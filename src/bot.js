const config = require('./config');
const BybitExchange = require('./exchanges/bybit');
const BinanceExchange = require('./exchanges/binance');
const logger = require('./logger');
const db = require('./db');

class TradingBot {
    constructor() {
        this.config = config;
        this.tradeExchange = null;
        this.liqExchanges = {};

        this.isTrading = false;
        this.isRunning = false;
        this.symbols = [];

        this.errorCount = 0;
        this.errorTimer = null;

        this.pnlInterval = null;
        this.cleanupInterval = null;
    }

    async handleError(errMessage) {
        this.errorCount++;
        logger.error(`[Error Tracking: ${this.errorCount}/15] ${errMessage}`);

        if (this.errorCount >= 15) {
            logger.error('CRITICAL: Too many consecutive errors. Automatically stopping the bot to protect capital.');
            await this.stop();
            this.config.set('BOT_RUNNING_STATE', 'false');
        }

        clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => {
            if (this.errorCount > 0) {
                this.errorCount = 0;
                logger.info('Error tracking reset back to 0 due to 60 seconds of stability.');
            }
        }, 60000);
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.errorCount = 0;
        clearTimeout(this.errorTimer);
        logger.info('Starting Trading Bot Engine...');
        
        // Purge old liquidation history to keep DB size minimum
        logger.info('Purging outdated liquidation history from database...');
        db.purgeLiquidations();

