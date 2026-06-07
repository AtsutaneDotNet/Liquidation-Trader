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

        let lastFetchTime = 0;
        let timeoutId = null;
        let isFetching = false;

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

    async watchPrivateTrades(callback, isRunningCheck, errorCallback) {
        if (!this.exchange.has['watchMyTrades']) {
            logger.info('[Binance] CCXT watchMyTrades not available. Fallback: Trades WS disabled.');
            return;
        }
        while (isRunningCheck()) {
            try {
                const trades = await this.exchange.watchMyTrades();
                if (!isRunningCheck()) break;

                callback(trades);
            } catch (e) {
                if (isRunningCheck()) {
                    if (errorCallback) errorCallback(`[Binance] [Trades Stream] ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    async fetchClosedPnls() {
        try {
            // Binance allows fetching Income history which includes REALIZED_PNL
            // We fetch the last 100 or so to get individual records.
            const income = await this.exchange.fapiPrivateGetIncome({ incomeType: 'REALIZED_PNL', limit: 100 });

            if (Array.isArray(income)) {
                return income.map(inc => {
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
            }
            return [];
        } catch (e) {
            logger.error(`[Binance] Failed to fetch PnL: ${e.message}`);
            return [];
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

            await this.exchange.createOrder(symbol, 'TAKE_PROFIT_MARKET', oppositeSide, undefined, undefined, {
                stopPrice: tpStr,
                closePosition: true
            });

            await this.exchange.createOrder(symbol, 'STOP_MARKET', oppositeSide, undefined, undefined, {
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
                    trailingParams.activationPrice = this.exchange.priceToPrecision(symbol, trailingActivationPrice);
                }
                logger.info(`[Binance] Configuring native Trailing Stop with callbackRate ${clampedPercent}%${trailingActivationPrice > 0 ? ' and activationPrice ' + trailingParams.activationPrice : ''}`);
                await this.exchange.createOrder(symbol, 'TRAILING_STOP_MARKET', oppositeSide, size, undefined, trailingParams);
            }

            logger.info(`[Binance] Conditional exit parameters independently bound to ${symbol}.`);
        } catch (e) {
            logger.error(`[Binance] Post-fill exit condition error for ${symbol}: ${e.message}`);
            throw e;
        }
    }
}

module.exports = BinanceExchange;
