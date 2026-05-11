const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');

class OkxExchange extends BaseExchange {
    constructor(configModule) {
        super(configModule);
    }

    async init() {
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
        logger.info('[OKX] Markets loaded.');
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

        logger.info(`[OKX] Starting to watch liquidations for ${symbols.length} symbols...`);
        // OKX supports batch watching or individual
        for (const symbol of symbols) {
            this._watchSymbolLiquidations(symbol, callback, isRunningCheck, errorCallback);
        }
    }

    async _watchSymbolLiquidations(symbol, callback, isRunningCheck, errorCallback) {
        while (isRunningCheck()) {
            try {
                const liquidations = await this.exchange.watchLiquidations(symbol);
                if (!isRunningCheck()) break;

                if (Array.isArray(liquidations)) {
                    for (const liq of liquidations) {
                        const amount = liq.contracts || liq.baseVolume || 0;
                        const value = liq.price * amount;
                        logger.debug(`[OKX] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else {
                    const liq = liquidations;
                    const amount = liq.contracts || liq.baseVolume || 0;
                    const value = liq.price * amount;
                    logger.debug(`[OKX] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liq);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[OKX] [${symbol} Stream] ${e.message}`);
                    else logger.error(`[OKX] Error watching liquidations for ${symbol}:`, e.message);
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
                    if (errorCallback) errorCallback(`[OKX] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchPositions']) {
            logger.info('[OKX] CCXT watchPositions not available.');
            return;
        }
        while (isRunningCheck()) {
            try {
                const positions = await this.exchange.watchPositions();
                if (!isRunningCheck()) break;
                callback(positions);
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[OKX] [Positions Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async fetchAggregatedPnl() {
        try {
            // OKX PNL is tricky, fetchIncome or fetchMyTrades might be needed
            // Fallback to null for now, or implement if known
            return null;
        } catch (e) {
            logger.error(`[OKX] Failed to fetch PnL: ${e.message}`);
            return null;
        }
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
            logger.info(`[OKX] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[OKX] Leverage setting message: ${e.message}`);
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

            logger.info(`[OKX] TP/SL independently bound to ${symbol}.`);
        } catch (e) {
            logger.error(`[OKX] Post-fill exit condition error for ${symbol}: ${e.message}`);
        }
    }
}

module.exports = OkxExchange;
