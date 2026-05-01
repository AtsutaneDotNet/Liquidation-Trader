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

  INSERT OR IGNORE INTO account_state (id) VALUES (1);
`);

// Add new columns dynamically if the table already existed
try { db.exec('ALTER TABLE positions ADD COLUMN tp_price REAL DEFAULT 0;'); } catch(e) {}
try { db.exec('ALTER TABLE positions ADD COLUMN sl_price REAL DEFAULT 0;'); } catch(e) {}


const ENCRYPTED_KEYS = ['API_KEY', 'API_SECRET', 'WEBUI_USERNAME', 'WEBUI_PASSWORD', 'CMC_API_KEY', 'LIQUIDATIONREPORT_KEY'];

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
    ENABLE_RSI_STRATEGY: 'false',
    RSI_PERIOD: '14',
    RSI_TIMEFRAME: '1m',
    RSI_OVERBOUGHT: '70',
    RSI_OVERSOLD: '30',
    ENABLE_ADX_STRATEGY: 'false',
    ADX_PERIOD: '14',
    ADX_TIMEFRAME: '1m',
    ADX_THRESHOLD: '25',
    LIQUIDATION_VALUE_CURRENCY: 'USD',
    LIQUIDATION_VALUE_THRESHOLD: '1000',
    OFFSET_PERCENTAGE: '0.5',
    TAKE_PROFIT_PERCENTAGE: '1.0',
    STOP_LOSS_PERCENTAGE: '0.5',
    ENABLE_TRAILING_PROFIT: 'false',
    TRAILING_PROFIT_PERCENTAGE: '0.2',
    TRAILING_ACTIVATION_PERCENTAGE: '0.0',
    TRADE_LEVERAGE: '10',
    TRADE_AMOUNT_PERCENTAGE: '5',
    TRADE_EXCHANGE: 'bybit',
    LIQUIDATION_EXCHANGES: 'bybit',
    MAX_OPEN_POSITIONS: '3',
    CMC_API_KEY: '',
    CMC_RANK_LIMIT: '100',
    CMC_FILTER_ENABLED: 'false',
    ENABLE_DCA_MARTINGALE: 'false',
    ENABLE_DYNAMIC_THRESHOLDS: 'false',
    LIQUIDATIONREPORT_KEY: '',
    COIN_BLACKLIST: ''
};

const currentConfig = getConfig();
for (const [k, v] of Object.entries(defaults)) {
    if (currentConfig[k] === undefined) {
        setConfig(k, v);
    }
}

function updateAccountState(data) {
    if (Object.keys(data).length === 0) return;
    const keys = Object.keys(data).filter(k => k !== 'id');
    const setClause = keys.map(k => `${k} = @${k}`).join(', ');
    data.updated_at = Date.now();
    data.id = 1;

    db.prepare(`UPDATE account_state SET ${setClause}, updated_at = @updated_at WHERE id = 1`).run(data);
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
    purgeLiquidations
};
