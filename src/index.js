const TradingBot = require('./bot');
const WebServer = require('./server');
const logger = require('./logger');

async function main() {
    logger.info('--- Deep-Blazar Trading Bot Runtime ---');
    try {
        const bot = new TradingBot();
        const server = new WebServer(bot);
        
        server.start();
        logger.info('Web interface is running. Please configure the bot via the dashboard if unconfigured.');
        
        const state = require('./config').get().BOT_RUNNING_STATE;
        if (state === 'true') {
            logger.info('Restoring previous running state: Starting bot automatically.');
            bot.start().catch(err => logger.error('Auto-start failed:', err));
        }
    } catch (error) {
        logger.error('Fatal Error:', error);
        process.exit(1);
    }
}

main();

process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    process.exit(0);
});
