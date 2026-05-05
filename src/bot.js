const config = require('./config');
const BybitExchange = require('./exchanges/bybit');
const BinanceExchange = require('./exchanges/binance');
const BitmexExchange = require('./exchanges/bitmex');
const LighterExchange = require('./exchanges/lighter');
const OkxExchange = require('./exchanges/okx');
const logger = require('./logger');
const db = require('./db');
const cmc = require('./cmc');

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
        this.cmcInterval = null;
        this.btcInterval = null;
        this.btcUsdPrice = null;

        this.dynamicThresholds = {};
        this.dynamicInterval = null;

        // In-memory store for recent order notifications (max 50)
        this.orderEvents = [];

        // In-memory store for recent trade evaluations (max 100), purged on restart
        this.tradeDecisions = [];
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

            // Strategy Validation
            if (!cfg.ENABLE_VWAP_STRATEGY && !cfg.ENABLE_RSI_STRATEGY && !cfg.ENABLE_ADX_STRATEGY) {
                logger.error('CRITICAL: No technical strategy enabled. Please enable VWAP, RSI, or ADX strategy in Settings.');
                throw new Error('No technical strategy enabled. Please enable at least one strategy.');
            }

            // CMC Filter Initialization
            if (cfg.CMC_FILTER_ENABLED) {
                try {
                    await this.refreshCmcRankings();
                } catch (cmcError) {
                    logger.error(`CRITICAL: CMC ranking list failed on startup. Bot will not start.`);
                    throw new Error(`CMC Filter Error: ${cmcError.message}`);
                }
            }

            // Setup Trading Exchange
            if (cfg.TRADE_EXCHANGE === 'binance') {
                this.tradeExchange = new BinanceExchange(this.config);
            } else if (cfg.TRADE_EXCHANGE === 'bitmex') {
                this.tradeExchange = new BitmexExchange(this.config);
            } else if (cfg.TRADE_EXCHANGE === 'lighter') {
                this.tradeExchange = new LighterExchange(this.config);
            } else if (cfg.TRADE_EXCHANGE === 'okx') {
                this.tradeExchange = new OkxExchange(this.config);
            } else {
                this.tradeExchange = new BybitExchange(this.config);
            }
            await this.tradeExchange.init();

            // Load pairs strictly from the chosen trading exchange
            logger.info('Fetching linear market instruments...');
            let allSymbols = await this.tradeExchange.getLinearSymbols();

            if (cfg.CMC_FILTER_ENABLED) {
                const originalCount = allSymbols.length;
                this.symbols = allSymbols.filter(s => cmc.isSymbolInTop(s));
                logger.info(`CMC Filter active: ${this.symbols.length}/${originalCount} pairs matched the Top ${cfg.CMC_RANK_LIMIT} ranking list.`);

                // Set refresh interval
                this.cmcInterval = setInterval(() => {
                    this.refreshCmcRankings().catch(e => logger.warn(`Periodic CMC refresh failed: ${e.message}`));
                }, 3600000); // 1 hour
            } else {
                this.symbols = allSymbols;
                logger.info(`Loaded ${this.symbols.length} active USDT pairs from ${cfg.TRADE_EXCHANGE.toUpperCase()}.`);
            }

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
                    } else if (exName === 'bitmex') {
                        this.liqExchanges[exName] = new BitmexExchange(this.config);
                    } else if (exName === 'lighter') {
                        this.liqExchanges[exName] = new LighterExchange(this.config);
                    } else if (exName === 'okx') {
                        this.liqExchanges[exName] = new OkxExchange(this.config);
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
            this.updateBtcPrice(); // Fetch once initially
            this.fetchDynamicThresholds(); // Fetch once initially

            this.pnlInterval = setInterval(() => this.updatePnL(), 600000); // Every 10 mins
            this.btcInterval = setInterval(() => this.updateBtcPrice(), 3600000); // Every hour
            this.dynamicInterval = setInterval(() => this.fetchDynamicThresholds(), 3600000); // Every hour
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
        clearInterval(this.cmcInterval);
        clearInterval(this.btcInterval);
        clearInterval(this.dynamicInterval);
    }

    async refreshCmcRankings() {
        const cfg = this.config.get();
        if (!cfg.CMC_FILTER_ENABLED) return;
        await cmc.getTopSymbols(cfg.CMC_API_KEY, cfg.CMC_RANK_LIMIT);
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

        const trailingPercent = cfg.ENABLE_TRAILING_PROFIT ? cfg.TRAILING_PROFIT_PERCENTAGE : 0;

        let targetTrailingActivationPrice = 0;
        if (trailingPercent > 0 && cfg.TRAILING_ACTIVATION_PERCENTAGE > 0) {
            const activationMultiplier = cfg.TRAILING_ACTIVATION_PERCENTAGE / 100;
            if (orderSide === 'buy') {
                targetTrailingActivationPrice = entryPrice * (1 + activationMultiplier);
            } else {
                targetTrailingActivationPrice = entryPrice * (1 - activationMultiplier);
            }
        }

        let shouldUpdate = false;

        if (trailingPercent > 0) {
            // Native trailing stop active. We track it in memory to avoid infinite loops if WS doesn't reflect the dynamic stop
            this._nativeTrailingSet = this._nativeTrailingSet || {};
            const trailingKey = `${symbol}_${orderSide}_${entryPrice}`; // Tie to this specific entry
            if (!this._nativeTrailingSet[trailingKey]) {
                shouldUpdate = true;
                this._nativeTrailingSet[trailingKey] = true;
            } else if (!isTpMatch) {
                // Only update again if TP is missing, to avoid creating duplicate trailing stops
                shouldUpdate = true;
            }
        } else {
            shouldUpdate = !isTpMatch || !isSlMatch;
        }

        // If Binance, we might not get TP/SL in position info via CCXT natively in some versions. Add basic throttle/cache if needed,
        // but normally CCXT watchPositions handles it. We'll proceed if there's no match.
        if (shouldUpdate) {
            // Anti-spam threshold
            this._lastTpSlSet = this._lastTpSlSet || {};
            const key = `${symbol}_${orderSide}`;
            const lastTime = this._lastTpSlSet[key] || 0;
            if (Date.now() - lastTime < 10000) return; // Prevent updating faster than 10s
            this._lastTpSlSet[key] = Date.now();

            let logMsg = `Updating TP/SL for ${symbol}. Entry: ${entryPrice.toFixed(4)}. Current TP: ${currentTp}, SL: ${currentSl} -> Target TP: ${formattedTp}, Target SL: ${formattedSl}`;
            if (trailingPercent > 0) {
                logMsg += ` (Trailing: Yes, ${trailingPercent}%, Active Price: ${targetTrailingActivationPrice > 0 ? targetTrailingActivationPrice.toFixed(4) : 'Immediate'})`;
            } else {
                logMsg += ` (Trailing: No)`;
            }
            logger.info(logMsg);
            await this.tradeExchange.setTpSl(symbol, orderSide, contracts, formattedTp, formattedSl, entryPrice, trailingPercent, targetTrailingActivationPrice);
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

    async updateBtcPrice() {
        if (!this.isRunning) return;
        try {
            if (this.tradeExchange && this.tradeExchange.exchange) {
                // If CCXT provides fetchTicker, use it for BTC/USDT to get the current conversion rate
                if (this.tradeExchange.exchange.has['fetchTicker']) {
                    const ticker = await this.tradeExchange.exchange.fetchTicker('BTC/USDT');
                    if (ticker && ticker.last) {
                        this.btcUsdPrice = ticker.last;
                        logger.debug(`BTC conversion price updated: $${this.btcUsdPrice}`);
                    }
                }
            }
        } catch (e) {
            logger.warn(`Failed to update BTC conversion price: ${e.message}`);
        }
    }

    async fetchDynamicThresholds() {
        if (!this.isRunning) return;
        const cfg = this.config.get();
        if (!cfg.ENABLE_DYNAMIC_THRESHOLDS || !cfg.LIQUIDATIONREPORT_KEY) {
            return;
        }

        try {
            logger.info('Fetching dynamic liquidation thresholds from liquidation.report...');
            const response = await fetch('https://liquidation-report.p.rapidapi.com/data', {
                headers: {
                    'X-RapidAPI-Key': cfg.LIQUIDATIONREPORT_KEY,
                    'X-RapidAPI-Host': 'liquidation-report.p.rapidapi.com'
                }
            });

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const json = await response.json();
            if (json && json.data && Array.isArray(json.data)) {
                const newThresholds = {};
                for (const item of json.data) {
                    if (item.name && item.mean_value) {
                        newThresholds[item.name.toUpperCase()] = parseFloat(item.mean_value);
                    }
                }
                this.dynamicThresholds = newThresholds;
                logger.info(`Successfully updated dynamic thresholds for ${Object.keys(newThresholds).length} base assets.`);
            }
        } catch (e) {
            logger.warn(`Failed to fetch dynamic thresholds: ${e.message}`);
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

            let thresholdInUsd = cfg.LIQUIDATION_VALUE_THRESHOLD;
            if (cfg.LIQUIDATION_VALUE_CURRENCY === 'BTC') {
                if (!this.btcUsdPrice) {
                    // Do not log warning on every liquidation as it could spam, just silently return until we have a price
                    return;
                }
                thresholdInUsd = cfg.LIQUIDATION_VALUE_THRESHOLD * this.btcUsdPrice;
            }

            let usingDynamic = false;
            if (cfg.ENABLE_DYNAMIC_THRESHOLDS) {
                const bases = Object.keys(this.dynamicThresholds).sort((a, b) => b.length - a.length);
                const symUpper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

                for (const base of bases) {
                    if (symUpper.startsWith(base)) {
                        thresholdInUsd = this.dynamicThresholds[base];
                        usingDynamic = true;
                        break;
                    }
                }
            }

            if (value >= thresholdInUsd) {
                logger.info(`--- Large Liquidation Detected ---`);
                if (usingDynamic) {
                    logger.info(`Symbol: ${symbol} | Price: ${price} | Value: $${value.toFixed(2)} (Dynamic Threshold: $${thresholdInUsd.toFixed(2)})`);
                } else if (cfg.LIQUIDATION_VALUE_CURRENCY === 'BTC') {
                    logger.info(`Symbol: ${symbol} | Price: ${price} | Value: $${value.toFixed(2)} (>= ${cfg.LIQUIDATION_VALUE_THRESHOLD} BTC ≈ $${thresholdInUsd.toFixed(2)})`);
                } else {
                    logger.info(`Symbol: ${symbol} | Price: ${price} | Value: $${value.toFixed(2)}`);
                }

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

    calculateRSI(closes, period = 14) {
        if (!closes || closes.length < period + 1) return null;
        let gains = 0;
        let losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff >= 0) gains += diff;
            else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;

        for (let i = period + 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            const gain = diff >= 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateADX(highs, lows, closes, period = 14) {
        if (!highs || highs.length < period * 2) return null;

        let tr = [];
        let plusDM = [];
        let minusDM = [];

        for (let i = 1; i < highs.length; i++) {
            const h = highs[i], l = lows[i], prevH = highs[i - 1], prevL = lows[i - 1], prevC = closes[i - 1];
            tr.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
            const upMove = h - prevH;
            const downMove = prevL - l;
            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        }

        const smooth = (data, period) => {
            let smoothed = [];
            let sum = 0;
            for (let i = 0; i < period; i++) sum += data[i];
            smoothed.push(sum);
            for (let i = period; i < data.length; i++) {
                const prev = smoothed[smoothed.length - 1];
                smoothed.push(prev - (prev / period) + data[i]);
            }
            return smoothed;
        };

        const smoothedTR = smooth(tr, period);
        const smoothedPlusDM = smooth(plusDM, period);
        const smoothedMinusDM = smooth(minusDM, period);

        let dx = [];
        let plusDIList = [];
        let minusDIList = [];
        for (let i = 0; i < smoothedTR.length; i++) {
            const trVal = smoothedTR[i];
            if (trVal === 0) {
                plusDIList.push(0); minusDIList.push(0); dx.push(0);
                continue;
            }
            const plusDI = 100 * (smoothedPlusDM[i] / trVal);
            const minusDI = 100 * (smoothedMinusDM[i] / trVal);
            plusDIList.push(plusDI);
            minusDIList.push(minusDI);
            const diSum = plusDI + minusDI;
            dx.push(diSum === 0 ? 0 : 100 * Math.abs(plusDI - minusDI) / diSum);
        }

        if (dx.length < period) return null;

        let adx = [];
        let sumDx = 0;
        for (let i = 0; i < period; i++) sumDx += dx[i];
        adx.push(sumDx / period);
        for (let i = period; i < dx.length; i++) {
            const prevAdx = adx[adx.length - 1];
            adx.push((prevAdx * (period - 1) + dx[i]) / period);
        }

        return {
            adx: adx[adx.length - 1],
            plusDI: plusDIList[plusDIList.length - 1],
            minusDI: minusDIList[minusDIList.length - 1]
        };
    }

    async evaluateTrade(symbol, currentPrice) {
        logger.info(`Evaluating trade for ${symbol} around price ${currentPrice}...`);
        const cfg = this.config.get();

        const decisionRecord = {
            timestamp: Date.now(),
            symbol: symbol,
            price: currentPrice,
            vwap: null,
            rsi: null,
            adx: null,
            confluence: null,
            reason: 'Evaluated',
            side: null
        };

        const pushDecision = (reason, side = null) => {
            decisionRecord.reason = reason;
            if (side) decisionRecord.side = side;
            this.tradeDecisions.unshift(decisionRecord);
            if (this.tradeDecisions.length > 100) this.tradeDecisions.pop();
        };

        const blacklistStr = cfg.COIN_BLACKLIST || '';
        const blacklist = blacklistStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (blacklist.length > 0) {
            const symUpper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
            const isBlacklisted = blacklist.some(b => symUpper.startsWith(b));
            if (isBlacklisted) {
                logger.info(`Symbol ${symbol} is blacklisted. Holding bot from opening new position.`);
                pushDecision('Blacklisted');
                return;
            }
        }

        try {
            let vwapSide = null;
            let rsiSide = null;
            let adxSide = null;

            // --- 1. VWAP Strategy ---
            if (cfg.ENABLE_VWAP_STRATEGY) {
                const ticker = await this.tradeExchange.fetchTicker(symbol);
                if (ticker && ticker.vwap) {
                    const vwap = ticker.vwap;
                    logger.info(`VWAP: ${vwap.toFixed(4)} | Current Price: ${currentPrice}`);
                    const offsetMultiplier = cfg.OFFSET_PERCENTAGE / 100;
                    const upperOffsetValue = vwap * (1 + offsetMultiplier);
                    const lowerOffsetValue = vwap * (1 - offsetMultiplier);

                    logger.info(`Upper Offset (+${cfg.OFFSET_PERCENTAGE}%): ${upperOffsetValue.toFixed(4)}`);
                    logger.info(`Lower Offset (-${cfg.OFFSET_PERCENTAGE}%): ${lowerOffsetValue.toFixed(4)}`);

                    if (currentPrice > upperOffsetValue) {
                        vwapSide = 'sell';
                        logger.info(`VWAP Condition met: Price ${currentPrice} > Upper VWAP ${upperOffsetValue.toFixed(4)}. Signal: SHORT.`);
                    } else if (currentPrice < lowerOffsetValue) {
                        vwapSide = 'buy';
                        logger.info(`VWAP Condition met: Price ${currentPrice} < Lower VWAP ${lowerOffsetValue.toFixed(4)}. Signal: LONG.`);
                    } else {
                        logger.info(`VWAP Condition: Price is within offset bounds. No trade signal.`);
                    }
                    decisionRecord.vwap = { value: vwap, upper: upperOffsetValue, lower: lowerOffsetValue, signal: vwapSide };
                } else {
                    logger.info(`No VWAP data available from ticker for ${symbol}.`);
                    decisionRecord.vwap = { error: 'No data' };
                }
            }

            // --- 2. RSI & ADX Shared Data Fetching ---
            let sharedKlines = null;
            const rsiEnabled = cfg.ENABLE_RSI_STRATEGY;
            const adxEnabled = cfg.ENABLE_ADX_STRATEGY;

            if ((rsiEnabled || adxEnabled) && this.tradeExchange?.exchange?.has['fetchOHLCV']) {
                // If both are enabled and share the same timeframe, fetch once with max limit
                if (rsiEnabled && adxEnabled && cfg.RSI_TIMEFRAME === cfg.ADX_TIMEFRAME) {
                    const rsiLimit = (parseInt(cfg.RSI_PERIOD) || 14) + 100;
                    const adxLimit = (parseInt(cfg.ADX_PERIOD) || 14) * 2 + 100;
                    const maxLimit = Math.max(rsiLimit, adxLimit);

                    try {
                        logger.info(`Fetching shared OHLCV for RSI & ADX (${cfg.RSI_TIMEFRAME}, limit: ${maxLimit})...`);
                        sharedKlines = await this.tradeExchange.exchange.fetchOHLCV(symbol, cfg.RSI_TIMEFRAME, undefined, maxLimit);
                    } catch (e) {
                        logger.error(`Error fetching shared OHLCV: ${e.message}`);
                    }
                }
            }

            // --- 3. RSI Strategy ---
            if (rsiEnabled) {
                if (this.tradeExchange?.exchange?.has['fetchOHLCV']) {
                    const period = parseInt(cfg.RSI_PERIOD) || 14;
                    let klines = sharedKlines;

                    // Fetch if not shared or shared fetch failed
                    if (!klines) {
                        try {
                            klines = await this.tradeExchange.exchange.fetchOHLCV(symbol, cfg.RSI_TIMEFRAME, undefined, period + 100);
                        } catch (e) {
                            logger.error(`Error fetching RSI OHLCV: ${e.message}`);
                        }
                    }

                    if (klines && klines.length > period) {
                        const closes = klines.map(k => k[4]); // Close price is index 4
                        const rsi = this.calculateRSI(closes, period);
                        if (rsi !== null) {
                            logger.info(`RSI (${period}, ${cfg.RSI_TIMEFRAME}): ${rsi.toFixed(2)}`);
                            if (rsi <= cfg.RSI_OVERSOLD) {
                                rsiSide = 'buy';
                                logger.info(`RSI Condition met: ${rsi.toFixed(2)} <= Oversold (${cfg.RSI_OVERSOLD}). Signal: LONG.`);
                            } else if (rsi >= cfg.RSI_OVERBOUGHT) {
                                rsiSide = 'sell';
                                logger.info(`RSI Condition met: ${rsi.toFixed(2)} >= Overbought (${cfg.RSI_OVERBOUGHT}). Signal: SHORT.`);
                            } else {
                                logger.info(`RSI Condition: Value is neutral. No trade signal.`);
                            }
                            decisionRecord.rsi = { value: rsi, oversold: cfg.RSI_OVERSOLD, overbought: cfg.RSI_OVERBOUGHT, signal: rsiSide };
                        }
                    } else {
                        logger.info(`Not enough klines fetched for RSI calculation for ${symbol}.`);
                        decisionRecord.rsi = { error: 'Not enough klines' };
                    }
                } else {
                    logger.info(`Exchange does not support fetchOHLCV for RSI.`);
                    decisionRecord.rsi = { error: 'Not supported' };
                }
            }

            // --- 4. ADX Strategy ---
            if (adxEnabled) {
                if (this.tradeExchange?.exchange?.has['fetchOHLCV']) {
                    const period = parseInt(cfg.ADX_PERIOD) || 14;
                    const threshold = parseFloat(cfg.ADX_THRESHOLD) || 25;
                    let klines = sharedKlines;

                    // Fetch if not shared or shared fetch failed
                    if (!klines) {
                        try {
                            klines = await this.tradeExchange.exchange.fetchOHLCV(symbol, cfg.ADX_TIMEFRAME, undefined, period * 2 + 100);
                        } catch (e) {
                            logger.error(`Error fetching ADX OHLCV: ${e.message}`);
                        }
                    }

                    if (klines && klines.length > period * 2) {
                        const highs = klines.map(k => k[2]);
                        const lows = klines.map(k => k[3]);
                        const closes = klines.map(k => k[4]);
                        const adxResult = this.calculateADX(highs, lows, closes, period);

                        if (adxResult !== null) {
                            logger.info(`ADX (${period}, ${cfg.ADX_TIMEFRAME}): ${adxResult.adx.toFixed(2)} | +DI: ${adxResult.plusDI.toFixed(2)} | -DI: ${adxResult.minusDI.toFixed(2)}`);
                            if (adxResult.adx >= threshold) {
                                if (adxResult.plusDI > adxResult.minusDI) {
                                    adxSide = 'sell';
                                    logger.info(`ADX Condition met: ADX >= ${threshold} and +DI > -DI. Signal: SHORT.`);
                                } else if (adxResult.minusDI > adxResult.plusDI) {
                                    adxSide = 'buy';
                                    logger.info(`ADX Condition met: ADX >= ${threshold} and -DI > +DI. Signal: LONG.`);
                                } else {
                                    logger.info(`ADX Condition: Value is weak but DIs are equal. No trade signal.`);
                                }
                            } else {
                                logger.info(`ADX Condition: ADX (${adxResult.adx.toFixed(2)}) is below threshold (${threshold}). No trade signal.`);
                            }
                            decisionRecord.adx = { value: adxResult.adx, plusDI: adxResult.plusDI, minusDI: adxResult.minusDI, threshold: threshold, signal: adxSide };
                        }
                    } else {
                        logger.info(`Not enough klines fetched for ADX calculation for ${symbol}.`);
                        decisionRecord.adx = { error: 'Not enough klines' };
                    }
                } else {
                    logger.info(`Exchange does not support fetchOHLCV for ADX.`);
                    decisionRecord.adx = { error: 'Not supported' };
                }
            }

            // --- 4. Confluence Logic (AND) ---
            let finalSide = null;
            const activeStrategies = [];
            if (cfg.ENABLE_VWAP_STRATEGY) activeStrategies.push({ name: 'VWAP', side: vwapSide });
            if (cfg.ENABLE_RSI_STRATEGY) activeStrategies.push({ name: 'RSI', side: rsiSide });
            if (cfg.ENABLE_ADX_STRATEGY) activeStrategies.push({ name: 'ADX', side: adxSide });

            if (activeStrategies.length > 0) {
                const allSame = activeStrategies.every(s => s.side && s.side === activeStrategies[0].side);
                if (allSame) {
                    finalSide = activeStrategies[0].side;
                    logger.info(`Confluence matched! Signals: ${activeStrategies.map(s => s.name).join(', ')} -> ${finalSide.toUpperCase()}`);
                    decisionRecord.confluence = { matched: true, side: finalSide };
                } else {
                    const signalsStr = activeStrategies.map(s => `${s.name}: ${s.side || 'none'}`).join(', ');
                    logger.info(`Confluence missed or conflicting signals. ${signalsStr}. No trade.`);
                    decisionRecord.confluence = { matched: false, signals: signalsStr };
                    pushDecision('No Confluence');
                    return;
                }
            } else {
                decisionRecord.confluence = { matched: false, signals: 'No strategies enabled' };
            }

            if (!finalSide) {
                pushDecision('No Signal');
                return;
            }

            const positions = db.getPositions();
            const hasPosition = positions.some(p => p.symbol === symbol);
            const maxPositions = cfg.MAX_OPEN_POSITIONS || 3;
            if (!hasPosition && positions.length >= maxPositions) {
                logger.info(`Max open positions (${maxPositions}) reached. Holding bot from opening new position for ${symbol}.`);
                pushDecision('Max Positions Reached');
                return;
            }

            await this.executeTrade(symbol, finalSide, currentPrice, cfg);
            pushDecision('Trade Executed', finalSide);

        } catch (error) {
            this.handleError(`Error in evaluateTrade for ${symbol}: ${error.message}`);
            pushDecision(`Error: ${error.message}`);
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

            if (cfg.ENABLE_DCA_MARTINGALE) {
                const positions = db.getPositions();
                const position = positions.find(p => p.symbol === symbol);
                let multiplier = 1;

                if (position && position.size > 0 && position.entry_price > 0) {
                    const margin = (position.size * position.entry_price) / cfg.TRADE_LEVERAGE;
                    if (margin > 0) {
                        const pnlPercent = (position.unrealized_pnl / margin) * 100;
                        multiplier = Math.ceil(Math.abs(pnlPercent));
                        if (multiplier === 0) multiplier = 1;
                    }
                }

                amountInToken = amountInToken * multiplier;
                logger.info(`DCA Martingale Multiplier for ${symbol}: ${multiplier}x`);
            }

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

            // Push order notification for the web UI toast system
            const orderEvent = {
                id: order.id || `local-${Date.now()}`,
                symbol,
                side: side.toUpperCase(),
                type: 'MARKET',
                amount: amountInToken,
                price: order.average || order.price || entryPrice,
                leverage: cfg.TRADE_LEVERAGE,
                value: (order.average || entryPrice) * amountInToken,
                timestamp: Date.now(),
                seen: false
            };
            this.orderEvents.unshift(orderEvent);
            if (this.orderEvents.length > 50) this.orderEvents.pop();

            // Removed TP/SL setting from here since we can't get accurate entry price immediately.
            // TP/SL is now handled in onPositionUpdate.

        } catch (error) {
            this.handleError(`Error executing trade for ${symbol}: ${error.message}`);
        }
    }
}

module.exports = TradingBot;
