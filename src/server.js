const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');
const connectionStatus = require('./connectionStatus');

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

        this.app.get('/api/account-history', (req, res) => {
            try {
                const db = require('./db');
                const chartData = db.getAccountHistoryData();
                const transfers = db.getInternalTransfers();
                res.json({ success: true, chartData, transfers });
            } catch (e) {
                logger.error(`Failed to fetch account history: ${e.message}`);
                res.status(500).json({ success: false, message: 'Internal server error' });
            }
        });

        // Check for updates
        this.app.get('/api/check-update', async (req, res) => {
            const start = Date.now();
            try {
                const gitPath = path.join(__dirname, '../.git');
                const headPath = path.join(gitPath, 'HEAD');
                if (!fs.existsSync(headPath)) {
                    connectionStatus.recordActivity('rest_github_update', { latencyMs: 0, incrementReq: 1, details: { notGit: true } });
                    return res.json({ updateAvailable: false, message: 'Not a git repository' });
                }

                let headContent = fs.readFileSync(headPath, 'utf8').trim();
                let localHash = '';
                let branchName = 'main';

                if (headContent.startsWith('ref: ')) {
                    const refPath = headContent.substring(5);
                    const absoluteRefPath = path.join(gitPath, refPath);
                    if (fs.existsSync(absoluteRefPath)) {
                        localHash = fs.readFileSync(absoluteRefPath, 'utf8').trim();
                    }
                    const branchParts = refPath.split('/');
                    branchName = branchParts[branchParts.length - 1];
                } else {
                    localHash = headContent;
                }

                // Call GitHub API
                const repoUrl = `https://api.github.com/repos/AtsutaneDotNet/Liquidation-Trader/commits/${branchName}`;
                const response = await fetch(repoUrl, {
                    headers: { 'User-Agent': 'Liquidation-Trader-App' }
                });

                const latency = Date.now() - start;

                if (!response.ok) {
                    connectionStatus.recordError('rest_github_update', `HTTP ${response.status}`, { branch: branchName });
                    return res.json({ updateAvailable: false, message: 'Failed to fetch remote commit' });
                }

                const data = await response.json();
                const remoteHash = data.sha;

                const updateAvailable = !!(localHash && remoteHash && localHash !== remoteHash);

                connectionStatus.recordActivity('rest_github_update', {
                    latencyMs: latency,
                    incrementReq: 1,
                    details: { branch: branchName, updateAvailable }
                });
                
                res.json({
                    updateAvailable,
                    localHash,
                    remoteHash,
                    branch: branchName
                });
            } catch (error) {
                connectionStatus.recordError('rest_github_update', error.message);
                logger.error('Failed to check for updates:', error);
                res.status(500).json({ updateAvailable: false, message: 'Error checking updates' });
            }
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
            res.json(db.getLiquidations(500) || []); // Fetch up to 500 liquidations for the UI
        });

        this.app.get('/api/closed-pnl', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperClosedPnls(500) || []);
            } else {
                res.json(db.getClosedPnls(500) || []);
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

        this.app.get('/api/pnl/weekly-history', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            const weeks = parseInt(req.query.weeks) || 26;
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperWeeklyPnLHistory(weeks) || []);
            } else {
                res.json(db.getWeeklyPnLHistory(weeks) || []);
            }
        });

        this.app.get('/api/pnl/monthly-history', (req, res) => {
            const db = require('./db');
            const currentConfig = config.get();
            const months = parseInt(req.query.months) || 12;
            if (currentConfig.ENABLE_PAPER_TRADING) {
                res.json(db.getPaperMonthlyPnLHistory(months) || []);
            } else {
                res.json(db.getMonthlyPnLHistory(months) || []);
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
            const currentConfig = config.get();
            res.json(db.getPageStatistics(cutoffTimestamp, currentConfig.ENABLE_PAPER_TRADING));
        });

        this.app.post('/api/paper/reset', (req, res) => {
            const currentConfig = config.get();
            const initialBalance = parseFloat(currentConfig.PAPER_TRADING_BALANCE) || 10000;
            const db = require('./db');
            
            // Delete all paper positions and PNL history to start fresh
            db.db.prepare('DELETE FROM paper_positions').run();
            db.db.prepare('DELETE FROM paper_closed_pnl').run();
            db.db.prepare('DELETE FROM paper_margin_history').run();
            
            // Reset account state
            db.updatePaperAccountState({
                total_value: initialBalance,
                margin_available: initialBalance,
                margin_used: 0,
                daily_pnl: 0,
                weekly_pnl: 0,
                monthly_pnl: 0,
                yearly_pnl: 0,
                total_pnl: 0
            });
            
            res.json({ success: true, message: 'Paper trading account has been completely reset to initial balance.' });
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

        // External Connections Status Snapshot & Summary
        this.app.get('/api/connections/status', (req, res) => {
            try {
                res.json({
                    connections: connectionStatus.getAll(),
                    summary: connectionStatus.getSummary(),
                    botRunning: !!this.bot.isRunning
                });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Test external connection (on-demand health check)
        this.app.post('/api/connections/test', async (req, res) => {
            const { id } = req.body || {};
            try {
                if (!id || id === 'all') {
                    const all = connectionStatus.getAll();
                    const results = {};
                    for (const conn of all) {
                        try {
                            results[conn.id] = await this.testConnection(conn.id);
                        } catch (err) {
                            results[conn.id] = { success: false, error: err.message };
                        }
                    }
                    return res.json({ success: true, results, summary: connectionStatus.getSummary() });
                }

                const result = await this.testConnection(id);
                res.json({ success: true, id, result, connection: connectionStatus.get(id), summary: connectionStatus.getSummary() });
            } catch (error) {
                res.status(500).json({ success: false, id, error: error.message });
            }
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

    async testConnection(id) {
        const cfg = config.get();
        const start = Date.now();
        const conn = connectionStatus.get(id);
        if (!conn) throw new Error(`Unknown connection ID: ${id}`);

        if (id === 'rest_github_update') {
            const response = await fetch('https://api.github.com/repos/AtsutaneDotNet/Liquidation-Trader', {
                headers: { 'User-Agent': 'Liquidation-Trader-App' }
            });
            const latency = Date.now() - start;
            if (!response.ok) {
                connectionStatus.recordError(id, `HTTP ${response.status}`);
                throw new Error(`HTTP ${response.status}`);
            }
            connectionStatus.recordActivity(id, { latencyMs: latency, incrementReq: 1 });
            return { success: true, latencyMs: latency, status: 'connected' };
        }

        if (id === 'rest_cmc_listings') {
            if (!cfg.CMC_API_KEY) {
                connectionStatus.updateStatus(id, 'disabled', null, { reason: 'No CMC API Key configured' });
                return { success: false, status: 'disabled', message: 'No CMC API Key configured' };
            }
            const response = await fetch('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=1', {
                headers: { 'X-CMC_PRO_API_KEY': cfg.CMC_API_KEY, 'Accept': 'application/json' }
            });
            const latency = Date.now() - start;
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                const msg = err.status?.error_message || `HTTP ${response.status}`;
                connectionStatus.recordError(id, msg);
                throw new Error(msg);
            }
            connectionStatus.recordActivity(id, { latencyMs: latency, incrementReq: 1 });
            return { success: true, latencyMs: latency, status: 'connected' };
        }

        if (id === 'rest_rapidapi_thresholds') {
            if (!cfg.RAPIDAPI_KEY) {
                connectionStatus.updateStatus(id, 'disabled', null, { reason: 'No RapidAPI Key configured' });
                return { success: false, status: 'disabled', message: 'No RapidAPI Key configured' };
            }
            const response = await fetch('https://liquidation-trader.p.rapidapi.com/data', {
                headers: { 'X-RapidAPI-Key': cfg.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'liquidation-trader.p.rapidapi.com' }
            });
            const latency = Date.now() - start;
            if (!response.ok) {
                connectionStatus.recordError(id, `HTTP ${response.status}`);
                throw new Error(`HTTP ${response.status}`);
            }
            connectionStatus.recordActivity(id, { latencyMs: latency, incrementReq: 1 });
            return { success: true, latencyMs: latency, status: 'connected' };
        }

        if (id === 'rest_rapidapi_sentiment') {
            if (!cfg.RAPIDAPI_KEY) {
                connectionStatus.updateStatus(id, 'disabled', null, { reason: 'No RapidAPI Key configured' });
                return { success: false, status: 'disabled', message: 'No RapidAPI Key configured' };
            }
            const response = await fetch('https://liquidation-trader.p.rapidapi.com/sentiment', {
                headers: { 'X-RapidAPI-Key': cfg.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'liquidation-trader.p.rapidapi.com' }
            });
            const latency = Date.now() - start;
            if (!response.ok) {
                connectionStatus.recordError(id, `HTTP ${response.status}`);
                throw new Error(`HTTP ${response.status}`);
            }
            connectionStatus.recordActivity(id, { latencyMs: latency, incrementReq: 1 });
            return { success: true, latencyMs: latency, status: 'connected' };
        }

        if (id === 'rest_report_sync') {
            const response = await fetch('https://liquidation.report/api/trader', {
                method: 'OPTIONS',
                headers: { 'Content-Type': 'application/json' }
            }).catch(async () => fetch('https://liquidation.report'));
            const latency = Date.now() - start;
            connectionStatus.recordActivity(id, { latencyMs: latency, incrementReq: 1 });
            return { success: true, latencyMs: latency, status: 'connected' };
        }

        // Exchange REST Endpoints
        if (id.startsWith('rest_ex_')) {
            const ex = this.bot.tradeExchange?.exchange;
            if (!ex) {
                return { success: false, status: conn.status, message: 'Exchange not initialized or bot not started' };
            }
            try {
                if (id === 'rest_ex_tickers') {
                    await ex.fetchTicker('BTC/USDT');
                } else if (id === 'rest_ex_markets') {
                    await ex.loadMarkets(true);
                } else if (id === 'rest_ex_balance') {
                    if (cfg.ENABLE_PAPER_TRADING) {
                        return { success: true, latencyMs: 1, status: 'connected', message: 'Paper trading account active' };
                    }
                    await ex.fetchBalance();
                } else if (id === 'rest_ex_pnl') {
                    await this.bot.tradeExchange.fetchClosedPnls();
                } else if (id === 'rest_ex_orders') {
                    if (ex.has['fetchTime']) {
                        await ex.fetchTime();
                    } else {
                        await ex.fetchStatus();
                    }
                }
                const latency = Date.now() - start;
                connectionStatus.recordActivity(id, { latencyMs: latency, incrementReq: 1 });
                return { success: true, latencyMs: latency, status: 'connected' };
            } catch (err) {
                connectionStatus.recordError(id, err.message);
                throw err;
            }
        }

        // WebSocket streams
        if (id.startsWith('ws_')) {
            return {
                success: conn.status === 'connected',
                status: conn.status,
                message: conn.status === 'connected' ? 'WebSocket stream active and receiving data' : `WebSocket stream is currently in state: ${conn.status}`
            };
        }

        return { success: true, status: conn.status };
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
