const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

class WebServer {
    constructor(bot) {
        this.app = express();
        this.bot = bot;
        this.activeSessions = new Set();

        this.app.use(cors());
        this.app.use(express.json());

        // Simple cookie parser
        this.app.use((req, res, next) => {
            req.cookies = {};
            if (req.headers.cookie) {
                req.headers.cookie.split(';').forEach(cookie => {
                    const parts = cookie.split('=');
                    req.cookies[parts[0].trim()] = (parts[1] || '').trim();
                });
            }
            next();
        });

        this.setupAuthRoutes();
        this.setupAuthMiddleware();

        this.app.use(express.static(path.join(__dirname, '../public')));

        this.setupRoutes();
    }

    setupAuthRoutes() {
        this.app.post('/api/auth/login', (req, res) => {
            const { username, password } = req.body;
            const currentConfig = config.get();
            if (username === currentConfig.WEBUI_USERNAME && password === currentConfig.WEBUI_PASSWORD) {
                const token = require('crypto').randomBytes(32).toString('hex');
                this.activeSessions.add(token);
                res.cookie('auth_token', token, { httpOnly: true });
                return res.json({ success: true, message: 'Logged in successfully' });
            }
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        });

        this.app.post('/api/auth/logout', (req, res) => {
            if (req.cookies.auth_token) {
                this.activeSessions.delete(req.cookies.auth_token);
            }
            res.clearCookie('auth_token');
            res.json({ success: true, message: 'Logged out successfully' });
        });

        this.app.get('/api/auth/status', (req, res) => {
            const enabled = config.get().WEBUI_AUTH_ENABLED;
            const authenticated = this.activeSessions.has(req.cookies.auth_token);
            res.json({ enabled, authenticated });
        });
    }