        try {
            const cfg = this.config.get();

            // Setup Trading Exchange
            if (cfg.TRADE_EXCHANGE === 'binance') {
                this.tradeExchange = new BinanceExchange(this.config);
            } else {
                this.tradeExchange = new BybitExchange(this.config);
            }
            await this.tradeExchange.init();

            // Load pairs strictly from the chosen trading exchange
            logger.info('Fetching linear market instruments...');
            this.symbols = await this.tradeExchange.getLinearSymbols();
            logger.info(`Loaded ${this.symbols.length} active USDT pairs from ${cfg.TRADE_EXCHANGE.toUpperCase()}.`);

            // Setup Liquidation Exchanges
            this.liqExchanges = {};
            const activeLiqSettings = (cfg.LIQUIDATION_EXCHANGES || 'bybit').split(',').map(s => s.trim()).filter(Boolean);
            for (const exName of activeLiqSettings) {
                if (exName === cfg.TRADE_EXCHANGE) {
                    // Reuse the existing validated trading instance, avoiding a double loadMarkets
                    this.liqExchanges[exName] = this.tradeExchange;
                } else {
                    if (exName === 'binance') {
                        this.liqExchanges[exName] = new BinanceExchange(this.config);
                    } else {
                        this.liqExchanges[exName] = new BybitExchange(this.config);
                    }
                    await this.liqExchanges[exName].init();
                }
                logger.info(`Liquidation stream mapped for ${exName}.`);
            }

            logger.info(`Trading on ${cfg.TRADE_EXCHANGE.toUpperCase()}`);
            logger.info(`Listening for liquidations > $${cfg.LIQUIDATION_VALUE_THRESHOLD}`);

            // Initial Balance Fetch
            try {
                const initialBalance = await this.tradeExchange.fetchBalance();
                if (initialBalance && initialBalance.USDT) {
                    const total = initialBalance.USDT.total || 0;
                    const free = initialBalance.USDT.free || 0;
                    const used = initialBalance.USDT.used > 0 ? initialBalance.USDT.used : Math.max(0, total - free);

                    this.onBalanceUpdate({
                        total_value: total,
                        margin_available: free,
                        margin_used: used
                    });
                    logger.info(`Initial account balance fetched: $${initialBalance.USDT.total}`);
                }
            } catch (balanceError) {
                logger.warn(`Could not fetch initial balance via REST: ${balanceError.message}`);
            }

            // Kickoff Private Account Streams on Trade Exchange
            this.tradeExchange.watchPrivateBalance(this.onBalanceUpdate.bind(this), () => this.isRunning, this.handleError.bind(this));
            this.tradeExchange.watchPrivatePositions(this.onPositionUpdate.bind(this), () => this.isRunning, this.handleError.bind(this));

            // Kickoff Public Liquidation Stream on all Liq Exchanges using unified symbols
            for (const [exName, exInstance] of Object.entries(this.liqExchanges)) {
                // Before starting watchLiquidations check liquidation stream setting
                if (!activeLiqSettings.includes(exName)) {
                    continue;
                }

                let safeSymbols = this.symbols;
                if (exInstance.exchange && exInstance.exchange.markets) {
                    safeSymbols = this.symbols.filter(sym => exInstance.exchange.markets[sym] !== undefined);
                }
                exInstance.watchLiquidations(safeSymbols, (liq) => this.onLiquidation(liq, exName), () => this.isRunning, this.handleError.bind(this));
                logger.info(`Starting Liquidation stream for ${exName} with ${safeSymbols.length} validated pairs.`);
            }

            // Kickoff Periodic REST PnL Tracker and Position Pruner
            this.updatePnL(); // Fetch once initially
            this.pnlInterval = setInterval(() => this.updatePnL(), 600000); // Every 10 mins
            this.cleanupInterval = setInterval(() => {
                this.checkAndRemoveStalePositions().catch(e => logger.error(`Cleanup error: ${e.message}`));
                db.pruneLiquidations(500);
            }, 10000); // Every 10 secs

        } catch (error) {
            await this.handleError(`Failed to start engine cleanly: ${error.message}`);
            if (this.isRunning) {
                this.isRunning = false;
                this.config.set('BOT_RUNNING_STATE', 'false');
            }
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) return;
        logger.info('Stopping Trading Bot Engine...');
        this.isRunning = false;
        this.symbols = [];
        this.errorCount = 0;
        clearTimeout(this.errorTimer);
        clearInterval(this.pnlInterval);
        clearInterval(this.cleanupInterval);
    }

    async checkAndRemoveStalePositions() {
        if (!this.isRunning) return;

        const stalePositions = db.getStalePositions(60000);
        if (!stalePositions || stalePositions.length === 0) return;

        logger.info(`Found ${stalePositions.length} stale position(s). Double-checking via API...`);
        try {
            if (this.tradeExchange && this.tradeExchange.exchange && this.tradeExchange.exchange.has['fetchPositions']) {
                const apiPositions = await this.tradeExchange.exchange.fetchPositions();

                for (const stale of stalePositions) {
                    const apiMatch = apiPositions.find(p => p.symbol === stale.symbol);
                    const stillOpen = apiMatch && (parseFloat(apiMatch.contracts) > 0 || parseFloat(apiMatch.info?.size) > 0);

                    if (stillOpen) {
                        logger.info(`Stale position ${stale.symbol} is actually still open. Syncing...`);
                        this.onPositionUpdate([apiMatch]);
                    } else {
                        logger.info(`Stale position ${stale.symbol} confirmed closed. Removing.`);
                        db.removePosition(stale.symbol);
                    }
                }
            } else {
                db.removeStalePositions(60000);
            }
        } catch (e) {
            logger.error(`Error checking stale positions: ${e.message}`);
        }
    }

    onBalanceUpdate(data) {
        db.updateAccountState(data);
    }

    async onPositionUpdate(positions) {
        if (!Array.isArray(positions)) positions = [positions];

        const state = db.getAccountState();
        const hasZeroOrEmpty = positions.length === 0 || positions.every(p => p.contracts === 0 || p.contracts === undefined);

        if (hasZeroOrEmpty && state && state.margin_used > 0) {
            logger.info("Position WS returned empty/0 but used margin is > 0. Fetching via API fetchPositions...");
            try {
                if (this.tradeExchange.exchange.has['fetchPositions']) {
                    positions = await this.tradeExchange.exchange.fetchPositions();
                }
            } catch (e) {
                logger.error(`Error fetching positions via API: ${e.message}`);
            }
        }

        for (const p of positions) {
            const contracts = p.contracts || parseFloat(p.info?.size) || 0;
            if (contracts === 0 || contracts === undefined) {
                if (p.symbol) db.db.prepare('DELETE FROM positions WHERE symbol = ?').run(p.symbol);
                continue;
            }

            let currentTp = parseFloat(p.takeProfitPrice || p.info?.takeProfit || p.info?.tpPrice || p.info?.takeProfitPrice || 0);
            let currentSl = parseFloat(p.stopLossPrice || p.info?.stopLoss || p.info?.slPrice || p.info?.stopLossPrice || 0);

            let s_size = contracts;
            let s_entryPrice = p.entryPrice || 0;
            let s_markPrice = p.markPrice || 0;
            let s_liqPrice = p.liquidationPrice || 0;
            let s_unrealizedPnl = p.unrealizedPnl || parseFloat(p.info?.unrealisedPnl) || 0;

            if (this.tradeExchange && this.tradeExchange.exchange) {
                try {
                    if (s_size) s_size = parseFloat(this.tradeExchange.exchange.amountToPrecision(p.symbol, s_size));
                    if (s_entryPrice) s_entryPrice = parseFloat(this.tradeExchange.exchange.priceToPrecision(p.symbol, s_entryPrice));
                    if (s_markPrice) s_markPrice = parseFloat(this.tradeExchange.exchange.priceToPrecision(p.symbol, s_markPrice));
                    if (s_liqPrice) s_liqPrice = parseFloat(this.tradeExchange.exchange.priceToPrecision(p.symbol, s_liqPrice));
                    if (currentTp) currentTp = parseFloat(this.tradeExchange.exchange.priceToPrecision(p.symbol, currentTp));
                    if (currentSl) currentSl = parseFloat(this.tradeExchange.exchange.priceToPrecision(p.symbol, currentSl));

                    if (s_unrealizedPnl) {
                        const sign = Math.sign(s_unrealizedPnl);
                        const absPnl = Math.abs(s_unrealizedPnl);
                        s_unrealizedPnl = sign * parseFloat(this.tradeExchange.exchange.priceToPrecision(p.symbol, absPnl));
                    }
                } catch (e) {
                    logger.debug(`Precision formatting failed for ${p.symbol}: ${e.message}`);
                }
            }

            const dbPos = {
                symbol: p.symbol,
                side: p.side || 'unknown',
                size: s_size || 0,
                entry_price: s_entryPrice || 0,
                mark_price: s_markPrice || 0,
                liq_price: s_liqPrice || 0,
                tp_price: currentTp || 0,
                sl_price: currentSl || 0,
                unrealized_pnl: s_unrealizedPnl || 0
            };
            db.updatePosition(dbPos);

            this.handleTpSl(p, contracts).catch(err => logger.error(`TP/SL handler error: ${err.message}`));
        }
    }

    async handleTpSl(p, contracts) {
        const symbol = p.symbol;
        const side = (p.side || 'unknown').toLowerCase();
        const entryPrice = parseFloat(p.entryPrice);

        if (contracts <= 0 || !entryPrice) return;

        let orderSide = side;
        if (side === 'long') orderSide = 'buy';
        if (side === 'short') orderSide = 'sell';
        if (orderSide === 'unknown') return;

        const cfg = this.config.get();
        const tpMultiplier = cfg.TAKE_PROFIT_PERCENTAGE / 100;
        const slMultiplier = cfg.STOP_LOSS_PERCENTAGE / 100;

        let targetTpPrice, targetSlPrice;
        if (orderSide === 'buy') {
            targetTpPrice = entryPrice * (1 + tpMultiplier);
            targetSlPrice = entryPrice * (1 - slMultiplier);
        } else {
            targetTpPrice = entryPrice * (1 - tpMultiplier);
            targetSlPrice = entryPrice * (1 + slMultiplier);
        }

        if (!this.tradeExchange || !this.tradeExchange.exchange) return;

        const formattedTp = parseFloat(this.tradeExchange.exchange.priceToPrecision(symbol, targetTpPrice));
        const formattedSl = parseFloat(this.tradeExchange.exchange.priceToPrecision(symbol, targetSlPrice));

        // Read current TP/SL
        let currentTp = parseFloat(p.takeProfitPrice || p.info?.takeProfit || p.info?.tpPrice || p.info?.takeProfitPrice || 0);
        let currentSl = parseFloat(p.stopLossPrice || p.info?.stopLoss || p.info?.slPrice || p.info?.stopLossPrice || 0);

        const isTpMatch = !isNaN(currentTp) && currentTp > 0 && Math.abs(currentTp - formattedTp) / formattedTp < 0.005;
        const isSlMatch = !isNaN(currentSl) && currentSl > 0 && Math.abs(currentSl - formattedSl) / formattedSl < 0.005;

        // If Binance, we might not get TP/SL in position info via CCXT natively in some versions. Add basic throttle/cache if needed,
        // but normally CCXT watchPositions handles it. We'll proceed if there's no match.
        if (!isTpMatch || !isSlMatch) {
            // Anti-spam threshold
            this._lastTpSlSet = this._lastTpSlSet || {};
            const key = `${symbol}_${orderSide}`;
            const lastTime = this._lastTpSlSet[key] || 0;
            if (Date.now() - lastTime < 10000) return; // Prevent updating faster than 10s
            this._lastTpSlSet[key] = Date.now();

            logger.info(`Updating TP/SL for ${symbol}. Entry: ${entryPrice.toFixed(4)}. Current TP: ${currentTp}, SL: ${currentSl} -> Target TP: ${formattedTp}, SL: ${formattedSl}`);
            await this.tradeExchange.setTpSl(symbol, orderSide, contracts, formattedTp, formattedSl);
        }
    }

    async updatePnL() {
        if (!this.isRunning) return;
        try {
            const pnlData = await this.tradeExchange.fetchAggregatedPnl();
            if (pnlData) {
                db.updateAccountState(pnlData);
                logger.debug(`Aggregated PnL updated. Daily: $${pnlData.daily_pnl.toFixed(2)}`);
            }
        } catch (e) {
            logger.error(`Failed to update PnL loop: ${e.message}`);
        }
    }



    async onLiquidation(liquidation, exName) {
        if (this.isTrading || !this.isRunning) return;

        try {
            const cfg = this.config.get();
            const symbol = liquidation.symbol;
            const price = liquidation.price;
            const amount = liquidation.contracts || liquidation.baseVolume || 0;
            const value = price * amount;

            let rawSide = (liquidation.side || 'unknown').toLowerCase();
            let unifiedSide = 'UNKNOWN';
            if (['buy', 'long', 'b'].includes(rawSide)) unifiedSide = 'BUY';
            if (['sell', 'short', 's'].includes(rawSide)) unifiedSide = 'SELL';

            // Add raw liquidation to SQLite for UI monitoring
            db.addLiquidation({
                symbol: symbol,
                exchange: exName || 'unknown',
                side: unifiedSide,
                price: price,
                amount: amount,
                value: value,
                timestamp: liquidation.timestamp || Date.now()
            });

            if (value >= cfg.LIQUIDATION_VALUE_THRESHOLD) {
                logger.info(`--- Large Liquidation Detected ---`);
                logger.info(`Symbol: ${symbol} | Price: ${price} | Value: $${value.toFixed(2)}`);

                this.isTrading = true;
                await this.evaluateTrade(symbol, price);
            }
        } catch (error) {
            this.handleError(`Error handling liquidation: ${error.message}`);
        } finally {
            if (this.isRunning) {
                setTimeout(() => {
                    this.isTrading = false;
                }, 5000);
            } else {
                this.isTrading = false;
            }
        }
    }

    async evaluateTrade(symbol, currentPrice) {
        logger.info(`Evaluating trade for ${symbol} around price ${currentPrice}...`);
        const cfg = this.config.get();

        try {
            const ticker = await this.tradeExchange.fetchTicker(symbol);

            if (!ticker || !ticker.vwap) {
                logger.info(`No VWAP data available from ticker for ${symbol}.`);
                return;
            }

            const vwap = ticker.vwap;
            logger.info(`VWAP: ${vwap.toFixed(4)} | Current Price: ${currentPrice}`);

            const offsetMultiplier = cfg.OFFSET_PERCENTAGE / 100;
            const upperOffsetValue = vwap * (1 + offsetMultiplier);
            const lowerOffsetValue = vwap * (1 - offsetMultiplier);

            logger.info(`Upper Offset (+${cfg.OFFSET_PERCENTAGE}%): ${upperOffsetValue.toFixed(4)}`);
            logger.info(`Lower Offset (-${cfg.OFFSET_PERCENTAGE}%): ${lowerOffsetValue.toFixed(4)}`);

            let side = null;

            if (currentPrice > upperOffsetValue) {
                side = 'sell';
                logger.info(`Condition met: Price ${currentPrice} > Upper VWAP ${upperOffsetValue.toFixed(4)}. Signal: SHORT.`);
            } else if (currentPrice < lowerOffsetValue) {
                side = 'buy';
                logger.info(`Condition met: Price ${currentPrice} < Lower VWAP ${lowerOffsetValue.toFixed(4)}. Signal: LONG.`);
            } else {
                logger.info(`Price is within offset bounds. No trade signal.`);
                return;
            }

            const positions = db.getPositions();
            const hasPosition = positions.some(p => p.symbol === symbol);
            const maxPositions = cfg.MAX_OPEN_POSITIONS || 3;
            if (!hasPosition && positions.length >= maxPositions) {
                logger.info(`Max open positions (${maxPositions}) reached. Holding bot from opening new position for ${symbol}.`);
                return;
            }

            await this.executeTrade(symbol, side, currentPrice, cfg);

        } catch (error) {
            this.handleError(`Error in evaluateTrade for ${symbol}: ${error.message}`);
        }
    }

    async executeTrade(symbol, side, entryPrice, cfg) {
        try {
            const balance = await this.tradeExchange.fetchBalance();
            const totalWalletUSDT = balance.USDT ? balance.USDT.total : 0;

            if (totalWalletUSDT <= 0) {
                logger.info('Insufficient total wallet balance to trade.');
                return;
            }

            const tradeValue = (totalWalletUSDT * cfg.TRADE_LEVERAGE) * (cfg.TRADE_AMOUNT_PERCENTAGE / 100);
            let amountInToken = tradeValue / entryPrice;

            if (this.tradeExchange.exchange && this.tradeExchange.exchange.amountToPrecision) {
                const formatted = this.tradeExchange.exchange.amountToPrecision(symbol, amountInToken);
                amountInToken = parseFloat(formatted);
            }

            if (!amountInToken || amountInToken <= 0) {
                logger.info(`Calculated amount for ${symbol} is too small after precision formatting. Order aborted.`);
                return;
            }

            await this.tradeExchange.setLeverage(cfg.TRADE_LEVERAGE, symbol);

            logger.info(`Executing naked ${side.toUpperCase()} Market order for ${amountInToken} ${symbol}...`);
            const order = await this.tradeExchange.exchange.createOrder(
                symbol,
                'market',
                side,
                amountInToken
            );

            logger.info(`Trade successfully executed! Order ID: ${order.id}`);

            // Removed TP/SL setting from here since we can't get accurate entry price immediately.
            // TP/SL is now handled in onPositionUpdate.

        } catch (error) {
            this.handleError(`Error executing trade for ${symbol}: ${error.message}`);
        }
    }
}

module.exports = TradingBot;
