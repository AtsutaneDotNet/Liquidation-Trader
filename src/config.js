require('dotenv').config();
const db = require('./db');

function getConfig() {
    const dbConfig = db.getConfig();
    return {
        API_KEY: dbConfig.API_KEY || '',
        API_SECRET: dbConfig.API_SECRET || '',
        TRADE_EXCHANGE: dbConfig.TRADE_EXCHANGE || 'bybit',
        LIQUIDATION_EXCHANGES: dbConfig.LIQUIDATION_EXCHANGES || 'bybit',
        LIQUIDATION_VALUE_THRESHOLD: parseFloat(dbConfig.LIQUIDATION_VALUE_THRESHOLD) || 1000,
        OFFSET_PERCENTAGE: parseFloat(dbConfig.OFFSET_PERCENTAGE) || 0.5,
        TAKE_PROFIT_PERCENTAGE: parseFloat(dbConfig.TAKE_PROFIT_PERCENTAGE) || 1.0,
        STOP_LOSS_PERCENTAGE: parseFloat(dbConfig.STOP_LOSS_PERCENTAGE) || 0.5,
        TRADE_LEVERAGE: parseInt(dbConfig.TRADE_LEVERAGE) || 10,
        TRADE_AMOUNT_PERCENTAGE: parseFloat(dbConfig.TRADE_AMOUNT_PERCENTAGE) || 5,
        MAX_OPEN_POSITIONS: parseInt(dbConfig.MAX_OPEN_POSITIONS) || 3,
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        WEB_PORT: parseInt(process.env.WEB_PORT) || 3000
    };
}

module.exports = {
    get: getConfig,
    set: (key, value) => {
        db.setConfig(key, value);
    }
};
