const Database = require('better-sqlite3');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const dbPath = path.resolve(__dirname, '../bot_data.sqlite');
const db = new Database(dbPath);

// Initialize config table
db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS account_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_value REAL DEFAULT 0,
    margin_used REAL DEFAULT 0,
    margin_available REAL DEFAULT 0,
    daily_pnl REAL DEFAULT 0,
    weekly_pnl REAL DEFAULT 0,
    monthly_pnl REAL DEFAULT 0,
    yearly_pnl REAL DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    updated_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS positions (
    symbol TEXT PRIMARY KEY,
    side TEXT,
    size REAL DEFAULT 0,
    entry_price REAL DEFAULT 0,
    mark_price REAL DEFAULT 0,
    liq_price REAL DEFAULT 0,
    tp_price REAL DEFAULT 0,
    sl_price REAL DEFAULT 0,
    unrealized_pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    updated_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS liquidations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    exchange TEXT,
    side TEXT,
    price REAL,
    amount REAL,
    value REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS closed_pnl (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    side TEXT,
    size REAL DEFAULT 0,
    entry_price REAL DEFAULT 0,
    close_price REAL DEFAULT 0,
    pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS margin_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    margin_percent REAL,
    position_count INTEGER DEFAULT 0,
    open_symbols TEXT DEFAULT '',
    timestamp INTEGER
  );

  INSERT OR IGNORE INTO account_state (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS bot_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT,
    symbol TEXT,
    side TEXT,
    strategy TEXT,
    value REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS paper_account_state (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_value REAL DEFAULT 0,
    margin_used REAL DEFAULT 0,
    margin_available REAL DEFAULT 0,
    daily_pnl REAL DEFAULT 0,
    weekly_pnl REAL DEFAULT 0,
    monthly_pnl REAL DEFAULT 0,
    yearly_pnl REAL DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    updated_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS paper_positions (
    symbol TEXT PRIMARY KEY,
    side TEXT,
    size REAL DEFAULT 0,
    entry_price REAL DEFAULT 0,
    mark_price REAL DEFAULT 0,
    liq_price REAL DEFAULT 0,
    tp_price REAL DEFAULT 0,
    sl_price REAL DEFAULT 0,
    unrealized_pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    updated_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS paper_closed_pnl (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    side TEXT,
    size REAL DEFAULT 0,
    entry_price REAL DEFAULT 0,
    close_price REAL DEFAULT 0,
    pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS paper_margin_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    margin_percent REAL,
    position_count INTEGER DEFAULT 0,
    open_symbols TEXT DEFAULT '',
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS symbol_drawdowns (
    symbol TEXT PRIMARY KEY,
    max_drawdown REAL DEFAULT 0,
    timestamp INTEGER
  );

  INSERT OR IGNORE INTO paper_account_state (id) VALUES (1);
`);

// Add new columns dynamically if the table already existed
try { db.exec('ALTER TABLE positions ADD COLUMN tp_price REAL DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE positions ADD COLUMN sl_price REAL DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE account_state ADD COLUMN yearly_pnl REAL DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE bot_events ADD COLUMN threshold REAL DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE margin_history ADD COLUMN position_count INTEGER DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE paper_margin_history ADD COLUMN position_count INTEGER DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE margin_history ADD COLUMN open_symbols TEXT DEFAULT \'\';'); } catch(e) {}
try { db.exec('ALTER TABLE paper_margin_history ADD COLUMN open_symbols TEXT DEFAULT \'\';'); } catch(e) {}


const ENCRYPTED_KEYS = ['API_KEY', 'API_SECRET', 'WEBUI_USERNAME', 'WEBUI_PASSWORD', 'CMC_API_KEY', 'RAPIDAPI_KEY'];

function getConfig() {
    const rows = db.prepare('SELECT * FROM config').all();
    const configMap = {};
    for (const row of rows) {
        if (ENCRYPTED_KEYS.includes(row.key)) {
            configMap[row.key] = decrypt(row.value);
        } else {
            configMap[row.key] = row.value;
        }
    }
    return configMap;
}

function setConfig(key, value) {
    let storeValue = value;
    if (ENCRYPTED_KEYS.includes(key)) {
        storeValue = encrypt(value);
    }
    const stmt = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    stmt.run(key, storeValue);
}

// Load default configs to the DB if empty
const defaults = {
    WEBUI_AUTH_ENABLED: 'false',
    WEBUI_USERNAME: 'admin',
    WEBUI_PASSWORD: 'admin',
    ENABLE_VWAP_STRATEGY: 'true',
    VWAP_TYPE: 'rolling',
    VWAP_SESSION_TYPE: 'daily',
    VWAP_PERIOD: '14',
    VWAP_TIMEFRAME: '1m',
    ENABLE_RSI_STRATEGY: 'false',
    RSI_PERIOD: '14',
    RSI_TIMEFRAME: '1m',
    RSI_OVERBOUGHT: '70',
    RSI_OVERSOLD: '30',
    ENABLE_DMI_STRATEGY: 'false',
    DMI_PERIOD: '14',
    DMI_TIMEFRAME: '1m',
    DMI_THRESHOLD: '25',
    DMI_SPREAD_THRESHOLD: '10',
    ENABLE_FEARGREED_STRATEGY: 'false',
    LIQUIDATION_VALUE_CURRENCY: 'USD',
    LIQUIDATION_VALUE_THRESHOLD: '1000',
    OFFSET_LONG_PERCENTAGE: '0.5',
    OFFSET_SHORT_PERCENTAGE: '0.5',
    TAKE_PROFIT_PERCENTAGE: '1.0',
    STOP_LOSS_PERCENTAGE: '0.5',
    ENABLE_TRAILING_PROFIT: 'false',
    TRAILING_PROFIT_PERCENTAGE: '0.2',
    TRAILING_ACTIVATION_PERCENTAGE: '0.0',
    TRADE_LEVERAGE: '10',
    TRADE_AMOUNT_PERCENTAGE: '5',
    TRADE_EXCHANGE: 'bybit',
    ENABLE_PAPER_TRADING: 'false',
    PAPER_TRADING_BALANCE: '10000',
    LIQUIDATION_EXCHANGES: 'bybit',
    MAX_OPEN_POSITIONS: '3',
    CMC_API_KEY: '',
    CMC_RANK_LIMIT: '100',
    CMC_FILTER_ENABLED: 'false',
    ENABLE_DCA_MARTINGALE: 'false',
    DCA_MARTINGALE_THRESHOLD: '-5',
    DCA_MARTINGALE_MAX_MULTIPLIER: '5',
    ENABLE_DYNAMIC_THRESHOLDS: 'false',
    REPLACE_BELOW_MIN_THRESHOLD: 'false',
    ENABLE_AUTO_TRANSFER: 'false',
    ENABLE_ISOLATION_MODE: 'false',
    ISOLATION_MARGIN_THRESHOLD: '10',
    REDUCE_TP_TRAILING_BY_HALF_IN_ISOLATION: 'false',
    ENABLE_RUNAWAY_HELPER: 'false',
    RUNAWAY_HELPER_THRESHOLD: '-10',
    RAPIDAPI_KEY: '',
    COIN_BLACKLIST: '',
    VWAP_UPPER_SIGNAL: 'sell',
    VWAP_LOWER_SIGNAL: 'buy',
    RSI_OVERBOUGHT_DIR: 'above',
    RSI_OVERBOUGHT_SIGNAL: 'sell',
    RSI_OVERSOLD_DIR: 'under',
    RSI_OVERSOLD_SIGNAL: 'buy',
    DMI_THRESHOLD_DIR: 'under',
    DMI_THRESHOLD_UPPER: '30',
    DMI_PDI_SIGNAL: 'sell',
    DMI_MDI_SIGNAL: 'buy',
    DMI_BYPASS_ON_POSITION: 'false',
    CB_BYPASS_ON_POSITION: 'false',
    FG_FEAR_SIGNAL: 'buy',
    FG_GREED_SIGNAL: 'sell',
    FG_EXTREME_FEAR_SIGNAL: 'none',
    FG_EXTREME_GREED_SIGNAL: 'none',
    MS_BYPASS_ON_POSITION: 'false',
    ENABLE_ANON_REPORTING: 'false',
    ANON_UID: '',
    ENABLE_24H_VOLUME_FILTER: 'false',
    MIN_24H_VOLUME_USD: '1000000',
    MAX_POSITION_SIZE_PERCENTAGE: '10'
};

const currentConfig = getConfig();

// Migration: LIQUIDATIONREPORT_KEY -> RAPIDAPI_KEY
if (currentConfig['LIQUIDATIONREPORT_KEY'] !== undefined) {
    let oldValue = currentConfig['LIQUIDATIONREPORT_KEY'];
    // Decrypt if it was stored encrypted (since it's not in the new ENCRYPTED_KEYS)
    if (oldValue && /^[a-f0-9]{32}:[a-f0-9]{32}:[a-f0-9]+$/i.test(oldValue)) {
        try {
            oldValue = decrypt(oldValue);
        } catch (e) {
            console.error('[Migration] Failed to decrypt LIQUIDATIONREPORT_KEY during migration:', e.message);
        }
    }
    setConfig('RAPIDAPI_KEY', oldValue);
    try {
        db.prepare("DELETE FROM config WHERE key = 'LIQUIDATIONREPORT_KEY'").run();
        console.log('[Migration] Successfully migrated LIQUIDATIONREPORT_KEY to RAPIDAPI_KEY in SQLite database.');
    } catch (e) {
        console.error('[Migration] Failed to delete old LIQUIDATIONREPORT_KEY:', e.message);
    }
    currentConfig['RAPIDAPI_KEY'] = oldValue;
    delete currentConfig['LIQUIDATIONREPORT_KEY'];
}

// Migration: Fix double encrypted RAPIDAPI_KEY
const finalConfig = getConfig();
if (finalConfig['RAPIDAPI_KEY']) {
    const keyVal = finalConfig['RAPIDAPI_KEY'];
    const isDoubleEncrypted = /^[a-f0-9]{32}:[a-f0-9]{32}:[a-f0-9]+$/i.test(keyVal);
    if (isDoubleEncrypted) {
        try {
            const decryptedOnceMore = decrypt(keyVal);
            if (decryptedOnceMore) {
                setConfig('RAPIDAPI_KEY', decryptedOnceMore);
                console.log('[Migration] Successfully fixed double-encrypted RAPIDAPI_KEY in SQLite database.');
            }
        } catch (e) {
            console.error('[Migration] Failed to decrypt double-encrypted RAPIDAPI_KEY:', e.message);
        }
    }
}

// Migration: ADX -> DMI strategy keys
const adxDmiMap = {
    ENABLE_ADX_STRATEGY: 'ENABLE_DMI_STRATEGY',
    ADX_PERIOD: 'DMI_PERIOD',
    ADX_TIMEFRAME: 'DMI_TIMEFRAME',
    ADX_THRESHOLD: 'DMI_THRESHOLD',
    ADX_THRESHOLD_DIR: 'DMI_THRESHOLD_DIR',
    ADX_PDI_SIGNAL: 'DMI_PDI_SIGNAL',
    ADX_MDI_SIGNAL: 'DMI_MDI_SIGNAL',
    ADX_BYPASS_ON_POSITION: 'DMI_BYPASS_ON_POSITION'
};

let migratedCount = 0;
for (const [oldKey, newKey] of Object.entries(adxDmiMap)) {
    if (currentConfig[oldKey] !== undefined) {
        setConfig(newKey, currentConfig[oldKey]);
        try {
            db.prepare("DELETE FROM config WHERE key = ?").run(oldKey);
            migratedCount++;
        } catch (e) {
            console.error(`[Migration] Failed to delete old key ${oldKey}:`, e.message);
        }
        currentConfig[newKey] = currentConfig[oldKey];
        delete currentConfig[oldKey];
    }
}
if (migratedCount > 0) {
    console.log(`[Migration] Successfully migrated ${migratedCount} ADX config settings to DMI settings in SQLite.`);
}

for (const [k, v] of Object.entries(defaults)) {
    if (currentConfig[k] === undefined) {
        setConfig(k, v);
        currentConfig[k] = v;
    }
}

if (!currentConfig['ANON_UID']) {
    const uid = require('crypto').randomBytes(4).toString('hex');
    setConfig('ANON_UID', uid);
    currentConfig['ANON_UID'] = uid;
}

let lastIsolationModeState = false;

function updateAccountState(data) {
    if (Object.keys(data).length === 0) return;
    const keys = Object.keys(data).filter(k => k !== 'id');
    const setClause = keys.map(k => `${k} = @${k}`).join(', ');
    data.updated_at = Date.now();
    data.id = 1;

    db.prepare(`UPDATE account_state SET ${setClause}, updated_at = @updated_at WHERE id = 1`).run(data);
    
    // Log margin history
    const state = getAccountState();
    if (state && state.total_value > 0) {
        const marginPercent = (state.margin_used / state.total_value) * 100;
        const positions = db.prepare('SELECT symbol FROM positions').all();
        const posCount = positions.length;
        const openSymbols = positions.map(p => p.symbol.replace('/USDT:USDT', '')).join(',');
        db.prepare('INSERT INTO margin_history (margin_percent, position_count, open_symbols, timestamp) VALUES (?, ?, ?, ?)').run(marginPercent, posCount, openSymbols, data.updated_at);
        
        // Track isolation mode
        if (currentConfig['ENABLE_ISOLATION_MODE'] === 'true') {
            const threshold = parseFloat(currentConfig['ISOLATION_MARGIN_THRESHOLD']) || 10;
            const isIsolation = marginPercent >= threshold;
            if (isIsolation && !lastIsolationModeState) {
                logBotEvent({ event_type: 'ISOLATION_MODE_TRIGGER', value: marginPercent, timestamp: data.updated_at });
            }
            lastIsolationModeState = isIsolation;
        } else {
            lastIsolationModeState = false;
        }
    }
}

function getAccountState() {
    return db.prepare('SELECT * FROM account_state WHERE id = 1').get();
}

function updatePosition(pos) {
    pos.updated_at = Date.now();
    db.prepare(`
        INSERT INTO positions (symbol, side, size, entry_price, mark_price, liq_price, tp_price, sl_price, unrealized_pnl, updated_at)
        VALUES (@symbol, @side, @size, @entry_price, @mark_price, @liq_price, @tp_price, @sl_price, @unrealized_pnl, @updated_at)
        ON CONFLICT(symbol) DO UPDATE SET 
            side=@side, size=@size, entry_price=@entry_price, mark_price=@mark_price, 
            liq_price=@liq_price, tp_price=@tp_price, sl_price=@sl_price, unrealized_pnl=@unrealized_pnl, updated_at=@updated_at
    `).run(pos);
}

function getStalePositions(timeoutMs = 60000) {
    const cutoff = Date.now() - timeoutMs;
    return db.prepare('SELECT * FROM positions WHERE updated_at < ?').all(cutoff);
}

function removePosition(symbol) {
    db.prepare('DELETE FROM positions WHERE symbol = ?').run(symbol);
}

function removeStalePositions(timeoutMs = 60000) {
    const cutoff = Date.now() - timeoutMs;
    db.prepare('DELETE FROM positions WHERE updated_at < ?').run(cutoff);
}

function getPositions() {
    return db.prepare('SELECT * FROM positions ORDER BY updated_at DESC').all();
}

function addLiquidation(data) {
    db.prepare(`
        INSERT INTO liquidations (symbol, exchange, side, price, amount, value, timestamp)
        VALUES (@symbol, @exchange, @side, @price, @amount, @value, @timestamp)
    `).run(data);
}

function getLiquidations(limit = 100) {
    return db.prepare('SELECT * FROM liquidations ORDER BY timestamp DESC LIMIT ?').all(limit);
}

function pruneLiquidations(max = 500) {
    // Keep only the most recent 'max' entries
    db.prepare(`
        DELETE FROM liquidations 
        WHERE id NOT IN (
            SELECT id FROM liquidations ORDER BY timestamp DESC LIMIT ?
        )
    `).run(max);
}

function purgeLiquidations() {
    db.prepare('DELETE FROM liquidations').run();
    db.exec('VACUUM'); // Reclaim space
}

function addClosedPnl(data) {
    db.prepare(`
        INSERT OR IGNORE INTO closed_pnl (id, symbol, side, size, entry_price, close_price, pnl, timestamp)
        VALUES (@id, @symbol, @side, @size, @entry_price, @close_price, @pnl, @timestamp)
    `).run(data);
}

function getClosedPnls(limit = 100) {
    return db.prepare('SELECT * FROM closed_pnl ORDER BY timestamp DESC LIMIT ?').all(limit);
}

function calculateAggregatedPnl() {
    const now = new Date();
    
    // Daily: From start of today
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    // Weekly: From start of current week (assuming Monday is start of week)
    const dayOfWeek = now.getDay() || 7; // Sunday=0 -> 7
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1).getTime();
    
    // Monthly: From start of current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    
    // Yearly: From start of current year
    const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

    const row = db.prepare(`
        SELECT 
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as daily_pnl,
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as weekly_pnl,
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as monthly_pnl,
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as yearly_pnl,
            SUM(pnl) as total_pnl
        FROM closed_pnl
    `).get(startOfDay, startOfWeek, startOfMonth, startOfYear);

    return {
        daily_pnl: row.daily_pnl || 0,
        weekly_pnl: row.weekly_pnl || 0,
        monthly_pnl: row.monthly_pnl || 0,
        yearly_pnl: row.yearly_pnl || 0,
        total_pnl: row.total_pnl || 0
    };
}

function logBotEvent(data) {
    db.prepare(`
        INSERT INTO bot_events (event_type, symbol, side, strategy, value, threshold, timestamp)
        VALUES (@event_type, @symbol, @side, @strategy, @value, @threshold, @timestamp)
    `).run({
        event_type: data.event_type || '',
        symbol: data.symbol || null,
        side: data.side || null,
        strategy: data.strategy || null,
        value: data.value || null,
        threshold: data.threshold || 0,
        timestamp: data.timestamp || Date.now()
    });
}

function get24HourStatistics() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    // Aggregation queries
    const liquidations = db.prepare(`SELECT COUNT(*) as count FROM bot_events WHERE event_type = 'LIQUIDATION_MATCH' AND timestamp >= ?`).get(cutoff);
    const totalLiquidations = db.prepare(`SELECT COUNT(*) as count FROM bot_events WHERE event_type = 'LIQUIDATION_RECEIVED' AND timestamp >= ?`).get(cutoff);
    const trades = db.prepare(`SELECT side, COUNT(*) as count FROM bot_events WHERE event_type = 'TRADE_EXECUTE' AND timestamp >= ? GROUP BY side`).all(cutoff);
    const strategies = db.prepare(`SELECT strategy, side, COUNT(*) as count FROM bot_events WHERE event_type = 'STRATEGY_MATCH' AND timestamp >= ? GROUP BY strategy, side`).all(cutoff);
    
    const stats = {
        liquidations: liquidations.count,
        totalLiquidations: totalLiquidations.count,
        trades: { BUY: 0, SELL: 0 },
        strategies: {}
    };
    
    for (const t of trades) {
        if (t.side) {
            const sideUpper = t.side.toUpperCase();
            if (stats.trades[sideUpper] !== undefined) {
                stats.trades[sideUpper] += t.count;
            } else {
                stats.trades[sideUpper] = t.count;
            }
        }
    }
    
    for (const s of strategies) {
        if (!s.strategy) continue;
        if (!stats.strategies[s.strategy]) {
            stats.strategies[s.strategy] = { BUY: 0, SELL: 0 };
        }
        if (s.side) {
            const sideUpper = s.side.toUpperCase();
            if (stats.strategies[s.strategy][sideUpper] !== undefined) {
                stats.strategies[s.strategy][sideUpper] += s.count;
            } else {
                stats.strategies[s.strategy][sideUpper] = s.count;
            }
        }
    }
    
    return stats;
}

function pruneBotEvents() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    db.prepare('DELETE FROM bot_events WHERE timestamp < ?').run(cutoff);
    db.prepare('DELETE FROM margin_history WHERE timestamp < ?').run(cutoff);
    db.prepare('DELETE FROM symbol_drawdowns WHERE timestamp < ?').run(cutoff);
}

function getDailyPnLHistory(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffTimestamp = cutoff.getTime();

    // Query groups by date (YYYY-MM-DD) and sums PnL
    // We use strftime with localtime to match the user's view
    return db.prepare(`
        SELECT 
            strftime('%Y-%m-%d', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
            SUM(pnl) as daily_pnl
        FROM closed_pnl
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
    `).all(cutoffTimestamp);
}

function getPaperDailyPnLHistory(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffTimestamp = cutoff.getTime();

    return db.prepare(`
        SELECT 
            strftime('%Y-%m-%d', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
            SUM(pnl) as daily_pnl
        FROM paper_closed_pnl
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
    `).all(cutoffTimestamp);
}

function getWeeklyPnLHistory(weeks = 26) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (weeks * 7));
    const cutoffTimestamp = cutoff.getTime();

    return db.prepare(`
        SELECT 
            strftime('%Y-%W', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
            SUM(pnl) as weekly_pnl
        FROM closed_pnl
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
    `).all(cutoffTimestamp);
}

function getPaperWeeklyPnLHistory(weeks = 26) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (weeks * 7));
    const cutoffTimestamp = cutoff.getTime();

    return db.prepare(`
        SELECT 
            strftime('%Y-%W', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
            SUM(pnl) as weekly_pnl
        FROM paper_closed_pnl
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
    `).all(cutoffTimestamp);
}

function getMonthlyPnLHistory(months = 12) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffTimestamp = cutoff.getTime();

    return db.prepare(`
        SELECT 
            strftime('%Y-%m', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
            SUM(pnl) as monthly_pnl
        FROM closed_pnl
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
    `).all(cutoffTimestamp);
}

function getPaperMonthlyPnLHistory(months = 12) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffTimestamp = cutoff.getTime();

    return db.prepare(`
        SELECT 
            strftime('%Y-%m', datetime(timestamp / 1000, 'unixepoch', 'localtime')) as date,
            SUM(pnl) as monthly_pnl
        FROM paper_closed_pnl
        WHERE timestamp >= ?
        GROUP BY date
        ORDER BY date ASC
    `).all(cutoffTimestamp);
}

function recordDrawdown(symbol, max_drawdown) {
    if (max_drawdown >= 0) return;
    
    const existing = db.prepare('SELECT max_drawdown FROM symbol_drawdowns WHERE symbol = ?').get(symbol);
    if (!existing || max_drawdown < existing.max_drawdown) {
        db.prepare(`
            INSERT INTO symbol_drawdowns (symbol, max_drawdown, timestamp) 
            VALUES (?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET max_drawdown = ?, timestamp = ?
        `).run(symbol, max_drawdown, Date.now(), max_drawdown, Date.now());
    }
}

function getPageStatistics(cutoff, isPaper = false) {
    const marginTable = isPaper ? 'paper_margin_history' : 'margin_history';
    const pnlTable = isPaper ? 'paper_closed_pnl' : 'closed_pnl';
    const cutoffTimestamp = cutoff || (Date.now() - 24 * 60 * 60 * 1000); // Default to last 24h
    
    const marginHistory = db.prepare(`SELECT margin_percent, position_count, open_symbols, timestamp FROM ${marginTable} WHERE timestamp >= ? ORDER BY timestamp ASC`).all(cutoffTimestamp);
    const isolationModeCount = db.prepare('SELECT COUNT(*) as count FROM bot_events WHERE event_type = \'ISOLATION_MODE_TRIGGER\' AND timestamp >= ?').get(cutoffTimestamp).count;
    const dynamicThresholds = db.prepare('SELECT MAX(threshold) as max, MIN(threshold) as min FROM bot_events WHERE event_type = \'LIQUIDATION_MATCH\' AND strategy = \'DYNAMIC\' AND timestamp >= ?').get(cutoffTimestamp);
    const closedPnls = db.prepare(`SELECT symbol, side, pnl FROM ${pnlTable} WHERE timestamp >= ?`).all(cutoffTimestamp);
    
    const drawdowns = db.prepare('SELECT symbol, max_drawdown FROM symbol_drawdowns WHERE timestamp >= ? ORDER BY max_drawdown ASC').all(cutoffTimestamp);
    
    const currentConfig = getConfig();
    const isolationThreshold = parseFloat(currentConfig['ISOLATION_MARGIN_THRESHOLD']) || 10;

    return {
        marginHistory,
        isolationModeCount,
        dynamicThresholds,
        closedPnls,
        drawdowns,
        isolationThreshold
    };
}

function updatePaperAccountState(data) {
    if (Object.keys(data).length === 0) return;
    const keys = Object.keys(data).filter(k => k !== 'id');
    const setClause = keys.map(k => `${k} = @${k}`).join(', ');
    data.updated_at = Date.now();
    data.id = 1;
    db.prepare(`UPDATE paper_account_state SET ${setClause}, updated_at = @updated_at WHERE id = 1`).run(data);
    
    // Log margin history
    const state = getPaperAccountState();
    if (state && state.total_value > 0) {
        const marginPercent = (state.margin_used / state.total_value) * 100;
        const paperPositions = db.prepare('SELECT symbol FROM paper_positions').all();
        const posCount = paperPositions.length;
        const openSymbols = paperPositions.map(p => p.symbol.replace('/USDT:USDT', '')).join(',');
        db.prepare('INSERT INTO paper_margin_history (margin_percent, position_count, open_symbols, timestamp) VALUES (?, ?, ?, ?)').run(marginPercent, posCount, openSymbols, data.updated_at);
        
        // Track isolation mode
        const currentConfig = getConfig();
        if (currentConfig['ENABLE_ISOLATION_MODE'] === 'true') {
            const threshold = parseFloat(currentConfig['ISOLATION_MARGIN_THRESHOLD']) || 10;
            const isIsolation = marginPercent >= threshold;
            if (isIsolation && !lastIsolationModeState) {
                logBotEvent({ event_type: 'ISOLATION_MODE_TRIGGER', value: marginPercent, timestamp: data.updated_at });
            }
            lastIsolationModeState = isIsolation;
        } else {
            lastIsolationModeState = false;
        }
    }
}

function getPaperAccountState() {
    return db.prepare('SELECT * FROM paper_account_state WHERE id = 1').get();
}

function updatePaperPosition(pos) {
    pos.updated_at = Date.now();
    db.prepare(`
        INSERT INTO paper_positions (symbol, side, size, entry_price, mark_price, liq_price, tp_price, sl_price, unrealized_pnl, updated_at)
        VALUES (@symbol, @side, @size, @entry_price, @mark_price, @liq_price, @tp_price, @sl_price, @unrealized_pnl, @updated_at)
        ON CONFLICT(symbol) DO UPDATE SET 
            side=@side, size=@size, entry_price=@entry_price, mark_price=@mark_price, 
            liq_price=@liq_price, tp_price=@tp_price, sl_price=@sl_price, unrealized_pnl=@unrealized_pnl, updated_at=@updated_at
    `).run(pos);
}

function removePaperPosition(symbol) {
    db.prepare('DELETE FROM paper_positions WHERE symbol = ?').run(symbol);
}

function getPaperPositions() {
    return db.prepare('SELECT * FROM paper_positions ORDER BY updated_at DESC').all();
}

function addPaperClosedPnl(data) {
    db.prepare(`
        INSERT OR IGNORE INTO paper_closed_pnl (id, symbol, side, size, entry_price, close_price, pnl, timestamp)
        VALUES (@id, @symbol, @side, @size, @entry_price, @close_price, @pnl, @timestamp)
    `).run(data);
}

function getPaperClosedPnls(limit = 100) {
    return db.prepare('SELECT * FROM paper_closed_pnl ORDER BY timestamp DESC LIMIT ?').all(limit);
}

function calculatePaperAggregatedPnl() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayOfWeek = now.getDay() || 7; 
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();

    const row = db.prepare(`
        SELECT 
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as daily_pnl,
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as weekly_pnl,
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as monthly_pnl,
            SUM(CASE WHEN timestamp >= ? THEN pnl ELSE 0 END) as yearly_pnl,
            SUM(pnl) as total_pnl
        FROM paper_closed_pnl
    `).get(startOfDay, startOfWeek, startOfMonth, startOfYear);

    return {
        daily_pnl: row.daily_pnl || 0,
        weekly_pnl: row.weekly_pnl || 0,
        monthly_pnl: row.monthly_pnl || 0,
        yearly_pnl: row.yearly_pnl || 0,
        total_pnl: row.total_pnl || 0
    };
}

module.exports = {
    db,
    getConfig,
    setConfig,
    ENCRYPTED_KEYS,
    updateAccountState,
    getAccountState,
    updatePosition,
    getStalePositions,
    removePosition,
    removeStalePositions,
    getPositions,
    addLiquidation,
    getLiquidations,
    pruneLiquidations,
    purgeLiquidations,
    addClosedPnl,
    recordDrawdown,
    getClosedPnls,
    calculateAggregatedPnl,
    getDailyPnLHistory,
    logBotEvent,
    get24HourStatistics,
    pruneBotEvents,
    getPageStatistics,
    updatePaperAccountState,
    getPaperAccountState,
    updatePaperPosition,
    removePaperPosition,
    getPaperPositions,
    addPaperClosedPnl,
    getPaperClosedPnls,
    calculatePaperAggregatedPnl,
    getPaperDailyPnLHistory,
    getWeeklyPnLHistory,
    getPaperWeeklyPnLHistory,
    getMonthlyPnLHistory,
    getPaperMonthlyPnLHistory
};
