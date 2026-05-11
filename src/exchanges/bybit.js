const ccxt = require('ccxt');
const BaseExchange = require('./base');
const logger = require('../logger');

class BybitExchange extends BaseExchange {
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

        if (cfg.TRADE_EXCHANGE === 'bybit') {
            ccxtConfig.apiKey = cfg.API_KEY;
            ccxtConfig.secret = cfg.API_SECRET;
        }

        this.exchange = new ccxt.pro.bybit(ccxtConfig);

        await this.exchange.loadMarkets();
        logger.info('[Bybit] Markets loaded.');
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

        logger.info(`[Bybit] Starting to watch liquidations for: ${symbols.join(', ')}`);
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
                        logger.debug(`[Bybit] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                        callback(liq);
                    }
                } else {
                    const liq = liquidations;
                    const amount = liq.contracts || liq.baseVolume || 0;
                    const value = liq.price * amount;
                    logger.debug(`[Bybit] Liquidation for ${symbol} | Price: ${liq.price} | Amount: ${amount} | Value: $${value.toFixed(2)}`);
                    callback(liq);
                }
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Bybit] [${symbol} Stream] ${e.message}`);
                    else logger.error(`[Bybit] Error watching liquidations for ${symbol}:`, e.message);
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
                    if (errorCallback) errorCallback(`[Bybit] [Balance Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async watchPrivatePositions(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchPositions']) {
            logger.info('[Bybit] CCXT watchPositions not available. Fallback: Position WS disabled.');
            return;
        }
        while (isRunningCheck()) {
            try {
                const positions = await this.exchange.watchPositions();
                if (!isRunningCheck()) break;

                callback(positions);
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Bybit] [Positions Stream] ${e.message}`);
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
            const threeSixtyFiveDays = 365 * oneDay;

            // Using direct privateGetV5PositionClosedPnl (Bybit Custom CCXT Method)
            const response = await this.exchange.privateGetV5PositionClosedPnl({
                category: 'linear',
                limit: 100
            });

            if (response && response.result && response.result.list) {
                const list = response.result.list;
                let daily = 0, weekly = 0, monthly = 0, yearly = 0, total = 0;

                list.forEach(pnl => {
                    const closedTime = parseInt(pnl.updatedTime);
                    const amount = parseFloat(pnl.closedPnl || 0);
                    total += amount;

                    if (now - closedTime <= oneDay) daily += amount;
                    if (now - closedTime <= sevenDays) weekly += amount;
                    if (now - closedTime <= thirtyDays) monthly += amount;
                    if (now - closedTime <= threeSixtyFiveDays) yearly += amount;
                });

                return { daily_pnl: daily, weekly_pnl: weekly, monthly_pnl: monthly, yearly_pnl: yearly, total_pnl: total };
            }
            return null;
        } catch (e) {
            logger.error(`[Bybit] Failed to fetch PnL: ${e.message}`);
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
            logger.info(`[Bybit] Leverage set to ${leverage} for ${symbol}`);
        } catch (e) {
            logger.info(`[Bybit] Leverage may already be set for ${symbol}. Message: ${e.message}`);
        }
    }

    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
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
            logger.info(`[Bybit] Conditional limits securely attached onto ${symbol} position.`);
        } catch (e) {
            logger.error(`[Bybit] Post-fill conditional logic failure for ${symbol}: ${e.message}`);
        }
    }
}

module.exports = BybitExchange;
