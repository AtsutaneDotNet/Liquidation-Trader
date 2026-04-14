const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

class WebServer {
    constructor(bot) {
        this.app = express();
        this.bot = bot;
        
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../public')));
        
        this.setupRoutes();
    }

    setupRoutes() {
        // Get config
        this.app.get('/api/config', (req, res) => {
            const currentConfig = config.get();
            // Mask API keys for safety over HTTP response
            const responseConfig = { ...currentConfig };
            if (responseConfig.API_KEY) responseConfig.API_KEY = responseConfig.API_KEY.replace(/.(?=.{4})/g, '*');
            if (responseConfig.API_SECRET) responseConfig.API_SECRET = '********';
            res.json(responseConfig);
        });

        // Update config
        this.app.post('/api/config', (req, res) => {
            try {
                const updates = req.body;
                for (const [key, value] of Object.entries(updates)) {
                    // Prevent overwriting API key with mask
                    const isMaskedKey = ['API_KEY', 'API_SECRET'].includes(key);
                    if (isMaskedKey && typeof value === 'string' && value.includes('*')) {
                        continue;
                    }
                    if (value !== undefined && value !== null && value !== '') {
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
            res.json({
                isRunning: this.bot.isRunning,
                isTrading: this.bot.isTrading,
                pairsLoaded: Array.isArray(this.bot.symbols) ? this.bot.symbols.length : 0
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
        this.app.listen(port, () => {
            logger.info(`Web dashboard server running on http://localhost:${port}`);
        });
    }
}

module.exports = WebServer;
