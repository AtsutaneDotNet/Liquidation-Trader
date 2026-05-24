document.addEventListener('DOMContentLoaded', () => {
    // ── Login Form ────────────────────────────────────────────────
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());
            const errorEl = document.getElementById('login-error');
            const submitBtn = this.querySelector('button[type="submit"]');

            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Authenticating...';
            submitBtn.disabled = true;

            fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
                .then(res => res.json())
                .then(result => {
                    if (result.success) {
                        window.location.href = '/';
                    } else {
                        errorEl.textContent = result.message || 'Invalid credentials';
                        errorEl.style.display = 'block';
                        submitBtn.textContent = originalText;
                        submitBtn.disabled = false;
                    }
                })
                .catch(err => {
                    errorEl.textContent = 'Network error. Please try again.';
                    errorEl.style.display = 'block';
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                });
        });
        return; // Stop further execution on login page
    }

    // Caching for real-time table search/filtering
    let cachedLiquidations = [];
    let cachedClosedPnls = [];
    let cachedDynamicThresholds = [];
    let cachedTradeDecisions = [];

    // Interactive Tooltip Touch & Click Delegation Handler
    document.addEventListener('click', (e) => {
        const container = e.target.closest('.strategy-badge-container');
        
        // Remove active class from all other containers
        document.querySelectorAll('.strategy-badge-container').forEach(el => {
            if (el !== container) {
                el.classList.remove('active');
            }
        });
        
        // Toggle active class on current container if clicked
        if (container) {
            container.classList.toggle('active');
        }
    });

    // Sidebar Toggle
    const sidebar = document.getElementById('sidebar');

    // Navigation
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.dataset.target;
            const pageEl = document.getElementById(targetId);
            if (pageEl) pageEl.classList.add('active');

            // Trigger immediate render on navigated tabs to maintain high responsiveness
            if (targetId === 'dashboard') {
                fetchStatus();
                fetchLiquidations();
                fetchTradeDecisions();
            } else if (targetId === 'positions') {
                fetchAccountData();
            } else if (targetId === 'account') {
                fetchAccountData();
                fetchPnLHistory();
            } else if (targetId === 'liquidations-page') {
                fetchLiquidations();
            } else if (targetId === 'closed-pnl-page') {
                fetchClosedPnlsTable();
            } else if (targetId === 'dynamic-thresholds-page') {
                fetchDynamicThresholdTable();
            } else if (targetId === 'trade-decisions-page') {
                fetchTradeDecisions();
            }
        });
    });

    // Form Loading and Saving
    const form = document.getElementById('config-form');

    function loadConfig() {
        fetch('/api/config')
            .then(res => res.json())
            .then(data => {
                for (const key in data) {
                    if (['WEBUI_AUTH_ENABLED', 'CMC_FILTER_ENABLED', 'ENABLE_VWAP_STRATEGY', 'ENABLE_RSI_STRATEGY', 'ENABLE_ADX_STRATEGY', 'ENABLE_MARKET_SENTIMENT_STRATEGY', 'ENABLE_TRAILING_PROFIT', 'ENABLE_DCA_MARTINGALE', 'ENABLE_DYNAMIC_THRESHOLDS', 'ENABLE_RUNAWAY_HELPER', 'REPLACE_BELOW_MIN_THRESHOLD'].includes(key)) {
                        const el = document.getElementById(key);
                        if (el) el.checked = data[key] === true || data[key] === 'true';
                        continue;
                    }
                    const el = document.getElementById(key);
                    if (el && el.type !== 'checkbox') {
                        el.value = data[key] || '';
                    }

                    if (key === 'LIQUIDATION_EXCHANGES' && data[key]) {
                        const arr = data[key].split(',').map(s => s.trim());
                        document.querySelectorAll('.liq-exchange-cb').forEach(cb => {
                            cb.checked = arr.includes(cb.value);
                        });
                        const hiddenEl = document.getElementById('LIQUIDATION_EXCHANGES');
                        if (hiddenEl) hiddenEl.value = data[key];
                    }
                }
                // Toggle VWAP fields on load
                const vwapTypeEl = document.getElementById('VWAP_TYPE');
                if (vwapTypeEl) {
                    const type = vwapTypeEl.value;
                    const sessionCol = document.getElementById('vwap-session-type-col');
                    const periodCol = document.getElementById('vwap-period-col');
                    if (sessionCol) sessionCol.style.display = type === 'session' ? 'flex' : 'none';
                    if (periodCol) periodCol.style.display = type === 'session' ? 'none' : 'flex';
                }
            })
            .catch(console.error);
    }

    loadConfig();

    const vwapTypeEl = document.getElementById('VWAP_TYPE');
    if (vwapTypeEl) {
        vwapTypeEl.addEventListener('change', (e) => {
            const type = e.target.value;
            const sessionCol = document.getElementById('vwap-session-type-col');
            const periodCol = document.getElementById('vwap-period-col');
            if (sessionCol) sessionCol.style.display = type === 'session' ? 'flex' : 'none';
            if (periodCol) periodCol.style.display = type === 'session' ? 'none' : 'flex';
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(form);

        // Populate hidden input for liquidation exchanges before sending
        const checkedLiqs = Array.from(document.querySelectorAll('.liq-exchange-cb:checked')).map(cb => cb.value);
        formData.set('LIQUIDATION_EXCHANGES', checkedLiqs.join(','));

        // Handle auth checkbox specifically
        const authCb = document.getElementById('WEBUI_AUTH_ENABLED');
        if (authCb) {
            formData.set('WEBUI_AUTH_ENABLED', authCb.checked ? 'true' : 'false');
        }

        const cmcFilterCb = document.getElementById('CMC_FILTER_ENABLED');
        if (cmcFilterCb) {
            formData.set('CMC_FILTER_ENABLED', cmcFilterCb.checked ? 'true' : 'false');
        }

        const vwapCb = document.getElementById('ENABLE_VWAP_STRATEGY');
        if (vwapCb) formData.set('ENABLE_VWAP_STRATEGY', vwapCb.checked ? 'true' : 'false');

        const rsiCb = document.getElementById('ENABLE_RSI_STRATEGY');
        if (rsiCb) formData.set('ENABLE_RSI_STRATEGY', rsiCb.checked ? 'true' : 'false');

        const trailingCb = document.getElementById('ENABLE_TRAILING_PROFIT');
        if (trailingCb) formData.set('ENABLE_TRAILING_PROFIT', trailingCb.checked ? 'true' : 'false');

        const dcaCb = document.getElementById('ENABLE_DCA_MARTINGALE');
        if (dcaCb) formData.set('ENABLE_DCA_MARTINGALE', dcaCb.checked ? 'true' : 'false');

        const dynamicCb = document.getElementById('ENABLE_DYNAMIC_THRESHOLDS');
        if (dynamicCb) formData.set('ENABLE_DYNAMIC_THRESHOLDS', dynamicCb.checked ? 'true' : 'false');

        const replaceBelowMinCb = document.getElementById('REPLACE_BELOW_MIN_THRESHOLD');
        if (replaceBelowMinCb) formData.set('REPLACE_BELOW_MIN_THRESHOLD', replaceBelowMinCb.checked ? 'true' : 'false');

        const runawayCb = document.getElementById('ENABLE_RUNAWAY_HELPER');
        if (runawayCb) formData.set('ENABLE_RUNAWAY_HELPER', runawayCb.checked ? 'true' : 'false');

        const adxCb = document.getElementById('ENABLE_ADX_STRATEGY');
        if (adxCb) formData.set('ENABLE_ADX_STRATEGY', adxCb.checked ? 'true' : 'false');

        const fgCb = document.getElementById('ENABLE_MARKET_SENTIMENT_STRATEGY');
        if (fgCb) formData.set('ENABLE_MARKET_SENTIMENT_STRATEGY', fgCb.checked ? 'true' : 'false');

        const isVwapChecked = vwapCb && vwapCb.checked;
        const isRsiChecked = rsiCb && rsiCb.checked;
        const isAdxChecked = adxCb && adxCb.checked;
        const isFgChecked = fgCb && fgCb.checked;

        if (!isVwapChecked && !isRsiChecked && !isAdxChecked && !isFgChecked) {
            showToast({
                title: 'Configuration Error',
                message: 'At least one strategy must be enabled.',
                type: 'error'
            });
            return;
        }

        // Add Advance Strategy Settings manually since they are outside the form
        const advInputs = [
            'VWAP_UPPER_SIGNAL', 'VWAP_LOWER_SIGNAL',
            'RSI_OVERBOUGHT_DIR', 'RSI_OVERSOLD_DIR',
            'RSI_OVERBOUGHT_SIGNAL', 'RSI_OVERSOLD_SIGNAL',
            'ADX_THRESHOLD_DIR', 'ADX_PDI_SIGNAL', 'ADX_MDI_SIGNAL',
            'MS_BULLISH_SIGNAL', 'MS_BEARISH_SIGNAL', 'MS_EXTREME_FEAR_SIGNAL', 'MS_EXTREME_GREED_SIGNAL'
        ];
        advInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) formData.set(id, el.value);
        });

        const data = Object.fromEntries(formData.entries());

        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
            .then(res => res.json())
            .then(result => {
                showToast({
                    title: 'Configuration Saved',
                    message: result.message,
                    type: result.success !== false ? 'success' : 'error'
                });
                loadConfig(); // fresh reload to mask api keys again safely
            });
    });

    // Status Polling
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const botStatusDot = document.getElementById('bot-status-indicator').querySelector('.dot');
    const botStatusText = document.getElementById('bot-status-text');
    const tradeStatusDot = document.getElementById('trade-status-indicator').querySelector('.dot');
    const tradeStatusText = document.getElementById('trade-status-text');
    const pairsCount = document.getElementById('pairs-count');
    const openPositionsCount = document.getElementById('open-positions-count');
    const maxPositionsCount = document.getElementById('max-positions-count');
    const usedMarginPercent = document.getElementById('used-margin-percent');
    const fearGreedValue = document.getElementById('fear-greed-value');
    const marketSentimentValue = document.getElementById('market-sentiment-value');
    const controlMsg = document.getElementById('control-msg');
    let currentBtcPrice = 0;

    // ── Currency Switcher Setup ──────────────────────────────
    const currencySymbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        MYR: 'RM',
        JPY: '¥',
        SGD: 'S$',
        BTC: '₿'
    };

    let exchangeRates = {
        USD: 1.0,
        EUR: 0.92,
        GBP: 0.79,
        MYR: 4.70,
        JPY: 155.0,
        SGD: 1.35,
        BTC: 0.000015 // Updated dynamically from live status
    };

    function fetchExchangeRates() {
        fetch('https://open.er-api.com/v6/latest/USD')
            .then(res => res.json())
            .then(data => {
                if (data && data.rates) {
                    for (const cur of ['EUR', 'GBP', 'MYR', 'JPY', 'SGD']) {
                        if (data.rates[cur]) {
                            exchangeRates[cur] = data.rates[cur];
                        }
                    }
                    console.log('Exchange rates updated successfully:', exchangeRates);
                    updateBtcRateAndReRender();
                }
            })
            .catch(err => {
                console.warn('Could not fetch live exchange rates, using fallbacks:', err);
            });
    }

    function convertFromUsd(val) {
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const rate = exchangeRates[cur] || 1.0;
        return val * rate;
    }

    function formatSelectedCurrency(val) {
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const converted = convertFromUsd(val);
        const symbol = currencySymbols[cur] || '$';
        
        if (cur === 'BTC') {
            return symbol + parseFloat(converted).toFixed(6);
        } else if (cur === 'JPY') {
            return symbol + Math.round(converted).toLocaleString();
        } else {
            return symbol + parseFloat(converted).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        }
    }

    function formatTokenPrice(priceUsd) {
        if (priceUsd === undefined || priceUsd === null || isNaN(priceUsd)) return 'N/A';
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const symbol = currencySymbols[cur] || '$';
        const converted = convertFromUsd(priceUsd);
        return symbol + parseFloat(converted).toFixed(cur === 'BTC' ? 6 : (cur === 'JPY' ? 0 : 4));
    }

    function updateBtcRateAndReRender() {
        if (currentBtcPrice > 0) {
            exchangeRates.BTC = 1 / currentBtcPrice;
        }
        
        // Re-trigger visual updates instantly on currency change or rate updates
        fetchAccountData();
        fetchLiquidations();
        fetchClosedPnlsTable();
        fetchDynamicThresholdTable();
        fetchTradeDecisions();
        fetchPnLHistory();
    }

    // Call exchange rate fetch on initialization
    fetchExchangeRates();

    function fetchStatus() {
        fetch('/api/status')
            .then(res => res.json())
            .then(data => {
                if (data.isRunning) {
                    botStatusDot.className = 'dot running';
                    botStatusText.textContent = 'Running';
                    btnStart.disabled = true;
                    btnStop.disabled = false;
                } else {
                    botStatusDot.className = 'dot';
                    botStatusText.textContent = 'Stopped';
                    btnStart.disabled = false;
                    btnStop.disabled = true;
                }

                if (data.isTrading) {
                    tradeStatusDot.className = 'dot error'; // Red when active execution locks standard
                    tradeStatusText.textContent = 'Executing Trade';
                } else {
                    tradeStatusDot.className = 'dot';
                    tradeStatusText.textContent = 'Idle';
                }

                pairsCount.textContent = data.pairsLoaded;
                currentBtcPrice = data.btcUsdPrice || 0;
                if (currentBtcPrice > 0) {
                    exchangeRates.BTC = 1 / currentBtcPrice;
                }

                if (openPositionsCount) openPositionsCount.textContent = data.openPositionsCount || 0;
                if (maxPositionsCount) maxPositionsCount.textContent = data.maxOpenPositions || 0;
                if (usedMarginPercent) usedMarginPercent.textContent = (data.usedMarginPercent || 0).toFixed(2) + '%';

                if (marketSentimentValue && fearGreedValue) {
                    if (data.marketSentiment) {
                        const val = parseInt(data.marketSentiment.fgValue) || 0;
                        const classif = data.marketSentiment.fgClassification || '';
                        fearGreedValue.textContent = `${val} (${classif})`;

                        // Dynamic color styling
                        if (val < 20) fearGreedValue.style.color = 'var(--danger)';
                        else if (val < 40) fearGreedValue.style.color = 'orange';
                        else if (val < 60) fearGreedValue.style.color = 'var(--text-muted)';
                        else if (val < 80) fearGreedValue.style.color = 'var(--accent)';
                        else fearGreedValue.style.color = '#00ff00';

                        const mktScore = parseFloat(data.marketSentiment.marketScore) || 0;
                        const mktLabel = data.marketSentiment.marketLabel || '';
                        marketSentimentValue.textContent = `${mktScore.toFixed(2)} (${mktLabel})`;
                        if (mktLabel.toLowerCase() === 'bullish') marketSentimentValue.style.color = '#00ff00';
                        else if (mktLabel.toLowerCase() === 'bearish') marketSentimentValue.style.color = 'var(--danger)';
                        else marketSentimentValue.style.color = 'var(--text-muted)';
                    } else {
                        fearGreedValue.textContent = 'N/A';
                        fearGreedValue.style.color = 'var(--text-muted)';
                        marketSentimentValue.textContent = 'N/A';
                        marketSentimentValue.style.color = 'var(--text-muted)';
                    }
                }
            });
    }

    setInterval(fetchStatus, 2000);
    fetchStatus();

    btnStart.addEventListener('click', () => {
        fetch('/api/bot/start', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                showToast({
                    title: 'Engine Status',
                    message: data.message,
                    type: data.success ? 'success' : 'error'
                });
                fetchStatus();
            });
    });

    btnStop.addEventListener('click', () => {
        fetch('/api/bot/stop', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                showToast({
                    title: 'Engine Status',
                    message: data.message,
                    type: data.success ? 'success' : 'error'
                });
                fetchStatus();
            });
    });

    // Terminal Logs Live Stream
    const logTerminal = document.getElementById('log-terminal');
    let lastLogCount = 0;

    function fetchLogs() {
        if (!logTerminal) return;
        if (!document.getElementById('logs-page').classList.contains('active')) return;

        fetch('/api/logs')
            .then(res => res.json())
            .then(logs => {
                // Determine if we need to update DOM
                if (logs.length !== lastLogCount || logs.length >= 500) {
                    const isBottom = logTerminal.scrollHeight - logTerminal.clientHeight <= logTerminal.scrollTop + 50;

                    logTerminal.innerHTML = logs.map(l => {
                        return `<div class="log-row"><span class="log-time">[${l.time}]</span><span class="log-${l.type}">${l.msg}</span></div>`;
                    }).join('');

                    // Auto-scroll to adhere to UX if user hasn't explicitly scrolled up
                    if (isBottom || lastLogCount === 0) {
                        logTerminal.scrollTop = logTerminal.scrollHeight;
                    }
                    lastLogCount = logs.length;
                }
            })
            .catch(console.error);
    }

    setInterval(fetchLogs, 2000);
    fetchLogs();

    // Account and Positions Live Stream
    const elAccTotal = document.getElementById('acc-total-value');
    const elAccUsed = document.getElementById('acc-margin-used');
    const elAccAvail = document.getElementById('acc-margin-avail');
    const elAccDaily = document.getElementById('acc-daily-pnl');
    const elAccWeekly = document.getElementById('acc-weekly-pnl');
    const elAccMonthly = document.getElementById('acc-monthly-pnl');
    const elAccYearly = document.getElementById('acc-yearly-pnl');
    const elAccTotalPnl = document.getElementById('acc-total-pnl');
    const positionsContainer = document.getElementById('positions-container');

    function formatUsd(val) {
        return formatSelectedCurrency(val);
    }

    function formatPnl(val) {
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const numUsd = parseFloat(val || 0);
        const converted = convertFromUsd(numUsd);
        
        const sign = converted > 0 ? '+' : '';
        const clz = numUsd >= 0 ? 'pnl-positive' : 'pnl-negative';
        const symbol = currencySymbols[cur] || '$';
        
        let formattedVal = '';
        if (cur === 'BTC') {
            formattedVal = parseFloat(converted).toFixed(6);
        } else if (cur === 'JPY') {
            formattedVal = Math.round(converted).toLocaleString();
        } else {
            formattedVal = parseFloat(converted).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        }
        
        return `<span class="${clz}">${sign}${symbol}${formattedVal}</span>`;
    }

    function fetchAccountData() {
        // Optimize polling: only render if standard tabs correspond.
        if (!document.getElementById('account').classList.contains('active') &&
            !document.getElementById('positions').classList.contains('active')) return;

        fetch('/api/account')
            .then(res => res.json())
            .then(data => {
                if (data.total_value !== undefined) {
                    elAccTotal.textContent = formatUsd(data.total_value);
                    elAccUsed.textContent = formatUsd(data.margin_used);
                    elAccAvail.textContent = formatUsd(data.margin_available);
                    elAccDaily.innerHTML = formatPnl(data.daily_pnl);
                    elAccWeekly.innerHTML = formatPnl(data.weekly_pnl);
                    elAccMonthly.innerHTML = formatPnl(data.monthly_pnl);
                    elAccYearly.innerHTML = formatPnl(data.yearly_pnl);
                    elAccTotalPnl.innerHTML = formatPnl(data.total_pnl);
                }
            }).catch(console.error);

        fetch('/api/positions')
            .then(res => res.json())
            .then(data => {
                if (!positionsContainer) return;
                if (!data || data.length === 0) {
                    positionsContainer.innerHTML = '<div class="empty-msg">&mdash; No active positions tracked yet &mdash;</div>';
                } else {
                    positionsContainer.innerHTML = data.map(p => {
                        const sideStr = (p.side || '').toLowerCase();
                        const isBuy = sideStr === 'buy' || sideStr === 'long';
                        const sideClz = isBuy ? 'buy' : 'sell';
                        const cardClz = isBuy ? 'pos-card-buy' : 'pos-card-sell';
                        const sideText = (p.side || 'UNKNOWN').toUpperCase();

                        return `
                        <div class="position-card ${cardClz}">
                            <div class="pos-header">
                                <div class="pos-symbol">${p.symbol}</div>
                                <div class="pos-side ${sideClz}">${sideText}</div>
                            </div>
                            <div class="pos-details">
                                <div class="pos-detail-item">
                                    <span class="pos-detail-label">Size</span>
                                    <span class="pos-detail-value">${p.size}</span>
                                </div>
                                <div class="pos-detail-item">
                                    <span class="pos-detail-label">Entry Price</span>
                                    <span class="pos-detail-value">${parseFloat(p.entry_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="pos-detail-item">
                                    <span class="pos-detail-label">Mark Price</span>
                                    <span class="pos-detail-value">${parseFloat(p.mark_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="pos-detail-item">
                                    <span class="pos-detail-label">Liq. Price</span>
                                    <span class="pos-detail-value" style="color: var(--danger)">${parseFloat(p.liq_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="pos-detail-item">
                                    <span class="pos-detail-label">TP Price</span>
                                    <span class="pos-detail-value" style="color: var(--accent)">${parseFloat(p.tp_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="pos-detail-item">
                                    <span class="pos-detail-label">SL Price</span>
                                    <span class="pos-detail-value" style="color: var(--danger)">${parseFloat(p.sl_price || 0).toFixed(4)}</span>
                                </div>
                            </div>
                            <div class="pos-pnl">
                                <span class="pos-pnl-label">Unrealized PnL</span>
                                <span class="pos-pnl-value">${formatPnl(p.unrealized_pnl)}</span>
                            </div>
                        </div>`;
                    }).join('');
                }
            }).catch(console.error);
    }

    setInterval(fetchAccountData, 2000);
    fetchAccountData();

    // Liquidations Live Stream
    const tbodyLiquidations = document.getElementById('liquidations-tbody');
    const tbodyDashboardLiquidations = document.getElementById('dashboard-liquidations-tbody');

    // Cache parameters for dynamic thresholds inside liquidations rendering
    let lastEffectiveThreshold = 0;
    let lastBases = [];
    let lastUseDynamic = false;
    let lastReplaceBelowMin = false;

    function renderLiquidations() {
        if (!tbodyLiquidations) return;

        const searchVal = (document.getElementById('liquidations-search')?.value || '').trim().toUpperCase();
        let filtered = cachedLiquidations;

        if (searchVal) {
            filtered = cachedLiquidations.filter(liq =>
                (liq.symbol || '').toUpperCase().includes(searchVal)
            );
        }

        const getThresholdForLiq = (liq) => {
            let currentThreshold = lastEffectiveThreshold;
            if (lastUseDynamic) {
                const symUpper = (liq.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                for (const base of lastBases) {
                    if (symUpper.startsWith(base)) {
                        const dynVal = globalDynamicThresholds[base];
                        if (lastReplaceBelowMin && dynVal < lastEffectiveThreshold) {
                            currentThreshold = lastEffectiveThreshold;
                        } else {
                            currentThreshold = dynVal;
                        }
                        break;
                    }
                }
            }
            return currentThreshold;
        };

        if (filtered.length === 0) {
            tbodyLiquidations.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching liquidations found for "${searchVal}" &mdash;` : '&mdash; No liquidations tracked yet &mdash;'}</td></tr>`;
        } else {
            tbodyLiquidations.innerHTML = filtered.map(liq => {
                const sideStr = (liq.side || '').toLowerCase();
                const isBuy = sideStr === 'buy' || sideStr === 'long';
                const sideClz = isBuy ? 'side-buy' : 'side-sell';
                const timeStr = new Date(liq.timestamp).toLocaleTimeString();

                const liqValue = parseFloat(liq.value || 0);
                const currentThreshold = getThresholdForLiq(liq);
                const isHighValue = liqValue >= currentThreshold;
                const highlightClass = isHighValue ? (isBuy ? 'liq-highlight-buy' : 'liq-highlight-sell') : '';

                return `<tr class="${highlightClass}">
                    <td style="color: var(--text-muted);">${timeStr}</td>
                    <td style="text-transform: capitalize;">${liq.exchange}</td>
                    <td><strong>${liq.symbol}</strong></td>
                    <td><span class="${sideClz}">${(liq.side || 'unknown').toUpperCase()}</span></td>
                    <td>${parseFloat(liq.price || 0).toFixed(4)}</td>
                    <td>${liq.amount}</td>
                    <td>${formatSelectedCurrency(liq.value)}</td>
                </tr>`;
            }).join('');
        }
    }

    function fetchLiquidations() {
        const liqPageActive = document.getElementById('liquidations-page').classList.contains('active');
        const dashPageActive = document.getElementById('dashboard').classList.contains('active');
        if (!liqPageActive && !dashPageActive) return;

        fetch('/api/liquidations')
            .then(res => res.json())
            .then(data => {
                cachedLiquidations = data || [];

                const thresholdInput = document.getElementById('LIQUIDATION_VALUE_THRESHOLD');
                const currencyInput = document.getElementById('LIQUIDATION_VALUE_CURRENCY');
                const dynamicCb = document.getElementById('ENABLE_DYNAMIC_THRESHOLDS');
                lastUseDynamic = dynamicCb ? dynamicCb.checked : false;
                const replaceBelowMinCb = document.getElementById('REPLACE_BELOW_MIN_THRESHOLD');
                lastReplaceBelowMin = replaceBelowMinCb ? replaceBelowMinCb.checked : false;

                const threshold = parseFloat(thresholdInput ? thresholdInput.value : 0) || 0;
                const currency = currencyInput ? currencyInput.value : 'USD';

                lastEffectiveThreshold = threshold;
                if (currency === 'BTC' && currentBtcPrice > 0) {
                    lastEffectiveThreshold = threshold * currentBtcPrice;
                }

                lastBases = Object.keys(globalDynamicThresholds).sort((a, b) => b.length - a.length);

                const getThresholdForLiq = (liq) => {
                    let currentThreshold = lastEffectiveThreshold;
                    if (lastUseDynamic) {
                        const symUpper = (liq.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                        for (const base of lastBases) {
                            if (symUpper.startsWith(base)) {
                                const dynVal = globalDynamicThresholds[base];
                                if (lastReplaceBelowMin && dynVal < lastEffectiveThreshold) {
                                    currentThreshold = lastEffectiveThreshold;
                                } else {
                                    currentThreshold = dynVal;
                                }
                                break;
                            }
                        }
                    }
                    return currentThreshold;
                };

                // Render page content
                renderLiquidations();

                // Render dashboard high value stream
                if (tbodyDashboardLiquidations && dashPageActive) {
                    const highValueLiqs = cachedLiquidations.filter(liq => parseFloat(liq.value || 0) >= getThresholdForLiq(liq)).slice(0, 10);
                    if (highValueLiqs.length === 0) {
                        tbodyDashboardLiquidations.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">&mdash; No recent high value liquidations &mdash;</td></tr>';
                    } else {
                        tbodyDashboardLiquidations.innerHTML = highValueLiqs.map(liq => {
                            const sideStr = (liq.side || '').toLowerCase();
                            const isBuy = sideStr === 'buy' || sideStr === 'long';
                            const sideClz = isBuy ? 'side-buy' : 'side-sell';
                            const timeStr = new Date(liq.timestamp).toLocaleTimeString();
                            const highlightClass = isBuy ? 'liq-highlight-buy' : 'liq-highlight-sell';
                            return `<tr class="${highlightClass}">
                                <td style="color: var(--text-muted);">${timeStr}</td>
                                <td style="text-transform: capitalize;">${liq.exchange}</td>
                                <td><strong>${liq.symbol}</strong></td>
                                <td><span class="${sideClz}">${(liq.side || 'unknown').toUpperCase()}</span></td>
                                <td>${parseFloat(liq.price || 0).toFixed(4)}</td>
                                <td>${liq.amount}</td>
                                <td>${formatSelectedCurrency(liq.value)}</td>
                            </tr>`;
                        }).join('');
                    }
                }
            }).catch(console.error);
    }

    setInterval(fetchLiquidations, 1500); // slightly faster polling for live feeling
    fetchLiquidations();

    // Closed PnL Live Stream
    const tbodyClosedPnl = document.getElementById('closed-pnl-tbody');

    function renderClosedPnlsTable() {
        if (!tbodyClosedPnl) return;

        const searchVal = (document.getElementById('closed-pnl-search')?.value || '').trim().toUpperCase();
        let filtered = cachedClosedPnls;

        if (searchVal) {
            filtered = cachedClosedPnls.filter(record =>
                (record.symbol || '').toUpperCase().includes(searchVal)
            );
        }

        if (filtered.length === 0) {
            tbodyClosedPnl.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching records found for "${searchVal}" &mdash;` : '&mdash; No closed PnL records found &mdash;'}</td></tr>`;
        } else {
            tbodyClosedPnl.innerHTML = filtered.map(record => {
                const timeStr = new Date(record.timestamp).toLocaleString();
                const sideClz = record.side === 'BUY' ? 'side-buy' : (record.side === 'SELL' ? 'side-sell' : '');
                const entryStr = record.entry_price ? parseFloat(record.entry_price).toFixed(4) : 'N/A';
                const closeStr = record.close_price ? parseFloat(record.close_price).toFixed(4) : 'N/A';
                const sizeStr = record.size ? record.size : 'N/A';

                return `<tr>
                    <td style="color: var(--text-muted);">${timeStr}</td>
                    <td><strong>${record.symbol}</strong></td>
                    <td><span class="${sideClz}">${record.side}</span></td>
                    <td>${sizeStr}</td>
                    <td>${entryStr}</td>
                    <td>${closeStr}</td>
                    <td>${formatPnl(record.pnl)}</td>
                </tr>`;
            }).join('');
        }
    }

    function fetchClosedPnlsTable() {
        const pageActive = document.getElementById('closed-pnl-page') && document.getElementById('closed-pnl-page').classList.contains('active');
        if (!pageActive) return;

        fetch('/api/closed-pnl')
            .then(res => res.json())
            .then(data => {
                cachedClosedPnls = data || [];
                renderClosedPnlsTable();
            }).catch(console.error);
    }

    setInterval(fetchClosedPnlsTable, 5000);
    fetchClosedPnlsTable();

    // Dynamic Thresholds Live Stream
    const tbodyDynamicThresholds = document.getElementById('dynamic-thresholds-tbody');
    let globalDynamicThresholds = {};

    function renderDynamicThresholdTable() {
        if (!tbodyDynamicThresholds) return;

        const searchVal = (document.getElementById('dynamic-thresholds-search')?.value || '').trim().toUpperCase();
        let filtered = cachedDynamicThresholds;

        if (searchVal) {
            filtered = cachedDynamicThresholds.filter(item =>
                (item.symbol || '').toUpperCase().includes(searchVal)
            );
        }

        if (filtered.length === 0) {
            tbodyDynamicThresholds.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching dynamic thresholds found for "${searchVal}" &mdash;` : '&mdash; Bot is stopped or no pairs loaded &mdash;'}</td></tr>`;
        } else {
            tbodyDynamicThresholds.innerHTML = filtered.map(item => {
                const isDynamic = item.status === 'Dynamic (API)';
                const statusColor = isDynamic ? 'var(--accent)' : 'var(--text-muted)';
                return `<tr>
                    <td><strong>${item.symbol}</strong></td>
                    <td>${formatSelectedCurrency(item.threshold)}</td>
                    <td><span style="color: ${statusColor}">${item.status}</span></td>
                </tr>`;
            }).join('');
        }
    }

    function fetchDynamicThresholdTable() {
        const pageActive = document.getElementById('dynamic-thresholds-page').classList.contains('active');

        fetch('/api/dynamic-thresholds')
            .then(res => res.json())
            .then(data => {
                const mapped = data.mapped || [];
                globalDynamicThresholds = data.rawMap || {};
                cachedDynamicThresholds = mapped;

                if (pageActive) {
                    renderDynamicThresholdTable();
                }
            }).catch(console.error);
    }

    setInterval(fetchDynamicThresholdTable, 5000);
    fetchDynamicThresholdTable();

    // Trade Decisions Live Stream
    const tbodyTradeDecisions = document.getElementById('trade-decisions-tbody');
    const tbodyDashboardTradeDecisions = document.getElementById('dashboard-trade-decisions-tbody');

    const formatStrategy = (strat, name) => {
        // Disabled State
        if (!strat) {
            return `<div class="strategy-badge-container">
                <span class="strategy-signal side-none" style="font-weight: bold; opacity: 0.5;">DISABLED</span>
            </div>`;
        }

        // Error State
        if (strat.error) {
            return `<div class="strategy-badge-container">
                <span class="strategy-signal side-sell" style="font-weight: bold;">ERROR</span>
                <div class="strategy-tooltip error-tooltip">
                    <div class="tooltip-header text-danger" style="color: var(--danger)">Strategy Error</div>
                    <div class="tooltip-desc">${strat.error}</div>
                </div>
            </div>`;
        }

        const signal = strat.signal ? strat.signal.toUpperCase() : 'NONE';
        const signalClz = strat.signal === 'buy' ? 'side-buy' : (strat.signal === 'sell' ? 'side-sell' : 'side-none');
        const activeSignalClz = strat.signal === 'buy' ? 'signal-buy' : (strat.signal === 'sell' ? 'signal-sell' : '');

        let tooltipHTML = '';
        if (name === 'VWAP') {
            const valStr = formatTokenPrice(strat.value);
            const upperStr = formatTokenPrice(strat.upper);
            const lowerStr = formatTokenPrice(strat.lower);
            const typeStr = strat.type ? (strat.type.charAt(0).toUpperCase() + strat.type.slice(1)) : 'Rolling';
            const tfStr = strat.timeframe || 'N/A';

            tooltipHTML = `
                <div class="tooltip-header">VWAP Strategy</div>
                <div class="tooltip-grid">
                    <div class="tooltip-row"><span>Type</span><span>${typeStr}</span></div>
                    <div class="tooltip-row"><span>Timeframe</span><span>${tfStr}</span></div>
                    <div class="tooltip-row"><span>Value</span><span>${valStr}</span></div>
                    <div class="tooltip-row"><span>Upper Band</span><span>${upperStr}</span></div>
                    <div class="tooltip-row"><span>Lower Band</span><span>${lowerStr}</span></div>
                    <div class="tooltip-row"><span>Signal</span><span class="${activeSignalClz}">${signal}</span></div>
                </div>
            `;
        } else if (name === 'RSI') {
            const valStr = typeof strat.value === 'number' ? strat.value.toFixed(2) : 'N/A';
            const obStr = strat.overbought !== undefined ? strat.overbought : 'N/A';
            const osStr = strat.oversold !== undefined ? strat.oversold : 'N/A';
            const tfStr = strat.timeframe || 'N/A';

            tooltipHTML = `
                <div class="tooltip-header">RSI Strategy</div>
                <div class="tooltip-grid">
                    <div class="tooltip-row"><span>Timeframe</span><span>${tfStr}</span></div>
                    <div class="tooltip-row"><span>Value</span><span>${valStr}</span></div>
                    <div class="tooltip-row"><span>Overbought</span><span>${obStr}</span></div>
                    <div class="tooltip-row"><span>Oversold</span><span>${osStr}</span></div>
                    <div class="tooltip-row"><span>Signal</span><span class="${activeSignalClz}">${signal}</span></div>
                </div>
            `;
        } else if (name === 'ADX') {
            const valStr = typeof strat.value === 'number' ? strat.value.toFixed(2) : 'N/A';
            const pDiStr = typeof strat.plusDI === 'number' ? strat.plusDI.toFixed(2) : 'N/A';
            const mDiStr = typeof strat.minusDI === 'number' ? strat.minusDI.toFixed(2) : 'N/A';
            const thresholdStr = strat.threshold !== undefined ? strat.threshold : 'N/A';
            const tfStr = strat.timeframe || 'N/A';

            tooltipHTML = `
                <div class="tooltip-header">ADX Strategy</div>
                <div class="tooltip-grid">
                    <div class="tooltip-row"><span>Timeframe</span><span>${tfStr}</span></div>
                    <div class="tooltip-row"><span>Value</span><span>${valStr}</span></div>
                    <div class="tooltip-row"><span>+DI</span><span>${pDiStr}</span></div>
                    <div class="tooltip-row"><span>-DI</span><span>${mDiStr}</span></div>
                    <div class="tooltip-row"><span>Threshold</span><span>${thresholdStr}</span></div>
                    <div class="tooltip-row"><span>Signal</span><span class="${activeSignalClz}">${signal}</span></div>
                </div>
            `;
        } else if (name === 'M.Sentiment') {
            let stateStr = 'N/A';
            if (strat.classification) {
                stateStr = strat.classification;
            } else if (strat.marketLabel && strat.fgClassification) {
                stateStr = `${strat.marketLabel} + ${strat.fgClassification}`;
            }

            tooltipHTML = `
                <div class="tooltip-header">Market Sentiment</div>
                <div class="tooltip-grid">
                    <div class="tooltip-row"><span>State</span><span>${stateStr}</span></div>
                    <div class="tooltip-row"><span>Signal</span><span class="${activeSignalClz}">${signal}</span></div>
                </div>
            `;
        }

        return `<div class="strategy-badge-container">
            <span class="strategy-signal ${signalClz}" style="font-weight: bold;">${signal}</span>
            <div class="strategy-tooltip">
                ${tooltipHTML}
            </div>
        </div>`;
    };

    const renderTradeDecisionRow = (record) => {
        const timeStr = new Date(record.timestamp).toLocaleTimeString();
        const confluenceText = record.confluence ? (record.confluence.matched ? `<span class="side-${record.confluence.side}">${record.confluence.side.toUpperCase()}</span>` : `<span style="color: var(--danger)">MISSED</span>`) : 'N/A';
        const outcomeClz = record.reason === 'Trade Executed' ? 'pnl-positive' : (record.reason.startsWith('Error') ? 'pnl-negative' : '');

        const priceFormatted = formatTokenPrice(record.price);

        return `<tr>
            <td style="color: var(--text-muted);">${timeStr}</td>
            <td><strong>${record.symbol}</strong></td>
            <td>${priceFormatted}</td>
            <td>${formatStrategy(record.vwap, 'VWAP')}</td>
            <td>${formatStrategy(record.rsi, 'RSI')}</td>
            <td>${formatStrategy(record.adx, 'ADX')}</td>
            <td>${formatStrategy(record.marketSentiment, 'M.Sentiment')}</td>
            <td>${confluenceText}</td>
            <td><span class="${outcomeClz}">${record.reason}</span></td>
        </tr>`;
    };

    function renderTradeDecisions() {
        if (!tbodyTradeDecisions) return;

        const searchVal = (document.getElementById('trade-decisions-search')?.value || '').trim().toUpperCase();
        let filtered = cachedTradeDecisions;

        if (searchVal) {
            filtered = cachedTradeDecisions.filter(record =>
                (record.symbol || '').toUpperCase().includes(searchVal)
            );
        }

        if (filtered.length === 0) {
            tbodyTradeDecisions.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching trade evaluations found for "${searchVal}" &mdash;` : '&mdash; No trade evaluations tracked yet &mdash;'}</td></tr>`;
        } else {
            tbodyTradeDecisions.innerHTML = filtered.map(renderTradeDecisionRow).join('');
        }
    }

    function fetchTradeDecisions() {
        const pageActive = document.getElementById('trade-decisions-page').classList.contains('active');
        const dashPageActive = document.getElementById('dashboard').classList.contains('active');
        if (!pageActive && !dashPageActive) return;

        fetch('/api/trade-decisions')
            .then(res => res.json())
            .then(data => {
                cachedTradeDecisions = data || [];

                if (pageActive) {
                    renderTradeDecisions();
                }

                if (tbodyDashboardTradeDecisions && dashPageActive) {
                    const confluenceOnly = cachedTradeDecisions.filter(record => record.confluence && record.confluence.matched).slice(0, 10);
                    if (confluenceOnly.length === 0) {
                        tbodyDashboardTradeDecisions.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">&mdash; No recent confluence matched &mdash;</td></tr>';
                    } else {
                        tbodyDashboardTradeDecisions.innerHTML = confluenceOnly.map(renderTradeDecisionRow).join('');
                    }
                }
            }).catch(console.error);
    }

    setInterval(fetchTradeDecisions, 2000);
    fetchTradeDecisions();

    // ── Browser Notification System ────────────────────────────
    const browserNotifyCb = document.getElementById('BROWSER_NOTIFICATIONS_ENABLED');
    const btnRequestNotify = document.getElementById('btn-request-notifications');
    const notifyStatus = document.getElementById('notification-status');

    function updateNotificationUI() {
        if (!('Notification' in window)) {
            if (notifyStatus) notifyStatus.textContent = '(Not supported by browser)';
            if (browserNotifyCb) browserNotifyCb.disabled = true;
            return;
        }

        const permission = Notification.permission;
        if (permission === 'granted') {
            if (btnRequestNotify) btnRequestNotify.style.display = 'none';
            if (notifyStatus) notifyStatus.textContent = '(Authorized)';
        } else if (permission === 'denied') {
            if (btnRequestNotify) btnRequestNotify.style.display = 'none';
            if (notifyStatus) notifyStatus.textContent = '(Blocked by browser)';
            if (browserNotifyCb) browserNotifyCb.disabled = true;
        } else {
            if (btnRequestNotify) btnRequestNotify.style.display = 'inline-block';
            if (notifyStatus) notifyStatus.textContent = '(Requires Authorization)';
        }
    }

    if (browserNotifyCb) {
        browserNotifyCb.checked = localStorage.getItem('enableBrowserNotifications') === 'true';
        browserNotifyCb.addEventListener('change', () => {
            localStorage.setItem('enableBrowserNotifications', browserNotifyCb.checked);
            if (browserNotifyCb.checked && Notification.permission === 'default') {
                requestNotificationPermission();
            }
        });
    }

    if (btnRequestNotify) {
        btnRequestNotify.addEventListener('click', requestNotificationPermission);
    }

    function requestNotificationPermission() {
        if (!('Notification' in window)) return;
        Notification.requestPermission().then(() => {
            updateNotificationUI();
        });
    }

    function sendBrowserNotification(title, message) {
        const enabled = localStorage.getItem('enableBrowserNotifications') === 'true';
        if (!enabled || !('Notification' in window) || Notification.permission !== 'granted') return;

        try {
            // Strip HTML from message if any
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = message;
            const plainText = tempDiv.textContent || tempDiv.innerText || '';

            new Notification(title, {
                body: plainText,
                icon: '/favicon.ico' // Or any suitable icon
            });
        } catch (e) {
            console.error('Failed to send browser notification:', e);
        }
    }

    updateNotificationUI();

    // ── Toast Notification System ───────────────────────────────
    const toastContainer = document.getElementById('toast-container');

    function showToast(options = {}) {
        const { title, message, type = 'info', duration = 6000, html = '' } = options;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        toast.innerHTML = `
            <div class="toast-header">
                <div class="toast-title">${title}</div>
                <button class="toast-close" title="Dismiss">✕</button>
            </div>
            ${message ? `<div class="toast-message">${message}</div>` : ''}
            ${html}
            <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
        `;

        toastContainer.appendChild(toast);

        // Also trigger browser notification if enabled
        if (message) {
            sendBrowserNotification(title, message);
        }

        toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));

        const timer = setTimeout(() => dismissToast(toast), duration);
        toast._dismissTimer = timer;

        return toast;
    }

    function dismissToast(toast) {
        clearTimeout(toast._dismissTimer);
        toast.classList.add('toast-hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    function showOrderToast(order) {
        const price = parseFloat(order.price || 0);
        const amount = parseFloat(order.amount || 0);
        const value = parseFloat(order.value || price * amount);
        const timeStr = new Date(order.timestamp).toLocaleTimeString();
        const shortId = order.id ? String(order.id).slice(-8) : 'N/A';

        let sideLabel, type, extraRows = '';

        if (order.isClose || order.type === 'CLOSE') {
            sideLabel = 'Position Closed';
            type = 'info'; // Use info toast style

            if (order.realizedPnl !== undefined && order.realizedPnl !== null) {
                const pnl = parseFloat(order.realizedPnl);
                const pnlColor = pnl >= 0 ? 'var(--positive)' : 'var(--danger)';
                const pnlSign = pnl >= 0 ? '+' : '';
                extraRows = `<div class="toast-detail-row"><span>Realized PnL</span><span style="color: ${pnlColor}; font-weight: bold;">${pnlSign}${formatSelectedCurrency(pnl)}</span></div>`;
            }
        } else {
            const isSell = order.side === 'SELL';
            sideLabel = isSell ? 'SHORT Executed' : 'LONG Executed';
            type = isSell ? 'sell' : 'success';
        }

        const html = `
            <div class="toast-symbol">${order.symbol}</div>
            <div class="toast-details">
                <div class="toast-detail-row"><span>Type</span><span>${order.type || 'MARKET'}</span></div>
                <div class="toast-detail-row"><span>Side</span><span>${order.side}</span></div>
                <div class="toast-detail-row"><span>Price</span><span>${formatSelectedCurrency(price)}</span></div>
                <div class="toast-detail-row"><span>Amount</span><span>${amount}</span></div>
                ${!order.isClose && order.type !== 'CLOSE' ? `<div class="toast-detail-row"><span>Leverage</span><span>${order.leverage}×</span></div>` : ''}
                <div class="toast-detail-row"><span>Value</span><span>${formatSelectedCurrency(value)}</span></div>
                ${extraRows}
            </div>
            <div class="toast-time">Order ID: …${shortId} · ${timeStr}</div>
        `;

        showToast({
            title: sideLabel,
            type: type,
            html: html
        });

        // Trigger detailed browser notification for orders
        const detailText = `${order.symbol} | ${order.side} ${order.type} | Price: ${formatSelectedCurrency(price)} | Amount: ${amount}`;
        sendBrowserNotification(sideLabel, detailText);
    }

    function fetchOrderNotifications() {
        fetch('/api/orders/recent')
            .then(res => res.json())
            .then(orders => {
                orders.forEach(order => showOrderToast(order));
            })
            .catch(() => { }); // Silently fail if bot is offline
    }

    setInterval(fetchOrderNotifications, 3000);
    fetchOrderNotifications();

    // ── Authentication Status ────────────────────────────────────
    function checkAuthStatus() {
        fetch('/api/auth/status')
            .then(res => res.json())
            .then(data => {
                const btnLogout = document.getElementById('btn-logout');
                if (data.enabled && data.authenticated) {
                    if (btnLogout) btnLogout.style.display = 'flex';
                } else {
                    if (btnLogout) btnLogout.style.display = 'none';
                }
            })
            .catch(console.error);
    }
    checkAuthStatus();

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            fetch('/api/auth/logout', { method: 'POST' })
                .then(() => {
                    window.location.href = '/login.html';
                })
                .catch(console.error);
        });
    }

    // ── PnL Chart ────────────────────────────────────────────────
    let pnlChart = null;

    function initPnlChart() {
        const ctx = document.getElementById('pnl-chart');
        if (!ctx) return;

        pnlChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: `Daily PnL (${currencySymbols[localStorage.getItem('selectedCurrency') || 'USD'] || '$'})`,
                    data: [],
                    backgroundColor: [],
                    borderRadius: 4,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(255, 255, 255, 0.05)'
                        },
                        ticks: {
                            color: '#949bab'
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: '#949bab'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#14171f',
                        titleColor: '#f0f2f5',
                        bodyColor: '#f0f2f5',
                        borderColor: '#2b303d',
                        borderWidth: 1,
                        displayColors: false,
                        callbacks: {
                            label: function (context) {
                                const val = context.raw;
                                const cur = localStorage.getItem('selectedCurrency') || 'USD';
                                const symbol = currencySymbols[cur] || '$';
                                const formattedVal = cur === 'BTC' ? val.toFixed(6) : (cur === 'JPY' ? Math.round(val).toLocaleString() : val.toFixed(2));
                                return (val >= 0 ? '+' : '') + symbol + formattedVal;
                            }
                        }
                    }
                }
            }
        });
    }

    function fetchPnLHistory() {
        if (!pnlChart) return;
        const pageActive = document.getElementById('account').classList.contains('active');
        if (!pageActive) return;

        fetch('/api/pnl/daily-history?days=30')
            .then(res => res.json())
            .then(data => {
                const cur = localStorage.getItem('selectedCurrency') || 'USD';
                const symbol = currencySymbols[cur] || '$';
                const labels = data.map(d => d.date.split('-').slice(1).join('/')); // MM/DD
                const values = data.map(d => convertFromUsd(d.daily_pnl));
                const colors = values.map(v => v >= 0 ? '#00e676' : '#ff3b3b'); // Accent or Danger

                pnlChart.data.labels = labels;
                pnlChart.data.datasets[0].label = `Daily PnL (${symbol})`;
                pnlChart.data.datasets[0].data = values;
                pnlChart.data.datasets[0].backgroundColor = colors;
                pnlChart.update();
            })
            .catch(console.error);
    }

    initPnlChart();
    setInterval(fetchPnLHistory, 5000);
    fetchPnLHistory();

    // ── Currency Switcher Selector Listener ───────────────────
    const currencySelect = document.getElementById('currency-select');
    if (currencySelect) {
        // Load initial currency selection from local storage
        currencySelect.value = localStorage.getItem('selectedCurrency') || 'USD';
        
        currencySelect.addEventListener('change', (e) => {
            localStorage.setItem('selectedCurrency', e.target.value);
            console.log('Active currency updated to:', e.target.value);
            updateBtcRateAndReRender();
        });
    }

    // ── Search Input Listeners ─────────────────────────────────
    const searchBindings = [
        { id: 'liquidations-search', render: renderLiquidations },
        { id: 'closed-pnl-search', render: renderClosedPnlsTable },
        { id: 'dynamic-thresholds-search', render: renderDynamicThresholdTable },
        { id: 'trade-decisions-search', render: renderTradeDecisions }
    ];

    searchBindings.forEach(binding => {
        const inputEl = document.getElementById(binding.id);
        if (inputEl) {
            inputEl.addEventListener('input', binding.render);
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    inputEl.value = '';
                    binding.render();
                }
            });
        }
    });

    // ── Import / Export Settings ─────────────────────────────────
    const btnExport = document.getElementById('btn-export');
    const btnImport = document.getElementById('btn-import');
    const importFileInput = document.getElementById('import-file-input');

    if (btnExport) {
        btnExport.addEventListener('click', () => {
            fetch('/api/config/export')
                .then(res => res.blob())
                .then(blob => {
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = 'liquidation-trader-settings.json';
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                })
                .catch(err => {
                    console.error('Export failed:', err);
                    showToast({
                        title: 'Export Failed',
                        message: 'Could not export settings. Check console for details.',
                        type: 'error'
                    });
                });
        });
    }

    if (btnImport && importFileInput) {
        btnImport.addEventListener('click', () => {
            importFileInput.click();
        });

        importFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const importedConfig = JSON.parse(evt.target.result);
                    
                    const excludedKeys = [
                        'API_KEY', 'API_SECRET', 'WEBUI_USERNAME', 'WEBUI_PASSWORD', 
                        'RAPIDAPI_KEY', 'CMC_API_KEY', 'WEBUI_AUTH_ENABLED', 
                        'LOG_LEVEL', 'WEB_PORT', 'WEB_HOST'
                    ];
                    for (const key of excludedKeys) {
                        delete importedConfig[key];
                    }
                    
                    fetch('/api/config', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(importedConfig)
                    })
                        .then(res => res.json())
                        .then(result => {
                            showToast({
                                title: 'Settings Imported',
                                message: result.success ? 'Configuration imported successfully. Restart the engine if it is currently running.' : result.message,
                                type: result.success ? 'success' : 'error'
                            });
                            if (result.success) {
                                loadConfig(); // Reload UI settings
                            }
                        });
                } catch (err) {
                    console.error('Import parse error:', err);
                    showToast({
                        title: 'Import Failed',
                        message: 'Invalid JSON file format.',
                        type: 'error'
                    });
                } finally {
                    importFileInput.value = ''; // Reset file input
                }
            };
            reader.readAsText(file);
        });
    }

    // ── Settings Section Tab Switching Logic & Scroll Enhancements ──
    const settingsTabBtns = document.querySelectorAll('.settings-tab-btn');
    const settingsTabContents = document.querySelectorAll('.settings-tab-content');
    const tabsContainer = document.querySelector('.settings-tabs');

    if (settingsTabBtns.length > 0 && tabsContainer) {
        let isDragging = false;
        let dragThreshold = 6; // pixels to distinguish click vs drag
        let startDragX = 0;

        tabsContainer.addEventListener('mousedown', (e) => {
            startDragX = e.pageX;
            isDragging = false;
        });

        tabsContainer.addEventListener('mousemove', (e) => {
            if (Math.abs(e.pageX - startDragX) > dragThreshold) {
                isDragging = true;
            }
        });

        settingsTabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (isDragging) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                settingsTabBtns.forEach(b => b.classList.remove('active'));
                settingsTabContents.forEach(c => c.classList.remove('active'));

                btn.classList.add('active');
                const tabTarget = btn.dataset.settingsTab;
                const contentEl = document.getElementById(`settings-tab-${tabTarget}`);
                if (contentEl) {
                    contentEl.classList.add('active');
                }
            });
        });

        // 1. Mouse wheel horizontal scrolling translation
        tabsContainer.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tabsContainer.scrollLeft += e.deltaY * 0.85; // scroll multiplier
            }
        }, { passive: false });

        // 2. Click-and-drag swipe scrolling on desktop
        let isDown = false;
        let startX;
        let scrollLeft;

        tabsContainer.addEventListener('mousedown', (e) => {
            isDown = true;
            tabsContainer.classList.add('dragging');
            startX = e.pageX - tabsContainer.offsetLeft;
            scrollLeft = tabsContainer.scrollLeft;
        });

        tabsContainer.addEventListener('mouseleave', () => {
            isDown = false;
            tabsContainer.classList.remove('dragging');
        });

        tabsContainer.addEventListener('mouseup', () => {
            isDown = false;
            tabsContainer.classList.remove('dragging');
        });

        tabsContainer.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - tabsContainer.offsetLeft;
            const walk = (x - startX) * 1.6; // multiplier for fluid sensitivity
            tabsContainer.scrollLeft = scrollLeft - walk;
        });
    }

    // ── Advance Strategy Modal Logic ──
    const btnOpenAdvanceModal = document.getElementById('openAdvanceStrategyModal');
    const advanceModal = document.getElementById('advanceStrategyModal');
    const btnCloseAdvanceModal = document.getElementById('closeAdvanceModalBtn');
    const btnSaveAdvanceModal = document.getElementById('saveAdvanceModalBtn');

    if (btnOpenAdvanceModal && advanceModal) {
        btnOpenAdvanceModal.addEventListener('click', (e) => {
            e.preventDefault();
            advanceModal.style.display = 'flex';
        });

        const closeModal = () => {
            advanceModal.style.display = 'none';
        };

        if (btnCloseAdvanceModal) btnCloseAdvanceModal.addEventListener('click', closeModal);
        if (btnSaveAdvanceModal) {
            btnSaveAdvanceModal.addEventListener('click', () => {
                closeModal();
                showToast({
                    title: 'Settings Applied Locally',
                    message: 'Advance strategies applied locally. Save Configuration to commit changes.',
                    type: 'info'
                });
            });
        }

        const btnResetAdvanceModal = document.getElementById('resetAdvanceModalBtn');
        if (btnResetAdvanceModal) {
            btnResetAdvanceModal.addEventListener('click', () => {
                const defaults = {
                    VWAP_UPPER_SIGNAL: 'sell',
                    VWAP_LOWER_SIGNAL: 'buy',
                    RSI_OVERBOUGHT_DIR: 'above',
                    RSI_OVERSOLD_DIR: 'under',
                    RSI_OVERBOUGHT_SIGNAL: 'sell',
                    RSI_OVERSOLD_SIGNAL: 'buy',
                    ADX_THRESHOLD_DIR: 'under',
                    ADX_PDI_SIGNAL: 'sell',
                    ADX_MDI_SIGNAL: 'buy',
                    MS_BULLISH_SIGNAL: 'buy',
                    MS_BEARISH_SIGNAL: 'sell',
                    MS_EXTREME_FEAR_SIGNAL: 'none',
                    MS_EXTREME_GREED_SIGNAL: 'none'
                };
                for (const [id, value] of Object.entries(defaults)) {
                    const el = document.getElementById(id);
                    if (el) el.value = value;
                }
                showToast({
                    title: 'Reset to Default',
                    message: 'Advance strategies reset to default locally. Save Configuration to commit changes.',
                    type: 'info'
                });
            });
        }

        // Close on outside click
        advanceModal.addEventListener('click', (e) => {
            if (e.target === advanceModal) {
                closeModal();
            }
        });
    }

});


