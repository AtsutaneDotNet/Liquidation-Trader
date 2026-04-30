require('dotenv').config();
const db = require('./db');

function getConfig() {
    const dbConfig = db.getConfig();
    return {
        WEBUI_AUTH_ENABLED: dbConfig.WEBUI_AUTH_ENABLED === 'true',
        WEBUI_USERNAME: dbConfig.WEBUI_USERNAME || 'admin',
        WEBUI_PASSWORD: dbConfig.WEBUI_PASSWORD || 'admin',
        API_KEY: dbConfig.API_KEY || '',
        API_SECRET: dbConfig.API_SECRET || '',
        ENABLE_VWAP_STRATEGY: dbConfig.ENABLE_VWAP_STRATEGY === 'true',
        ENABLE_RSI_STRATEGY: dbConfig.ENABLE_RSI_STRATEGY === 'true',
        RSI_PERIOD: parseInt(dbConfig.RSI_PERIOD) || 14,
        RSI_TIMEFRAME: dbConfig.RSI_TIMEFRAME || '1m',
        RSI_OVERBOUGHT: parseFloat(dbConfig.RSI_OVERBOUGHT) || 70,
        RSI_OVERSOLD: parseFloat(dbConfig.RSI_OVERSOLD) || 30,
        TRADE_EXCHANGE: dbConfig.TRADE_EXCHANGE || 'bybit',
        LIQUIDATION_EXCHANGES: dbConfig.LIQUIDATION_EXCHANGES || 'bybit',
        LIQUIDATION_VALUE_CURRENCY: dbConfig.LIQUIDATION_VALUE_CURRENCY || 'USD',
        LIQUIDATION_VALUE_THRESHOLD: parseFloat(dbConfig.LIQUIDATION_VALUE_THRESHOLD) || 1000,
        OFFSET_PERCENTAGE: parseFloat(dbConfig.OFFSET_PERCENTAGE) || 0.5,
        TAKE_PROFIT_PERCENTAGE: parseFloat(dbConfig.TAKE_PROFIT_PERCENTAGE) || 1.0,
        STOP_LOSS_PERCENTAGE: parseFloat(dbConfig.STOP_LOSS_PERCENTAGE) || 0.5,
        ENABLE_TRAILING_PROFIT: dbConfig.ENABLE_TRAILING_PROFIT === 'true',
        TRAILING_PROFIT_PERCENTAGE: parseFloat(dbConfig.TRAILING_PROFIT_PERCENTAGE) || 0.2,
        TRAILING_ACTIVATION_PERCENTAGE: parseFloat(dbConfig.TRAILING_ACTIVATION_PERCENTAGE) || 0.0,
        TRADE_LEVERAGE: parseInt(dbConfig.TRADE_LEVERAGE) || 10,
        TRADE_AMOUNT_PERCENTAGE: parseFloat(dbConfig.TRADE_AMOUNT_PERCENTAGE) || 5,
        MAX_OPEN_POSITIONS: parseInt(dbConfig.MAX_OPEN_POSITIONS) || 3,
        CMC_API_KEY: dbConfig.CMC_API_KEY || '',
        CMC_RANK_LIMIT: parseInt(dbConfig.CMC_RANK_LIMIT) || 100,
        CMC_FILTER_ENABLED: dbConfig.CMC_FILTER_ENABLED === 'true',
        ENABLE_DCA_MARTINGALE: dbConfig.ENABLE_DCA_MARTINGALE === 'true',
        ENABLE_DYNAMIC_THRESHOLDS: dbConfig.ENABLE_DYNAMIC_THRESHOLDS === 'true',
        LIQUIDATIONREPORT_KEY: dbConfig.LIQUIDATIONREPORT_KEY || '',
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        WEB_PORT: parseInt(process.env.WEB_PORT) || 3000,
        WEB_HOST: process.env.WEB_HOST || 'localhost'
    };
}

module.exports = {
    get: getConfig,
    set: (key, value) => {
        db.setConfig(key, value);
    }
};
