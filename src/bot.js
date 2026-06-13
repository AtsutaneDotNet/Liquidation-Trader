const config = require('./config');
const BybitExchange = require('./exchanges/bybit');
const BinanceExchange = require('./exchanges/binance');
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

        this.marketSentiment = null;
        this.marketSentimentInterval = null;

        // In-memory store for recent order notifications (max 50)
        this.orderEvents = [];

        // In-memory store for recent trade evaluations (max 100), purged on restart
        this.tradeDecisions = [];

        // Cache to prevent duplicate trade notifications
        this.seenTradeIds = new Set();
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
            if (!cfg.ENABLE_VWAP_STRATEGY && !cfg.ENABLE_RSI_STRATEGY && !cfg.ENABLE_DMI_STRATEGY && !cfg.ENABLE_MARKET_SENTIMENT_STRATEGY) {
                logger.error('CRITICAL: No technical strategy enabled. Please enable VWAP, RSI, DMI, or Market Sentiment strategy in Settings.');
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
            } else if (cfg.TRADE_EXCHANGE === 'okx') {
                this.tradeExchange = new OkxExchange(this.config);
            } else {
                this.tradeExchange = new BybitExchange(this.config);
            }
            await this.tradeExchange.init();

            // Load pairs strictly from the chosen trading exchange
            logger.info('Fetching linear market instruments...');
            let allSymbols = await this.tradeExchange.getLinearSymbols();

            // Filter out blacklisted symbols
            const blacklistStr = cfg.COIN_BLACKLIST || '';
            const blacklist = blacklistStr.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            if (blacklist.length > 0) {
                const originalCount = allSymbols.length;
                allSymbols = allSymbols.filter(symbol => {
                    const symUpper = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    return !blacklist.some(b => symUpper.startsWith(b));
                });
                logger.info(`Blacklist filter active: Removed ${originalCount - allSymbols.length} blacklisted pairs. ${allSymbols.length} pairs remaining.`);
            }

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
                const parsedData = this.tradeExchange.parseBalanceData(initialBalance);
                if (parsedData) {
                    this.onBalanceUpdate(parsedData);
                    logger.info(`Initial account balance fetched: $${parsedData.total_value}`);
                }
            } catch (balanceError) {
                logger.warn(`Could not fetch initial balance via REST: ${balanceError.message}`);
            }

            // Kickoff Private Account Streams on Trade Exchange
            this.tradeExchange.watchPrivateBalance(this.onBalanceUpdate.bind(this), () => this.isRunning, (err) => logger.warn(err));
            this.tradeExchange.watchPrivatePositions(this.onPositionUpdate.bind(this), () => this.isRunning, (err) => logger.warn(err));
            this.tradeExchange.watchPrivateTrades(this.onTradeUpdate.bind(this), () => this.isRunning, (err) => logger.warn(err));

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
                exInstance.watchLiquidations(safeSymbols, (liq) => this.onLiquidation(liq, exName), () => this.isRunning, (err) => logger.warn(err));
                logger.info(`Starting Liquidation stream for ${exName} with ${safeSymbols.length} validated pairs.`);
            }

            // Kickoff Periodic REST PnL Tracker and Position Pruner
            this.updatePnL(); // Fetch once initially
            this.updateBtcPrice(); // Fetch once initially
            this.fetchDynamicThresholds(); // Fetch once initially
            this.updateMarketSentiment(); // Fetch once initially
            this.sendAnonReport(); // Fetch once initially

            this.pnlInterval = setInterval(() => this.updatePnL(), 600000); // Every 10 mins
            this.btcInterval = setInterval(() => this.updateBtcPrice(), 3600000); // Every hour
            this.dynamicInterval = setInterval(() => this.fetchDynamicThresholds(), 3600000); // Every hour
            this.marketSentimentInterval = setInterval(() => this.updateMarketSentiment(), 3600000); // Every hour
            this.anonReportInterval = setInterval(() => this.sendAnonReport(), 900000); // Every 15 mins
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
        clearInterval(this.marketSentimentInterval);
        clearInterval(this.anonReportInterval);
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

                        const cfg = this.config.get();
                        if (cfg.ENABLE_RUNAWAY_HELPER) {
                            const runawayThreshold = parseFloat(cfg.RUNAWAY_HELPER_THRESHOLD) || -10;
                            const contracts = parseFloat(apiMatch.contracts) || parseFloat(apiMatch.info?.size) || 0;
                            const entryPrice = parseFloat(apiMatch.entryPrice);
                            const markPrice = parseFloat(apiMatch.markPrice);
                            const leverage = parseFloat(cfg.TRADE_LEVERAGE) || 10;
                            const unrealizedPnl = parseFloat(apiMatch.unrealizedPnl || apiMatch.info?.unrealisedPnl || 0);

                            if (contracts > 0 && entryPrice > 0) {
                                const margin = (contracts * entryPrice) / leverage;
                                if (margin > 0) {
                                    const pnlPercent = (unrealizedPnl / margin) * 100;
                                    if (pnlPercent < runawayThreshold) {
                                        logger.info(`Runaway Helper triggered for ${stale.symbol}. PNL% ${pnlPercent.toFixed(2)}% < ${runawayThreshold}%. Evaluating trade...`);
                                        this.evaluateTrade(stale.symbol, markPrice).catch(e => logger.error(`Runaway evaluateTrade error: ${e.message}`));
                                    }
                                }
                            }
                        }
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

            if ((!currentTp || !currentSl) && this.tradeExchange && this.tradeExchange.exchange && typeof this.tradeExchange.exchange.fapiPrivateGetOpenAlgoOrders === 'function') {
                try {
                    const marketId = this.tradeExchange.exchange.market(p.symbol).id;
                    const openAlgoOrders = await this.tradeExchange.exchange.fapiPrivateGetOpenAlgoOrders({ symbol: marketId });
                    if (Array.isArray(openAlgoOrders)) {
                        for (const order of openAlgoOrders) {
                            const type = (order.orderType || '').toUpperCase();
                            const triggerPrice = parseFloat(order.triggerPrice || order.stopPrice || 0);
                            if (triggerPrice > 0) {
                                if (type === 'TAKE_PROFIT_MARKET' && !currentTp) {
                                    currentTp = triggerPrice;
                                } else if (type === 'STOP_MARKET' && !currentSl) {
                                    currentSl = triggerPrice;
                                }
                            }
                        }
                    }
                } catch (e) {
                    logger.warn(`[onPositionUpdate] Failed to fetch open algo orders for ${p.symbol}: ${e.message}`);
                }
            }

            p.takeProfitPrice = currentTp;
            p.stopLossPrice = currentSl;

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

    async onTradeUpdate(trades) {
        if (!Array.isArray(trades)) trades = [trades];
        for (const trade of trades) {
            if (!trade.id || this.seenTradeIds.has(trade.id)) continue;
            this.seenTradeIds.add(trade.id);
            if (this.seenTradeIds.size > 500) {
                const iterator = this.seenTradeIds.values();
                this.seenTradeIds.delete(iterator.next().value);
            }

            // Check if this trade belongs to a known entry order
            const isEntry = this.orderEvents.some(e => e.id === trade.order || e.id === trade.id);
            if (!isEntry) {
                let pnl = trade.info?.realizedPnl || trade.info?.realisedPnl || trade.info?.closedPnl || trade.info?.execProfit;
                if (pnl !== undefined && !isNaN(parseFloat(pnl))) pnl = parseFloat(pnl);

                const orderEvent = {
                    id: trade.id,
                    symbol: trade.symbol || 'UNKNOWN',
                    side: (trade.side || 'unknown').toUpperCase(),
                    type: 'CLOSE',
                    amount: trade.amount || 0,
                    price: trade.price || 0,
                    leverage: this.config.get().TRADE_LEVERAGE || 1,
                    value: (trade.price || 0) * (trade.amount || 0),
                    timestamp: trade.timestamp || Date.now(),
                    seen: false,
                    isClose: true,
                    realizedPnl: pnl
                };
                this.orderEvents.unshift(orderEvent);
                if (this.orderEvents.length > 50) this.orderEvents.pop();

                // Fallback for exchanges without REST Closed PnL
                const cfg = this.config.get();
                if (['okx'].includes(cfg.TRADE_EXCHANGE)) {
                    db.addClosedPnl({
                        id: trade.id || `ws_${trade.symbol}_${Date.now()}`,
                        symbol: trade.symbol || 'UNKNOWN',
                        side: trade.side ? trade.side.toUpperCase() : 'N/A',
                        size: trade.amount || 0,
                        entry_price: 0,
                        close_price: trade.price || 0,
                        pnl: pnl || 0,
                        timestamp: trade.timestamp || Date.now()
                    });

                    db.updateAccountState(db.calculateAggregatedPnl());
                }

                // Remove the position from the DB so the UI reflects the closure immediately
                if (trade.symbol) {
                    db.removePosition(trade.symbol);
                }
            }
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
            if (Date.now() - lastTime < 1000) return; // Prevent updating faster than 1s
            this._lastTpSlSet[key] = Date.now();

            let logMsg = `Updating TP/SL for ${symbol}. Entry: ${entryPrice.toFixed(4)}. Current TP: ${currentTp}, SL: ${currentSl} -> Target TP: ${formattedTp}, Target SL: ${formattedSl}`;
            if (trailingPercent > 0) {
                logMsg += ` (Trailing: Yes, ${trailingPercent}%, Active Price: ${targetTrailingActivationPrice > 0 ? targetTrailingActivationPrice.toFixed(4) : 'Immediate'})`;
            } else {
                logMsg += ` (Trailing: No)`;
            }
            logger.info(logMsg);
            try {
                await this.tradeExchange.setTpSl(symbol, orderSide, contracts, formattedTp, formattedSl, entryPrice, trailingPercent, targetTrailingActivationPrice);
            } catch (error) {
                logger.error(`Failed to set TP/SL/Trailing for ${symbol}: ${error.message}`);
                await this.executeFallbackClose(symbol, orderSide, contracts, entryPrice, formattedTp, formattedSl, trailingPercent, targetTrailingActivationPrice, cfg);
            }
        }
    }

    async executeFallbackClose(symbol, orderSide, contracts, entryPrice, formattedTp, formattedSl, trailingPercent, targetTrailingActivationPrice, cfg) {
        try {
            logger.info(`Running fallback logic for ${symbol}...`);
            let currentPrice = null;

            if (this.tradeExchange && this.tradeExchange.exchange && this.tradeExchange.exchange.has['fetchTicker']) {
                const ticker = await this.tradeExchange.exchange.fetchTicker(symbol);
                if (ticker && ticker.last) {
                    currentPrice = ticker.last;
                }
            }

            if (!currentPrice) {
                logger.warn(`Fallback for ${symbol} failed: Could not fetch latest price.`);
                return;
            }

            let pnlPercent = 0;
            if (orderSide === 'buy') {
                pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
            } else {
                pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
            }

            let targetThresholdPercent = cfg.TAKE_PROFIT_PERCENTAGE;
            if (trailingPercent > 0 && cfg.TRAILING_ACTIVATION_PERCENTAGE > 0) {
                targetThresholdPercent = Math.min(cfg.TAKE_PROFIT_PERCENTAGE, cfg.TRAILING_ACTIVATION_PERCENTAGE);
            }

            let shouldClose = false;

            if (orderSide === 'buy') {
                const passedTp = currentPrice >= formattedTp;
                const passedTrailing = (trailingPercent > 0 && targetTrailingActivationPrice > 0) ? (currentPrice >= targetTrailingActivationPrice) : false;

                if (passedTp || passedTrailing) {
                    if (pnlPercent >= targetThresholdPercent) {
                        shouldClose = true;
                    } else {
                        logger.info(`Fallback holding ${symbol} close: Pnl% (${pnlPercent.toFixed(2)}%) is below threshold (${targetThresholdPercent}%).`);
                    }
                }
            } else if (orderSide === 'sell') {
                const passedTp = currentPrice <= formattedTp;
                const passedTrailing = (trailingPercent > 0 && targetTrailingActivationPrice > 0) ? (currentPrice <= targetTrailingActivationPrice) : false;

                if (passedTp || passedTrailing) {
                    if (pnlPercent >= targetThresholdPercent) {
                        shouldClose = true;
                    } else {
                        logger.info(`Fallback holding ${symbol} close: Pnl% (${pnlPercent.toFixed(2)}%) is below threshold (${targetThresholdPercent}%).`);
                    }
                }
            }

            if (shouldClose) {
                logger.info(`Market volatility fallback triggered! Closing position for ${symbol} at Market. Pnl%: ${pnlPercent.toFixed(2)}% >= Target Threshold: ${targetThresholdPercent}%`);
                const closeSide = orderSide === 'buy' ? 'sell' : 'buy';

                // Market close with reduceOnly
                await this.tradeExchange.exchange.createOrder(
                    symbol,
                    'market',
                    closeSide,
                    contracts,
                    undefined,
                    { reduceOnly: true }
                );
                logger.info(`Emergency fallback close executed successfully for ${symbol}.`);
            }
        } catch (e) {
            logger.error(`Fallback close error for ${symbol}: ${e.message}`);
        }
    }

    async updatePnL() {
        if (!this.isRunning) return;
        try {
            const closedPnls = await this.tradeExchange.fetchClosedPnls();
            if (closedPnls && closedPnls.length > 0) {
                for (const pnl of closedPnls) {
                    db.addClosedPnl(pnl);
                }
            }

            const aggregated = db.calculateAggregatedPnl();
            db.updateAccountState(aggregated);
            logger.debug(`Aggregated PnL updated. Daily: $${aggregated.daily_pnl.toFixed(2)}`);

            // Execute automatic internal transfer (take profit) check
            await this.checkAutoTransfer();
        } catch (e) {
            logger.error(`Failed to update PnL loop: ${e.message}`);
        }
    }

    async checkAutoTransfer() {
        if (!this.isRunning) return;
        const cfg = this.config.get();
        if (!cfg.ENABLE_AUTO_TRANSFER) return;

        try {
            const state = db.getAccountState();
            if (!state) return;
            const walletValue = state.total_value || 0;
            const minBalance = parseFloat(cfg.MIN_BALANCE_THRESHOLD) || 0;
            const thresholdPercent = parseFloat(cfg.TRANSFER_PERCENTAGE_THRESHOLD) || 0;

            if (walletValue > minBalance && minBalance > 0) {
                const diff = walletValue - minBalance;
                const diffPercentage = (diff / walletValue) * 100;

                if (diffPercentage >= thresholdPercent) {
                    logger.info(`Auto Transfer Triggered: Wallet Value ($${walletValue.toFixed(2)}) is ${diffPercentage.toFixed(2)}% above minimum balance ($${minBalance.toFixed(2)}).`);

                    let fromAccount = 'contract';
                    let toAccount = 'fund';
                    const exName = cfg.TRADE_EXCHANGE.toLowerCase();

                    if (exName === 'bybit') {
                        fromAccount = 'unified';
                        toAccount = 'fund';
                    } else if (exName === 'binance') {
                        fromAccount = 'future';
                        toAccount = 'funding';
                    } else if (exName === 'okx') {
                        fromAccount = 'trading';
                        toAccount = 'funding';
                    }

                    if (this.tradeExchange && typeof this.tradeExchange.internalTransfer === 'function') {
                        const amountToTransfer = Math.floor(diff * 100) / 100; // Transfer exact diff rounded down to 2 decimals
                        const success = await this.tradeExchange.internalTransfer('USDT', amountToTransfer, fromAccount, toAccount);
                        if (success) {
                            logger.info(`Auto Transfer Completed: Moved $${amountToTransfer} USDT from ${fromAccount} to ${toAccount}.`);
                        }
                    } else {
                        logger.warn('Auto Transfer failed: internalTransfer method not supported by the current exchange implementation.');
                    }
                }
            }
        } catch (e) {
            logger.error(`Failed during Auto Transfer check: ${e.message}`);
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
        if (!cfg.ENABLE_DYNAMIC_THRESHOLDS || !cfg.RAPIDAPI_KEY) {
            return;
        }

        try {
            logger.info('Fetching dynamic liquidation thresholds from liquidation.report...');
            const response = await fetch('https://liquidation-trader.p.rapidapi.com/data', {
                headers: {
                    'X-RapidAPI-Key': cfg.RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'liquidation-trader.p.rapidapi.com'
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

    async updateMarketSentiment() {
        if (!this.isRunning) return;
        const cfg = this.config.get();
        if (!cfg.RAPIDAPI_KEY) {
            this.marketSentiment = null;
            return;
        }

        try {
            const response = await fetch('https://liquidation-trader.p.rapidapi.com/sentiment', {
                headers: {
                    'X-RapidAPI-Key': cfg.RAPIDAPI_KEY,
                    'X-RapidAPI-Host': 'liquidation-trader.p.rapidapi.com'
                }
            });

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const json = await response.json();
            if (json && json.data && json.data.market && json.data.market.fear_greed) {
                const market = json.data.market;
                const fg = market.fear_greed;
                this.marketSentiment = {
                    fgValue: fg.value,
                    fgClassification: fg.label,
                    marketScore: market.score,
                    marketLabel: market.label
                };
                logger.debug(`Updated Market Sentiment: ${market.label} (Score: ${market.score}) | F&G: ${fg.value} (${fg.label})`);
            } else {
                this.marketSentiment = null;
            }
        } catch (e) {
            logger.warn(`Failed to update Market Sentiment: ${e.message}`);
        }
    }

    async sendAnonReport() {
        if (!this.isRunning) return;
        const cfg = this.config.get();
        if (!cfg.ENABLE_ANON_REPORTING) return;

        try {
            const aggregated = db.calculateAggregatedPnl();
            const payload = {
                uid: cfg.ANON_UID || 'unknown',
                exchange: cfg.TRADE_EXCHANGE || 'unknown',
                daily: aggregated.daily_pnl || 0,
                weekly: aggregated.weekly_pnl || 0,
                monthly: aggregated.monthly_pnl || 0,
                yearly: aggregated.yearly_pnl || 0,
                total: aggregated.total_pnl || 0
            };

            const response = await fetch('https://liquidation.report/api/trader', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                logger.debug(`Failed to send anonymous report. Status: ${response.status}`);
            } else {
                logger.debug(`Anonymous report sent successfully for UID: ${payload.uid}`);
            }
        } catch (e) {
            logger.debug(`Error sending anonymous report: ${e.message}`);
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
            
            // Log for 24h statistics
            db.logBotEvent({ event_type: 'LIQUIDATION_RECEIVED', symbol: symbol, side: unifiedSide, value: value });

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
                        const dynVal = this.dynamicThresholds[base];
                        if (cfg.REPLACE_BELOW_MIN_THRESHOLD && dynVal < thresholdInUsd) {
                            // Do not use dynamic value since it is below minimum static threshold
                            usingDynamic = false;
                        } else {
                            thresholdInUsd = dynVal;
                            usingDynamic = true;
                        }
                        break;
                    }
                }
            }

            if (value >= thresholdInUsd) {
                db.logBotEvent({
                    event_type: 'LIQUIDATION_MATCH',
                    symbol: symbol,
                    value: value
                });
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

    calculateDMI(highs, lows, closes, period = 14) {
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

    calculateVWAP(klines, period = 14, isSession = false) {
        if (!klines) return null;
        if (!isSession && klines.length < period) return null;

        let cumulativeTPV = 0;
        let cumulativeVolume = 0;

        const startIndex = isSession ? 0 : klines.length - period;
        for (let i = startIndex; i < klines.length; i++) {
            const high = klines[i][2];
            const low = klines[i][3];
            const close = klines[i][4];
            const volume = klines[i][5];

            const typicalPrice = (high + low + close) / 3;
            cumulativeTPV += typicalPrice * volume;
            cumulativeVolume += volume;
        }

        if (cumulativeVolume === 0) return null;
        return cumulativeTPV / cumulativeVolume;
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
            dmi: null,
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
            const positions = db.getPositions();
            const openPosition = positions.find(p => p.symbol === symbol);

            let vwapSide = null;
            let rsiSide = null;
            let dmiSide = null;
            let msSide = null;

            // --- 1. Shared OHLCV Fetching ---
            let sharedKlines = null;
            const vwapEnabled = cfg.ENABLE_VWAP_STRATEGY;
            const rsiEnabled = cfg.ENABLE_RSI_STRATEGY;
            const dmiEnabled = cfg.ENABLE_DMI_STRATEGY;

            if ((vwapEnabled || rsiEnabled || dmiEnabled) && this.tradeExchange?.exchange?.has['fetchOHLCV']) {
                const activeTimeframes = [];
                if (vwapEnabled) activeTimeframes.push(cfg.VWAP_TIMEFRAME || '1m');
                if (rsiEnabled) activeTimeframes.push(cfg.RSI_TIMEFRAME || '1m');
                if (dmiEnabled) activeTimeframes.push(cfg.DMI_TIMEFRAME || '1m');

                // Check if all active strategies share the exact same timeframe
                const allSameTimeframe = activeTimeframes.length > 0 && activeTimeframes.every(tf => tf === activeTimeframes[0]);

                if (activeTimeframes.length > 1 && allSameTimeframe) {
                    const vLimit = vwapEnabled ? (parseInt(cfg.VWAP_PERIOD) || 14) + 100 : 0;
                    const rLimit = rsiEnabled ? (parseInt(cfg.RSI_PERIOD) || 14) + 100 : 0;
                    const aLimit = dmiEnabled ? (parseInt(cfg.DMI_PERIOD) || 14) * 2 + 100 : 0;
                    const maxLimit = Math.max(vLimit, rLimit, aLimit);

                    try {
                        logger.info(`Fetching shared OHLCV for Technical Strategies (${activeTimeframes[0]}, limit: ${maxLimit})...`);
                        sharedKlines = await this.tradeExchange.exchange.fetchOHLCV(symbol, activeTimeframes[0], undefined, maxLimit);
                    } catch (e) {
                        logger.error(`Error fetching shared OHLCV: ${e.message}`);
                    }
                }
            }

            // --- 2. VWAP Strategy ---
            if (vwapEnabled) {
                if (this.tradeExchange?.exchange?.has['fetchOHLCV']) {
                    const vwapType = cfg.VWAP_TYPE || 'rolling';
                    const period = parseInt(cfg.VWAP_PERIOD) || 14;
                    const tf = cfg.VWAP_TIMEFRAME || '1m';
                    let klines = sharedKlines;

                    if (vwapType === 'session') {
                        const sessionType = cfg.VWAP_SESSION_TYPE || 'daily';
                        const now = new Date();
                        let since = null;

                        if (sessionType === 'monthly') {
                            since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
                        } else if (sessionType === 'weekly') {
                            const day = now.getUTCDay();
                            const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
                            since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff, 0, 0, 0, 0);
                        } else {
                            since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
                        }

                        try {
                            klines = await this.tradeExchange.exchange.fetchOHLCV(symbol, tf, since, 1000);
                        } catch (e) {
                            logger.error(`Error fetching Session VWAP OHLCV: ${e.message}`);
                        }
                    } else {
                        if (!klines) {
                            try {
                                klines = await this.tradeExchange.exchange.fetchOHLCV(symbol, tf, undefined, period + 100);
                            } catch (e) {
                                logger.error(`Error fetching VWAP OHLCV: ${e.message}`);
                            }
                        }
                    }

                    if (klines && (vwapType === 'session' ? klines.length > 0 : klines.length >= period)) {
                        const vwap = this.calculateVWAP(klines, period, vwapType === 'session');
                        if (vwap !== null) {
                            logger.info(`VWAP (${vwapType === 'session' ? 'session' : period}, ${tf}): ${vwap.toFixed(4)} | Current Price: ${currentPrice}`);
                            const longOffsetMultiplier = cfg.OFFSET_LONG_PERCENTAGE / 100;
                            const shortOffsetMultiplier = cfg.OFFSET_SHORT_PERCENTAGE / 100;
                            const upperOffsetValue = vwap * (1 + shortOffsetMultiplier);
                            const lowerOffsetValue = vwap * (1 - longOffsetMultiplier);

                            logger.info(`Upper Offset (+${cfg.OFFSET_SHORT_PERCENTAGE}%): ${upperOffsetValue.toFixed(4)}`);
                            logger.info(`Lower Offset (-${cfg.OFFSET_LONG_PERCENTAGE}%): ${lowerOffsetValue.toFixed(4)}`);

                            if (currentPrice > upperOffsetValue) {
                                vwapSide = cfg.VWAP_UPPER_SIGNAL === 'none' ? null : cfg.VWAP_UPPER_SIGNAL;
                                logger.info(`VWAP Condition met: Price ${currentPrice} > Upper VWAP ${upperOffsetValue.toFixed(4)}. Signal: ${vwapSide ? vwapSide.toUpperCase() : 'NONE'}.`);
                            } else if (currentPrice < lowerOffsetValue) {
                                vwapSide = cfg.VWAP_LOWER_SIGNAL === 'none' ? null : cfg.VWAP_LOWER_SIGNAL;
                                logger.info(`VWAP Condition met: Price ${currentPrice} < Lower VWAP ${lowerOffsetValue.toFixed(4)}. Signal: ${vwapSide ? vwapSide.toUpperCase() : 'NONE'}.`);
                            } else {
                                logger.info(`VWAP Condition: Price is within offset bounds. No trade signal.`);
                            }
                            decisionRecord.vwap = { value: vwap, upper: upperOffsetValue, lower: lowerOffsetValue, signal: vwapSide, type: vwapType, timeframe: tf };
                        } else {
                            logger.info(`VWAP calculation returned null for ${symbol}.`);
                            decisionRecord.vwap = { error: 'Calculation failed' };
                        }
                    } else {
                        logger.info(`Not enough klines fetched for VWAP calculation for ${symbol}.`);
                        decisionRecord.vwap = { error: 'Not enough klines' };
                    }
                } else {
                    logger.info(`Exchange does not support fetchOHLCV for VWAP.`);
                    decisionRecord.vwap = { error: 'Not supported' };
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

                            let oversoldMet = false;
                            if (cfg.RSI_OVERSOLD_DIR === 'above') oversoldMet = rsi >= cfg.RSI_OVERSOLD;
                            else oversoldMet = rsi <= cfg.RSI_OVERSOLD;

                            let overboughtMet = false;
                            if (cfg.RSI_OVERBOUGHT_DIR === 'under') overboughtMet = rsi <= cfg.RSI_OVERBOUGHT;
                            else overboughtMet = rsi >= cfg.RSI_OVERBOUGHT;

                            if (oversoldMet && rsi < 50) {
                                rsiSide = cfg.RSI_OVERSOLD_SIGNAL === 'none' ? null : cfg.RSI_OVERSOLD_SIGNAL;
                                const op = cfg.RSI_OVERSOLD_DIR === 'above' ? '>=' : '<=';
                                logger.info(`RSI Condition met: ${rsi.toFixed(2)} ${op} Oversold (${cfg.RSI_OVERSOLD}). Signal: ${rsiSide ? rsiSide.toUpperCase() : 'NONE'}.`);
                            } else if (overboughtMet && rsi > 50) {
                                rsiSide = cfg.RSI_OVERBOUGHT_SIGNAL === 'none' ? null : cfg.RSI_OVERBOUGHT_SIGNAL;
                                const op = cfg.RSI_OVERBOUGHT_DIR === 'under' ? '<=' : '>=';
                                logger.info(`RSI Condition met: ${rsi.toFixed(2)} ${op} Overbought (${cfg.RSI_OVERBOUGHT}). Signal: ${rsiSide ? rsiSide.toUpperCase() : 'NONE'}.`);
                            } else {
                                logger.info(`RSI Condition: Value is neutral. No trade signal.`);
                            }
                            decisionRecord.rsi = { value: rsi, oversold: cfg.RSI_OVERSOLD, overbought: cfg.RSI_OVERBOUGHT, signal: rsiSide, timeframe: cfg.RSI_TIMEFRAME };
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

            // --- 4. DMI Strategy ---
            if (dmiEnabled) {
                if (cfg.DMI_BYPASS_ON_POSITION === 'true' && openPosition) {
                    const posSide = (openPosition.side || '').toLowerCase();
                    dmiSide = 'ignore';
                    logger.info(`Bypassing DMI strategy because there is an open ${posSide.toUpperCase()} position on ${symbol}.`);
                    decisionRecord.dmi = { classification: 'Bypassed (Open Position)', signal: dmiSide };
                } else if (this.tradeExchange?.exchange?.has['fetchOHLCV']) {
                    const period = parseInt(cfg.DMI_PERIOD) || 14;
                    const threshold = parseFloat(cfg.DMI_THRESHOLD) || 25;
                    let klines = sharedKlines;

                    // Fetch if not shared or shared fetch failed
                    if (!klines) {
                        try {
                            klines = await this.tradeExchange.exchange.fetchOHLCV(symbol, cfg.DMI_TIMEFRAME, undefined, period * 2 + 100);
                        } catch (e) {
                            logger.error(`Error fetching DMI OHLCV: ${e.message}`);
                        }
                    }

                    if (klines && klines.length > period * 2) {
                        const highs = klines.map(k => k[2]);
                        const lows = klines.map(k => k[3]);
                        const closes = klines.map(k => k[4]);
                        const dmiResult = this.calculateDMI(highs, lows, closes, period);

                        if (dmiResult !== null) {
                            logger.info(`DMI (${period}, ${cfg.DMI_TIMEFRAME}): ${dmiResult.adx.toFixed(2)} | +DI: ${dmiResult.plusDI.toFixed(2)} | -DI: ${dmiResult.minusDI.toFixed(2)}`);
                            const isDmiConditionMet = cfg.DMI_THRESHOLD_DIR === 'above' ? (dmiResult.adx >= threshold) : (dmiResult.adx <= threshold);
                            if (isDmiConditionMet) {
                                if (dmiResult.plusDI > dmiResult.minusDI) {
                                    dmiSide = cfg.DMI_PDI_SIGNAL === 'none' ? null : cfg.DMI_PDI_SIGNAL;
                                    logger.info(`DMI Condition met: DMI ${cfg.DMI_THRESHOLD_DIR} ${threshold} and +DI > -DI. Signal: ${dmiSide ? dmiSide.toUpperCase() : 'NONE'}.`);
                                } else if (dmiResult.minusDI > dmiResult.plusDI) {
                                    dmiSide = cfg.DMI_MDI_SIGNAL === 'none' ? null : cfg.DMI_MDI_SIGNAL;
                                    logger.info(`DMI Condition met: DMI ${cfg.DMI_THRESHOLD_DIR} ${threshold} and -DI > +DI. Signal: ${dmiSide ? dmiSide.toUpperCase() : 'NONE'}.`);
                                } else {
                                    logger.info(`DMI Condition: Value met threshold but DIs are equal. No trade signal.`);
                                }
                            } else {
                                logger.info(`DMI Condition: DMI (${dmiResult.adx.toFixed(2)}) is not ${cfg.DMI_THRESHOLD_DIR} threshold (${threshold}). No trade signal.`);
                            }
                            decisionRecord.dmi = { value: dmiResult.adx, plusDI: dmiResult.plusDI, minusDI: dmiResult.minusDI, threshold: threshold, signal: dmiSide, timeframe: cfg.DMI_TIMEFRAME };
                        }
                    } else {
                        logger.info(`Not enough klines fetched for DMI calculation for ${symbol}.`);
                        decisionRecord.dmi = { error: 'Not enough klines' };
                    }
                } else {
                    logger.info(`Exchange does not support fetchOHLCV for DMI.`);
                    decisionRecord.dmi = { error: 'Not supported' };
                }
            }

            // --- 5. Market Sentiment Strategy ---
            if (cfg.ENABLE_MARKET_SENTIMENT_STRATEGY) {
                if (cfg.MS_BYPASS_ON_POSITION === 'true' && openPosition) {
                    const posSide = (openPosition.side || '').toLowerCase();
                    msSide = 'ignore';
                    logger.info(`Bypassing Market Sentiment strategy because there is an open ${posSide.toUpperCase()} position on ${symbol}.`);
                    decisionRecord.marketSentiment = { classification: 'Bypassed (Open Position)', signal: msSide };
                } else if (this.marketSentiment) {
                    const fgClass = (this.marketSentiment.fgClassification || '').toLowerCase();
                    const mktLabel = (this.marketSentiment.marketLabel || '').toLowerCase();

                    if (fgClass === 'extreme fear') {
                        msSide = cfg.MS_EXTREME_FEAR_SIGNAL === 'none' ? null : cfg.MS_EXTREME_FEAR_SIGNAL;
                        logger.info(`Market Sentiment Condition met: Extreme Fear. Signal: ${msSide ? msSide.toUpperCase() : 'NONE'}.`);
                    } else if (fgClass === 'extreme greed') {
                        msSide = cfg.MS_EXTREME_GREED_SIGNAL === 'none' ? null : cfg.MS_EXTREME_GREED_SIGNAL;
                        logger.info(`Market Sentiment Condition met: Extreme Greed. Signal: ${msSide ? msSide.toUpperCase() : 'NONE'}.`);
                    } else if (fgClass === 'neutral' || mktLabel === 'neutral') {
                        msSide = 'ignore';
                        logger.info(`Market Sentiment Condition met: F&G ${fgClass}, Market ${mktLabel}. Ignoring for confluence.`);
                    } else {
                        // fgClass is fear or greed, mktLabel is bullish or bearish
                        if (mktLabel === 'bullish') {
                            msSide = cfg.MS_BULLISH_SIGNAL === 'none' ? null : cfg.MS_BULLISH_SIGNAL;
                            logger.info(`Market Sentiment Condition met: Bullish + ${fgClass}. Signal: ${msSide ? msSide.toUpperCase() : 'NONE'}.`);
                        } else if (mktLabel === 'bearish') {
                            msSide = cfg.MS_BEARISH_SIGNAL === 'none' ? null : cfg.MS_BEARISH_SIGNAL;
                            logger.info(`Market Sentiment Condition met: Bearish + ${fgClass}. Signal: ${msSide ? msSide.toUpperCase() : 'NONE'}.`);
                        } else {
                            msSide = null;
                            logger.info(`Market Sentiment Condition met: Unknown label (${mktLabel}). Signal: NONE.`);
                        }
                    }
                    decisionRecord.marketSentiment = { fgClassification: this.marketSentiment.fgClassification, marketLabel: this.marketSentiment.marketLabel, signal: msSide };
                } else {
                    logger.info(`No Market Sentiment data available.`);
                    decisionRecord.marketSentiment = { error: 'No data' };
                }
            }

            if (cfg.ENABLE_VWAP_STRATEGY && vwapSide) db.logBotEvent({ event_type: 'STRATEGY_MATCH', symbol: symbol, strategy: 'VWAP', side: vwapSide });
            if (cfg.ENABLE_RSI_STRATEGY && rsiSide) db.logBotEvent({ event_type: 'STRATEGY_MATCH', symbol: symbol, strategy: 'RSI', side: rsiSide });
            if (cfg.ENABLE_DMI_STRATEGY && dmiSide && dmiSide !== 'ignore') db.logBotEvent({ event_type: 'STRATEGY_MATCH', symbol: symbol, strategy: 'DMI', side: dmiSide });
            if (cfg.ENABLE_MARKET_SENTIMENT_STRATEGY && msSide && msSide !== 'ignore') db.logBotEvent({ event_type: 'STRATEGY_MATCH', symbol: symbol, strategy: 'MarketSentiment', side: msSide });

            // --- 6. Confluence Logic (AND) ---
            let finalSide = null;
            const activeStrategies = [];
            if (cfg.ENABLE_VWAP_STRATEGY) activeStrategies.push({ name: 'VWAP', side: vwapSide });
            if (cfg.ENABLE_RSI_STRATEGY) activeStrategies.push({ name: 'RSI', side: rsiSide });
            if (cfg.ENABLE_DMI_STRATEGY && dmiSide !== 'ignore') {
                activeStrategies.push({ name: 'DMI', side: dmiSide });
            }
            if (cfg.ENABLE_MARKET_SENTIMENT_STRATEGY && msSide !== 'ignore') {
                activeStrategies.push({ name: 'MarketSentiment', side: msSide });
            }

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

            const hasPosition = !!openPosition;
            const maxPositions = cfg.MAX_OPEN_POSITIONS || 3;
            if (!hasPosition && positions.length >= maxPositions) {
                logger.info(`Max open positions (${maxPositions}) reached. Holding bot from opening new position for ${symbol}.`);
                pushDecision('Max Positions Reached');
                return;
            }

            if (!hasPosition && cfg.ENABLE_ISOLATION_MODE) {
                const state = db.getAccountState();
                const usedMarginPercent = (state && state.total_value > 0) ? (state.margin_used / state.total_value) * 100 : 0;
                const threshold = parseFloat(cfg.ISOLATION_MARGIN_THRESHOLD) || 10;
                if (usedMarginPercent >= threshold) {
                    logger.info(`Isolation Mode active (used margin ${usedMarginPercent.toFixed(2)}% >= ${threshold}%). Holding bot from opening new position for ${symbol}.`);
                    pushDecision('Isolation Mode Active');
                    return;
                }
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
            const isLeverageAllowed = await this.tradeExchange.checkMaxLeverage(symbol, cfg.TRADE_LEVERAGE);
            if (!isLeverageAllowed) {
                logger.info(`Max leverage for ${symbol} is lower than the configured TRADE_LEVERAGE (${cfg.TRADE_LEVERAGE}). Skipping order.`);
                return;
            }

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
                        multiplier = Math.ceil(Math.abs(pnlPercent / cfg.TRADE_LEVERAGE));
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
            db.logBotEvent({ event_type: 'TRADE_EXECUTE', symbol: symbol, side: side });

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
