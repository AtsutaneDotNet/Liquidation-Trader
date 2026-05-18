const config = require('./config');

const logHistory = [];
const MAX_LOGS = 500;

function getTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function addLog(type, args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    logHistory.push({
        type,
        msg,
        time: getTimestamp()
    });
    if (logHistory.length > MAX_LOGS) {
        logHistory.shift();
    }
}

const logger = {
    info: (...args) => {
        const time = getTimestamp();
        console.log(`[${time}] [INFO]`, ...args);
        addLog('info', args);
    },
    debug: (...args) => {
        if (config.get().LOG_LEVEL === 'debug') {
            const time = getTimestamp();
            console.log(`[${time}] [DEBUG]`, ...args);
            addLog('debug', args);
        }
    },
    error: (...args) => {
        const time = getTimestamp();
        console.error(`[${time}] [ERROR]`, ...args);
        addLog('error', args);
    },
    warn: (...args) => {
        const time = getTimestamp();
        console.warn(`[${time}] [WARN]`, ...args);
        addLog('warn', args);
    },
    getLogs: () => {
        return logHistory;
    }
};

module.exports = logger;

