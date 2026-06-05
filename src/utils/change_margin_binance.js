const config = require('../config');
const BinanceExchange = require('../exchanges/binance');
const logger = require('../logger');

// ==================== CONFIGURATION ====================
// Define default margin mode: 'cross' or 'isolated'
// This can also be overridden by passing an argument: node src/utils/change_margin_binance.js [cross|isolated]
const DEFAULT_MARGIN_MODE = 'isolated'; 

// Define symbols to change, e.g. ['BTC/USDT', 'ETH/USDT']. 
// Set to empty array [] to change margin mode for ALL active USDT perpetual symbols on Binance.
const SYMBOLS = []; 
// ========================================================

async function changeMarginMode() {
    console.log('===================================================');
    console.log('      BINANCE FUTURES MARGIN MODE CHANGE UTILITY     ');
    console.log('===================================================');

    // Determine target mode (checks CLI argument first, then default constant)
    const targetMode = (process.argv[2] || DEFAULT_MARGIN_MODE).toLowerCase();
    if (targetMode !== 'cross' && targetMode !== 'isolated') {
        logger.error(`Invalid margin mode: "${targetMode}". Must be either "cross" or "isolated".`);
        console.log('Usage: node src/utils/change_margin_binance.js [cross|isolated]');
        process.exit(1);
    }

    logger.info(`Target Margin Mode: ${targetMode.toUpperCase()}`);

    try {
        const cfg = config.get();

        // Check configured credentials
        if (!cfg.API_KEY || !cfg.API_SECRET) {
            logger.error('No API keys found in application database. Please configure them in the web UI or config.');
            process.exit(1);
        }

        // Warn if the active exchange is not Binance, but still try to proceed
        if (cfg.TRADE_EXCHANGE !== 'binance') {
            logger.warn(`Main app is configured for: "${cfg.TRADE_EXCHANGE.toUpperCase()}".`);
            logger.info('Using main app API credentials to initialize Binance Exchange...');
        }

        // Initialize Binance exchange by forcing the configuration exchange to binance for init
        const mockConfig = {
            get: () => ({
                ...cfg,
                TRADE_EXCHANGE: 'binance'
            }),
            set: config.set
        };

        const exchange = new BinanceExchange(mockConfig);
        await exchange.init();

        if (!exchange.exchange) {
            throw new Error('Exchange client instance was not successfully initialized.');
        }

        // Determine symbol list
        let targetSymbols = [];
        if (Array.isArray(SYMBOLS) && SYMBOLS.length > 0) {
            targetSymbols = SYMBOLS;
            logger.info(`Using symbols defined in script: ${targetSymbols.join(', ')}`);
        } else {
            logger.info('Fetching active USDT perpetual symbols from Binance...');
            targetSymbols = await exchange.getLinearSymbols();
            logger.info(`Found ${targetSymbols.length} active USDT linear symbol(s).`);
        }

        if (targetSymbols.length === 0) {
            logger.warn('No target symbols to update.');
            process.exit(0);
        }

        logger.info(`Updating margin mode to ${targetMode.toUpperCase()} for ${targetSymbols.length} symbol(s)...`);
        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;

        for (let i = 0; i < targetSymbols.length; i++) {
            const symbol = targetSymbols[i];
            const progress = `[${i + 1}/${targetSymbols.length}]`;

            try {
                // Call CCXT's unified setMarginMode method
                await exchange.exchange.setMarginMode(targetMode, symbol);
                logger.info(`${progress} Successfully set ${symbol} to ${targetMode.toUpperCase()}`);
                successCount++;
            } catch (error) {
                const errMsg = error.message || '';
                // Catch error if already set (Binance code -4046 / "No need to change margin type")
                if (
                    errMsg.includes('No need to change margin type') ||
                    errMsg.includes('-4046') ||
                    errMsg.includes('already set') ||
                    errMsg.includes('Margin type no change')
                ) {
                    logger.info(`${progress} ${symbol} is already ${targetMode.toUpperCase()} (skipped)`);
                    skipCount++;
                } else {
                    logger.error(`${progress} Failed to change margin mode for ${symbol}: ${errMsg}`);
                    failCount++;
                }
            }
        }

        logger.info('==================== SUMMARY ====================');
        logger.info(`Total Processed: ${targetSymbols.length}`);
        logger.info(`Successfully Changed: ${successCount}`);
        logger.info(`Already Correct / Skipped: ${skipCount}`);
        logger.info(`Failed / Rejected: ${failCount}`);
        logger.info('================================================');

        await exchange.exchange.close();
        process.exit(0);

    } catch (error) {
        logger.error(`Utility script execution failed: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

changeMarginMode();
