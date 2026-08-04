const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');
const connectionStatus = require('../connectionStatus');

class BybitExchange extends BaseExchange {
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
                    defaultType: 'swap', // perpetuals
                }
            };

            if (cfg.TRADE_EXCHANGE === 'bybit') {
                ccxtConfig.apiKey = cfg.API_KEY;
                ccxtConfig.secret = cfg.API_SECRET;
            }

            this.exchange = new ccxt.pro.bybit(ccxtConfig);

            await this.exchange.loadMarkets();
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_markets', {
                latencyMs: latency,
                incrementReq: 1,
                details: { exchange: 'bybit', marketsCount: Object.keys(this.exchange.markets || {}).length }
            });
            logger.info('[Bybit] Markets loaded.');
        } catch (e) {
            connectionStatus.recordError('rest_ex_markets', e, { exchange: 'bybit' });
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
            logger.error('[Bybit] No symbols provided for specific liquidation watching.');
            return;
        }

        logger.info(`[Bybit] Starting to watch liquidations for ${symbols.length} symbols in throttled streams...`);
        for (const symbol of symbols) {
            if (!isRunningCheck()) break;
            this._watchSymbolLiquidations(symbol, callback, isRunningCheck, errorCallback);
            // Stagger individual subscriptions by 50ms to prevent connection rate-limiting spikes
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    async _watchSymbolLiquidations(symbol, callback, isRunningCheck, errorCallback) {
        let retryDelay = 2000;
        connectionStatus.updateStatus('ws_liq_bybit', 'connecting');
        while (isRunningCheck()) {
            try {
                const liquidations = await this.exchange.watchLiquidations(symbol);
                if (!isRunningCheck()) break;
                retryDelay = 2000;

                const count = Array.isArray(liquidations) ? liquidations.length : (liquidations ? 1 : 0);
                connectionStatus.recordActivity('ws_liq_bybit', { incrementMsg: count || 1 });

                if (Array.isArray(liquidations)) {
                    for (const liq of liquidations) {
                        const amount = liq.contracts || liq.baseVolume || 0;
                        const value = (liq.price || 0) * amount;
                        logger.debug(`[Bybit] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else if (liquidations) {
                    const amount = liquidations.contracts || liquidations.baseVolume || 0;
                    const value = (liquidations.price || 0) * amount;
                    logger.debug(`[Bybit] Liquidation for ${symbol} | Price: ${liquidations.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liquidations);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_liq_bybit', e.message, { symbol });
                    if (errorCallback) errorCallback(`[Bybit] [${symbol} Stream] ${e.message}`);
                    else logger.error(`[Bybit] Error watching liquidations for ${symbol}:`, e.message);
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

        connectionStatus.updateStatus('ws_priv_balance', 'connecting');
        while (isRunningCheck()) {
            try {
                const balance = await this.exchange.watchBalance();
                if (!isRunningCheck()) break;
                connectionStatus.recordActivity('ws_priv_balance', { incrementMsg: 1 });

                const data = this.parseBalanceData(balance);
                if (data) {
                    callback(data);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_priv_balance', e.message);
                    if (errorCallback) errorCallback(`[Bybit] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchPositions']) {
            connectionStatus.updateStatus('ws_priv_positions', 'disabled', null, { reason: 'CCXT watchPositions not supported' });
            logger.info('[Bybit] CCXT watchPositions not available. Fallback: Position WS disabled.');
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
                    if (errorCallback) errorCallback(`[Bybit] [Positions Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivateTrades(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchMyTrades']) {
            connectionStatus.updateStatus('ws_priv_trades', 'disabled', null, { reason: 'CCXT watchMyTrades not supported' });
            logger.info('[Bybit] CCXT watchMyTrades not available. Fallback: Trades WS disabled.');
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
                    if (errorCallback) errorCallback(`[Bybit] [Trades Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async fetchClosedPnls() {
        const start = Date.now();
        try {
            // Using direct privateGetV5PositionClosedPnl (Bybit Custom CCXT Method)
            const response = await this.exchange.privateGetV5PositionClosedPnl({
                category: 'linear',
                limit: 100
            });
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_pnl', { latencyMs: latency, incrementReq: 1, details: { exchange: 'bybit' } });

            if (response && response.result && response.result.list) {
                return response.result.list.map(pnl => {
                    return {
                        id: pnl.orderId || `${pnl.symbol}_${pnl.updatedTime}`,
                        symbol: pnl.symbol || 'UNKNOWN',
                        side: (pnl.side || 'UNKNOWN').toUpperCase(),
                        size: parseFloat(pnl.closedSize || 0),
                        entry_price: parseFloat(pnl.avgEntryPrice || 0),
                        close_price: parseFloat(pnl.avgExitPrice || 0),
                        pnl: parseFloat(pnl.closedPnl || 0),
                        timestamp: parseInt(pnl.updatedTime || 0)
                    };
                });
            }
            return [];
        } catch (e) {
            connectionStatus.recordError('rest_ex_pnl', e.message, { exchange: 'bybit' });
            logger.error(`[Bybit] Failed to fetch PnL: ${e.message}`);
            return [];
        }
    }

    async watchOHLCV(symbol, timeframe, callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchOHLCV']) {
            connectionStatus.updateStatus('ws_ohlcv_tracking', 'disabled', null, { reason: 'CCXT watchOHLCV not supported' });
            logger.info('[Bybit] CCXT watchOHLCV not available. Paper Trading WS disabled.');
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
                    if (errorCallback) errorCallback(`[Bybit] [OHLCV Stream] ${e.message}`);
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
            connectionStatus.recordActivity('rest_ex_balance', { latencyMs: latency, incrementReq: 1, details: { exchange: 'bybit' } });
            return balance;
        } catch (e) {
            connectionStatus.recordError('rest_ex_balance', e.message, { exchange: 'bybit' });
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
            logger.info(`[Bybit] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[Bybit] Leverage may already be set for ${symbol}. Message: ${e.message}`);
        }
    }

    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
        const start = Date.now();
        try {
            const tpStr = this.exchange.priceToPrecision(symbol, takeProfit);
            const slStr = this.exchange.priceToPrecision(symbol, stopLoss);

            const params = {
                category: 'linear',
                symbol: symbol.replace('/', '').split(':')[0],
                takeProfit: tpStr,
                stopLoss: slStr,
                tpslMode: 'Full',
                positionIdx: 0
            };

            if (trailingPercent > 0 && entryPrice > 0) {
                const distance = entryPrice * (trailingPercent / 100);
                params.trailingStop = this.exchange.priceToPrecision(symbol, distance);
                if (trailingActivationPrice > 0) {
                    params.activePrice = this.exchange.priceToPrecision(symbol, trailingActivationPrice);
                }
                logger.info(`[Bybit] Configuring native Trailing Stop with distance ${params.trailingStop} (${trailingPercent}%)${trailingActivationPrice > 0 ? ' and active price ' + params.activePrice : ''}`);
            }

            await this.exchange.privatePostV5PositionTradingStop(params);
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_orders', { latencyMs: latency, incrementReq: 1, details: { symbol, action: 'setTpSl' } });
            logger.info(`[Bybit] Conditional limits securely attached onto ${symbol} position.`);
        } catch (e) {
            connectionStatus.recordError('rest_ex_orders', e.message, { symbol, action: 'setTpSl' });
            logger.error(`[Bybit] Post-fill conditional logic failure for ${symbol}: ${e.message}`);
            throw e;
        }
    }
}

module.exports = BybitExchange;

