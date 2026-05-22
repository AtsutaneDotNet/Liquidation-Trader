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
        VWAP_PERIOD: parseInt(dbConfig.VWAP_PERIOD) || 14,
        VWAP_TIMEFRAME: dbConfig.VWAP_TIMEFRAME || '1m',
        ENABLE_RSI_STRATEGY: dbConfig.ENABLE_RSI_STRATEGY === 'true',
        ENABLE_FEARGREED_STRATEGY: dbConfig.ENABLE_FEARGREED_STRATEGY === 'true',
        RSI_PERIOD: parseInt(dbConfig.RSI_PERIOD) || 14,
        RSI_TIMEFRAME: dbConfig.RSI_TIMEFRAME || '1m',
        RSI_OVERBOUGHT: parseFloat(dbConfig.RSI_OVERBOUGHT) || 70,
        RSI_OVERSOLD: parseFloat(dbConfig.RSI_OVERSOLD) || 30,
        ENABLE_ADX_STRATEGY: dbConfig.ENABLE_ADX_STRATEGY === 'true',
        ADX_PERIOD: parseInt(dbConfig.ADX_PERIOD) || 14,
        ADX_TIMEFRAME: dbConfig.ADX_TIMEFRAME || '1m',
        ADX_THRESHOLD: parseFloat(dbConfig.ADX_THRESHOLD) || 25,
        TRADE_EXCHANGE: dbConfig.TRADE_EXCHANGE || 'bybit',
        LIQUIDATION_EXCHANGES: dbConfig.LIQUIDATION_EXCHANGES || 'bybit',
        LIQUIDATION_VALUE_CURRENCY: dbConfig.LIQUIDATION_VALUE_CURRENCY || 'USD',
        LIQUIDATION_VALUE_THRESHOLD: parseFloat(dbConfig.LIQUIDATION_VALUE_THRESHOLD) || 1000,
        OFFSET_LONG_PERCENTAGE: parseFloat(dbConfig.OFFSET_LONG_PERCENTAGE) || 0.5,
        OFFSET_SHORT_PERCENTAGE: parseFloat(dbConfig.OFFSET_SHORT_PERCENTAGE) || 0.5,
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
        REPLACE_BELOW_MIN_THRESHOLD: dbConfig.REPLACE_BELOW_MIN_THRESHOLD === 'true',
        ENABLE_RUNAWAY_HELPER: dbConfig.ENABLE_RUNAWAY_HELPER === 'true',
        RUNAWAY_HELPER_THRESHOLD: parseFloat(dbConfig.RUNAWAY_HELPER_THRESHOLD) || -10,
        RAPIDAPI_KEY: dbConfig.RAPIDAPI_KEY || '',
        COIN_BLACKLIST: dbConfig.COIN_BLACKLIST || '',
        VWAP_UPPER_SIGNAL: dbConfig.VWAP_UPPER_SIGNAL || 'sell',
        VWAP_LOWER_SIGNAL: dbConfig.VWAP_LOWER_SIGNAL || 'buy',
        RSI_OVERBOUGHT_DIR: dbConfig.RSI_OVERBOUGHT_DIR || 'above',
        RSI_OVERBOUGHT_SIGNAL: dbConfig.RSI_OVERBOUGHT_SIGNAL || 'sell',
        RSI_OVERSOLD_DIR: dbConfig.RSI_OVERSOLD_DIR || 'under',
        RSI_OVERSOLD_SIGNAL: dbConfig.RSI_OVERSOLD_SIGNAL || 'buy',
        ADX_THRESHOLD_DIR: dbConfig.ADX_THRESHOLD_DIR || 'under',
        ADX_PDI_SIGNAL: dbConfig.ADX_PDI_SIGNAL || 'sell',
        ADX_MDI_SIGNAL: dbConfig.ADX_MDI_SIGNAL || 'buy',
        FG_FEAR_SIGNAL: dbConfig.FG_FEAR_SIGNAL || 'buy',
        FG_GREED_SIGNAL: dbConfig.FG_GREED_SIGNAL || 'sell',
        FG_EXTREME_FEAR_SIGNAL: dbConfig.FG_EXTREME_FEAR_SIGNAL || 'none',
        FG_EXTREME_GREED_SIGNAL: dbConfig.FG_EXTREME_GREED_SIGNAL || 'none',
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
