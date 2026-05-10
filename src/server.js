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
            if (responseConfig.LIQUIDATIONREPORT_KEY) responseConfig.LIQUIDATIONREPORT_KEY = responseConfig.LIQUIDATIONREPORT_KEY.replace(/.(?=.{4})/g, '*');
            res.json(responseConfig);
        });

        // Update config
        this.app.post('/api/config', (req, res) => {
            try {
                const updates = req.body;
                for (const [key, value] of Object.entries(updates)) {
                    // Prevent overwriting API key with mask
                    const isMaskedKey = ['API_KEY', 'API_SECRET', 'WEBUI_USERNAME', 'WEBUI_PASSWORD', 'LIQUIDATIONREPORT_KEY'].includes(key);
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

        // Status
        this.app.get('/api/status', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            const positions = db.getPositions() || [];
            const state = db.getAccountState() || {};
            const usedMarginPercent = state.total_value > 0 ? (state.margin_used / state.total_value) * 100 : 0;

            res.json({
                isRunning: this.bot.isRunning,
                isTrading: this.bot.isTrading,
                pairsLoaded: Array.isArray(this.bot.symbols) ? this.bot.symbols.length : 0,
                btcUsdPrice: this.bot.btcUsdPrice,
                openPositionsCount: positions.length,
                maxOpenPositions: parseInt(currentConfig.MAX_OPEN_POSITIONS) || 0,
                usedMarginPercent: usedMarginPercent
            });
        });

        // Account & Positions
        this.app.get('/api/account', (req, res) => {
            const db = require('./db');
            res.json(db.getAccountState() || {});
        });

        this.app.get('/api/positions', (req, res) => {
            const db = require('./db');
            res.json(db.getPositions() || []);
        });

        this.app.get('/api/liquidations', (req, res) => {
            const db = require('./db');
            res.json(db.getLiquidations(200) || []); // Fetch up to 200 liquidations for the UI
        });

        this.app.get('/api/trade-decisions', (req, res) => {
            res.json(this.bot.tradeDecisions || []);
        });

        // Dynamic Thresholds
        this.app.get('/api/dynamic-thresholds', (req, res) => {
            const currentConfig = config.get();
            const result = [];
            const symbols = Array.isArray(this.bot.symbols) ? this.bot.symbols : [];
            const isDynamicEnabled = currentConfig.ENABLE_DYNAMIC_THRESHOLDS;
            const btcPrice = this.bot.btcUsdPrice || 1;
            const staticUsd = currentConfig.LIQUIDATION_VALUE_CURRENCY === 'BTC' ? currentConfig.LIQUIDATION_VALUE_THRESHOLD * btcPrice : currentConfig.LIQUIDATION_VALUE_THRESHOLD;
            const dynamicMap = this.bot.dynamicThresholds || {};
            const bases = Object.keys(dynamicMap).sort((a, b) => b.length - a.length);

            for (const sym of symbols) {
                let threshold = staticUsd;
                let status = 'Static (Config)';
                
                if (isDynamicEnabled) {
                    const symUpper = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    for (const base of bases) {
                        if (symUpper.startsWith(base)) {
                            threshold = dynamicMap[base];
                            status = 'Dynamic (API)';
                            break;
                        }
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
                // Ensure API keys exist
                const currentConfig = config.get();
                if (!currentConfig.API_KEY || !currentConfig.API_SECRET) {
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
