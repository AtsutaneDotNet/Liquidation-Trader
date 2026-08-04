const logger = require('./logger');

class ConnectionStatusManager {
    constructor() {
        this.connections = new Map();
        this.startTime = Date.now();
        this.initializeDefaultRegistry();
    }

    /**
     * Pre-register known connection definitions so the status page shows all tracked endpoints
     */
    initializeDefaultRegistry() {
        const defaults = [
            // 1. WebSocket Connections
            {
                id: 'ws_liq_bybit',
                name: 'Bybit Liquidations Stream',
                category: 'websocket',
                protocol: 'WSS',
                target: 'wss://stream.bybit.com/v5/public/linear',
                status: 'idle',
                details: { type: 'Public Liquidations Feed' }
            },
            {
                id: 'ws_liq_binance',
                name: 'Binance Liquidations Stream',
                category: 'websocket',
                protocol: 'WSS',
                target: 'wss://fstream.binance.com',
                status: 'idle',
                details: { type: 'Public Liquidations Batched Streams' }
            },
            {
                id: 'ws_liq_okx',
                name: 'OKX Liquidations Stream',
                category: 'websocket',
                protocol: 'WSS',
                target: 'wss://ws.okx.com:8443/ws/v5/public',
                status: 'idle',
                details: { type: 'Public Liquidations Feed' }
            },
            {
                id: 'ws_priv_balance',
                name: 'Exchange Balance Stream',
                category: 'websocket',
                protocol: 'WSS',
                target: 'Private User Data Stream',
                status: 'idle',
                details: { type: 'Real-time Wallet Balance & Margin' }
            },
            {
                id: 'ws_priv_positions',
                name: 'Exchange Positions Stream',
                category: 'websocket',
                protocol: 'WSS',
                target: 'Private User Data Stream',
                status: 'idle',
                details: { type: 'Real-time Position Updates' }
            },
            {
                id: 'ws_priv_trades',
                name: 'Exchange Private Trades Stream',
                category: 'websocket',
                protocol: 'WSS',
                target: 'Private User Data Stream',
                status: 'idle',
                details: { type: 'Real-time Execution & Fill Notifications' }
            },
            {
                id: 'ws_ohlcv_tracking',
                name: 'OHLCV Price Feed Streams',
                category: 'websocket',
                protocol: 'WSS',
                target: 'Public OHLCV Candlestick Feed',
                status: 'idle',
                details: { type: 'Paper Trading & Trailing SL Engine' }
            },

            // 2. Exchange REST API Endpoints
            {
                id: 'rest_ex_markets',
                name: 'Exchange Markets & Symbols Loader',
                category: 'exchange_rest',
                protocol: 'REST',
                target: 'loadMarkets / getLinearSymbols',
                status: 'idle',
                details: { type: 'Perpetuals Linear Pair Discovery' }
            },
            {
                id: 'rest_ex_tickers',
                name: 'Exchange 24h Tickers & Volume',
                category: 'exchange_rest',
                protocol: 'REST',
                target: 'fetchTickers / fetchTicker',
                status: 'idle',
                details: { type: '24h Volume Filter & BTC Price Converter' }
            },
            {
                id: 'rest_ex_balance',
                name: 'Exchange Balance REST Endpoint',
                category: 'exchange_rest',
                protocol: 'REST',
                target: 'fetchBalance',
                status: 'idle',
                details: { type: 'Account Margin & Balance Check' }
            },
            {
                id: 'rest_ex_orders',
                name: 'Order Placement & TP/SL Engine',
                category: 'exchange_rest',
                protocol: 'REST',
                target: 'createOrder / setTpSl / Algo',
                status: 'idle',
                details: { type: 'Trade Execution & Protective Orders' }
            },
            {
                id: 'rest_ex_pnl',
                name: 'Closed PnL History Reconciliation',
                category: 'exchange_rest',
                protocol: 'REST',
                target: 'fetchClosedPnls / Income History',
                status: 'idle',
                details: { type: 'Realized PnL & Trade Sync' }
            },

            // 3. External Services & Intelligence APIs
            {
                id: 'rest_cmc_listings',
                name: 'CoinMarketCap Top Rankings API',
                category: 'external_api',
                protocol: 'HTTPS',
                target: 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest',
                status: 'idle',
                details: { type: 'Market Cap Top-Ranked Coin Filter' }
            },
            {
                id: 'rest_rapidapi_thresholds',
                name: 'Liquidation Trader Dynamic Thresholds',
                category: 'external_api',
                protocol: 'HTTPS',
                target: 'https://liquidation-trader.p.rapidapi.com/data',
                status: 'idle',
                details: { type: 'Asset-specific Mean Liquidation Thresholds' }
            },
            {
                id: 'rest_rapidapi_sentiment',
                name: 'Liquidation Trader Market Sentiment',
                category: 'external_api',
                protocol: 'HTTPS',
                target: 'https://liquidation-trader.p.rapidapi.com/sentiment',
                status: 'idle',
                details: { type: 'Fear & Greed Index and Score' }
            },
            {
                id: 'rest_report_sync',
                name: 'Liquidation Report Community Sync',
                category: 'external_api',
                protocol: 'HTTPS',
                target: 'https://liquidation.report/api/trader',
                status: 'idle',
                details: { type: 'Anonymous Aggregated Performance Sharing' }
            },
            {
                id: 'rest_github_update',
                name: 'GitHub Version Check API',
                category: 'external_api',
                protocol: 'HTTPS',
                target: 'https://api.github.com/repos/AtsutaneDotNet/Liquidation-Trader',
                status: 'idle',
                details: { type: 'Repository Release & Commit Checker' }
            }
        ];

        for (const item of defaults) {
            this.register(item.id, item);
        }
    }

