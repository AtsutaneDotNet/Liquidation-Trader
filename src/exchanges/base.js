class BaseExchange {
    constructor(config) {
        this.config = config;
        this.exchange = null;
    }

    /**
     * Initialize the exchange instance
     */
    async init() {
        throw new Error('init() must be implemented');
    }

    /**
     * Watch for liquidations in real-time
     * @param {string[]} symbols - Array of symbols to watch
     * @param {function} callback - Callback function for when a liquidation occurs
     */
    async watchLiquidations(symbols, callback) {
        throw new Error('watchLiquidations() must be implemented');
    }

    /**
     * Watch for user's private trades (fills) in real-time
     * @param {function} callback - Callback function for when a trade occurs
     * @param {function} isRunningCheck - Function returning boolean to keep the loop running
     * @param {function} errorCallback - Callback for handling errors
     */
    async watchPrivateTrades(callback, isRunningCheck, errorCallback) {
        throw new Error('watchPrivateTrades() must be implemented');
    }

    /**
     * Fetch wallet balance
     */
    async fetchBalance() {
        throw new Error('fetchBalance() must be implemented');
    }

    /**
     * Get array of all loaded active USDT linear symbol pairs
     */
    getLinearSymbols() {
        throw new Error('getLinearSymbols() must be implemented');
    }

    /**
     * Fetch ticker data to get VWAP
     * @param {string} symbol - Symbol to fetch
     */
    async fetchTicker(symbol) {
        throw new Error('fetchTicker() must be implemented');
    }

    /**
     * Place an order with TP and SL
     */
    async placeOrderWithTpSl(symbol, side, amount, price, tpPrice, slPrice) {
        throw new Error('placeOrderWithTpSl() must be implemented');
    }

    /**
     * Set Take Profit and Stop Loss for a position
     */
    async setTpSl(symbol, side, size, takeProfit, stopLoss, entryPrice = 0, trailingPercent = 0, trailingActivationPrice = 0) {
        throw new Error('setTpSl() must be implemented');
    }

    /**
     * Fetch array of recently closed PnLs
     */
    async fetchClosedPnls() {
        return [];
    }

    /**
     * Check if the exchange allows the requested leverage for a specific symbol
     * @param {string} symbol - Symbol to check
     * @param {number} requiredLeverage - The leverage requested in settings
     * @returns {boolean} - true if allowed or undetermined, false if strictly exceeds max allowed
     */
    async checkMaxLeverage(symbol, requiredLeverage) {
        if (!this.exchange) return true;

        try {
            // First check if the max leverage is available in the loaded markets cache
            const market = this.exchange.markets ? this.exchange.markets[symbol] : null;
            if (market && market.limits && market.limits.leverage && market.limits.leverage.max !== undefined) {
                return requiredLeverage <= market.limits.leverage.max;
            }

            // Fallback to fetchLeverageTiers if supported by the exchange
            if (this.exchange.has['fetchLeverageTiers']) {
                const tiers = await this.exchange.fetchLeverageTiers([symbol]);
                if (tiers && tiers[symbol] && tiers[symbol].length > 0) {
                    // Extract the maximum leverage from all the tiers available for this symbol
                    const maxAllowed = Math.max(...tiers[symbol].map(t => t.maxLeverage || 0));
                    if (maxAllowed > 0) {
                        return requiredLeverage <= maxAllowed;
                    }
                }
            }
        } catch (e) {
            if (require('../logger')) {
                const logger = require('../logger');
                logger.warn(`[BaseExchange] Failed to verify max leverage for ${symbol}: ${e.message}`);
            }
        }

        // Return true if we couldn't definitively prove it's not allowed
        return true;
    }

    /**
     * Recursively search for a key in an object up to a certain depth
     */
    findKeyInObj(obj, targetKey, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
        if (obj[targetKey] !== undefined) return parseFloat(obj[targetKey]);
        for (const key in obj) {
            if (typeof obj[key] === 'object') {
                const res = this.findKeyInObj(obj[key], targetKey, depth + 1);
                if (res !== undefined && !isNaN(res)) return res;
            }
        }
        return undefined;
    }

    /**
     * Recursively search for a coin object (e.g., USDT) inside raw data
     */
    findCoinObj(obj, coinSymbol = 'USDT', depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 5) return null;

        const assetName = obj.asset || obj.coin || obj.ccy;
        if (assetName !== undefined && String(assetName).toUpperCase() === coinSymbol.toUpperCase()) {
            return obj;
        }

        for (const key in obj) {
            if (typeof obj[key] === 'object') {
                const res = this.findCoinObj(obj[key], coinSymbol, depth + 1);
                if (res) return res;
            }
        }
        return null;
    }

    /**
     * Standardize balance object parsing to always use totalWalletBalance and totalAvailableBalance
     */
    parseBalanceData(balance) {
        if (!balance) return null;

        let total = 0;
        let free = 0;

        const sourceObj = balance.info || balance;

        const totalWalletBalance = this.findKeyInObj(sourceObj, 'totalWalletBalance');
        if (totalWalletBalance !== undefined && !isNaN(totalWalletBalance)) {
            total = totalWalletBalance;
        } else if (balance.USDT && balance.USDT.total !== undefined) {
            total = balance.USDT.total;
        }

        const totalAvailableBalance = this.findKeyInObj(sourceObj, 'totalAvailableBalance');
        if (totalAvailableBalance !== undefined && !isNaN(totalAvailableBalance)) {
            free = totalAvailableBalance;
        } else if (balance.USDT && balance.USDT.free !== undefined) {
            free = balance.USDT.free;
        }

        const used = Math.max(0, total - free);

        return {
            total_value: total,
            margin_available: free,
            margin_used: used
        };
    }

    /**
     * Execute internal transfer between accounts
     * @param {string} code - Currency code (e.g. USDT)
     * @param {number} amount - Amount to transfer
     * @param {string} fromAccount - Origin account
     * @param {string} toAccount - Destination account
     */
    async internalTransfer(code, amount, fromAccount, toAccount) {
        if (!this.exchange || !this.exchange.has['transfer']) {
            if (require('../logger')) {
                require('../logger').warn(`[BaseExchange] Transfer not supported by this exchange or ccxt wrapper`);
            }
            return false;
        }
        
        try {
            await this.exchange.transfer(code, amount, fromAccount, toAccount);
            if (require('../logger')) {
                require('../logger').info(`[BaseExchange] Successfully transferred ${amount} ${code} from ${fromAccount} to ${toAccount}`);
            }
            return true;
        } catch (e) {
            if (require('../logger')) {
                require('../logger').error(`[BaseExchange] Internal transfer failed: ${e.message}`);
            }
            return false;
        }
    }
}

module.exports = BaseExchange;
