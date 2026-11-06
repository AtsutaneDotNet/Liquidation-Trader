(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.TradFiUtils = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    /**
     * Clean and extract the base asset from a symbol
     * Examples: 'XAU/USDT:USDT' -> 'XAU', 'BTCUSDT' -> 'BTC', 'MU/USDT:USDT' -> 'MU'
     */
    function extractBaseAsset(symbol, market) {
        if (market && market.base) {
            return String(market.base).toUpperCase();
        }
        if (market && market.info && (market.info.baseAsset || market.info.baseCoin)) {
            return String(market.info.baseAsset || market.info.baseCoin).toUpperCase();
        }
        if (!symbol) return '';

        let s = symbol.trim().toUpperCase();
        // CCXT style symbol e.g. XAU/USDT:USDT or EUR/USDT
        if (s.includes('/')) {
            return s.split('/')[0].replace(/[^A-Z0-9]/g, '');
        }
        // Stripped symbol e.g. XAUUSDT, BTCUSDT
        const quotes = ['USDT', 'USDC', 'USD', 'BUSD'];
        for (const q of quotes) {
            if (s.endsWith(q) && s.length > q.length) {
                return s.slice(0, -q.length).replace(/[^A-Z0-9]/g, '');
            }
        }
        return s.replace(/[^A-Z0-9]/g, '');
    }

    /**
     * Check if a symbol/market is a TradFi pair
     * Purely driven by exchange protocol metadata (market.info) and user custom lists.
     * No hardcoded symbol fallback lists.
     */
    function isTradFi(symbol, market = null, customTradFiStr = '', excludeStr = 'PAXG, XAUT') {
        const base = extractBaseAsset(symbol, market);
        if (!base) return false;

        // 1. Process custom user exclusion list (force crypto)
        const userExclude = new Set(
            (excludeStr || 'PAXG, XAUT')
                .split(',')
                .map(s => s.trim().toUpperCase())
                .filter(Boolean)
        );
        if (userExclude.has(base)) return false;

        // 2. Process custom user TradFi list (force TradFi)
        if (customTradFiStr) {
            const userCustom = new Set(
                customTradFiStr
                    .split(',')
                    .map(s => s.trim().toUpperCase())
                    .filter(Boolean)
            );
            if (userCustom.has(base)) return true;
        }

        // 3. If market object is already classified by server
        if (market && typeof market.isTradFi === 'boolean') {
            return market.isTradFi;
        }

        // 4. Exchange metadata inspection (CCXT market.info)
        if (market && market.info) {
            const info = market.info;

            // Binance: contractType === 'TRADIFI_PERPETUAL'
            if (info.contractType) {
                const ct = String(info.contractType).toUpperCase();
                if (ct === 'TRADIFI_PERPETUAL' || ct.includes('TRADIFI') || ct.includes('TRADFI')) {
                    return true;
                }
            }

            // Binance: underlyingSubType array contains 'TradFi'
            if (info.underlyingSubType) {
                const subTypes = Array.isArray(info.underlyingSubType)
                    ? info.underlyingSubType
                    : [info.underlyingSubType];
                if (subTypes.some(st => {
                    const s = String(st).toUpperCase();
                    return s === 'TRADFI' || s === 'TRADIFI';
                })) {
                    return true;
                }
            }

            // Binance: underlyingType inspection
            if (info.underlyingType) {
                const ut = String(info.underlyingType).toUpperCase();
                if (ut === 'COIN') return false; // Native crypto pair in Binance
                if (['EQUITY', 'COMMODITY', 'PREMARKET', 'KR_EQUITY', 'HK_EQUITY', 'CN_EQUITY', 'FX', 'STOCK', 'FOREX', 'METALS'].includes(ut)) {
                    return true;
                }
            }

            // Bybit: symbolType inspection
            if (info.symbolType) {
                const st = String(info.symbolType).toLowerCase();
                if (st === 'crypto') return false; // Native crypto pair in Bybit
                if (['commodity', 'forex', 'stock', 'xstocks', 'equity', 'index', 'etf'].includes(st)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Get TradFi asset category name from exchange metadata
     */
    function getAssetCategory(base, market = null) {
        if (market) {
            if (market.category && market.category !== 'TradFi') {
                return market.category;
            }
            if (market.info) {
                const info = market.info;
                const ut = String(info.underlyingType || '').toUpperCase();
                const st = String(info.symbolType || '').toLowerCase();
                const ct = String(info.contractType || '').toUpperCase();

                if (ut.includes('EQUITY') || ut === 'STOCK' || ut === 'PREMARKET' || st === 'stock' || st === 'xstocks' || st === 'equity' || st === 'etf') {
                    return 'Stock';
                }
                if (ut === 'INDEX' || st === 'index') {
                    return 'Index';
                }
                if (ut === 'FX' || ut === 'FOREX' || st === 'forex') {
                    return 'Forex';
                }
                if (ut === 'COMMODITY' || ut === 'METALS' || st === 'commodity') {
                    const b = (base || '').toUpperCase();
                    if (['XAU', 'XAG', 'XPT', 'XPD'].includes(b)) return 'Metals';
                    return 'Commodity';
                }
                if (ct.includes('TRADIFI') || ct.includes('TRADFI')) {
                    return 'Stock';
                }
            }
        }

        return 'TradFi';
    }

    /**
     * Get asset display name (clean ticker symbol, no static dictionary)
     */
    function getAssetName(base) {
        return (base || '').toUpperCase();
    }

    /**
     * Calculate whether the TradFi market is actively operating or closed.
     * Evaluates real-world session hours using UTC time:
     * - Stocks: Mon-Fri 13:30 - 20:00 UTC (US Equities regular hours)
     * - Forex: Sun 22:00 - Fri 22:00 UTC continuous (No daily break)
     * - Indices: Sun 23:00 - Fri 21:15 UTC (Daily break: 21:15-22:00 UTC)
     * - Metals & Commodities: Sun 23:00 - Fri 22:00 UTC (Daily break: 22:00-23:00 UTC)
     *
     * @param {string} symbol - Trading symbol
     * @param {object} [market] - Optional CCXT market object
     * @param {Date} [nowDate] - Current date/time (defaults to new Date())
     * @param {string} [customTradFiStr] - Comma-separated custom TradFi symbols
     * @param {string} [excludeStr] - Comma-separated exclude symbols
     * @returns {object} Status details
     */
    function getMarketStatus(symbol, market = null, nowDate = new Date(), customTradFiStr = '', excludeStr = 'PAXG, XAUT') {
        const base = extractBaseAsset(symbol, market);
        const isTradFiPair = isTradFi(symbol, market, customTradFiStr, excludeStr);

        if (!isTradFiPair) {
            return {
                isTradFi: false,
                isOpen: true,
                status: 'OPERATING',
                statusLabel: 'Operating',
                category: 'Crypto',
                assetName: base,
                scheduleSummary: '24/7/365 Always Open',
                tooltip: 'Native Cryptocurrency (Trades 24/7/365 continuously)'
            };
        }

        const category = getAssetCategory(base, market);
        const assetName = getAssetName(base);

        const d = nowDate instanceof Date ? nowDate : new Date(nowDate);
        const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
        const hours = d.getUTCHours();
        const mins = d.getUTCMinutes();
        const totalMinDay = hours * 60 + mins; // minutes since 00:00 UTC today

        let isOpen = false;
        let status = 'OPERATING'; // 'OPERATING', 'DAILY_BREAK', 'CLOSED'
        let statusLabel = 'Operating';
        let scheduleSummary = '';
        let nextEventLabel = '';
        let minutesUntilNextEvent = 0;

        if (category === 'Stock') {
            scheduleSummary = 'Mon–Fri 13:30 – 20:00 UTC (US Equities)';
            // US Equities: Regular Hours 13:30 to 20:00 UTC, Mon-Fri
            const isWeekend = (day === 6) || // Saturday
                (day === 0) || // Sunday
                (day === 5 && totalMinDay >= 20 * 60) || // Friday after 20:00
                (day === 1 && totalMinDay < 13 * 60 + 30); // Monday before 13:30

            if (isWeekend) {
                isOpen = false;
                status = 'CLOSED';
                statusLabel = 'Market Closed';
                // Calculate minutes until Monday 13:30 UTC
                let minUntilMon1330 = 0;
                if (day === 5) {
                    minUntilMon1330 = (24 * 60 - totalMinDay) + (2 * 24 * 60) + (13 * 60 + 30);
                } else if (day === 6) {
                    minUntilMon1330 = (24 * 60 - totalMinDay) + (24 * 60) + (13 * 60 + 30);
                } else if (day === 0) {
                    minUntilMon1330 = (24 * 60 - totalMinDay) + (13 * 60 + 30);
                } else if (day === 1) {
                    minUntilMon1330 = (13 * 60 + 30 - totalMinDay);
                }
                minutesUntilNextEvent = Math.max(0, minUntilMon1330);
                nextEventLabel = `Reopens Mon 13:30 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            } else if (day >= 1 && day <= 5 && (totalMinDay < 13 * 60 + 30 || totalMinDay >= 20 * 60)) {
                // Weekday outside regular hours
                isOpen = false;
                status = 'CLOSED';
                statusLabel = 'Market Closed';
                let minUntilNextOpen = 0;
                if (totalMinDay < 13 * 60 + 30) {
                    minUntilNextOpen = (13 * 60 + 30 - totalMinDay);
                    nextEventLabel = `Reopens today at 13:30 UTC (${formatMinutesHuman(minUntilNextOpen)})`;
                } else {
                    // After 20:00 on Mon-Thu -> opens tomorrow at 13:30 UTC
                    minUntilNextOpen = (24 * 60 - totalMinDay) + (13 * 60 + 30);
                    nextEventLabel = `Reopens tomorrow at 13:30 UTC (${formatMinutesHuman(minUntilNextOpen)})`;
                }
                minutesUntilNextEvent = Math.max(0, minUntilNextOpen);
            } else {
                // Active trading hours
                isOpen = true;
                status = 'OPERATING';
                statusLabel = 'Operating';
                const minUntilClose = (20 * 60) - totalMinDay;
                minutesUntilNextEvent = Math.max(0, minUntilClose);
                nextEventLabel = `Closes at 20:00 UTC (${formatMinutesHuman(minUntilClose)})`;
            }
        } else if (category === 'Forex') {
            scheduleSummary = 'Sun 22:00 – Fri 22:00 UTC (24/5 Continuous)';
            const isWeekend = (day === 6) ||
                (day === 0 && totalMinDay < 22 * 60) ||
                (day === 5 && totalMinDay >= 22 * 60);

            if (isWeekend) {
                isOpen = false;
                status = 'CLOSED';
                statusLabel = 'Market Closed';
                let minUntilSun22 = 0;
                if (day === 5) {
                    minUntilSun22 = (24 * 60 - totalMinDay) + (24 * 60) + (22 * 60);
                } else if (day === 6) {
                    minUntilSun22 = (24 * 60 - totalMinDay) + (22 * 60);
                } else if (day === 0) {
                    minUntilSun22 = (22 * 60 - totalMinDay);
                }
                minutesUntilNextEvent = Math.max(0, minUntilSun22);
                nextEventLabel = `Reopens Sun 22:00 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            } else {
                isOpen = true;
                status = 'OPERATING';
                statusLabel = 'Operating';
                let daysUntilFri = (5 - day);
                let minUntilFri22 = (daysUntilFri * 24 * 60) + (22 * 60 - totalMinDay);
                minutesUntilNextEvent = Math.max(0, minUntilFri22);
                nextEventLabel = `Closes Fri 22:00 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            }
        } else if (category === 'Index') {
            scheduleSummary = 'Sun 23:00 – Fri 21:15 UTC (Daily break: 21:15–22:00 UTC)';
            const isWeekend = (day === 6) ||
                (day === 0 && totalMinDay < 23 * 60) ||
                (day === 5 && totalMinDay >= 21 * 60 + 15);

            if (isWeekend) {
                isOpen = false;
                status = 'CLOSED';
                statusLabel = 'Market Closed';
                let minUntilSun23 = 0;
                if (day === 5) minUntilSun23 = (24 * 60 - totalMinDay) + (24 * 60) + (23 * 60);
                else if (day === 6) minUntilSun23 = (24 * 60 - totalMinDay) + (23 * 60);
                else if (day === 0) minUntilSun23 = (23 * 60 - totalMinDay);
                minutesUntilNextEvent = Math.max(0, minUntilSun23);
                nextEventLabel = `Reopens Sun 23:00 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            } else if (day >= 1 && day <= 4 && totalMinDay >= (21 * 60 + 15) && totalMinDay < (22 * 60)) {
                isOpen = false;
                status = 'DAILY_BREAK';
                statusLabel = 'Daily Break';
                minutesUntilNextEvent = Math.max(0, 22 * 60 - totalMinDay);
                nextEventLabel = `Reopens at 22:00 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            } else {
                isOpen = true;
                status = 'OPERATING';
                statusLabel = 'Operating';
                let nextHaltMin = 0;
                if (day === 5) {
                    nextHaltMin = (21 * 60 + 15) - totalMinDay;
                    nextEventLabel = `Weekend close at 21:15 UTC (${formatMinutesHuman(nextHaltMin)})`;
                } else if (day >= 1 && day <= 4) {
                    if (totalMinDay < 21 * 60 + 15) {
                        nextHaltMin = (21 * 60 + 15) - totalMinDay;
                        nextEventLabel = `Daily break in ${formatMinutesHuman(nextHaltMin)}`;
                    } else {
                        nextHaltMin = (24 * 60 - totalMinDay) + (21 * 60 + 15);
                        nextEventLabel = `Daily break in ${formatMinutesHuman(nextHaltMin)}`;
                    }
                } else if (day === 0) {
                    nextHaltMin = (24 * 60 - totalMinDay) + (21 * 60 + 15);
                    nextEventLabel = `Daily break in ${formatMinutesHuman(nextHaltMin)}`;
                }
                minutesUntilNextEvent = Math.max(0, nextHaltMin);
            }
        } else {
            // Default: Metals & Commodities (CME/COMEX Gold & Silver)
            scheduleSummary = 'Sun 23:00 – Fri 22:00 UTC (Daily break: 22:00–23:00 UTC)';
            const isWeekend = (day === 6) ||
                (day === 0 && totalMinDay < 23 * 60) ||
                (day === 5 && totalMinDay >= 22 * 60);

            if (isWeekend) {
                isOpen = false;
                status = 'CLOSED';
                statusLabel = 'Market Closed';
                let minUntilSun23 = 0;
                if (day === 5) minUntilSun23 = (24 * 60 - totalMinDay) + (24 * 60) + (23 * 60);
                else if (day === 6) minUntilSun23 = (24 * 60 - totalMinDay) + (23 * 60);
                else if (day === 0) minUntilSun23 = (23 * 60 - totalMinDay);
                minutesUntilNextEvent = Math.max(0, minUntilSun23);
                nextEventLabel = `Reopens Sun 23:00 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            } else if (day >= 1 && day <= 4 && totalMinDay >= (22 * 60) && totalMinDay < (23 * 60)) {
                isOpen = false;
                status = 'DAILY_BREAK';
                statusLabel = 'Daily Break';
                minutesUntilNextEvent = Math.max(0, 23 * 60 - totalMinDay);
                nextEventLabel = `Daily break ends at 23:00 UTC (${formatMinutesHuman(minutesUntilNextEvent)})`;
            } else {
                isOpen = true;
                status = 'OPERATING';
                statusLabel = 'Operating';
                let nextHaltMin = 0;
                if (day === 5) {
                    nextHaltMin = (22 * 60) - totalMinDay;
                    nextEventLabel = `Weekend close in ${formatMinutesHuman(nextHaltMin)}`;
                } else if (day >= 1 && day <= 4) {
                    if (totalMinDay < 22 * 60) {
                        nextHaltMin = (22 * 60) - totalMinDay;
                        nextEventLabel = `Daily break in ${formatMinutesHuman(nextHaltMin)}`;
                    } else {
                        nextHaltMin = (24 * 60 - totalMinDay) + (22 * 60);
                        nextEventLabel = `Daily break in ${formatMinutesHuman(nextHaltMin)}`;
                    }
                } else if (day === 0) {
                    nextHaltMin = (24 * 60 - totalMinDay) + (22 * 60);
                    nextEventLabel = `Daily break in ${formatMinutesHuman(nextHaltMin)}`;
                }
                minutesUntilNextEvent = Math.max(0, nextHaltMin);
            }
        }

        const tooltip = `TradFi: ${assetName} (${category})\nStatus: ${statusLabel}\nSchedule: ${scheduleSummary}\nNext: ${nextEventLabel}`;

        return {
            isTradFi: true,
            isOpen,
            status,
            statusLabel,
            category,
            assetName,
            scheduleSummary,
            nextEventLabel,
            minutesUntilNextEvent,
            tooltip
        };
    }

    function formatMinutesHuman(totalMinutes) {
        if (totalMinutes <= 0) return 'now';
        const d = Math.floor(totalMinutes / (24 * 60));
        const h = Math.floor((totalMinutes % (24 * 60)) / 60);
        const m = Math.floor(totalMinutes % 60);

        if (d > 0) {
            return `${d}d ${h}h`;
        }
        if (h > 0) {
            return `${h}h ${m}m`;
        }
        return `${m}m`;
    }

    return {
        isTradFi,
        getMarketStatus,
        extractBaseAsset,
        getAssetCategory,
        getAssetName,
        formatMinutesHuman
    };
}));