    /**
     * Register or update registration of an endpoint
     */
    register(id, info) {
        const existing = this.connections.get(id) || {};
        this.connections.set(id, {
            id,
            name: info.name || existing.name || id,
            category: info.category || existing.category || 'external_api',
            protocol: info.protocol || existing.protocol || 'REST',
            target: info.target || existing.target || 'N/A',
            status: info.status || existing.status || 'idle', // connected, connecting, idle, error, disabled
            lastActivity: existing.lastActivity || null,
            lastLatencyMs: existing.lastLatencyMs !== undefined ? existing.lastLatencyMs : null,
            messageCount: existing.messageCount || 0,
            requestCount: existing.requestCount || 0,
            errorCount: existing.errorCount || 0,
            lastError: existing.lastError || null,
            lastErrorTime: existing.lastErrorTime || null,
            details: { ...(existing.details || {}), ...(info.details || {}) }
        });
    }

    /**
     * Update connection status
     */
    updateStatus(id, status, error = null, details = null) {
        const conn = this.connections.get(id);
        if (!conn) {
            this.register(id, { status, details });
            return;
        }

        conn.status = status;
        if (error) {
            conn.lastError = typeof error === 'string' ? error : error.message || String(error);
            conn.lastErrorTime = Date.now();
            conn.errorCount = (conn.errorCount || 0) + 1;
        }
        if (details) {
            conn.details = { ...conn.details, ...details };
        }
    }

    /**
     * Record successful activity/message on connection
     */
    recordActivity(id, { latencyMs = null, incrementMsg = 0, incrementReq = 0, details = null } = {}) {
        let conn = this.connections.get(id);
        if (!conn) {
            this.register(id, {});
            conn = this.connections.get(id);
        }

        conn.status = 'connected';
        conn.lastActivity = Date.now();
        if (latencyMs !== null && latencyMs !== undefined) {
            conn.lastLatencyMs = Math.round(latencyMs);
        }
        if (incrementMsg > 0) {
            conn.messageCount = (conn.messageCount || 0) + incrementMsg;
        }
        if (incrementReq > 0) {
            conn.requestCount = (conn.requestCount || 0) + incrementReq;
        }
        if (details) {
            conn.details = { ...conn.details, ...details };
        }
    }

    /**
     * Record an error on connection
     */
    recordError(id, error, details = null) {
        let conn = this.connections.get(id);
        if (!conn) {
            this.register(id, {});
            conn = this.connections.get(id);
        }

        conn.status = 'error';
        conn.lastError = typeof error === 'string' ? error : error.message || String(error);
        conn.lastErrorTime = Date.now();
        conn.errorCount = (conn.errorCount || 0) + 1;
        if (details) {
            conn.details = { ...conn.details, ...details };
        }
    }

    /**
     * Get specific connection by ID
     */
    get(id) {
        return this.connections.get(id) || null;
    }

    /**
     * Get all connections as an array
     */
    getAll() {
        return Array.from(this.connections.values());
    }

    /**
     * Get summary metrics and categorization counts
     */
    getSummary() {
        const list = this.getAll();
        const summary = {
            total: list.length,
            connected: 0,
            connecting: 0,
            idle: 0,
            error: 0,
            disabled: 0,
            categories: {
                websocket: { total: 0, connected: 0, error: 0, idle: 0, disabled: 0, messageCount: 0 },
                exchange_rest: { total: 0, connected: 0, error: 0, idle: 0, disabled: 0, requestCount: 0, latencies: [] },
                external_api: { total: 0, connected: 0, error: 0, idle: 0, disabled: 0, requestCount: 0, latencies: [] }
            },
            uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000)
        };

        for (const conn of list) {
            const cat = summary.categories[conn.category] || summary.categories.external_api;
            cat.total++;

            if (conn.status === 'connected') {
                summary.connected++;
                cat.connected++;
            } else if (conn.status === 'connecting') {
                summary.connecting++;
            } else if (conn.status === 'error') {
                summary.error++;
                cat.error++;
            } else if (conn.status === 'disabled') {
                summary.disabled++;
                cat.disabled++;
            } else {
                summary.idle++;
                cat.idle++;
            }

            if (conn.category === 'websocket') {
                cat.messageCount += conn.messageCount || 0;
            } else {
                cat.requestCount += conn.requestCount || 0;
                if (conn.lastLatencyMs && conn.lastLatencyMs > 0) {
                    cat.latencies.push(conn.lastLatencyMs);
                }
            }
        }

        // Calculate average latencies
        const calcAvg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
        summary.categories.exchange_rest.avgLatencyMs = calcAvg(summary.categories.exchange_rest.latencies);
        delete summary.categories.exchange_rest.latencies;
        summary.categories.external_api.avgLatencyMs = calcAvg(summary.categories.external_api.latencies);
        delete summary.categories.external_api.latencies;

        return summary;
    }
}

module.exports = new ConnectionStatusManager();
