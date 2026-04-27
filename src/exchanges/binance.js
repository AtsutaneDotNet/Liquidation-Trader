const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');

class BinanceExchange extends BaseExchange {
    constructor(configModule) {
        super(configModule);
    }

    async init() {
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
        logger.info('[Binance] Markets loaded.');
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

        logger.info(`[Binance] Starting to watch liquidations for: ${symbols.join(', ')}`);
        // Note: For Binance, ccxt does not support an aggregate liquidation stream for multiple symbols easily,
        // or watching them independently might hit limits if limits are strict, 
        // but let's conform to the structure.
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
                        logger.debug(`[Binance] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else {
                    const liq = liquidations;
                    const amount = liq.contracts || liq.baseVolume || 0;
                    const value = liq.price * amount;
                    logger.debug(`[Binance] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liq);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Binance] [${symbol} Stream] ${e.message}`);
                    else logger.error(`[Binance] Error watching liquidations for ${symbol}:`, e.message);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivateBalance(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchBalance']) return;

        const findTotalAvailableBalance = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
            if (obj.totalAvailableBalance !== undefined) return parseFloat(obj.totalAvailableBalance);
            for (const key in obj) {
                if (typeof obj[key] === 'object') {
                    const res = findTotalAvailableBalance(obj[key], depth + 1);
                    if (res !== undefined && !isNaN(res)) return res;
                }
            }
            return undefined;
        };

        while (isRunningCheck()) {
            try {
                const balance = await this.exchange.watchBalance();
                if (!isRunningCheck()) break;

                if (balance && balance.USDT) {
                    const total = balance.USDT.total || 0;
                    let free = balance.USDT.free || 0;

                    const totalAvailableBalance = findTotalAvailableBalance(balance.info);
                    if (totalAvailableBalance !== undefined && free !== totalAvailableBalance) {
                        free = totalAvailableBalance;
                    }

                    const used = balance.USDT.used > 0 ? balance.USDT.used : Math.max(0, total - free);

                    const data = {
                        total_value: total,
                        margin_available: free,
                        margin_used: used
                    };
                    callback(data);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Binance] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchPositions']) {
            logger.info('[Binance] CCXT watchPositions not available. Fallback: Position WS disabled.');
            return;
        }
        while (isRunningCheck()) {
            try {
                const positions = await this.exchange.watchPositions();
                if (!isRunningCheck()) break;

                callback(positions);
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Binance] [Positions Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async fetchAggregatedPnl() {
        try {
            const now = Date.now();
            const oneDay = 24 * 60 * 60 * 1000;
            const sevenDays = 7 * oneDay;
            const thirtyDays = 30 * oneDay;

            if (!this.exchange.has['fetchIncome']) return null;

            // Binance allows fetching Income history which includes REALIZED_PNL
            // We fetch the last 100 or so to aggregate.
            const income = await this.exchange.fetchIncome(undefined, undefined, undefined, { incomeType: 'REALIZED_PNL' });
            let daily = 0, weekly = 0, monthly = 0, total = 0;

            if (Array.isArray(income)) {
                income.forEach(inc => {
                    const time = inc.timestamp;
                    const amount = parseFloat(inc.amount || 0);
                    total += amount;

                    if (now - time <= oneDay) daily += amount;
                    if (now - time <= sevenDays) weekly += amount;
                    if (now - time <= thirtyDays) monthly += amount;
                });

                return { daily_pnl: daily, weekly_pnl: weekly, monthly_pnl: monthly, total_pnl: total };
            }
            return null;
        } catch (e) {
            logger.error(`[Binance] Failed to fetch PnL: ${e.message}`);
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
            logger.info(`[Binance] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[Binance] Leverage may already be set for ${symbol}. Message: ${e.message}`);
        }
    }

    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
        try {
            const tpStr = this.exchange.priceToPrecision(symbol, takeProfit);
            const slStr = this.exchange.priceToPrecision(symbol, stopLoss);
            const oppositeSide = side === 'buy' ? 'sell' : 'buy';
            
            await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', oppositeSide, size, undefined, {
                stopPrice: tpStr,
                reduceOnly: true
            });

            if (trailingPercent > 0) {
                let clampedPercent = Math.max(0.1, Math.min(5.0, trailingPercent));
                const trailingParams = {
                    callbackRate: clampedPercent,
                    reduceOnly: true
                };
                if (trailingActivationPrice > 0) {
                    trailingParams.activationPrice = this.exchange.priceToPrecision(symbol, trailingActivationPrice);
                }
                logger.info(`[Binance] Configuring native Trailing Stop with callbackRate ${clampedPercent}%${trailingActivationPrice > 0 ? ' and activationPrice ' + trailingParams.activationPrice : ''}`);
                await this.exchange.createOrder(symbol, 'TRAILING_STOP_MARKET', oppositeSide, size, undefined, trailingParams);
            } else {
                await this.exchange.createOrder(symbol, 'STOP_MARKET', oppositeSide, size, undefined, {
                    stopPrice: slStr,
                    reduceOnly: true
                });
            }

            logger.info(`[Binance] Conditional exit parameters independently bound to ${symbol}.`);
        } catch (e) {
            logger.error(`[Binance] Post-fill exit condition error for ${symbol}: ${e.message}`);
        }
    }
}

module.exports = BinanceExchange;
