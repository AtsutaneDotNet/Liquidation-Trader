const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');
const connectionStatus = require('../connectionStatus');

class OkxExchange extends BaseExchange {
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

            if (cfg.TRADE_EXCHANGE === 'okx') {
                ccxtConfig.apiKey = cfg.API_KEY;
                ccxtConfig.secret = cfg.API_SECRET;
                // OKX requires password (passphrase) in CCXT
                if (cfg.API_PASSPHRASE) {
                    ccxtConfig.password = cfg.API_PASSPHRASE;
                }
            }

            this.exchange = new ccxt.pro.okx(ccxtConfig);

            await this.exchange.loadMarkets();
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_markets', {
                latencyMs: latency,
                incrementReq: 1,
                details: { exchange: 'okx', marketsCount: Object.keys(this.exchange.markets || {}).length }
            });
            logger.info('[OKX] Markets loaded.');
        } catch (e) {
            connectionStatus.recordError('rest_ex_markets', e, { exchange: 'okx' });
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
            logger.error('[OKX] No symbols provided for liquidation watching.');
            return;
        }

        logger.info(`[OKX] Starting to watch liquidations for ${symbols.length} symbols in batched streams...`);
        const BATCH_SIZE = 50;
        for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
            if (!isRunningCheck()) break;
            const chunk = symbols.slice(i, i + BATCH_SIZE);
            this._watchSymbolGroupLiquidations(chunk, callback, isRunningCheck, errorCallback);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    async _watchSymbolGroupLiquidations(symbolsChunk, callback, isRunningCheck, errorCallback) {
        let retryDelay = 2000;
        connectionStatus.updateStatus('ws_liq_okx', 'connecting');
        while (isRunningCheck()) {
            try {
                const liquidations = await this.exchange.watchLiquidationsForSymbols(symbolsChunk);
                if (!isRunningCheck()) break;
                retryDelay = 2000;

                const count = Array.isArray(liquidations) ? liquidations.length : (liquidations ? 1 : 0);
                connectionStatus.recordActivity('ws_liq_okx', { incrementMsg: count || 1 });

                if (Array.isArray(liquidations)) {
                    for (const liq of liquidations) {
                        const amount = liq.contracts || liq.baseVolume || 0;
                        const value = (liq.price || 0) * amount;
                        logger.debug(`[OKX] Liquidation for ${liq.symbol || 'N/A'} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else if (liquidations) {
                    const amount = liquidations.contracts || liquidations.baseVolume || 0;
                    const value = (liquidations.price || 0) * amount;
                    logger.debug(`[OKX] Liquidation for ${liquidations.symbol || 'N/A'} | Price: ${liquidations.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liquidations);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    connectionStatus.recordError('ws_liq_okx', e.message);
                    if (errorCallback) errorCallback(`[OKX] [Liquidations Batch] ${e.message}`);
                    else logger.error(`[OKX] Error watching liquidations batch: ${e.message}`);
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
                    if (errorCallback) errorCallback(`[OKX] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchPositions']) {
            connectionStatus.updateStatus('ws_priv_positions', 'disabled', null, { reason: 'CCXT watchPositions not supported' });
            logger.info('[OKX] CCXT watchPositions not available.');
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
                    if (errorCallback) errorCallback(`[OKX] [Positions Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivateTrades(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchMyTrades']) {
            connectionStatus.updateStatus('ws_priv_trades', 'disabled', null, { reason: 'CCXT watchMyTrades not supported' });
            logger.info('[OKX] CCXT watchMyTrades not available. Fallback: Trades WS disabled.');
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
                    if (errorCallback) errorCallback(`[OKX] [Trades Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchOHLCV(symbol, timeframe, callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchOHLCV']) {
            connectionStatus.updateStatus('ws_ohlcv_tracking', 'disabled', null, { reason: 'CCXT watchOHLCV not supported' });
            logger.info('[OKX] CCXT watchOHLCV not available. Paper Trading WS disabled.');
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
                    if (errorCallback) errorCallback(`[OKX] [OHLCV Stream] ${e.message}`);
                }
                const jitter = Math.floor(Math.random() * 3000);
                await new Promise(resolve => setTimeout(resolve, retryDelay + jitter));
                retryDelay = Math.min(retryDelay * 1.5, 30000);
            }
        }
    }

    async fetchClosedPnls() {
        const start = Date.now();
        try {
            // OKX PNL is tricky, fetchIncome or fetchMyTrades might be needed
            // Fallback to empty array for now
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_pnl', { latencyMs: latency, incrementReq: 1, details: { exchange: 'okx' } });
            return [];
        } catch (e) {
            connectionStatus.recordError('rest_ex_pnl', e.message, { exchange: 'okx' });
            logger.error(`[OKX] Failed to fetch PnL: ${e.message}`);
            return [];
        }
    }

    async fetchBalance() {
        const start = Date.now();
        try {
            const balance = await this.exchange.fetchBalance();
            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_balance', { latencyMs: latency, incrementReq: 1, details: { exchange: 'okx' } });
            return balance;
        } catch (e) {
            connectionStatus.recordError('rest_ex_balance', e.message, { exchange: 'okx' });
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
            logger.info(`[OKX] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[OKX] Leverage setting message: ${e.message}`);
        }
    }

    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
        const start = Date.now();
        try {
            const tpStr = this.exchange.priceToPrecision(symbol, takeProfit);
            const slStr = this.exchange.priceToPrecision(symbol, stopLoss);
            const oppositeSide = side === 'buy' ? 'sell' : 'buy';

            await this.exchange.createOrder(symbol, 'take_profit', oppositeSide, size, undefined, {
                stopPrice: tpStr,
                reduceOnly: true
            });

            if (trailingPercent > 0) {
                // Approximate OKX trailing if supported, else fallback to standard SL
                await this.exchange.createOrder(symbol, 'stop', oppositeSide, size, undefined, {
                    stopPrice: slStr,
                    reduceOnly: true
                });
            } else {
                await this.exchange.createOrder(symbol, 'stop', oppositeSide, size, undefined, {
                    stopPrice: slStr,
                    reduceOnly: true
                });
            }

            const latency = Date.now() - start;
            connectionStatus.recordActivity('rest_ex_orders', { latencyMs: latency, incrementReq: 1, details: { symbol, action: 'setTpSl' } });
            logger.info(`[OKX] TP/SL independently bound to ${symbol}.`);
        } catch (e) {
            connectionStatus.recordError('rest_ex_orders', e.message, { symbol, action: 'setTpSl' });
            logger.error(`[OKX] Post-fill exit condition error for ${symbol}: ${e.message}`);
            throw e;
        }
    }
}

module.exports = OkxExchange;