    setupAuthMiddleware() {
        this.app.use((req, res, next) => {
            const currentConfig = config.get();
            if (!currentConfig.WEBUI_AUTH_ENABLED) {
                return next();
            }

            if (req.path === '/login.html' || req.path === '/style.css' || req.path === '/script.js') {
                return next();
            }

            if (this.activeSessions.has(req.cookies.auth_token)) {
                return next();
            }

            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            } else {
                return res.redirect('/login.html');
            }
        });
    }

    setupRoutes() {
        // Get config
        this.app.get('/api/config', (req, res) => {
            const currentConfig = config.get();
            // Mask API keys for safety over HTTP response
            const responseConfig = { ...currentConfig };
            if (responseConfig.API_KEY) responseConfig.API_KEY = responseConfig.API_KEY.replace(/.(?=.{4})/g, '*');
            if (responseConfig.API_SECRET) responseConfig.API_SECRET = '********';
            if (responseConfig.WEBUI_USERNAME) responseConfig.WEBUI_USERNAME = responseConfig.WEBUI_USERNAME.replace(/.(?=.{4})/g, '*');
            if (responseConfig.WEBUI_PASSWORD) responseConfig.WEBUI_PASSWORD = '********';
            if (responseConfig.RAPIDAPI_KEY) responseConfig.RAPIDAPI_KEY = responseConfig.RAPIDAPI_KEY.replace(/.(?=.{4})/g, '*');
            res.json(responseConfig);
        });

        // Update config
        this.app.post('/api/config', (req, res) => {
            try {
                const updates = req.body;
                for (const [key, value] of Object.entries(updates)) {
                    // Prevent overwriting API key with mask
                    const isMaskedKey = ['API_KEY', 'API_SECRET', 'WEBUI_USERNAME', 'WEBUI_PASSWORD', 'RAPIDAPI_KEY'].includes(key);
                    if (isMaskedKey && typeof value === 'string' && value.includes('*')) {
                        continue;
                    }
                    if (value !== undefined && value !== null) {
                        if (value === '' && key !== 'COIN_BLACKLIST') {
                            continue;
                        }
                        config.set(key, value.toString());
                    }
                }
                res.json({ success: true, message: 'Configuration saved to SQLite.' });
            } catch (error) {
                logger.error('Failed to update config:', error);
                res.status(500).json({ success: false, message: 'Failed to update configuration.' });
            }
        });

        // Export config
        this.app.get('/api/config/export', (req, res) => {
            const currentConfig = config.get();
            const exportConfig = { ...currentConfig };
            const excludedKeys = [
                'API_KEY', 'API_SECRET', 'WEBUI_USERNAME', 'WEBUI_PASSWORD', 
                'RAPIDAPI_KEY', 'CMC_API_KEY', 'WEBUI_AUTH_ENABLED', 
                'LOG_LEVEL', 'WEB_PORT', 'WEB_HOST', 'ANON_UID'
            ];
            for (const key of excludedKeys) {
                delete exportConfig[key];
            }
            res.setHeader('Content-disposition', 'attachment; filename=liquidation-trader-settings.json');
            res.setHeader('Content-type', 'application/json');
            res.send(JSON.stringify(exportConfig, null, 2));
        });

        // Status
        this.app.get('/api/status', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            const isPaper = currentConfig.ENABLE_PAPER_TRADING;
            const positions = isPaper ? (db.getPaperPositions() || []) : (db.getPositions() || []);
            const state = isPaper ? (db.getPaperAccountState() || {}) : (db.getAccountState() || {});
            const usedMarginPercent = state.total_value > 0 ? (state.margin_used / state.total_value) * 100 : 0;

            res.json({
                isRunning: this.bot.isRunning,
                isTrading: this.bot.isTrading,
                pairsLoaded: Array.isArray(this.bot.symbols) ? this.bot.symbols.length : 0,
                btcUsdPrice: this.bot.btcUsdPrice,
                openPositionsCount: positions.length,
                maxOpenPositions: parseInt(currentConfig.MAX_OPEN_POSITIONS) || 0,
                usedMarginPercent: usedMarginPercent,
                isolationMode: currentConfig.ENABLE_ISOLATION_MODE && usedMarginPercent >= (parseFloat(currentConfig.ISOLATION_MARGIN_THRESHOLD) || 10),
                marketSentiment: this.bot.marketSentiment,
                lastTransferCheck: this.bot.lastTransferCheck,
                lastSuccessfulTransfer: this.bot.lastSuccessfulTransfer,
                lastAccountUpdate: this.bot.lastAccountUpdate,
                lastPositionsUpdate: this.bot.lastPositionsUpdate,
                lastClosedPnlUpdate: this.bot.lastClosedPnlUpdate,
                lastDynamicThresholdsUpdate: this.bot.lastDynamicThresholdsUpdate
            });
        });

        this.app.get('/api/account', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperAccountState() || {});
            } else {
                res.json(db.getAccountState() || {});
            }
        });

        this.app.get('/api/positions', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperPositions() || []);
            } else {
                res.json(db.getPositions() || []);
            }
        });

        this.app.post('/api/positions/refresh', async (req, res) => {
            if (config.get().ENABLE_PAPER_TRADING) {
                return res.json({ success: true, message: 'Paper positions are updated locally.' });
            }
            if (!this.bot.isRunning || !this.bot.tradeExchange || !this.bot.tradeExchange.exchange) {
                return res.json({ success: false, message: 'Bot is not running or exchange not initialized.' });
            }
            try {
                if (this.bot.tradeExchange.exchange.has['fetchPositions']) {
                    const apiPositions = await this.bot.tradeExchange.exchange.fetchPositions();
                    await this.bot.onPositionUpdate(apiPositions);
                    res.json({ success: true, message: 'Positions refreshed.' });
                } else {
                    res.json({ success: false, message: 'Exchange does not support fetchPositions.' });
                }
            } catch (err) {
                logger.error('Failed to manually refresh positions:', err);
                res.status(500).json({ success: false, message: 'Error refreshing positions.' });
            }
        });

        this.app.post('/api/positions/close', async (req, res) => {
            const { symbol } = req.body;
            if (!symbol) {
                return res.status(400).json({ success: false, message: 'Symbol is required.' });
            }
            try {
                if (!this.bot.isRunning) {
                    return res.json({ success: false, message: 'Bot is not running.' });
                }
                if (typeof this.bot.closePositionBySymbol === 'function') {
                    await this.bot.closePositionBySymbol(symbol);
                    res.json({ success: true, message: `Position ${symbol} successfully closed.` });
                } else {
                    res.json({ success: false, message: 'Bot does not support closePositionBySymbol.' });
                }
            } catch (err) {
                logger.error(`Failed to manually close position ${symbol}:`, err);
                res.status(500).json({ success: false, message: `Error closing position: ${err.message}` });
            }
        });

        this.app.get('/api/liquidations', (req, res) => {
            const db = require('./db');
            res.json(db.getLiquidations(200) || []); // Fetch up to 200 liquidations for the UI
        });

        this.app.get('/api/closed-pnl', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperClosedPnls(200) || []);
            } else {
                res.json(db.getClosedPnls(200) || []);
            }
        });

        this.app.get('/api/pnl/daily-history', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            const days = parseInt(req.query.days) || 30;
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperDailyPnLHistory(days) || []);
            } else {
                res.json(db.getDailyPnLHistory(days) || []);
            }
        });

        this.app.get('/api/trade-decisions', (req, res) => {
            res.json(this.bot.tradeDecisions || []);
        });

        this.app.get('/api/statistics/24h', (req, res) => {
            const db = require('./db');
            res.json(db.get24HourStatistics());
        });

        this.app.get('/api/statistics/page-data', (req, res) => {
            const db = require('./db');
            const cutoffTimestamp = Date.now() - 24 * 60 * 60 * 1000;
            res.json(db.getPageStatistics(cutoffTimestamp));
        });

        // Dynamic Thresholds
        this.app.get('/api/dynamic-thresholds', (req, res) => {
            const currentConfig = config.get();
            const result = [];
            const symbols = Array.isArray(this.bot.symbols) ? this.bot.symbols : [];
            const isDynamicEnabled = currentConfig.ENABLE_DYNAMIC_THRESHOLDS;
            const replaceBelowMin = currentConfig.REPLACE_BELOW_MIN_THRESHOLD;
            const btcPrice = this.bot.btcUsdPrice || 1;
            const staticUsd = currentConfig.LIQUIDATION_VALUE_CURRENCY === 'BTC' ? currentConfig.LIQUIDATION_VALUE_THRESHOLD * btcPrice : currentConfig.LIQUIDATION_VALUE_THRESHOLD;
            const dynamicMap = this.bot.dynamicThresholds || {};
            const bases = Object.keys(dynamicMap).sort((a, b) => b.length - a.length);

            for (const sym of symbols) {
                let threshold = staticUsd;
                let status = 'Static (Config)';
                
                if (isDynamicEnabled) {
                    const symUpper = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    let foundDynamic = false;
                    for (const base of bases) {
                        if (symUpper.startsWith(base)) {
                            const dynVal = dynamicMap[base];
                            if (replaceBelowMin && dynVal < staticUsd) {
                                threshold = staticUsd;
                                status = 'Static (Config)';
                            } else {
                                threshold = dynVal;
                                status = 'Dynamic (API)';
                            }
                            foundDynamic = true;
                            break;
                        }
                    }
                    if (!foundDynamic) {
                        threshold = staticUsd;
                        status = 'Static (Config)';
                    }
                }
                
                result.push({
                    symbol: sym,
                    threshold: threshold,
                    status: status
                });
            }
            res.json({
                mapped: result,
                rawMap: dynamicMap
            });
        });

        // Logs
        this.app.get('/api/logs', (req, res) => {
            res.json(logger.getLogs());
        });

        // Control bot
        this.app.post('/api/bot/start', async (req, res) => {
            if (this.bot.isRunning) {
                return res.json({ success: false, message: 'Bot is already running.' });
            }
            try {
                // Ensure API keys exist if not paper trading
                const currentConfig = config.get();
                if (!currentConfig.ENABLE_PAPER_TRADING && (!currentConfig.API_KEY || !currentConfig.API_SECRET)) {
                    return res.json({ success: false, message: 'API Key and Secret must be configured for Trading.' });
                }

                await this.bot.start();
                config.set('BOT_RUNNING_STATE', 'true');
                res.json({ success: true, message: 'Bot started successfully.' });
            } catch (error) {
                logger.error('Failed to start bot via web UI:', error);
                res.json({ success: false, message: error.message });
            }
        });

        // Recent orders (for toast notifications in the UI)
        this.app.get('/api/orders/recent', (req, res) => {
            const unseen = this.bot.orderEvents.filter(e => !e.seen);
            // Mark them seen so they only notify once
            unseen.forEach(e => { e.seen = true; });
            res.json(unseen);
        });

        this.app.post('/api/bot/stop', async (req, res) => {
            if (!this.bot.isRunning) {
                return res.json({ success: false, message: 'Bot is not running.' });
            }
            try {
                await this.bot.stop();
                config.set('BOT_RUNNING_STATE', 'false');
                res.json({ success: true, message: 'Bot stopped successfully.' });
            } catch (error) {
                res.json({ success: false, message: error.message });
            }
        });
    }

    start() {
        const port = config.get().WEB_PORT;
        const host = config.get().WEB_HOST;
        this.app.listen(port, host, () => {
            logger.info(`Web dashboard server running on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
        });
    }
}

module.exports = WebServer;
