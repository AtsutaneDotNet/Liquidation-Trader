const config = require('./config');

const logHistory = [];
const MAX_LOGS = 500;

function addLog(type, args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logHistory.push({
        type,
        msg,
        time: new Date().toLocaleTimeString()
    });
    if (logHistory.length > MAX_LOGS) {
        logHistory.shift();
    }
}

const logger = {
    info: (...args) => {
        console.log('[INFO]', ...args);
        addLog('info', args);
    },
    debug: (...args) => {
        if (config.get().LOG_LEVEL === 'debug') {
            console.log('[DEBUG]', ...args);
            addLog('debug', args);
        }
    },
    error: (...args) => {
        console.error('[ERROR]', ...args);
        addLog('error', args);
    },
    warn: (...args) => {
        console.warn('[WARN]', ...args);
        addLog('warn', args);
    },
    getLogs: () => {
        return logHistory;
    }
};

module.exports = logger;
