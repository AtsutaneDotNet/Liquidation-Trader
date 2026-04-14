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
}

module.exports = BaseExchange;
