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
        let foundTotal = false;
        let foundFree = false;

        const sourceObj = balance.info || balance;

        // 1. Try to find coin-specific USDT data first to be highly precise
        const coinObj = this.findCoinObj(sourceObj, 'USDT');
        if (coinObj) {
            const coinTotalKeys = ['walletBalance', 'equity', 'eq', 'cashBal', 'total'];
            for (const key of coinTotalKeys) {
                if (coinObj[key] !== undefined) {
                    const val = parseFloat(coinObj[key]);
                    if (!isNaN(val)) {
                        total = val;
                        foundTotal = true;
                        break;
                    }
                }
            }

            const coinFreeKeys = ['availableBalance', 'availBal', 'available', 'freeBalance', 'free_balance', 'free'];
            for (const key of coinFreeKeys) {
                if (coinObj[key] !== undefined) {
                    const val = parseFloat(coinObj[key]);
                    if (!isNaN(val)) {
                        free = val;
                        foundFree = true;
                        break;
                    }
                }
            }
        }

        // 2. Fallback to unique account-level keys in raw info
        if (!foundTotal) {
            const accountTotalKeys = ['totalWalletBalance', 'totalBalance', 'walletBalance', 'total_balance', 'wallet_balance', 'total'];
            for (const key of accountTotalKeys) {
                const val = this.findKeyInObj(sourceObj, key);
                if (val !== undefined && !isNaN(val)) {
                    total = val;
                    foundTotal = true;
                    break;
                }
            }
        }

        if (!foundFree) {
            const accountFreeKeys = ['totalAvailableBalance', 'availableBalance', 'available', 'freeBalance', 'free_balance', 'free'];
            for (const key of accountFreeKeys) {
                const val = this.findKeyInObj(sourceObj, key);
                if (val !== undefined && !isNaN(val)) {
                    free = val;
                    foundFree = true;
                    break;
                }
            }
        }

        // 3. Fallbacks using standard CCXT parsed properties
        let detectedCoin = 'USDT';
        if (!foundTotal) {
            if (balance.USDT && balance.USDT.total !== undefined) {
                total = parseFloat(balance.USDT.total);
            } else if (balance.total && balance.total.USDT !== undefined) {
                total = parseFloat(balance.total.USDT);
            } else if (balance.total && typeof balance.total === 'object') {
                for (const coin in balance.total) {
                    const val = parseFloat(balance.total[coin]);
                    if (val > 0) {
                        total = val;
                        detectedCoin = coin;
                        break;
                    }
                }
            }
        }

        if (!foundFree) {
            if (detectedCoin && balance[detectedCoin] && balance[detectedCoin].free !== undefined) {
                free = parseFloat(balance[detectedCoin].free);
            } else if (detectedCoin && balance.free && balance.free[detectedCoin] !== undefined) {
                free = parseFloat(balance.free[detectedCoin]);
            } else if (balance.free && typeof balance.free === 'object') {
                for (const coin in balance.free) {
                    const val = parseFloat(balance.free[coin]);
                    if (val > 0) {
                        free = val;
                        break;
                    }
                }
            }
        }

        const used = Math.max(0, total - free);

        return {
            total_value: total,
            margin_available: free,
            margin_used: used
        };
    }
}

module.exports = BaseExchange;
