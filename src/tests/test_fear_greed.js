const TradingBot = require('../bot');
const db = require('../db');
const logger = require('../logger');

// Store original db methods so we can restore them if needed
const originalGetPositions = db.getPositions;

// Mock database to avoid mutating the real SQLite DB
db.getPositions = () => [];
db.updatePosition = () => {};

// Mock logger.info/debug to display or silence test logs
const loggedInfo = [];
logger.info = (msg) => {
    loggedInfo.push(msg);
    console.log(`  [LOG-INFO] ${msg}`);
};

async function runTests() {
    console.log('\n===================================================');
    console.log('       FEAR & GREED STRATEGY VERIFICATION TEST      ');
    console.log('===================================================');

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`\x1b[32m  ✓ PASS: ${message}\x1b[0m`);
            passedTests++;
        } else {
            console.error(`\x1b[31m  ✗ FAIL: ${message}\x1b[0m`);
            failedTests++;
        }
    }

    const bot = new TradingBot();
    
    // Stub executeTrade so it doesn't try to send orders to an exchange
    let executeTradeCall = null;
    bot.executeTrade = async (symbol, side, entryPrice, cfg) => {
        executeTradeCall = { symbol, side, entryPrice };
    };

    // Helper to evaluate trade for a given F&G classification
    async function evaluateFGLate(classification, configMock, openPosition = null) {
        // Reset state
        bot.tradeDecisions = [];
        executeTradeCall = null;
        loggedInfo.length = 0;

        // Set mocks
        bot.config.get = () => configMock;
        bot.fearAndGreed = classification ? { classification, value: 50 } : null;
        
        db.getPositions = () => openPosition ? [openPosition] : [];

        await bot.evaluateTrade('BTC/USDT', 50000);
        return bot.tradeDecisions[0];
    }

    const testConfig = {
        ENABLE_VWAP_STRATEGY: false,
        ENABLE_RSI_STRATEGY: false,
        ENABLE_ADX_STRATEGY: false,
        ENABLE_FEARGREED_STRATEGY: true,
        MAX_OPEN_POSITIONS: 3,
        COIN_BLACKLIST: ''
    };

    // ----------------------------------------------------
    // TEST CASE 1: Fear -> Long Signal (buy)
    // ----------------------------------------------------
    console.log('\n[Test Case 1] Fear classification should trigger LONG signal (buy)');
    const res1 = await evaluateFGLate('Fear', testConfig);
    assert(res1 !== undefined, 'Should record a trade decision');
    assert(res1.fearAndGreed && res1.fearAndGreed.signal === 'buy', 'Fear signal should map to "buy"');
    assert(executeTradeCall !== null && executeTradeCall.side === 'buy', 'Should execute a buy order');

    // ----------------------------------------------------
    // TEST CASE 2: Greed -> Short Signal (sell)
    // ----------------------------------------------------
    console.log('\n[Test Case 2] Greed classification should trigger SHORT signal (sell)');
    const res2 = await evaluateFGLate('Greed', testConfig);
    assert(res2 !== undefined, 'Should record a trade decision');
    assert(res2.fearAndGreed && res2.fearAndGreed.signal === 'sell', 'Greed signal should map to "sell"');
    assert(executeTradeCall !== null && executeTradeCall.side === 'sell', 'Should execute a sell order');

    // ----------------------------------------------------
    // TEST CASE 3: Neutral -> Keep current setting (ignore)
    // ----------------------------------------------------
    console.log('\n[Test Case 3] Neutral classification should be ignored');
    const res3 = await evaluateFGLate('Neutral', testConfig);
    assert(res3 !== undefined, 'Should record a trade decision');
    assert(res3.fearAndGreed && res3.fearAndGreed.signal === 'ignore', 'Neutral signal should map to "ignore"');
    assert(res3.reason === 'No Signal', 'Should report "No Signal" reason');
    assert(executeTradeCall === null, 'Should not execute any order');

    // ----------------------------------------------------
    // TEST CASE 4: Extreme Fear -> Keep current setting (NONE / block trade)
    // ----------------------------------------------------
    console.log('\n[Test Case 4] Extreme Fear should block trades');
    const res4 = await evaluateFGLate('Extreme Fear', testConfig);
    assert(res4 !== undefined, 'Should record a trade decision');
    assert(res4.fearAndGreed && res4.fearAndGreed.signal === null, 'Extreme Fear signal should map to null');
    assert(res4.reason === 'No Confluence', 'Should report "No Confluence" reason');
    assert(executeTradeCall === null, 'Should not execute any order');

    // ----------------------------------------------------
    // TEST CASE 5: Extreme Greed -> Keep current setting (NONE / block trade)
    // ----------------------------------------------------
    console.log('\n[Test Case 5] Extreme Greed should block trades');
    const res5 = await evaluateFGLate('Extreme Greed', testConfig);
    assert(res5 !== undefined, 'Should record a trade decision');
    assert(res5.fearAndGreed && res5.fearAndGreed.signal === null, 'Extreme Greed signal should map to null');
    assert(res5.reason === 'No Confluence', 'Should report "No Confluence" reason');
    assert(executeTradeCall === null, 'Should not execute any order');

    // ----------------------------------------------------
    // TEST CASE 6: Open Position Bypass -> Keep current setting (ignore)
    // ----------------------------------------------------
    console.log('\n[Test Case 6] If a position is already open, F&G should be bypassed');
    const openPositionMock = { symbol: 'BTC/USDT', side: 'long', size: 1 };
    const res6 = await evaluateFGLate('Fear', testConfig, openPositionMock);
    assert(res6 !== undefined, 'Should record a trade decision');
    assert(res6.fearAndGreed && res6.fearAndGreed.signal === 'ignore', 'Open position should bypass F&G as "ignore"');
    assert(executeTradeCall === null, 'Should not execute new orders since position is open and no confluence matching');

    // ----------------------------------------------------
    // Restore original db methods
    // ----------------------------------------------------
    db.getPositions = originalGetPositions;

    console.log('\n===================================================');
    console.log('                 TEST RESULT SUMMARY                ');
    console.log('===================================================');
    console.log(`  PASSED: \x1b[32m${passedTests}\x1b[0m`);
    console.log(`  FAILED: ${failedTests > 0 ? `\x1b[31m${failedTests}\x1b[0m` : '\x1b[32m0\x1b[0m'}`);
    console.log('===================================================\n');

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test execution failed with error:', err);
    process.exit(1);
});
