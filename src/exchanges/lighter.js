const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');

class LighterExchange extends BaseExchange {
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

        if (cfg.TRADE_EXCHANGE === 'lighter') {
            ccxtConfig.apiKey = cfg.API_KEY;
            ccxtConfig.secret = cfg.API_SECRET;
        }

        this.exchange = new ccxt.pro.lighter(ccxtConfig);

        await this.exchange.loadMarkets();
        logger.info('[Lighter] Markets loaded.');
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
            logger.error('[Lighter] No symbols provided for liquidation watching.');
            return;
        }

        logger.info(`[Lighter] Starting to watch liquidations for ${symbols.length} symbols...`);
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
                        logger.debug(`[Lighter] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else {
                    const liq = liquidations;
                    const amount = liq.contracts || liq.baseVolume || 0;
                    const value = liq.price * amount;
                    logger.debug(`[Lighter] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liq);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Lighter] [${symbol} Stream] ${e.message}`);
                    else logger.error(`[Lighter] Error watching liquidations for ${symbol}:`, e.message);
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
                    if (errorCallback) errorCallback(`[Lighter] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        // Lighter CCXT Pro doesn't support watchPositions. We implement REST polling fallback.
        logger.info('[Lighter] CCXT watchPositions not available. Using REST polling fallback every 5 seconds.');
        
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
                    if (errorCallback) errorCallback(`[Lighter] [Positions Polling] ${e.message}`);
                }
            }
        }, 5000);
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
            logger.info(`[Lighter] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[Lighter] Leverage setting message: ${e.message}`);
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

            logger.info(`[Lighter] TP/SL independently bound to ${symbol}.`);
        } catch (e) {
            logger.error(`[Lighter] Post-fill exit condition error for ${symbol}: ${e.message}`);
        }
    }
}

module.exports = LighterExchange;
