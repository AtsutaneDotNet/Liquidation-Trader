const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');
const connectionStatus = require('../connectionStatus');

class BinanceExchange extends BaseExchange {
    constructor(configModule) {
        super(configModule);
    }

    async init() {
        const start = Date.now();
        try {
            const cfg = this.config.get();
            const ccxtConfig = {
                enableRateLimit: true,
                options: {
                    defaultType: 'future', // perpetuals
                }
            };

            if (cfg.TRADE_EXCHANGE === 'binance') {
                ccxtConfig.apiKey = cfg.API_KEY;
                ccxtConfig.secret = cfg.API_SECRET;
            }

            this.exchange = new ccxt.pro.binance(ccxtConfig);

            await this.exchange.loadMarkets();
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_markets', {
                latencyMs: latency,
                incrementReq: 1,
                details: { exchange: 'binance', marketsCount: Object.keys(this.exchange.markets || {}).length }
            });
            logger.info('[Binance] Markets loaded.');
        } catch (e) {
            connectionStatus.recordError('rest_ex_markets', e, { exchange: 'binance' });
            throw e;
        }
    }

    async getLinearSymbols() {
        const markets = this.exchange.markets;
        let loadedSymbols = [];
        if (markets) {
            loadedSymbols = Object.values(markets)
                .filter(m => m.swap && m.active && m.quote === 'USDT')
                .map(m => m.symbol);
        }
        return loadedSymbols;
    }

    async watchLiquidations(symbols, callback, isRunningCheck, errorCallback) {
        if (!symbols || symbols.length === 0) {
            logger.error('[Binance] No symbols provided for specific liquidation watching.');
            return;
        }

        logger.info(`[Binance] Starting to watch liquidations for ${symbols.length} symbols in batched streams...`);
        const BATCH_SIZE = 50;
        for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
            if (!isRunningCheck()) break;
            const chunk = symbols.slice(i, i + BATCH_SIZE);
            this._watchSymbolGroupLiquidations(chunk, callback, isRunningCheck, errorCallback);
            // Stagger batch subscriptions by 400ms to respect Binance's 5 messages/sec limit
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }

    async _watchSymbolGroupLiquidations(symbolsChunk, callback, isRunningCheck, errorCallback) {
        let retryDelay = 2000;
        connectionStatus.updateStatus('ws_liq_binance', 'connecting');
        while (isRunningCheck()) {
            try {
                const liquidations = await this.exchange.watchLiquidationsForSymbols(symbolsChunk);
                if (!isRunningCheck()) break;
                retryDelay = 2000;

                const count = Array.isArray(liquidations) ? liquidations.length : (liquidations ? 1 : 0);
                connectionStatus.recordActivity('ws_liq_binance', { incrementMsg: count || 1 });

                if (Array.isArray(liquidations)) {
                    for (const liq of liquidations) {
                        const amount = liq.contracts || liq.baseVolume || 0;
                        const value = (liq.price || 0) * amount;
                        logger.debug(`[Binance] Liquidation for ${liq.symbol || 'N/A'} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else if (liquidations) {
                    const amount = liquidations.contracts || liquidations.baseVolume || 0;
                    const value = (liquidations.price || 0) * amount;
                    logger.debug(`[Binance] Liquidation for ${liquidations.symbol || 'N/A'} | Price: ${liquidations.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liquidations);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_liq_binance', e.message);
                    if (errorCallback) errorCallback(`[Binance] [Liquidations Batch] ${e.message}`);
                    else logger.error(`[Binance] Error watching liquidations batch: ${e.message}`);
                }
                const jitter = Math.floor(Math.random() * 2000);
                await new Promise(resolve => setTimeout(resolve, retryDelay + jitter));
                retryDelay = Math.min(retryDelay * 1.5, 30000);
            }
        }
    }

    async watchPrivateBalance(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchBalance']) {
            connectionStatus.updateStatus('ws_priv_balance', 'disabled', null, { reason: 'CCXT watchBalance not supported' });
            return;
        }

        let lastFetchTime = 0;
        let timeoutId = null;
        let isFetching = false;
        connectionStatus.updateStatus('ws_priv_balance', 'connecting');

        const triggerBalanceUpdate = async () => {
            if (isFetching) return;
            isFetching = true;
            try {
                const balance = await this.fetchBalance();
                const data = this.parseBalanceData(balance);
                if (data) {
                    callback(data);
                }
            } catch (e) {
                logger.error(`[Binance] Error fetching balance on WS trigger: ${e.message}`);
            } finally {
                isFetching = false;
                lastFetchTime = Date.now();
            }
        };

        while (isRunningCheck()) {
            try {
                await this.exchange.watchBalance();
                if (!isRunningCheck()) break;
                connectionStatus.recordActivity('ws_priv_balance', { incrementMsg: 1 });

                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                const now = Date.now();
                const timeSinceLastFetch = now - lastFetchTime;

                if (timeSinceLastFetch > 2000) {
                    // Fetch immediately, but don't await so we don't block the WS loop
                    triggerBalanceUpdate();
                } else {
                    // Debounce rapid updates
                    timeoutId = setTimeout(() => {
                        if (isRunningCheck()) {
                            triggerBalanceUpdate();
                        }
                    }, 2000 - timeSinceLastFetch);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_priv_balance', e.message);
                    if (errorCallback) errorCallback(`[Binance] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchPositions']) {
            connectionStatus.updateStatus('ws_priv_positions', 'disabled', null, { reason: 'CCXT watchPositions not supported' });
            logger.info('[Binance] CCXT watchPositions not available. Fallback: Position WS disabled.');
            return;
        }
        connectionStatus.updateStatus('ws_priv_positions', 'connecting');
        while (isRunningCheck()) {
            try {
                const positions = await this.exchange.watchPositions();
                if (!isRunningCheck()) break;
                connectionStatus.recordActivity('ws_priv_positions', { incrementMsg: 1 });
                callback(positions);
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_priv_positions', e.message);
                    if (errorCallback) errorCallback(`[Binance] [Positions Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivateTrades(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchMyTrades']) {
            connectionStatus.updateStatus('ws_priv_trades', 'disabled', null, { reason: 'CCXT watchMyTrades not supported' });
            logger.info('[Binance] CCXT watchMyTrades not available. Fallback: Trades WS disabled.');
            return;
        }
        connectionStatus.updateStatus('ws_priv_trades', 'connecting');
        while (isRunningCheck()) {
            try {
                const trades = await this.exchange.watchMyTrades();
                if (!isRunningCheck()) break;
                connectionStatus.recordActivity('ws_priv_trades', { incrementMsg: 1 });
                callback(trades);
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_priv_trades', e.message);
                    if (errorCallback) errorCallback(`[Binance] [Trades Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async fetchClosedPnls() {
        const start = Date.now();
        try {
            // Binance allows fetching Income history which includes REALIZED_PNL
            // We fetch the last 100 or so to get individual records.
            const income = await this.exchange.fapiPrivateGetIncome({ incomeType: 'REALIZED_PNL', limit: 100 });
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_pnl', { latencyMs: latency, incrementReq: 1, details: { exchange: 'binance' } });

            if (Array.isArray(income)) {
                const pnls = income.map(inc => {
                    return {
                        id: inc.tranId || `${inc.symbol}_${inc.time}`,
                        symbol: inc.symbol || 'UNKNOWN',
                        side: 'N/A',
                        size: 0,
                        entry_price: 0,
                        close_price: 0,
                        pnl: parseFloat(inc.income || 0),
                        timestamp: parseInt(inc.time || 0)
                    };
                });

                // Enrich with fetchMyTrades
                const tradesBySymbol = {};
                for (const pnl of pnls) {
                    if (pnl.symbol !== 'UNKNOWN') {
                        try {
                            if (!tradesBySymbol[pnl.symbol]) {
                                tradesBySymbol[pnl.symbol] = await this.exchange.fetchMyTrades(pnl.symbol);
                            }
                            const trades = tradesBySymbol[pnl.symbol];

                            let bestMatch = null;
                            let minDiff = Infinity;

                            for (const trade of trades) {
                                // Try to match by exact PnL if available in trade.info
                                const tradePnl = trade.info && trade.info.realizedPnl !== undefined ? parseFloat(trade.info.realizedPnl) : null;
                                if (tradePnl !== null && Math.abs(tradePnl - pnl.pnl) < 0.0001 && Math.abs(trade.timestamp - pnl.timestamp) < 60000) {
                                    bestMatch = trade;
                                    break;
                                }

                                // Fallback to closest timestamp
                                const diff = Math.abs(trade.timestamp - pnl.timestamp);
                                if (diff < minDiff) {
                                    minDiff = diff;
                                    bestMatch = trade;
                                }
                            }

                            if (bestMatch && (minDiff < 60000 || bestMatch)) { // Use bestMatch if matched by PnL or within 60s
                                if (!pnl.side || pnl.side === 'N/A') pnl.side = bestMatch.side ? bestMatch.side.toUpperCase() : 'N/A';
                                if (!pnl.size || pnl.size === 0) pnl.size = bestMatch.amount;
                                if (!pnl.close_price || pnl.close_price === 0) pnl.close_price = bestMatch.price;

                                // Calculate entry price if missing
                                if (pnl.size > 0 && pnl.close_price > 0 && pnl.side !== 'N/A' && pnl.entry_price === 0) {
                                    const priceMovement = pnl.pnl / pnl.size;
                                    if (pnl.side === 'BUY') {
                                        pnl.entry_price = pnl.close_price + priceMovement;
                                    } else if (pnl.side === 'SELL') {
                                        pnl.entry_price = pnl.close_price - priceMovement;
                                    }
                                }
                            }
                        } catch (e) {
                            logger.error(`[Binance] Failed to fetch trades for ${pnl.symbol}: ${e.message}`);
                        }
                    }
                }

                return pnls;
            }
            return [];
        } catch (e) {
            connectionStatus.recordError('rest_ex_pnl', e.message, { exchange: 'binance' });
            logger.error(`[Binance] Failed to fetch PnL: ${e.message}`);
            return [];
        }
    }

    async watchOHLCV(symbol, timeframe, callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchOHLCV']) {
            connectionStatus.updateStatus('ws_ohlcv_tracking', 'disabled', null, { reason: 'CCXT watchOHLCV not supported' });
            logger.info('[Binance] CCXT watchOHLCV not available. Paper Trading WS disabled.');
            return;
        }
        let retryDelay = 3000;
        connectionStatus.updateStatus('ws_ohlcv_tracking', 'connecting');
        while (isRunningCheck()) {
            try {
                const ohlcv = await this.exchange.watchOHLCV(symbol, timeframe);
                if (!isRunningCheck()) break;
                retryDelay = 3000;
                connectionStatus.recordActivity('ws_ohlcv_tracking', { incrementMsg: 1, details: { lastSymbol: symbol } });
                callback(ohlcv);
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_ohlcv_tracking', e.message, { symbol });
                    if (errorCallback) errorCallback(`[Binance] [OHLCV Stream] ${e.message}`);
                }
                const jitter = Math.floor(Math.random() * 3000);
                await new Promise(resolve => setTimeout(resolve, retryDelay + jitter));
                retryDelay = Math.min(retryDelay * 1.5, 30000);
            }
        }
    }

    async fetchBalance() {
        const start = Date.now();
        try {
            const balance = await this.exchange.fetchBalance();
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_balance', { latencyMs: latency, incrementReq: 1, details: { exchange: 'binance' } });
            return balance;
        } catch (e) {
            connectionStatus.recordError('rest_ex_balance', e.message, { exchange: 'binance' });
            throw e;
        }
    }

    async fetchTicker(symbol) {
        const start = Date.now();
        try {
            const ticker = await this.exchange.fetchTicker(symbol);
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_tickers', { latencyMs: latency, incrementReq: 1, details: { symbol } });
            return ticker;
        } catch (e) {
            connectionStatus.recordError('rest_ex_tickers', e.message, { symbol });
            throw e;
        }
    }

    async setLeverage(leverage, symbol) {
        try {
            await this.exchange.setLeverage(leverage, symbol);
            logger.info(`[Binance] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[Binance] Leverage may already be set for ${symbol}. Message: ${e.message}`);
        }
    }

    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
        const start = Date.now();
        try {
            try {
                const marketId = this.exchange.market(symbol).id;
                const openOrders = await this.exchange.fapiPrivateGetOpenAlgoOrders({ symbol: marketId });

                const ordersToCancel = openOrders.filter(order => {
                    const type = (order.orderType || '').toUpperCase();
                    const targetTypes = ['TAKE_PROFIT_MARKET', 'STOP_MARKET', 'TRAILING_STOP_MARKET'];
                    return targetTypes.includes(type);
                });

                for (const order of ordersToCancel) {
                    await this.exchange.fapiPrivateDeleteAlgoOrder({
                        algoId: order.algoId,
                        clientAlgoId: order.clientAlgoId
                    });
                    logger.info(`[Binance] Cancelled existing conditional algo order ${order.algoId} for ${symbol}`);
                }
            } catch (err) {
                logger.warn(`[Binance] Error fetching or cancelling existing orders for ${symbol}: ${err.message}`);
            }

            const tpStr = this.exchange.priceToPrecision(symbol, takeProfit);
            const slStr = this.exchange.priceToPrecision(symbol, stopLoss);
            const oppositeSide = side === 'buy' ? 'sell' : 'buy';

            await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', oppositeSide, size, undefined, {
                stopPrice: tpStr,
                closePosition: true
            });

            await this.exchange.createOrder(symbol, 'STOP_MARKET', oppositeSide, size, undefined, {
                stopPrice: slStr,
                closePosition: true
            });

            if (trailingPercent > 0) {
                let clampedPercent = Math.max(0.1, Math.min(5.0, trailingPercent));
                const trailingParams = {
                    callbackRate: clampedPercent,
                    reduceOnly: true
                };
                if (trailingActivationPrice > 0) {
                    trailingParams.activatePrice = this.exchange.priceToPrecision(symbol, trailingActivationPrice);
                }
                logger.info(`[Binance] Configuring native Trailing Stop with callbackRate ${clampedPercent}%${trailingActivationPrice > 0 ? ' and activationPrice ' + trailingParams.activatePrice : ''}`);
                const traillog = await this.exchange.createOrder(symbol, 'TRAILING_STOP_MARKET', oppositeSide, size, undefined, trailingParams);
                logger.debug(`[Binance] Trailing Stop created for ${symbol}: ${JSON.stringify(traillog)}`);
            }

            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_orders', { latencyMs: latency, incrementReq: 1, details: { symbol, action: 'setTpSl' } });
            logger.info(`[Binance] Conditional exit parameters independently bound to ${symbol}.`);
        } catch (e) {
            connectionStatus.recordError('rest_ex_orders', e.message, { symbol, action: 'setTpSl' });
            logger.error(`[Binance] Post-fill exit condition error for ${symbol}: ${e.message}`);
            throw e;
        }
    }
}

module.exports = BinanceExchange;
