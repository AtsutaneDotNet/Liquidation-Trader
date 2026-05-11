const logger = require('./logger');

class CmcService {
    constructor() {
        this.cache = null;
        this.lastFetch = 0;
        this.cacheTTL = 3600000; // 1 hour in ms
    }

    /**
     * Fetch top ranked cryptocurrency symbols from CoinMarketCap
     * @param {string} apiKey CMC API Key
     * @param {number} limit Number of coins to fetch
     * @returns {Promise<Set<string>>} Set of uppercase symbols
     */
    async getTopSymbols(apiKey, limit = 100) {
        const now = Date.now();

        // Return cache if it's still fresh
        if (this.cache && (now - this.lastFetch < this.cacheTTL)) {
            return this.cache;
        }

        if (!apiKey) {
            logger.warn('CMC API Key is missing. Cannot fetch rankings.');
            return this.cache || new Set();
        }

        try {
            logger.info(`Refreshing CMC rankings (Top ${limit})...`);
            const response = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=${limit}`, {
                headers: {
                    'X-CMC_PRO_API_KEY': apiKey,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.status?.error_message || `HTTP ${response.status}`);
            }

            const json = await response.json();
            if (!json.data || !Array.isArray(json.data)) {
                throw new Error('Invalid response format from CMC');
            }

            const symbols = new Set(json.data.map(coin => coin.symbol.toUpperCase()));

            this.cache = symbols;
            this.lastFetch = now;
            logger.info(`Successfully cached ${symbols.size} symbols from CMC.`);

            return symbols;
        } catch (error) {
            logger.error(`Failed to refresh CMC rankings: ${error.message}`);

            if (this.cache) {
                logger.info('Using stale CMC cache due to fetch failure.');
                return this.cache;
            }

            throw error; // Rethrow if no cache available (bot start should handle this)
        }
    }

    /**
     * Check if a symbol is in the top rankings
     * @param {string} exchangeSymbol Symbol from exchange (e.g. BTC/USDT or BTCUSDT)
     * @returns {boolean}
     */
    isSymbolInTop(exchangeSymbol) {
        if (!this.cache) return true; // If no filter active/loaded, allow all

        // 1. Separate by common delimiters used in CCXT/Exchanges: /, :, -
        // Examples: ZRX/USDT:USDT -> ZRX, BTC/USDT -> BTC, BTC-USDT -> BTC
        let baseSymbol = exchangeSymbol.toUpperCase().split(/[\/:-]/)[0];

        // 2. Remove common quote suffixes if they are attached without delimiters
        // Example: BTCUSDT -> BTC
        baseSymbol = baseSymbol.replace(/(USDT|USD|BUSD|USDC|EUR|GBP)$/, '');

        return this.cache.has(baseSymbol);
    }

    /**
     * Fetch the latest Fear and Greed Index from CoinMarketCap
     * @param {string} apiKey CMC API Key
     * @returns {Promise<Object|null>}
     */
    async getFearAndGreed(apiKey) {
        if (!apiKey) {
            return null;
        }

        try {
            const response = await fetch(`https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest`, {
                headers: {
                    'X-CMC_PRO_API_KEY': apiKey,
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.status?.error_message || `HTTP ${response.status}`);
            }

            const json = await response.json();
            if (json && json.data) {
                return {
                    value: json.data.value,
                    classification: json.data.value_classification
                };
            }
            return null;
        } catch (error) {
            logger.error(`Failed to fetch CMC Fear and Greed Index: ${error.message}`);
            return null;
        }
    }
}

module.exports = new CmcService();
