const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');

class AsterExchange extends BaseExchange {
    constructor(configModule) {
        super(configModule);
        this.positionPollInterval = null;
    }

    async init() {
        const cfg = this.config.get();
        const ccxtConfig = {
            enableRateLimit: true,
            options: {
                defaultType: 'swap', // perpetuals
            }
        };

        if (cfg.TRADE_EXCHANGE === 'aster') {
            ccxtConfig.apiKey = cfg.API_KEY;
            ccxtConfig.secret = cfg.API_SECRET;
        }

        // Try to use CCXT Pro for WebSockets, fallback to standard CCXT if needed.
        if (ccxt.pro && ccxt.pro.aster) {
            this.exchange = new ccxt.pro.aster(ccxtConfig);
        } else {
            this.exchange = new ccxt.aster(ccxtConfig);
        }

        await this.exchange.loadMarkets();
        logger.info('[Aster] Markets loaded.');
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
            logger.error('[Aster] No symbols provided for liquidation watching.');
            return;
        }

        logger.info(`[Aster] Starting to watch liquidations for ${symbols.length} symbols...`);
        for (const symbol of symbols) {
            this._watchSymbolLiquidations(symbol, callback, isRunningCheck, errorCallback);
        }
    }

    async _watchSymbolLiquidations(symbol, callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchLiquidations']) {
            logger.debug(`[Aster] watchLiquidations not explicitly supported in CCXT for ${symbol}. Streams might not start.`);
            // Proceeding anyway in case it works or gets added.
        }
        
        while (isRunningCheck()) {
            try {
                const liquidations = await this.exchange.watchLiquidations(symbol);
                if (!isRunningCheck()) break;

                if (Array.isArray(liquidations)) {
                    for (const liq of liquidations) {
                        const amount = liq.contracts || liq.baseVolume || 0;
                        const value = liq.price * amount;
                        logger.debug(`[Aster] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else {
                    const liq = liquidations;
                    const amount = liq.contracts || liq.baseVolume || 0;
                    const value = liq.price * amount;
                    logger.debug(`[Aster] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liq);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Aster] [${symbol} Stream] ${e.message}`);
                    else logger.error(`[Aster] Error watching liquidations for ${symbol}:`, e.message);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivateBalance(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchBalance']) return;

        while (isRunningCheck()) {
            try {
                const balance = await this.exchange.watchBalance();
                if (!isRunningCheck()) break;

                const data = this.parseBalanceData(balance);
                if (data) {
                    callback(data);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Aster] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (this.exchange.has['watchPositions']) {
            while (isRunningCheck()) {
                try {
                    const positions = await this.exchange.watchPositions();
                    if (!isRunningCheck()) break;
                    callback(positions);
                } catch (e) {
                    if (isRunningCheck()) {
                        if (errorCallback) errorCallback(`[Aster] [Positions Stream] ${e.message}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        } else {
            logger.info('[Aster] CCXT watchPositions not available. Using REST polling fallback every 5 seconds.');
            
            if (this.positionPollInterval) clearInterval(this.positionPollInterval);

            this.positionPollInterval = setInterval(async () => {
                if (!isRunningCheck()) {
                    clearInterval(this.positionPollInterval);
                    return;
                }
                try {
                    if (this.exchange.has['fetchPositions']) {
                        const positions = await this.exchange.fetchPositions();
                        callback(positions);
                    }
                } catch (e) {
                    if (isRunningCheck()) {
                        if (errorCallback) errorCallback(`[Aster] [Positions Polling] ${e.message}`);
                    }
                }
            }, 5000);
        }
    }

    async watchPrivateTrades(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchMyTrades']) {
            logger.info('[Aster] CCXT watchMyTrades not available. Fallback: Trades WS disabled.');
            return;
        }
        while (isRunningCheck()) {
            try {
                const trades = await this.exchange.watchMyTrades();
                if (!isRunningCheck()) break;

                callback(trades);
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Aster] [Trades Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async fetchClosedPnls() {
        return [];
    }

    async fetchBalance() {
        return await this.exchange.fetchBalance();
    }

    async fetchTicker(symbol) {
        return await this.exchange.fetchTicker(symbol);
    }

    async setLeverage(leverage, symbol) {
        try {
            await this.exchange.setLeverage(leverage, symbol);
            logger.info(`[Aster] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[Aster] Leverage setting message: ${e.message}`);
        }
    }

    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
        try {
            const tpStr = this.exchange.priceToPrecision(symbol, takeProfit);
            const slStr = this.exchange.priceToPrecision(symbol, stopLoss);
            const oppositeSide = side === 'buy' ? 'sell' : 'buy';
            
            await this.exchange.createOrder(symbol, 'take_profit', oppositeSide, size, undefined, {
                stopPrice: tpStr,
                reduceOnly: true
            });

            await this.exchange.createOrder(symbol, 'stop', oppositeSide, size, undefined, {
                stopPrice: slStr,
                reduceOnly: true
            });

            logger.info(`[Aster] TP/SL independently bound to ${symbol}.`);
        } catch (e) {
            logger.error(`[Aster] Post-fill exit condition error for ${symbol}: ${e.message}`);
        }
    }
}

module.exports = AsterExchange;
