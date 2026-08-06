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

    // ── Check for Updates ─────────────────────────────────────────
    function checkForUpdates() {
        fetch('/api/check-update')
            .then(res => res.json())
            .then(data => {
                if (data.updateAvailable) {
                    const notification = document.getElementById('update-notification');
                    if (notification) {
                        notification.style.display = 'flex';
                    }
                }
            })
            .catch(err => console.error('Failed to check for updates:', err));
    }

    const updateDismissBtn = document.getElementById('update-dismiss');
    if (updateDismissBtn) {
        updateDismissBtn.addEventListener('click', () => {
            const notification = document.getElementById('update-notification');
            if (notification) {
                notification.style.display = 'none';
            }
        });
    }

    checkForUpdates();
    // Also check once a day (every 24 hours) in case the page is left open
    setInterval(checkForUpdates, 24 * 60 * 60 * 1000);

    // Caching for real-time table search/filtering
    let cachedLiquidations = [];
    let cachedClosedPnls = [];
    let cachedDynamicThresholds = [];
    let cachedTradeDecisions = [];
    
    // Pagination states
    const ITEMS_PER_PAGE = 100;
    let currentLiquidationsPage = 1;
    let currentTradeDecisionsPage = 1;
    let currentClosedPnlsPage = 1;
    let currentDynamicThresholdsPage = 1;

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
    const sidebarConnWidget = document.getElementById('sidebar-conn-widget');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            if (sidebarConnWidget) sidebarConnWidget.classList.remove('active');

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
                fetchAccountData(true);
            } else if (targetId === 'account') {
                fetchAccountData(true);
                fetchPnLHistory(true);
                fetchWeeklyPnLHistory(true);
                fetchMonthlyPnLHistory(true);
            } else if (targetId === 'statistics-page') {
                fetch24HStatistics(true);
                fetchPageStatisticsData(true);
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

    // Sidebar Connection Widget Shortcut Click
    if (sidebarConnWidget) {
        sidebarConnWidget.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            pages.forEach(p => p.classList.remove('active'));
            sidebarConnWidget.classList.add('active');

            const pageEl = document.getElementById('connection-status-page');
            if (pageEl) pageEl.classList.add('active');

            fetchConnectionStatus();
        });
    }

    // Form Loading and Saving
    const form = document.getElementById('config-form');

    function loadConfig() {
        fetch('/api/config')
            .then(res => res.json())
            .then(data => {
                for (const key in data) {
                    if (['WEBUI_AUTH_ENABLED', 'CMC_FILTER_ENABLED', 'ENABLE_CIRCUIT_BREAKER', 'ENABLE_VWAP_STRATEGY', 'ENABLE_RSI_STRATEGY', 'ENABLE_DMI_STRATEGY', 'ENABLE_MARKET_SENTIMENT_STRATEGY', 'ENABLE_SNEAKY_PIVOT_STRATEGY', 'SNEAKY_PIVOT_ENABLE_PDR_HIGH', 'SNEAKY_PIVOT_ENABLE_PDR_LOW', 'SNEAKY_PIVOT_ENABLE_PDS_HIGH', 'SNEAKY_PIVOT_ENABLE_PDS_LOW', 'ENABLE_TRAILING_PROFIT', 'ENABLE_DCA_MARTINGALE', 'ENABLE_DYNAMIC_THRESHOLDS', 'ENABLE_RUNAWAY_HELPER', 'REPLACE_BELOW_MIN_THRESHOLD', 'ENABLE_AUTO_TRANSFER', 'ENABLE_ISOLATION_MODE', 'REDUCE_TP_TRAILING_BY_HALF_IN_ISOLATION', 'ENABLE_ANON_REPORTING', 'ENABLE_24H_VOLUME_FILTER', 'ENABLE_PAPER_TRADING'].includes(key)) {
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

                // Toggle DMI range field on load
                const dmiDirEl = document.getElementById('DMI_THRESHOLD_DIR');
                if (dmiDirEl) {
                    const dmiUpperCol = document.getElementById('dmi-upper-threshold-col');
                    if (dmiUpperCol) dmiUpperCol.style.display = dmiDirEl.value === 'range' ? 'block' : 'none';
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

                // Toggle Paper Trading row on load
                const paperEnableEl = document.getElementById('ENABLE_PAPER_TRADING');
                if (paperEnableEl) {
                    const row = document.getElementById('paperTradingBalanceRow');
                    if (row) row.style.display = paperEnableEl.checked ? 'flex' : 'none';
                }

                // Toggle CB fields on load
                const cbEnableEl = document.getElementById('ENABLE_CIRCUIT_BREAKER');
                if (cbEnableEl) {
                    const row = document.getElementById('cbSettingsRow');
                    if (row) row.style.display = cbEnableEl.checked ? 'block' : 'none';
                }

                const vwapEnableEl = document.getElementById('ENABLE_VWAP_STRATEGY');
                if (vwapEnableEl) {
                    const row = document.getElementById('vwapSettingsRow');
                    if (row) row.style.display = vwapEnableEl.checked ? 'block' : 'none';
                }

                const rsiEnableEl = document.getElementById('ENABLE_RSI_STRATEGY');
                if (rsiEnableEl) {
                    const row = document.getElementById('rsiSettingsRow');
                    if (row) row.style.display = rsiEnableEl.checked ? 'block' : 'none';
                }

                const dmiEnableEl = document.getElementById('ENABLE_DMI_STRATEGY');
                if (dmiEnableEl) {
                    const row = document.getElementById('dmiSettingsRow');
                    if (row) row.style.display = dmiEnableEl.checked ? 'block' : 'none';
                }

                const sneakyPivotEnableEl = document.getElementById('ENABLE_SNEAKY_PIVOT_STRATEGY');
                if (sneakyPivotEnableEl) {
                    const row = document.getElementById('sneakyPivotSettingsRow');
                    if (row) row.style.display = sneakyPivotEnableEl.checked ? 'block' : 'none';
                }

                // Update Trading Mode Badge
                const modeBadge = document.getElementById('trading-mode-badge');
                const btnResetPaper = document.getElementById('btn-reset-paper');
                if (modeBadge) {
                    const isPaper = data['ENABLE_PAPER_TRADING'] === true || data['ENABLE_PAPER_TRADING'] === 'true';
                    if (isPaper) {
                        modeBadge.textContent = 'PAPER';
                        modeBadge.className = 'mode-badge mode-paper';
                        if (btnResetPaper) btnResetPaper.style.display = 'inline-block';
                    } else {
                        modeBadge.textContent = 'LIVE';
                        modeBadge.className = 'mode-badge mode-live';
                        if (btnResetPaper) btnResetPaper.style.display = 'none';
                    }
                    modeBadge.style.display = 'inline-block';
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

    const cbEnableEl = document.getElementById('ENABLE_CIRCUIT_BREAKER');
    if (cbEnableEl) {
        cbEnableEl.addEventListener('change', (e) => {
            const row = document.getElementById('cbSettingsRow');
            if (row) row.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    const vwapEnableEl = document.getElementById('ENABLE_VWAP_STRATEGY');
    if (vwapEnableEl) {
        vwapEnableEl.addEventListener('change', (e) => {
            const row = document.getElementById('vwapSettingsRow');
            if (row) row.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    const rsiEnableEl = document.getElementById('ENABLE_RSI_STRATEGY');
    if (rsiEnableEl) {
        rsiEnableEl.addEventListener('change', (e) => {
            const row = document.getElementById('rsiSettingsRow');
            if (row) row.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    const dmiEnableEl = document.getElementById('ENABLE_DMI_STRATEGY');
    if (dmiEnableEl) {
        dmiEnableEl.addEventListener('change', (e) => {
            const row = document.getElementById('dmiSettingsRow');
            if (row) row.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    const sneakyPivotEnableEl = document.getElementById('ENABLE_SNEAKY_PIVOT_STRATEGY');
    if (sneakyPivotEnableEl) {
        sneakyPivotEnableEl.addEventListener('change', (e) => {
            const row = document.getElementById('sneakyPivotSettingsRow');
            if (row) row.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    const paperTradingCb = document.getElementById('ENABLE_PAPER_TRADING');
    if (paperTradingCb) {
        paperTradingCb.addEventListener('change', (e) => {
            const row = document.getElementById('paperTradingBalanceRow');
            if (row) row.style.display = e.target.checked ? 'flex' : 'none';
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

        const cbCb = document.getElementById('ENABLE_CIRCUIT_BREAKER');
        if (cbCb) formData.set('ENABLE_CIRCUIT_BREAKER', cbCb.checked ? 'true' : 'false');

        const vwapCb = document.getElementById('ENABLE_VWAP_STRATEGY');
        if (vwapCb) formData.set('ENABLE_VWAP_STRATEGY', vwapCb.checked ? 'true' : 'false');

        const volumeFilterCb = document.getElementById('ENABLE_24H_VOLUME_FILTER');
        if (volumeFilterCb) formData.set('ENABLE_24H_VOLUME_FILTER', volumeFilterCb.checked ? 'true' : 'false');

        const rsiCb = document.getElementById('ENABLE_RSI_STRATEGY');
        if (rsiCb) formData.set('ENABLE_RSI_STRATEGY', rsiCb.checked ? 'true' : 'false');

        const trailingCb = document.getElementById('ENABLE_TRAILING_PROFIT');
        if (trailingCb) formData.set('ENABLE_TRAILING_PROFIT', trailingCb.checked ? 'true' : 'false');

        const dcaCb = document.getElementById('ENABLE_DCA_MARTINGALE');
        if (dcaCb) formData.set('ENABLE_DCA_MARTINGALE', dcaCb.checked ? 'true' : 'false');

        const isolationCb = document.getElementById('ENABLE_ISOLATION_MODE');
        if (isolationCb) formData.set('ENABLE_ISOLATION_MODE', isolationCb.checked ? 'true' : 'false');

        const reduceTpTrailingIsolationCb = document.getElementById('REDUCE_TP_TRAILING_BY_HALF_IN_ISOLATION');
        if (reduceTpTrailingIsolationCb) formData.set('REDUCE_TP_TRAILING_BY_HALF_IN_ISOLATION', reduceTpTrailingIsolationCb.checked ? 'true' : 'false');

        const dynamicCb = document.getElementById('ENABLE_DYNAMIC_THRESHOLDS');
        if (dynamicCb) formData.set('ENABLE_DYNAMIC_THRESHOLDS', dynamicCb.checked ? 'true' : 'false');

        const replaceBelowMinCb = document.getElementById('REPLACE_BELOW_MIN_THRESHOLD');
        if (replaceBelowMinCb) formData.set('REPLACE_BELOW_MIN_THRESHOLD', replaceBelowMinCb.checked ? 'true' : 'false');

        const runawayCb = document.getElementById('ENABLE_RUNAWAY_HELPER');
        if (runawayCb) formData.set('ENABLE_RUNAWAY_HELPER', runawayCb.checked ? 'true' : 'false');

        const autoTransferCb = document.getElementById('ENABLE_AUTO_TRANSFER');
        if (autoTransferCb) formData.set('ENABLE_AUTO_TRANSFER', autoTransferCb.checked ? 'true' : 'false');

        const dmiCb = document.getElementById('ENABLE_DMI_STRATEGY');
        if (dmiCb) formData.set('ENABLE_DMI_STRATEGY', dmiCb.checked ? 'true' : 'false');

        const fgCb = document.getElementById('ENABLE_MARKET_SENTIMENT_STRATEGY');
        if (fgCb) formData.set('ENABLE_MARKET_SENTIMENT_STRATEGY', fgCb.checked ? 'true' : 'false');

        const spCb = document.getElementById('ENABLE_SNEAKY_PIVOT_STRATEGY');
        if (spCb) formData.set('ENABLE_SNEAKY_PIVOT_STRATEGY', spCb.checked ? 'true' : 'false');

        const spPdrHighCb = document.getElementById('SNEAKY_PIVOT_ENABLE_PDR_HIGH');
        if (spPdrHighCb) formData.set('SNEAKY_PIVOT_ENABLE_PDR_HIGH', spPdrHighCb.checked ? 'true' : 'false');
        const spPdrLowCb = document.getElementById('SNEAKY_PIVOT_ENABLE_PDR_LOW');
        if (spPdrLowCb) formData.set('SNEAKY_PIVOT_ENABLE_PDR_LOW', spPdrLowCb.checked ? 'true' : 'false');
        const spPdsHighCb = document.getElementById('SNEAKY_PIVOT_ENABLE_PDS_HIGH');
        if (spPdsHighCb) formData.set('SNEAKY_PIVOT_ENABLE_PDS_HIGH', spPdsHighCb.checked ? 'true' : 'false');
        const spPdsLowCb = document.getElementById('SNEAKY_PIVOT_ENABLE_PDS_LOW');
        if (spPdsLowCb) formData.set('SNEAKY_PIVOT_ENABLE_PDS_LOW', spPdsLowCb.checked ? 'true' : 'false');

        const anonCb = document.getElementById('ENABLE_ANON_REPORTING');
        if (anonCb) formData.set('ENABLE_ANON_REPORTING', anonCb.checked ? 'true' : 'false');

        const paperCb = document.getElementById('ENABLE_PAPER_TRADING');
        if (paperCb) formData.set('ENABLE_PAPER_TRADING', paperCb.checked ? 'true' : 'false');

        const isVwapChecked = vwapCb && vwapCb.checked;
        const isRsiChecked = rsiCb && rsiCb.checked;
        const isDmiChecked = dmiCb && dmiCb.checked;
        const isFgChecked = fgCb && fgCb.checked;
        const isSpChecked = spCb && spCb.checked;

        if (!isVwapChecked && !isRsiChecked && !isDmiChecked && !isFgChecked && !isSpChecked) {
            showToast({
                title: 'Configuration Error',
                message: 'At least one strategy must be enabled.',
                type: 'error'
            });
            return;
        }

        // Add Advance Strategy Settings manually since they are outside the form
        const advInputs = [
            'VWAP_UPPER_SIGNAL', 'VWAP_LOWER_SIGNAL', 'CB_BYPASS_ON_POSITION',
            'RSI_OVERBOUGHT_DIR', 'RSI_OVERSOLD_DIR',
            'RSI_OVERBOUGHT_SIGNAL', 'RSI_OVERSOLD_SIGNAL', 'RSI_BYPASS_ON_POSITION',
            'DMI_THRESHOLD_DIR', 'DMI_THRESHOLD_UPPER', 'DMI_PDI_SIGNAL', 'DMI_MDI_SIGNAL', 'DMI_BYPASS_ON_POSITION',
            'MS_BULLISH_SIGNAL', 'MS_BEARISH_SIGNAL', 'MS_EXTREME_FEAR_SIGNAL', 'MS_EXTREME_GREED_SIGNAL', 'MS_BYPASS_ON_POSITION',
            'SNEAKY_PIVOT_BUY_SIGNAL', 'SNEAKY_PIVOT_SELL_SIGNAL', 'SNEAKY_PIVOT_BYPASS_ON_POSITION'
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
    const overviewStatusPill = document.getElementById('bot-overview-status-pill');
    const overviewStatusDot = document.getElementById('bot-overview-status-dot');
    const overviewStatusLabel = document.getElementById('bot-overview-status-label');
    const tradeStatusDot = document.getElementById('trade-status-indicator').querySelector('.dot');
    const tradeStatusText = document.getElementById('trade-status-text');
    const pairsCount = document.getElementById('pairs-count');
    const openPositionsCount = document.getElementById('open-positions-count');
    const maxPositionsCount = document.getElementById('max-positions-count');
    const usedMarginPercent = document.getElementById('used-margin-percent');
    const fearGreedValue = document.getElementById('fear-greed-value');
    const marketSentimentValue = document.getElementById('market-sentiment-value');
    const isolationStatusDot = document.getElementById('isolation-status-indicator')?.querySelector('.dot');
    const isolationStatusText = document.getElementById('isolation-status-text');
    const controlMsg = document.getElementById('control-msg');
    let currentBtcPrice = 0;
    let currentEthPrice = 0;
    let lastIsolationMode = null;

    // ── Currency Switcher Setup ──────────────────────────────
    const currencySymbols = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        AUD: 'A$',
        CAD: 'C$',
        CNY: '¥',
        INR: '₹',
        IDR: 'Rp',
        MYR: 'RM',
        JPY: '¥',
        SGD: 'S$',
        BTC: '₿',
        ETH: 'Ξ'
    };

    let exchangeRates = {
        USD: 1.0,
        EUR: 0.92,
        GBP: 0.79,
        AUD: 1.55,
        CAD: 1.38,
        CNY: 7.25,
        INR: 86.0,
        IDR: 16200.0,
        MYR: 4.70,
        JPY: 155.0,
        SGD: 1.35,
        BTC: 0.000015, // Updated dynamically from live status
        ETH: 0.0004    // Updated dynamically from live API
    };

    function formatCurrencyValue(absVal, cur) {
        if (cur === 'BTC' || cur === 'ETH') {
            return parseFloat(absVal).toFixed(6);
        } else if (cur === 'JPY' || cur === 'IDR') {
            return Math.round(absVal).toLocaleString();
        } else {
            return parseFloat(absVal).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        }
    }

    function fetchExchangeRates() {
        // Fetch fiat exchange rates from open.er-api.com
        fetch('https://open.er-api.com/v6/latest/USD')
            .then(res => res.json())
            .then(data => {
                if (data && data.rates) {
                    for (const cur of ['EUR', 'GBP', 'AUD', 'CAD', 'CNY', 'INR', 'IDR', 'MYR', 'JPY', 'SGD']) {
                        if (data.rates[cur]) {
                            exchangeRates[cur] = data.rates[cur];
                        }
                    }
                    console.log('Exchange rates updated successfully:', exchangeRates);
                    updateCryptoRatesAndReRender();
                }
            })
            .catch(err => {
                console.warn('Could not fetch live exchange rates, using fallbacks:', err);
            });

        // Fetch live ETH price from Binance public ticker (with Coinbase fallback)
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')
            .then(res => res.json())
            .then(data => {
                const p = parseFloat(data && data.price);
                if (p > 0) {
                    currentEthPrice = p;
                    exchangeRates.ETH = 1 / currentEthPrice;
                    updateCryptoRatesAndReRender();
                }
            })
            .catch(() => {
                fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')
                    .then(res => res.json())
                    .then(cbData => {
                        const p = parseFloat(cbData?.data?.amount);
                        if (p > 0) {
                            currentEthPrice = p;
                            exchangeRates.ETH = 1 / currentEthPrice;
                            updateCryptoRatesAndReRender();
                        }
                    })
                    .catch(err => console.warn('Could not fetch live ETH price:', err));
            });
    }

    function convertFromUsd(val) {
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const rate = exchangeRates[cur] || 1.0;
        return (parseFloat(val) || 0) * rate;
    }

    function formatSelectedCurrency(val) {
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const num = parseFloat(val || 0);
        const converted = convertFromUsd(num);
        const symbol = currencySymbols[cur] || '$';
        const sign = num < 0 ? '-' : '';
        const absVal = Math.abs(converted);
        return sign + symbol + formatCurrencyValue(absVal, cur);
    }

    function formatTokenPrice(priceUsd) {
        if (priceUsd === undefined || priceUsd === null || isNaN(priceUsd)) return 'N/A';
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const symbol = currencySymbols[cur] || '$';
        const converted = convertFromUsd(priceUsd);
        const sign = priceUsd < 0 ? '-' : '';
        const absVal = Math.abs(converted);
        const decimals = (cur === 'BTC' || cur === 'ETH') ? 6 : ((cur === 'JPY' || cur === 'IDR') ? 0 : 4);
        return sign + symbol + parseFloat(absVal).toFixed(decimals);
    }

    function updateCryptoRatesAndReRender() {
        if (currentBtcPrice > 0) {
            exchangeRates.BTC = 1 / currentBtcPrice;
        }
        if (currentEthPrice > 0) {
            exchangeRates.ETH = 1 / currentEthPrice;
        }

        // Re-trigger visual updates instantly across all views on currency change or rate updates
        fetchAccountData(true);
        fetchLiquidations();
        fetchClosedPnlsTable();
        fetchDynamicThresholdTable();
        fetchTradeDecisions();
        fetchPnLHistory(true);
        fetchWeeklyPnLHistory(true);
        fetchMonthlyPnLHistory(true);
        fetch24HStatistics(true);
        fetchPageStatisticsData(true);
    }

    function updateBtcRateAndReRender() {
        updateCryptoRatesAndReRender();
    }

    // Call exchange rate fetch on initialization and periodically every 5 minutes
    fetchExchangeRates();
    setInterval(fetchExchangeRates, 5 * 60 * 1000);

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

                // Dynamic Status Pill next to Bot Overview heading
                if (overviewStatusPill && overviewStatusDot && overviewStatusLabel) {
                    if (data.isRunning) {
                        if (data.isTrading) {
                            overviewStatusPill.className = 'live-indicator-pill status-pill-trading';
                            overviewStatusDot.className = 'pulse-dot-indicator dot-trading';
                            overviewStatusLabel.textContent = 'Executing Trade';
                        } else if (data.isolationMode) {
                            overviewStatusPill.className = 'live-indicator-pill status-pill-warning';
                            overviewStatusDot.className = 'pulse-dot-indicator dot-warning';
                            overviewStatusLabel.textContent = 'Isolation Mode';
                        } else {
                            overviewStatusPill.className = 'live-indicator-pill status-pill-running';
                            overviewStatusDot.className = 'pulse-dot-indicator dot-running';
                            overviewStatusLabel.textContent = 'Live • Running';
                        }
                    } else {
                        overviewStatusPill.className = 'live-indicator-pill status-pill-stopped';
                        overviewStatusDot.className = 'pulse-dot-indicator dot-stopped';
                        overviewStatusLabel.textContent = 'Engine Stopped';
                    }
                }

                if (data.isTrading) {
                    tradeStatusDot.className = 'dot error'; // Red when active execution locks standard
                    tradeStatusText.textContent = 'Executing Trade';
                } else {
                    tradeStatusDot.className = 'dot';
                    tradeStatusText.textContent = 'Idle';
                }

                if (!data.isRunning) {
                    if (isolationStatusDot) isolationStatusDot.className = 'dot';
                    if (isolationStatusText) isolationStatusText.textContent = 'Stopped';
                } else if (data.isolationMode) {
                    if (isolationStatusDot) isolationStatusDot.className = 'dot error'; // Red/Orange pulse
                    if (isolationStatusText) isolationStatusText.textContent = 'Isolation';
                } else {
                    if (isolationStatusDot) isolationStatusDot.className = 'dot running'; // Green pulse
                    if (isolationStatusText) isolationStatusText.textContent = 'Normal';
                }

                // Track and notify on Isolation Mode changes
                if (data.isRunning) {
                    if (lastIsolationMode !== null) {
                        if (!lastIsolationMode && data.isolationMode) {
                            showToast({
                                title: 'Trading Status Changed',
                                message: 'Bot has entered ISOLATION MODE. Used margin has exceeded the threshold. No new positions will be opened.',
                                type: 'error'
                            });
                        } else if (lastIsolationMode && !data.isolationMode) {
                            showToast({
                                title: 'Trading Status Changed',
                                message: 'Bot has returned to NORMAL trading mode. Used margin has dropped below the threshold.',
                                type: 'success'
                            });
                        }
                    }
                    lastIsolationMode = data.isolationMode;
                } else {
                    lastIsolationMode = null;
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

                // Auto Transfer Status
                const lastCheckEl = document.getElementById('auto-transfer-last-check');
                if (lastCheckEl) {
                    lastCheckEl.textContent = data.lastTransferCheck ? new Date(data.lastTransferCheck).toLocaleString() : 'Never';
                }
                const lastSuccessEl = document.getElementById('auto-transfer-last-success');
                if (lastSuccessEl) {
                    lastSuccessEl.textContent = data.lastSuccessfulTransfer ? new Date(data.lastSuccessfulTransfer).toLocaleString() : 'Never';
                }

                const accUpdateEl = document.getElementById('last-update-account');
                if (accUpdateEl) accUpdateEl.textContent = data.lastAccountUpdate ? new Date(data.lastAccountUpdate).toLocaleString() : 'Never';
                const posUpdateEl = document.getElementById('last-update-positions');
                if (posUpdateEl) posUpdateEl.textContent = data.lastPositionsUpdate ? new Date(data.lastPositionsUpdate).toLocaleString() : 'Never';
                const pnlUpdateEl = document.getElementById('last-update-closed-pnl');
                if (pnlUpdateEl) pnlUpdateEl.textContent = data.lastClosedPnlUpdate ? new Date(data.lastClosedPnlUpdate).toLocaleString() : 'Never';
                const dynUpdateEl = document.getElementById('last-update-dynamic-thresholds');
                if (dynUpdateEl) dynUpdateEl.textContent = data.lastDynamicThresholdsUpdate ? new Date(data.lastDynamicThresholdsUpdate).toLocaleString() : 'Never';

                // Stats auto-updating moved to fetchAccountData
            })
            .catch(err => {
                if (overviewStatusPill && overviewStatusDot && overviewStatusLabel) {
                    overviewStatusPill.className = 'live-indicator-pill status-pill-error';
                    overviewStatusDot.className = 'pulse-dot-indicator dot-error';
                    overviewStatusLabel.textContent = 'Disconnected';
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
    let cachedLogs = [];
    let logsSearchQuery = '';
    let logsLevelFilter = 'all';
    let isAutoScrollEnabled = true;

    function renderLogs() {
        if (!logTerminal) return;

        let filtered = cachedLogs;

        // 1. Filter by Level
        if (logsLevelFilter !== 'all') {
            filtered = filtered.filter(l => l.type === logsLevelFilter);
        }

        // 2. Filter by Search Query
        if (logsSearchQuery) {
            const query = logsSearchQuery.toLowerCase();
            filtered = filtered.filter(l =>
                (l.msg && l.msg.toLowerCase().includes(query)) ||
                (l.time && l.time.toLowerCase().includes(query)) ||
                (l.type && l.type.toLowerCase().includes(query))
            );
        }

        if (filtered.length === 0) {
            logTerminal.innerHTML = `<div class="empty-terminal-msg">&mdash; No matching logs found &mdash;</div>`;
            return;
        }

        logTerminal.innerHTML = filtered.map(l => {
            const badgeClass = `badge-${l.type}`;
            const textClass = `log-${l.type}`;
            return `<div class="log-row"><span class="log-time">[${l.time}]</span><span class="log-badge ${badgeClass}">${l.type.toUpperCase()}</span><span class="${textClass}">${l.msg}</span></div>`;
        }).join('');

        // Auto-scroll
        if (isAutoScrollEnabled) {
            logTerminal.scrollTop = logTerminal.scrollHeight;
        }
    }

    function fetchLogs() {
        if (!logTerminal) return;
        if (!document.getElementById('logs-page').classList.contains('active')) return;

        fetch('/api/logs')
            .then(res => res.json())
            .then(logs => {
                const logsChanged = logs.length !== cachedLogs.length ||
                    (logs.length > 0 && cachedLogs.length > 0 && logs[logs.length - 1].time !== cachedLogs[cachedLogs.length - 1].time);

                if (logsChanged) {
                    const isAtBottom = logTerminal.scrollHeight - logTerminal.clientHeight <= logTerminal.scrollTop + 50;
                    if (!isAtBottom && cachedLogs.length > 0) {
                        const autoScrollCb = document.getElementById('log-autoscroll');
                        if (autoScrollCb && autoScrollCb.checked) {
                            autoScrollCb.checked = false;
                            isAutoScrollEnabled = false;
                        }
                    }

                    cachedLogs = logs;
                    renderLogs();
                }
            })
            .catch(console.error);
    }

    if (logTerminal) {
        // Search Input
        const logSearchInput = document.getElementById('log-search');
        if (logSearchInput) {
            logSearchInput.addEventListener('input', (e) => {
                logsSearchQuery = e.target.value;
                renderLogs();
            });
        }

        // Level Filters
        const filterChips = document.querySelectorAll('.filter-chip');
        filterChips.forEach(chip => {
            chip.addEventListener('click', () => {
                filterChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                logsLevelFilter = chip.getAttribute('data-level');
                renderLogs();
            });
        });

        // Auto-scroll Toggle
        const autoScrollCb = document.getElementById('log-autoscroll');
        if (autoScrollCb) {
            autoScrollCb.addEventListener('change', (e) => {
                isAutoScrollEnabled = e.target.checked;
                if (isAutoScrollEnabled) {
                    logTerminal.scrollTop = logTerminal.scrollHeight;
                }
            });
        }

        // Clear Viewport Logs
        const btnClearLogs = document.getElementById('btn-clear-logs');
        if (btnClearLogs) {
            btnClearLogs.addEventListener('click', () => {
                cachedLogs = [];
                renderLogs();
            });
        }

        // Download Logs
        const btnDownloadLogs = document.getElementById('btn-download-logs');
        if (btnDownloadLogs) {
            btnDownloadLogs.addEventListener('click', () => {
                if (cachedLogs.length === 0) {
                    showToast({
                        title: 'Export Failed',
                        message: 'No logs available to export.',
                        type: 'error'
                    });
                    return;
                }

                const logText = cachedLogs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.msg}`).join('\n');
                const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');

                const timestampStr = new Date().toISOString().slice(0, 19).replace(/T|:/g, '-');
                a.href = url;
                a.download = `liquidation_trader_logs_${timestampStr}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showToast({
                    title: 'Export Successful',
                    message: 'Logs downloaded successfully.',
                    type: 'success'
                });
            });
        }

        // Monitor scroll to detect manual scrolling up
        logTerminal.addEventListener('scroll', () => {
            const isAtBottom = logTerminal.scrollHeight - logTerminal.clientHeight <= logTerminal.scrollTop + 50;
            const autoScrollCb = document.getElementById('log-autoscroll');
            if (autoScrollCb) {
                if (isAtBottom && !isAutoScrollEnabled) {
                    autoScrollCb.checked = true;
                    isAutoScrollEnabled = true;
                } else if (!isAtBottom && isAutoScrollEnabled) {
                    autoScrollCb.checked = false;
                    isAutoScrollEnabled = false;
                }
            }
        });

        setInterval(fetchLogs, 2000);
        fetchLogs();
    }

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
    let currentPositionsList = [];
    let currentTvWidget = null;
    
    const btnResetPaper = document.getElementById('btn-reset-paper');
    if (btnResetPaper) {
        btnResetPaper.addEventListener('click', () => {
            if (confirm("Are you sure you want to completely reset your Paper Trading account? This will wipe all paper positions and PnL history and reset your balance.")) {
                fetch('/api/paper/reset', { method: 'POST' })
                    .then(res => res.json())
                    .then(data => {
                        showToast({ title: data.success ? 'Success' : 'Error', message: data.message, type: data.success ? 'success' : 'error' });
                        if (data.success) {
                            fetchAccountData();
                            fetch24HStatistics();
                            fetchPageStatisticsData();
                        }
                    })
                    .catch(err => {
                        console.error(err);
                        showToast({ title: 'Error', message: 'Error resetting paper account', type: 'error' });
                    });
            }
        });
    }


    window.openPositionDetail = function (symbol) {
        const position = currentPositionsList.find(p => p.symbol === symbol);
        if (!position) return;

        // Update Nav & Pages manually
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('position-detail-page').classList.add('active');

        document.getElementById('detail-symbol-name').textContent = symbol;

        renderPositionStats(symbol);

        let exchangeInput = document.getElementById('TRADE_EXCHANGE');
        let exchangeName = exchangeInput ? exchangeInput.value.toUpperCase() : 'BINANCE';

        let cleanSymbol = symbol;
        if (symbol.includes('/')) {
            cleanSymbol = symbol.split('/')[0] + symbol.split('/')[1].split(':')[0];
        }
        let tvSymbol = `${exchangeName}:${cleanSymbol}.P`;

        if (currentTvWidget) {
            currentTvWidget.remove();
            currentTvWidget = null;
        }

        const savedInterval = localStorage.getItem('tvChartInterval') || "15";

        currentTvWidget = new TradingView.widget({
            "autosize": true,
            "symbol": tvSymbol,
            "interval": savedInterval,
            "timezone": "Etc/UTC",
            "theme": "dark",
            "style": "8",
            "locale": "en",
            "enable_publishing": false,
            "backgroundColor": "rgba(0, 0, 0, 1)",
            "hide_top_toolbar": false,
            "hide_legend": false,
            "save_image": false,
            "container_id": "tv_chart_container",
            "studies": [
                "RSI@tv-basicstudies",
                "DM@tv-basicstudies"
            ]
        });
    };

    let popupTvWidget = null;

    window.openTvPopupModal = function (symbol) {
        let exchangeInput = document.getElementById('TRADE_EXCHANGE');
        let exchangeName = exchangeInput ? exchangeInput.value.toUpperCase() : 'BINANCE';

        let cleanSymbol = symbol;
        if (symbol.includes('/')) {
            cleanSymbol = symbol.split('/')[0] + symbol.split('/')[1].split(':')[0];
        }
        let tvSymbol = `${exchangeName}:${cleanSymbol}.P`;

        document.getElementById('tvPopupModalSymbol').textContent = symbol;
        document.getElementById('tvPopupModal').style.display = 'flex';

        if (popupTvWidget) {
            popupTvWidget.remove();
            popupTvWidget = null;
        }

        const savedInterval = localStorage.getItem('tvChartInterval') || "15";

        popupTvWidget = new TradingView.widget({
            "autosize": true,
            "symbol": tvSymbol,
            "interval": savedInterval,
            "timezone": "Etc/UTC",
            "theme": "dark",
            "style": "8",
            "locale": "en",
            "enable_publishing": false,
            "backgroundColor": "rgba(0, 0, 0, 1)",
            "hide_top_toolbar": false,
            "hide_legend": false,
            "save_image": false,
            "container_id": "tv_popup_chart_container",
            "studies": [
                "RSI@tv-basicstudies",
                "DM@tv-basicstudies"
            ]
        });
    };

    document.getElementById('closeTvPopupModalBtn')?.addEventListener('click', () => {
        document.getElementById('tvPopupModal').style.display = 'none';
        if (popupTvWidget) {
            popupTvWidget.remove();
            popupTvWidget = null;
        }
    });

    document.getElementById('tvPopupModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('tvPopupModal')) {
            document.getElementById('tvPopupModal').style.display = 'none';
            if (popupTvWidget) {
                popupTvWidget.remove();
                popupTvWidget = null;
            }
        }
    });

    // Chart Settings Modal Logic
    document.addEventListener('click', (e) => {
        if (e.target.closest('.openTvSettingsBtn')) {
            const savedInterval = localStorage.getItem('tvChartInterval') || "15";
            document.getElementById('tv-settings-interval').value = savedInterval;
            document.getElementById('tvSettingsModal').style.display = 'flex';
        }
    });

    document.getElementById('closeTvSettingsModalBtn')?.addEventListener('click', () => {
        document.getElementById('tvSettingsModal').style.display = 'none';
    });
    document.getElementById('cancelTvSettingsBtn')?.addEventListener('click', () => {
        document.getElementById('tvSettingsModal').style.display = 'none';
    });

    document.getElementById('tvSettingsModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('tvSettingsModal')) {
            document.getElementById('tvSettingsModal').style.display = 'none';
        }
    });

    document.getElementById('saveTvSettingsBtn')?.addEventListener('click', () => {
        const newInterval = document.getElementById('tv-settings-interval').value;
        localStorage.setItem('tvChartInterval', newInterval);
        document.getElementById('tvSettingsModal').style.display = 'none';

        // Re-render whichever chart is currently visible
        if (document.getElementById('position-detail-page').classList.contains('active')) {
            const symbol = document.getElementById('detail-symbol-name').textContent;
            if (symbol) openPositionDetail(symbol);
        }
        if (document.getElementById('tvPopupModal').style.display !== 'none') {
            const symbol = document.getElementById('tvPopupModalSymbol').textContent;
            if (symbol) openTvPopupModal(symbol);
        }
    });

    function renderPositionStats(symbol) {
        const position = currentPositionsList.find(p => p.symbol === symbol);
        if (!position) return;

        const sideStr = (position.side || '').toLowerCase();
        const isBuy = sideStr === 'buy' || sideStr === 'long';
        const statusClz = isBuy ? 'status-connected' : 'status-error';
        const badgeClz = isBuy ? 'badge-connected' : 'badge-error';
        const dotClz = isBuy ? 'dot-connected' : 'dot-error';
        const sideText = (position.side || 'UNKNOWN').toUpperCase();

        const posValue = (parseFloat(position.size || 0) * parseFloat(position.entry_price || 0));
        const posValueStr = posValue > 0 ? posValue.toFixed(2) : '0.00';

        const leverage = parseInt(document.getElementById('TRADE_LEVERAGE')?.value || 10);
        const margin = posValue / leverage;
        const marginStr = margin > 0 ? margin.toFixed(2) : '0.00';

        const pnlNum = parseFloat(position.unrealized_pnl || 0);
        const pnlPercent = margin > 0 ? (pnlNum / margin) * 100 : 0;
        const pnlPercentStr = (pnlPercent > 0 ? '+' : '') + pnlPercent.toFixed(2) + '%';

        let trailingActivationPercent = parseFloat(document.getElementById('TRAILING_ACTIVATION_PERCENTAGE')?.value || 0);
        let trailingPriceStr = 'N/A';
        if (trailingActivationPercent > 0) {
            let multiplier = trailingActivationPercent / 100;
            let tp = isBuy ? (position.entry_price * (1 + multiplier)) : (position.entry_price * (1 - multiplier));
            trailingPriceStr = tp.toFixed(4);
        }

        const lastUpdatedText = position.updated_at ? (typeof formatTimeAgo === 'function' ? formatTimeAgo(position.updated_at) : new Date(position.updated_at).toLocaleTimeString()) : 'Live';

        document.getElementById('position-detail-stats').innerHTML = `
            <div class="conn-item-card pos-item-card pos-detail-card ${statusClz}">
                <div class="conn-item-top">
                    <div class="conn-item-title-wrap">
                        <div class="conn-item-title-row">
                            <span class="proto-tag tag-perp">PERP CONTRACT</span>
                            <span class="pos-detail-title">${escapeHtml(position.symbol)}</span>
                        </div>
                        <span class="conn-item-desc">Linear Perpetual &bull; Leverage: <strong>${leverage}x</strong> &bull; Size: <strong>${escapeHtml(String(position.size))}</strong></span>
                    </div>
                    <div class="conn-status-badge ${badgeClz}">
                        <span class="conn-dot ${dotClz}"></span>
                        <span>${sideText}</span>
                    </div>
                </div>

                <div class="pos-item-pnl-box pos-detail-pnl-box ${pnlNum >= 0 ? 'pnl-box-positive' : 'pnl-box-negative'}">
                    <div class="pos-pnl-left">
                        <span class="pos-pnl-sub-label">Unrealized PnL</span>
                        <div class="pos-pnl-main-val">
                            ${formatPnl(position.unrealized_pnl)}
                            <span class="pos-pnl-roi ${pnlNum >= 0 ? 'val-accent' : 'val-danger'}">(${pnlPercentStr} ROI)</span>
                        </div>
                    </div>
                    <div class="pos-pnl-mid" style="display: flex; flex-direction: column; gap: 2px;">
                        <span class="pos-pnl-sub-label">Position Value</span>
                        <span class="pos-pnl-val-mono mono-num" style="font-size: 15px;">${formatSelectedCurrency(posValue)}</span>
                    </div>
                    <div class="pos-pnl-right">
                        <span class="pos-pnl-sub-label">Margin Allocated</span>
                        <span class="pos-pnl-val-mono mono-num" style="font-size: 15px;">${formatSelectedCurrency(margin)}</span>
                    </div>
                </div>

                <div class="conn-item-metrics pos-item-metrics pos-detail-metrics">
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Entry Price</span>
                        <span class="conn-metric-num mono-num">${parseFloat(position.entry_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Mark Price</span>
                        <span class="conn-metric-num mono-num">${parseFloat(position.mark_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Liq. Price</span>
                        <span class="conn-metric-num mono-num val-danger">${parseFloat(position.liq_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Take Profit</span>
                        <span class="conn-metric-num mono-num val-accent">${parseFloat(position.tp_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Stop Loss</span>
                        <span class="conn-metric-num mono-num val-danger">${parseFloat(position.sl_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Trailing Target</span>
                        <span class="conn-metric-num mono-num ${trailingPriceStr !== 'N/A' ? 'val-accent' : ''}">${trailingPriceStr}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Contract Units</span>
                        <span class="conn-metric-num mono-num">${escapeHtml(String(position.size))}</span>
                    </div>
                    <div class="conn-metric-col">
                        <span class="conn-metric-title">Effective Margin</span>
                        <span class="conn-metric-num mono-num">${formatSelectedCurrency(margin)}</span>
                    </div>
                </div>

                <div class="conn-item-footer">
                    <span>Last Sync: <strong>${lastUpdatedText}</strong></span>
                    <div class="pos-footer-actions">
                        <span class="status-pill-badge badge-active" style="font-size: 11px; padding: 3px 8px;">Active Position</span>
                    </div>
                </div>
            </div>
        `;
    }
    window.renderPositionStats = renderPositionStats;

    window.closePositionDetail = function () {
        document.getElementById('position-detail-page').classList.remove('active');
        document.getElementById('positions').classList.add('active');

        if (currentTvWidget) {
            currentTvWidget.remove();
            currentTvWidget = null;
        }
    };


    window.closePositionMarket = function () {
        const symbol = document.getElementById('detail-symbol-name').textContent;
        if (!symbol) return;

        if (!confirm(`Are you sure you want to CLOSE ${symbol} at MARKET price?`)) {
            return;
        }

        const btn = document.getElementById('close-position-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = 'Closing...';
        }

        fetch('/api/positions/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast({ title: 'Position Closed', message: data.message, type: 'success' });
                    closePositionDetail();
                    fetchAccountData();
                } else {
                    showToast({ title: 'Error', message: data.message || 'Failed to close position.', type: 'error' });
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = 'Close Position (Market)';
                    }
                }
            })
            .catch(err => {
                console.error(err);
                showToast({ title: 'Error', message: 'Network error closing position.', type: 'error' });
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = 'Close Position (Market)';
                }
            });
    };

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatTimeAgo(timestamp) {
        if (!timestamp) return 'Never';
        const diffMs = Date.now() - timestamp;
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 5) return 'Just now';
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    }

    function formatUsd(val) {
        return formatSelectedCurrency(val);
    }

    function formatPnl(val) {
        const cur = localStorage.getItem('selectedCurrency') || 'USD';
        const numUsd = parseFloat(val || 0);
        const converted = convertFromUsd(numUsd);

        const sign = numUsd > 0 ? '+' : (numUsd < 0 ? '-' : '');
        const clz = numUsd >= 0 ? 'pnl-positive' : 'pnl-negative';
        const symbol = currencySymbols[cur] || '$';
        const absVal = Math.abs(converted);
        const formattedVal = formatCurrencyValue(absVal, cur);

        return `<span class="${clz}">${sign}${symbol}${formattedVal}</span>`;
    }

    function fetchAccountData(force = false) {
        // Optimize polling: only render if standard tabs correspond or forced.
        if (!force &&
            !document.getElementById('account').classList.contains('active') &&
            !document.getElementById('positions').classList.contains('active') &&
            !document.getElementById('position-detail-page').classList.contains('active')) return;

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
                    currentPositionsList = [];
                    positionsContainer.innerHTML = '<div class="empty-msg">&mdash; No active positions tracked yet &mdash;</div>';
                } else {
                    data.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
                    currentPositionsList = data;
                    positionsContainer.innerHTML = data.map(p => {
                        const sideStr = (p.side || '').toLowerCase();
                        const isBuy = sideStr === 'buy' || sideStr === 'long';
                        const statusClz = isBuy ? 'status-connected' : 'status-error';
                        const badgeClz = isBuy ? 'badge-connected' : 'badge-error';
                        const dotClz = isBuy ? 'dot-connected' : 'dot-error';
                        const sideText = (p.side || 'UNKNOWN').toUpperCase();

                        const posValue = (parseFloat(p.size || 0) * parseFloat(p.entry_price || 0));
                        const posValueStr = posValue > 0 ? posValue.toFixed(2) : '0.00';

                        const leverage = parseInt(document.getElementById('TRADE_LEVERAGE')?.value || 10);
                        const margin = posValue / leverage;
                        const marginStr = margin > 0 ? margin.toFixed(2) : '0.00';

                        const pnlNum = parseFloat(p.unrealized_pnl || 0);
                        const pnlPercent = margin > 0 ? (pnlNum / margin) * 100 : 0;
                        const pnlPercentStr = (pnlPercent > 0 ? '+' : '') + pnlPercent.toFixed(2) + '%';

                        const lastUpdatedText = p.updated_at ? (typeof formatTimeAgo === 'function' ? formatTimeAgo(p.updated_at) : new Date(p.updated_at).toLocaleTimeString()) : 'Live';
                        const safeSymbolJs = (p.symbol || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                        const cardDomId = 'pos-card-' + (p.symbol || '').replace(/[^a-zA-Z0-9_-]/g, '_');

                        return `
                        <div class="conn-item-card pos-item-card ${statusClz}" id="${cardDomId}">
                            <div class="conn-item-top">
                                <div class="conn-item-title-wrap">
                                    <div class="conn-item-title-row">
                                        <span class="proto-tag tag-perp">PERP</span>
                                        <span class="conn-item-name pos-item-name">${escapeHtml(p.symbol)}</span>
                                    </div>
                                    <span class="conn-item-desc">Linear Contract &bull; Size: <strong>${escapeHtml(String(p.size))}</strong></span>
                                </div>
                                <div class="conn-status-badge ${badgeClz}">
                                    <span class="conn-dot ${dotClz}"></span>
                                    <span>${sideText}</span>
                                </div>
                            </div>

                            <div class="pos-item-pnl-box ${pnlNum >= 0 ? 'pnl-box-positive' : 'pnl-box-negative'}">
                                <div class="pos-pnl-left">
                                    <span class="pos-pnl-sub-label">Unrealized PnL</span>
                                    <div class="pos-pnl-main-val">
                                        ${formatPnl(p.unrealized_pnl)}
                                        <span class="pos-pnl-roi ${pnlNum >= 0 ? 'val-accent' : 'val-danger'}">(${pnlPercentStr})</span>
                                    </div>
                                </div>
                                <div class="pos-pnl-right">
                                    <span class="pos-pnl-sub-label">Position Value</span>
                                    <span class="pos-pnl-val-mono mono-num">${formatSelectedCurrency(posValue)}</span>
                                </div>
                            </div>

                            <div class="conn-item-metrics pos-item-metrics">
                                <div class="conn-metric-col">
                                    <span class="conn-metric-title">Entry Price</span>
                                    <span class="conn-metric-num mono-num">${parseFloat(p.entry_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="conn-metric-col">
                                    <span class="conn-metric-title">Mark Price</span>
                                    <span class="conn-metric-num mono-num">${parseFloat(p.mark_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="conn-metric-col">
                                    <span class="conn-metric-title">Liq. Price</span>
                                    <span class="conn-metric-num mono-num val-danger">${parseFloat(p.liq_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="conn-metric-col">
                                    <span class="conn-metric-title">TP Target</span>
                                    <span class="conn-metric-num mono-num val-accent">${parseFloat(p.tp_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="conn-metric-col">
                                    <span class="conn-metric-title">SL Guard</span>
                                    <span class="conn-metric-num mono-num val-danger">${parseFloat(p.sl_price || 0).toFixed(4)}</span>
                                </div>
                                <div class="conn-metric-col">
                                    <span class="conn-metric-title">Est. Margin</span>
                                    <span class="conn-metric-num mono-num">${formatSelectedCurrency(margin)}</span>
                                </div>
                            </div>

                            <div class="conn-item-footer">
                                <span>Updated: <strong>${lastUpdatedText}</strong></span>
                                <div class="pos-footer-actions">
                                    <button class="btn-test-conn" onclick="openTvPopupModal('${safeSymbolJs}')" title="Open Interactive TradingView Chart">
                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path>
                                        </svg>
                                        <span>Chart</span>
                                    </button>
                                    <button class="btn-test-conn btn-pos-detail" onclick="openPositionDetail('${safeSymbolJs}')" title="View Full Position Details & Execution Controls">
                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                        </svg>
                                        <span>Details</span>
                                    </button>
                                </div>
                            </div>
                        </div>`;
                    }).join('');
                }

                let currentPositionsCount = 0;
                let cumulativePnl = 0;
                if (data && data.length > 0) {
                    currentPositionsCount = data.length;
                    cumulativePnl = data.reduce((sum, p) => sum + (parseFloat(p.unrealized_pnl) || 0), 0);
                }
                
                const summaryBar = document.getElementById('positions-summary-bar');
                if (summaryBar) {
                    summaryBar.style.display = currentPositionsCount > 0 ? 'flex' : 'none';
                }

                const elSummaryCount = document.getElementById('summary-current-positions');
                const elSummaryPnl = document.getElementById('summary-cumulative-pnl');
                
                if (elSummaryCount) elSummaryCount.textContent = currentPositionsCount;
                if (elSummaryPnl) {
                    elSummaryPnl.innerHTML = formatPnl(cumulativePnl);
                }

                // If detail page is active, auto-update the stats
                const detailPage = document.getElementById('position-detail-page');
                if (detailPage && detailPage.classList.contains('active')) {
                    const activeSymbol = document.getElementById('detail-symbol-name').textContent;
                    if (activeSymbol && typeof renderPositionStats === 'function') {
                        renderPositionStats(activeSymbol);
                    }
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

        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        if (currentLiquidationsPage > totalPages) currentLiquidationsPage = totalPages;
        if (currentLiquidationsPage < 1) currentLiquidationsPage = 1;

        const startIndex = (currentLiquidationsPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const pageData = filtered.slice(startIndex, endIndex);

        // Update pagination UI
        const btnPrev = document.getElementById('btn-prev-liquidations');
        const btnNext = document.getElementById('btn-next-liquidations');
        const pageInfo = document.getElementById('liquidations-page-info');

        if (btnPrev) btnPrev.disabled = currentLiquidationsPage === 1;
        if (btnNext) btnNext.disabled = currentLiquidationsPage === totalPages;
        if (pageInfo) pageInfo.textContent = `Page ${currentLiquidationsPage} of ${totalPages}`;

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

        if (pageData.length === 0) {
            tbodyLiquidations.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching liquidations found for "${searchVal}" &mdash;` : '&mdash; No liquidations tracked yet &mdash;'}</td></tr>`;
        } else {
            tbodyLiquidations.innerHTML = pageData.map(liq => {
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

    const btnPrevLiq = document.getElementById('btn-prev-liquidations');
    const btnNextLiq = document.getElementById('btn-next-liquidations');
    if (btnPrevLiq) {
        btnPrevLiq.addEventListener('click', () => {
            if (currentLiquidationsPage > 1) {
                currentLiquidationsPage--;
                renderLiquidations();
            }
        });
    }
    if (btnNextLiq) {
        btnNextLiq.addEventListener('click', () => {
            const searchVal = (document.getElementById('liquidations-search')?.value || '').trim().toUpperCase();
            let filtered = cachedLiquidations;
            if (searchVal) filtered = cachedLiquidations.filter(liq => (liq.symbol || '').toUpperCase().includes(searchVal));
            const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            if (currentLiquidationsPage < totalPages) {
                currentLiquidationsPage++;
                renderLiquidations();
            }
        });
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

        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        if (currentClosedPnlsPage > totalPages) currentClosedPnlsPage = totalPages;
        if (currentClosedPnlsPage < 1) currentClosedPnlsPage = 1;

        const startIndex = (currentClosedPnlsPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const pageData = filtered.slice(startIndex, endIndex);

        // Update pagination UI
        const btnPrev = document.getElementById('btn-prev-closed-pnl');
        const btnNext = document.getElementById('btn-next-closed-pnl');
        const pageInfo = document.getElementById('closed-pnl-page-info');

        if (btnPrev) btnPrev.disabled = currentClosedPnlsPage === 1;
        if (btnNext) btnNext.disabled = currentClosedPnlsPage === totalPages;
        if (pageInfo) pageInfo.textContent = `Page ${currentClosedPnlsPage} of ${totalPages}`;

        if (pageData.length === 0) {
            tbodyClosedPnl.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching records found for "${searchVal}" &mdash;` : '&mdash; No closed PnL records found &mdash;'}</td></tr>`;
        } else {
            tbodyClosedPnl.innerHTML = pageData.map(record => {
                const timeStr = new Date(record.timestamp).toLocaleString();
                const sideStr = (record.side || '').toUpperCase();
                const sideClz = sideStr === 'BUY' || sideStr === 'LONG' ? 'side-buy' : (sideStr === 'SELL' || sideStr === 'SHORT' ? 'side-sell' : '');
                const entryStr = record.entry_price ? parseFloat(record.entry_price).toFixed(4) : 'N/A';
                const closeStr = record.close_price ? parseFloat(record.close_price).toFixed(4) : 'N/A';
                const sizeStr = record.size ? record.size : 'N/A';

                return `<tr>
                    <td style="color: var(--text-muted);">${timeStr}</td>
                    <td><strong>${record.symbol}</strong></td>
                    <td><span class="${sideClz}">${(record.side || '').toUpperCase()}</span></td>
                    <td>${sizeStr}</td>
                    <td>${entryStr}</td>
                    <td>${closeStr}</td>
                    <td>${formatPnl(record.pnl)}</td>
                </tr>`;
            }).join('');
        }
    }

    const btnPrevClosedPnl = document.getElementById('btn-prev-closed-pnl');
    const btnNextClosedPnl = document.getElementById('btn-next-closed-pnl');
    if (btnPrevClosedPnl) {
        btnPrevClosedPnl.addEventListener('click', () => {
            if (currentClosedPnlsPage > 1) {
                currentClosedPnlsPage--;
                renderClosedPnlsTable();
            }
        });
    }
    if (btnNextClosedPnl) {
        btnNextClosedPnl.addEventListener('click', () => {
            const searchVal = (document.getElementById('closed-pnl-search')?.value || '').trim().toUpperCase();
            let filtered = cachedClosedPnls;
            if (searchVal) filtered = cachedClosedPnls.filter(record => (record.symbol || '').toUpperCase().includes(searchVal));
            const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            if (currentClosedPnlsPage < totalPages) {
                currentClosedPnlsPage++;
                renderClosedPnlsTable();
            }
        });
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

        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        if (currentDynamicThresholdsPage > totalPages) currentDynamicThresholdsPage = totalPages;
        if (currentDynamicThresholdsPage < 1) currentDynamicThresholdsPage = 1;

        const startIndex = (currentDynamicThresholdsPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const pageData = filtered.slice(startIndex, endIndex);

        // Update pagination UI
        const btnPrev = document.getElementById('btn-prev-dynamic-thresholds');
        const btnNext = document.getElementById('btn-next-dynamic-thresholds');
        const pageInfo = document.getElementById('dynamic-thresholds-page-info');

        if (btnPrev) btnPrev.disabled = currentDynamicThresholdsPage === 1;
        if (btnNext) btnNext.disabled = currentDynamicThresholdsPage === totalPages;
        if (pageInfo) pageInfo.textContent = `Page ${currentDynamicThresholdsPage} of ${totalPages}`;

        if (pageData.length === 0) {
            tbodyDynamicThresholds.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching dynamic thresholds found for "${searchVal}" &mdash;` : '&mdash; Bot is stopped or no pairs loaded &mdash;'}</td></tr>`;
        } else {
            tbodyDynamicThresholds.innerHTML = pageData.map(item => {
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

    const btnPrevDynamic = document.getElementById('btn-prev-dynamic-thresholds');
    const btnNextDynamic = document.getElementById('btn-next-dynamic-thresholds');
    if (btnPrevDynamic) {
        btnPrevDynamic.addEventListener('click', () => {
            if (currentDynamicThresholdsPage > 1) {
                currentDynamicThresholdsPage--;
                renderDynamicThresholdTable();
            }
        });
    }
    if (btnNextDynamic) {
        btnNextDynamic.addEventListener('click', () => {
            const searchVal = (document.getElementById('dynamic-thresholds-search')?.value || '').trim().toUpperCase();
            let filtered = cachedDynamicThresholds;
            if (searchVal) filtered = cachedDynamicThresholds.filter(item => (item.symbol || '').toUpperCase().includes(searchVal));
            const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            if (currentDynamicThresholdsPage < totalPages) {
                currentDynamicThresholdsPage++;
                renderDynamicThresholdTable();
            }
        });
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
        } else if (name === 'DMI') {
            const valStr = typeof strat.value === 'number' ? strat.value.toFixed(2) : 'N/A';
            const pDiStr = typeof strat.plusDI === 'number' ? strat.plusDI.toFixed(2) : 'N/A';
            const mDiStr = typeof strat.minusDI === 'number' ? strat.minusDI.toFixed(2) : 'N/A';
            const thresholdStr = strat.threshold !== undefined ? strat.threshold : 'N/A';
            const tfStr = strat.timeframe || 'N/A';
            const spreadStr = typeof strat.spread === 'number' ? strat.spread.toFixed(2) : 'N/A';

            tooltipHTML = `
                <div class="tooltip-header">DMI Strategy</div>
                <div class="tooltip-grid">
                    <div class="tooltip-row"><span>Timeframe</span><span>${tfStr}</span></div>
                    <div class="tooltip-row"><span>Value</span><span>${valStr}</span></div>
                    <div class="tooltip-row"><span>+DI</span><span>${pDiStr}</span></div>
                    <div class="tooltip-row"><span>-DI</span><span>${mDiStr}</span></div>
                    <div class="tooltip-row"><span>Threshold</span><span>${thresholdStr}</span></div>
                    <div class="tooltip-row"><span>Spread</span><span>${spreadStr}</span></div>
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
        } else if (name === 'SneakyPivot' || name === 'SP') {
            const patternStr = strat.pattern ? strat.pattern.toUpperCase() : 'N/A';
            const tfStr = strat.timeframe || '15m';
            const c2HStr = typeof strat.c2High === 'number' ? formatTokenPrice(strat.c2High) : 'N/A';
            const c2LStr = typeof strat.c2Low === 'number' ? formatTokenPrice(strat.c2Low) : 'N/A';
            const c3HStr = typeof strat.c3High === 'number' ? formatTokenPrice(strat.c3High) : 'N/A';
            const c3LStr = typeof strat.c3Low === 'number' ? formatTokenPrice(strat.c3Low) : 'N/A';
            const pdrHStr = typeof strat.pdrHigh === 'number' ? formatTokenPrice(strat.pdrHigh) : 'N/A';
            const pdrLStr = typeof strat.pdrLow === 'number' ? formatTokenPrice(strat.pdrLow) : 'N/A';
            const pdsHStr = typeof strat.pdsHigh === 'number' ? formatTokenPrice(strat.pdsHigh) : 'N/A';
            const pdsLStr = typeof strat.pdsLow === 'number' ? formatTokenPrice(strat.pdsLow) : 'N/A';

            tooltipHTML = `
                <div class="tooltip-header">Sneaky Pivot Strategy</div>
                <div class="tooltip-grid">
                    <div class="tooltip-row"><span>Timeframe</span><span>${tfStr}</span></div>
                    <div class="tooltip-row"><span>Pattern</span><span>${patternStr}</span></div>
                    <div class="tooltip-row"><span>Candle 2 High/Low</span><span>${c2HStr} / ${c2LStr}</span></div>
                    <div class="tooltip-row"><span>Candle 3 High/Low</span><span>${c3HStr} / ${c3LStr}</span></div>
                    <div class="tooltip-row"><span>PDR High/Low</span><span>${pdrHStr} / ${pdrLStr}</span></div>
                    <div class="tooltip-row"><span>PDS High/Low</span><span>${pdsHStr} / ${pdsLStr}</span></div>
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
            <td style="cursor: pointer;" onclick="openTvPopupModal('${record.symbol}')"><strong style="color: var(--accent); transition: color 0.2s;" onmouseover="this.style.color='var(--text-main)'" onmouseout="this.style.color='var(--accent)'">${record.symbol}</strong></td>
            <td>${priceFormatted}</td>
            <td>${formatStrategy(record.vwap, 'VWAP')}</td>
            <td>${formatStrategy(record.rsi, 'RSI')}</td>
            <td>${formatStrategy(record.dmi, 'DMI')}</td>
            <td>${formatStrategy(record.marketSentiment, 'M.Sentiment')}</td>
            <td>${formatStrategy(record.sneakyPivot, 'SneakyPivot')}</td>
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

        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
        if (currentTradeDecisionsPage > totalPages) currentTradeDecisionsPage = totalPages;
        if (currentTradeDecisionsPage < 1) currentTradeDecisionsPage = 1;

        const startIndex = (currentTradeDecisionsPage - 1) * ITEMS_PER_PAGE;
        const endIndex = startIndex + ITEMS_PER_PAGE;
        const pageData = filtered.slice(startIndex, endIndex);

        // Update pagination UI
        const btnPrev = document.getElementById('btn-prev-trade-decisions');
        const btnNext = document.getElementById('btn-next-trade-decisions');
        const pageInfo = document.getElementById('trade-decisions-page-info');

        if (btnPrev) btnPrev.disabled = currentTradeDecisionsPage === 1;
        if (btnNext) btnNext.disabled = currentTradeDecisionsPage === totalPages;
        if (pageInfo) pageInfo.textContent = `Page ${currentTradeDecisionsPage} of ${totalPages}`;

        if (pageData.length === 0) {
            tbodyTradeDecisions.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching trade evaluations found for "${searchVal}" &mdash;` : '&mdash; No trade evaluations tracked yet &mdash;'}</td></tr>`;
        } else {
            tbodyTradeDecisions.innerHTML = pageData.map(renderTradeDecisionRow).join('');
        }
    }

    const btnPrevTrade = document.getElementById('btn-prev-trade-decisions');
    const btnNextTrade = document.getElementById('btn-next-trade-decisions');
    if (btnPrevTrade) {
        btnPrevTrade.addEventListener('click', () => {
            if (currentTradeDecisionsPage > 1) {
                currentTradeDecisionsPage--;
                renderTradeDecisions();
            }
        });
    }
    if (btnNextTrade) {
        btnNextTrade.addEventListener('click', () => {
            const searchVal = (document.getElementById('trade-decisions-search')?.value || '').trim().toUpperCase();
            let filtered = cachedTradeDecisions;
            if (searchVal) filtered = cachedTradeDecisions.filter(record => (record.symbol || '').toUpperCase().includes(searchVal));
            const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
            if (currentTradeDecisionsPage < totalPages) {
                currentTradeDecisionsPage++;
                renderTradeDecisions();
            }
        });
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
                        tbodyDashboardTradeDecisions.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--text-muted);">&mdash; No recent confluence matched &mdash;</td></tr>';
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
    let weeklyPnlChart = null;
    let monthlyPnlChart = null;

    function getPnlChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 10, bottom: 5, left: 10, right: 10 }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#8a94a6',
                        font: { family: "'JetBrains Mono', monospace", size: 10 },
                        callback: function(value) {
                            const cur = localStorage.getItem('selectedCurrency') || 'USD';
                            const symbol = currencySymbols[cur] || '$';
                            return (value >= 0 ? '+' : '') + symbol + (Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : value);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.03)' },
                    ticks: {
                        color: '#8a94a6',
                        font: { family: "'JetBrains Mono', monospace", size: 10 }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(20, 23, 31, 0.95)',
                    titleColor: '#8a94a6',
                    bodyColor: '#e0e4eb',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            const val = Number(context.raw) || 0;
                            const cur = localStorage.getItem('selectedCurrency') || 'USD';
                            const symbol = currencySymbols[cur] || '$';
                            const absVal = Math.abs(val);
                            const formattedVal = formatCurrencyValue(absVal, cur);
                            return ` PnL: ${val >= 0 ? '+' : '-'}${symbol}${formattedVal}`;
                        }
                    }
                }
            }
        };
    }

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
                    borderColor: [],
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 22,
                    categoryPercentage: 0.7,
                    barPercentage: 0.85
                }]
            },
            options: getPnlChartOptions()
        });
    }

    function initWeeklyPnlChart() {
        const ctx = document.getElementById('weekly-pnl-chart');
        if (!ctx) return;

        weeklyPnlChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: `Weekly PnL (${currencySymbols[localStorage.getItem('selectedCurrency') || 'USD'] || '$'})`,
                    data: [],
                    backgroundColor: [],
                    borderColor: [],
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 26,
                    categoryPercentage: 0.6,
                    barPercentage: 0.85
                }]
            },
            options: getPnlChartOptions()
        });
    }

    function initMonthlyPnlChart() {
        const ctx = document.getElementById('monthly-pnl-chart');
        if (!ctx) return;

        monthlyPnlChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: `Monthly PnL (${currencySymbols[localStorage.getItem('selectedCurrency') || 'USD'] || '$'})`,
                    data: [],
                    backgroundColor: [],
                    borderColor: [],
                    borderWidth: 1,
                    borderRadius: 4,
                    maxBarThickness: 32,
                    categoryPercentage: 0.5,
                    barPercentage: 0.85
                }]
            },
            options: getPnlChartOptions()
        });
    }

    function fetchPnLHistory(force = false) {
        if (!pnlChart) return;
        const pageActive = document.getElementById('account').classList.contains('active');
        if (!pageActive && !force) return;

        fetch('/api/pnl/daily-history?days=30')
            .then(res => res.json())
            .then(data => {
                const cur = localStorage.getItem('selectedCurrency') || 'USD';
                const symbol = currencySymbols[cur] || '$';
                const labels = data.map(d => d.date.split('-').slice(1).join('/')); // MM/DD
                const values = data.map(d => convertFromUsd(d.daily_pnl));
                const colors = values.map(v => v >= 0 ? 'rgba(0, 230, 118, 0.85)' : 'rgba(255, 77, 109, 0.85)');
                const borderColors = values.map(v => v >= 0 ? '#00e676' : '#ff4d6d');

                pnlChart.data.labels = labels;
                pnlChart.data.datasets[0].label = `Daily PnL (${symbol})`;
                pnlChart.data.datasets[0].data = values;
                pnlChart.data.datasets[0].backgroundColor = colors;
                pnlChart.data.datasets[0].borderColor = borderColors;
                pnlChart.update();
            })
            .catch(console.error);
    }

    function fetchWeeklyPnLHistory(force = false) {
        if (!weeklyPnlChart) return;
        const pageActive = document.getElementById('account').classList.contains('active');
        if (!pageActive && !force) return;

        fetch('/api/pnl/weekly-history?weeks=26')
            .then(res => res.json())
            .then(data => {
                const cur = localStorage.getItem('selectedCurrency') || 'USD';
                const symbol = currencySymbols[cur] || '$';
                const labels = data.map(d => {
                    const parts = d.date.split('-');
                    return parts[1];
                });
                const values = data.map(d => convertFromUsd(d.weekly_pnl));
                const colors = values.map(v => v >= 0 ? 'rgba(0, 230, 118, 0.85)' : 'rgba(255, 77, 109, 0.85)');
                const borderColors = values.map(v => v >= 0 ? '#00e676' : '#ff4d6d');

                weeklyPnlChart.data.labels = labels;
                weeklyPnlChart.data.datasets[0].label = `Weekly PnL (${symbol})`;
                weeklyPnlChart.data.datasets[0].data = values;
                weeklyPnlChart.data.datasets[0].backgroundColor = colors;
                weeklyPnlChart.data.datasets[0].borderColor = borderColors;
                weeklyPnlChart.update();
            })
            .catch(console.error);
    }

    function fetchMonthlyPnLHistory(force = false) {
        if (!monthlyPnlChart) return;
        const pageActive = document.getElementById('account').classList.contains('active');
        if (!pageActive && !force) return;

        fetch('/api/pnl/monthly-history?months=12')
            .then(res => res.json())
            .then(data => {
                const cur = localStorage.getItem('selectedCurrency') || 'USD';
                const symbol = currencySymbols[cur] || '$';
                const labels = data.map(d => {
                    const parts = d.date.split('-');
                    const date = new Date(parts[0], parts[1] - 1);
                    return date.toLocaleString('default', { month: 'short' });
                });
                const values = data.map(d => convertFromUsd(d.monthly_pnl));
                const colors = values.map(v => v >= 0 ? 'rgba(0, 230, 118, 0.85)' : 'rgba(255, 77, 109, 0.85)');
                const borderColors = values.map(v => v >= 0 ? '#00e676' : '#ff4d6d');

                monthlyPnlChart.data.labels = labels;
                monthlyPnlChart.data.datasets[0].label = `Monthly PnL (${symbol})`;
                monthlyPnlChart.data.datasets[0].data = values;
                monthlyPnlChart.data.datasets[0].backgroundColor = colors;
                monthlyPnlChart.data.datasets[0].borderColor = borderColors;
                monthlyPnlChart.update();
            })
            .catch(console.error);
    }

    initPnlChart();
    initWeeklyPnlChart();
    initMonthlyPnlChart();
    
    setInterval(() => {
        fetchPnLHistory();
        fetchWeeklyPnLHistory();
        fetchMonthlyPnLHistory();
    }, 5000);
    
    fetchPnLHistory();
    fetchWeeklyPnLHistory();
    fetchMonthlyPnLHistory();

    // ── 24H Statistics Dashboard ──────────────────────────────────
    let tradesChartInst = null;
    let strategiesChartInst = null;
    let marginHistoryChart = null;
    let pnlSymbolChart = null;
    let pnlSideChart = null;
    let pnlWinRateChart = null;
    let drawdownChart = null;

    const DONUT_PALETTE = [
        '#00e676', // Emerald Green
        '#00e5ff', // Cyan
        '#ff4d6d', // Neon Coral
        '#a855f7', // Electric Violet
        '#ffb300', // Amber
        '#3b82f6', // Electric Blue
        '#ec4899', // Pink
        '#10b981', // Mint
        '#8b5cf6', // Indigo
        '#f97316'  // Orange
    ];

    function initStatisticsCharts() {
        const tradesCtx = document.getElementById('tradesChart');
        if (tradesCtx) {
            tradesChartInst = new Chart(tradesCtx, {
                type: 'doughnut',
                data: {
                    labels: ['BUY (Long)', 'SELL (Short)'],
                    datasets: [{
                        data: [0, 0],
                        backgroundColor: ['#00e676', '#ff4d6d'],
                        borderWidth: 2,
                        borderColor: 'rgba(20, 23, 31, 0.95)',
                        spacing: 3,
                        borderRadius: 4,
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 10
                        }
                    }
                }
            });
        }

        const stratCtx = document.getElementById('strategiesChart');
        if (stratCtx) {
            strategiesChartInst = new Chart(stratCtx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'BUY (Long)',
                            data: [],
                            backgroundColor: 'rgba(0, 230, 118, 0.85)',
                            borderColor: '#00e676',
                            borderWidth: 1,
                            borderRadius: 4,
                            maxBarThickness: 32,
                            categoryPercentage: 0.5,
                            barPercentage: 0.8
                        },
                        {
                            label: 'SELL (Short)',
                            data: [],
                            backgroundColor: 'rgba(255, 77, 109, 0.85)',
                            borderColor: '#ff4d6d',
                            borderWidth: 1,
                            borderRadius: 4,
                            maxBarThickness: 32,
                            categoryPercentage: 0.5,
                            barPercentage: 0.8
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: { top: 10, bottom: 5, left: 10, right: 10 }
                    },
                    plugins: {
                        legend: {
                            labels: { color: '#8a94a6', font: { family: "'JetBrains Mono', monospace", size: 11 }, boxWidth: 12, boxHeight: 12, borderRadius: 3 }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 10
                        }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8a94a6', font: { family: "'JetBrains Mono', monospace" } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8a94a6', stepSize: 1, font: { family: "'JetBrains Mono', monospace" } } }
                    }
                }
            });
        }

        const marginCtx = document.getElementById('marginHistoryChart');
        if (marginCtx) {
            marginHistoryChart = new Chart(marginCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Used Margin %',
                            data: [],
                            borderColor: '#00e676',
                            backgroundColor: 'rgba(0, 230, 118, 0.08)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.3,
                            pointRadius: 0,
                            pointHoverRadius: 5,
                            pointHoverBackgroundColor: '#00e676',
                            yAxisID: 'y'
                        },
                        {
                            label: 'Open Positions',
                            data: [],
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.08)',
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                            fill: false,
                            tension: 0.2,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            yAxisID: 'y1'
                        },
                        {
                            label: 'Isolation Threshold',
                            data: [],
                            borderColor: '#ff3b3b',
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            pointRadius: 0,
                            fill: false,
                            yAxisID: 'y'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { labels: { color: '#8a94a6', font: { size: 10 } } },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            callbacks: {
                                label: function(context) {
                                    if (context.datasetIndex === 0) return ` Used Margin: ${context.raw}%`;
                                    if (context.datasetIndex === 1) {
                                        const syms = context.dataset.openSymbols ? context.dataset.openSymbols[context.dataIndex] : '';
                                        return ` Positions: ${context.raw}${syms ? ` (${syms})` : ''}`;
                                    }
                                    if (context.datasetIndex === 2) return ` Threshold: ${context.raw}%`;
                                    return '';
                                }
                            }
                        }
                    }, 
                    scales: { 
                        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8a94a6', maxTicksLimit: 8 } },
                        y: { beginAtZero: true, suggestedMax: 20, position: 'left', grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8a94a6', callback: v => v + '%' } },
                        y1: { beginAtZero: true, suggestedMax: 5, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#8a94a6', stepSize: 1 } }
                    } 
                }
            });
        }

        const pnlSymCtx = document.getElementById('pnlSymbolChart');
        if (pnlSymCtx) {
            pnlSymbolChart = new Chart(pnlSymCtx, {
                type: 'doughnut',
                data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: 'rgba(20, 23, 31, 0.95)', spacing: 3, borderRadius: 4, hoverOffset: 6 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                label: function(context) {
                                    const val = Number(context.raw) || 0;
                                    const sign = val > 0 ? '+' : (val < 0 ? '-' : '');
                                    const cur = localStorage.getItem('selectedCurrency') || 'USD';
                                    const symbol = currencySymbols[cur] || '$';
                                    const absVal = Math.abs(val);
                                    const formattedVal = formatCurrencyValue(absVal, cur);
                                    return ` ${context.label}: ${sign}${symbol}${formattedVal}`;
                                }
                            }
                        }
                    }
                }
            });
        }

        const pnlSideCtx = document.getElementById('pnlSideChart');
        if (pnlSideCtx) {
            pnlSideChart = new Chart(pnlSideCtx, {
                type: 'doughnut',
                data: {
                    labels: ['BUY (Long)', 'SELL (Short)'],
                    datasets: [{
                        data: [0, 0],
                        backgroundColor: ['#00e676', '#ff4d6d'],
                        borderWidth: 2,
                        borderColor: 'rgba(20, 23, 31, 0.95)',
                        spacing: 3,
                        borderRadius: 4,
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 10
                        }
                    }
                }
            });
        }

        const pnlWinRateCtx = document.getElementById('pnlWinRateChart');
        if (pnlWinRateCtx) {
            pnlWinRateChart = new Chart(pnlWinRateCtx, {
                type: 'doughnut',
                data: {
                    labels: ['BUY Win %', 'SELL Win %'],
                    datasets: [{
                        data: [0, 0],
                        backgroundColor: ['#00e676', '#ff4d6d'],
                        borderWidth: 2,
                        borderColor: 'rgba(20, 23, 31, 0.95)',
                        spacing: 3,
                        borderRadius: 4,
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                label: function(context) {
                                    return ` ${context.label}: ${Number(context.raw || 0).toFixed(2)}%`;
                                }
                            }
                        }
                    }
                }
            });
        }

        const drawdownCtx = document.getElementById('drawdownChart');
        if (drawdownCtx) {
            drawdownChart = new Chart(drawdownCtx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Max Drawdown',
                        data: [],
                        backgroundColor: 'rgba(255, 77, 109, 0.8)',
                        borderColor: '#ff4d6d',
                        borderWidth: 1,
                        borderRadius: 4,
                        maxBarThickness: 18,
                        barPercentage: 0.7,
                        categoryPercentage: 0.8
                    }]
                },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false,
                    layout: {
                        padding: { top: 5, bottom: 5, left: 10, right: 15 }
                    },
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 10,
                            callbacks: {
                                label: function(context) {
                                    return ` Max Drawdown: ${context.raw}%`;
                                }
                            }
                        }
                    }, 
                    scales: { 
                        x: { 
                            beginAtZero: true, 
                            max: 0, 
                            reverse: true,
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: {
                                color: '#8a94a6',
                                font: { family: "'JetBrains Mono', monospace", size: 10 },
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        },
                        y: {
                            grid: { display: false },
                            ticks: {
                                color: '#e0e4eb',
                                font: { family: "'JetBrains Mono', monospace", size: 11, weight: '500' }
                            }
                        }
                    } 
                }
            });
        }
    }

    function fetch24HStatistics(force = false) {
        const pageActive = document.getElementById('statistics-page').classList.contains('active');
        if (!pageActive && !force) return;

        fetch('/api/statistics/24h')
            .then(res => res.json())
            .then(data => {
                const matched = data.liquidations || 0;
                const total = data.totalLiquidations || 0;
                const percent = total > 0 ? ((matched / total) * 100).toFixed(2) : '0.00';

                document.getElementById('stats-liquidations-count').innerText = `${matched} / ${total}`;

                const percentEl = document.getElementById('stats-liquidations-percent');
                if (percentEl) percentEl.innerText = `${percent}%`;

                if (tradesChartInst && data.trades) {
                    const buy = data.trades['BUY'] || 0;
                    const sell = data.trades['SELL'] || 0;
                    tradesChartInst.data.datasets[0].data = [buy, sell];
                    tradesChartInst.update();
                    document.getElementById('stats-trades-buy').innerText = buy;
                    document.getElementById('stats-trades-sell').innerText = sell;

                    const tradesTotalEl = document.getElementById('stats-donut-trades-total');
                    if (tradesTotalEl) tradesTotalEl.innerText = buy + sell;
                }

                if (strategiesChartInst && data.strategies) {
                    const strats = Object.keys(data.strategies);
                    const buys = strats.map(s => data.strategies[s]['BUY'] || 0);
                    const sells = strats.map(s => data.strategies[s]['SELL'] || 0);

                    strategiesChartInst.data.labels = strats;
                    strategiesChartInst.data.datasets[0].data = buys;
                    strategiesChartInst.data.datasets[1].data = sells;
                    strategiesChartInst.update();
                }
            })
            .catch(console.error);
    }

    function fetchPageStatisticsData(force = false) {
        const pageActive = document.getElementById('statistics-page').classList.contains('active');
        if (!pageActive && !force) return;

        fetch('/api/statistics/page-data')
            .then(res => res.json())
            .then(data => {
                if (data.marginHistory && marginHistoryChart) {
                    const maxMargin = data.marginHistory.reduce((max, h) => Math.max(max, h.margin_percent), 0);
                    document.getElementById('stats-highest-margin').innerText = maxMargin.toFixed(2) + '%';

                    let points = data.marginHistory;
                    if (points.length > 100) {
                        const step = Math.ceil(points.length / 100);
                        points = points.filter((_, i) => i % step === 0);
                    }
                    marginHistoryChart.data.labels = points.map(h => new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                    marginHistoryChart.data.datasets[0].data = points.map(h => h.margin_percent.toFixed(2));
                    marginHistoryChart.data.datasets[1].data = points.map(h => h.position_count || 0);
                    marginHistoryChart.data.datasets[1].openSymbols = points.map(h => h.open_symbols || '');
                    marginHistoryChart.data.datasets[2].data = points.map(() => data.isolationThreshold || 10);
                    marginHistoryChart.update();
                }

                if (data.isolationModeCount !== undefined) {
                    document.getElementById('stats-isolation-count').innerText = 'Isolation Activated: ' + data.isolationModeCount;
                }

                if (data.dynamicThresholds) {
                    document.getElementById('stats-dynamic-high').innerText = formatSelectedCurrency(data.dynamicThresholds.max || 0);
                    document.getElementById('stats-dynamic-low').innerText = formatSelectedCurrency(data.dynamicThresholds.min || 0);
                }

                if (data.closedPnls) {
                    let symMap = {};
                    let totalPnL = 0;
                    let buyPosCount = 0;
                    let sellPosCount = 0;
                    let buyPosWin = 0;
                    let sellPosWin = 0;

                    for (let pnl of data.closedPnls) {
                        const amount = Number(pnl.pnl) || 0;
                        symMap[pnl.symbol] = (symMap[pnl.symbol] || 0) + amount;
                        totalPnL += amount;
                        const side = pnl.side ? pnl.side.toUpperCase() : '';
                        if (side === 'SELL' || side === 'LONG' || side === 'BUY_POSITION') {
                            buyPosCount++;
                            if (amount > 0) buyPosWin++;
                        } else if (side === 'BUY' || side === 'SHORT' || side === 'SELL_POSITION') {
                            sellPosCount++;
                            if (amount > 0) sellPosWin++;
                        }
                    }

                    // Update PnL Center Stat
                    const totalPnlEl = document.getElementById('stats-donut-total-pnl');
                    if (totalPnlEl) {
                        const cur = localStorage.getItem('selectedCurrency') || 'USD';
                        const symbol = currencySymbols[cur] || '$';
                        const sign = totalPnL > 0 ? '+' : (totalPnL < 0 ? '-' : '');
                        const convertedTotal = convertFromUsd(Math.abs(totalPnL));
                        const formattedTotal = formatCurrencyValue(convertedTotal, cur);
                        totalPnlEl.innerText = `${sign}${symbol}${formattedTotal}`;
                        totalPnlEl.style.color = totalPnL >= 0 ? '#00e676' : '#ff4d6d';
                    }

                    if (pnlSymbolChart) {
                        const syms = Object.keys(symMap);
                        const cur = localStorage.getItem('selectedCurrency') || 'USD';
                        const symbol = currencySymbols[cur] || '$';

                        pnlSymbolChart.data.labels = syms;
                        pnlSymbolChart.data.datasets[0].data = syms.map(s => convertFromUsd(symMap[s]));
                        const bgColors = syms.map((s, i) => DONUT_PALETTE[i % DONUT_PALETTE.length]);
                        pnlSymbolChart.data.datasets[0].backgroundColor = bgColors;
                        pnlSymbolChart.update();

                        const legendDiv = document.getElementById('pnl-symbol-legend');
                        if (legendDiv) {
                            if (syms.length === 0) {
                                legendDiv.innerHTML = '<span style="color: var(--text-muted); font-size: 11px;">No closed trades recorded</span>';
                            } else {
                                legendDiv.innerHTML = syms.map((s, i) => {
                                    const rawVal = symMap[s];
                                    const pnlSign = rawVal > 0 ? '+' : (rawVal < 0 ? '-' : '');
                                    const pnlColor = rawVal >= 0 ? '#00e676' : '#ff4d6d';
                                    const convertedPnl = convertFromUsd(Math.abs(rawVal));
                                    const formattedPnl = formatCurrencyValue(convertedPnl, cur);
                                    return `
                                        <div class="legend-chip">
                                            <span class="legend-dot" style="background-color: ${bgColors[i]}; box-shadow: 0 0 6px ${bgColors[i]}99;"></span>
                                            <span class="legend-label">${escapeHtml(s)}:</span>
                                            <span class="legend-val mono-num" style="color: ${pnlColor}">${pnlSign}${symbol}${formattedPnl}</span>
                                        </div>
                                    `;
                                }).join('');
                            }
                        }
                    }

                    if (pnlSideChart) {
                        pnlSideChart.data.datasets[0].data = [buyPosCount, sellPosCount];
                        pnlSideChart.update();

                        document.getElementById('stats-pnl-buy-count').innerText = buyPosCount;
                        document.getElementById('stats-pnl-sell-count').innerText = sellPosCount;

                        const sideTotalEl = document.getElementById('stats-pnl-total-count');
                        if (sideTotalEl) sideTotalEl.innerText = buyPosCount + sellPosCount;
                    }

                    if (pnlWinRateChart) {
                        const totalPositions = buyPosCount + sellPosCount;
                        const totalWins = buyPosWin + sellPosWin;
                        const overallWinRate = totalPositions > 0 ? (totalWins / totalPositions) * 100 : 0;
                        const buyWinShare = totalWins > 0 ? (buyPosWin / totalWins) * 100 : 0;
                        const sellWinShare = totalWins > 0 ? (sellPosWin / totalWins) * 100 : 0;

                        pnlWinRateChart.data.datasets[0].data = [buyWinShare, sellWinShare];
                        pnlWinRateChart.update();

                        const buyWinEl = document.getElementById('stats-pnl-buy-win');
                        if (buyWinEl) buyWinEl.innerText = buyWinShare.toFixed(2) + '%';
                        const sellWinEl = document.getElementById('stats-pnl-sell-win');
                        if (sellWinEl) sellWinEl.innerText = sellWinShare.toFixed(2) + '%';

                        const winRateAvgEl = document.getElementById('stats-donut-winrate-avg');
                        if (winRateAvgEl) {
                            winRateAvgEl.innerText = overallWinRate.toFixed(1) + '%';
                            winRateAvgEl.style.color = overallWinRate >= 50 ? '#00e676' : overallWinRate > 0 ? '#ffb300' : 'var(--text-main)';
                        }
                    }
                }

                if (data.drawdowns && drawdownChart) {
                    const sortedDrawdowns = data.drawdowns.sort((a, b) => a.max_drawdown - b.max_drawdown);
                    drawdownChart.data.labels = sortedDrawdowns.map(d => d.symbol);
                    drawdownChart.data.datasets[0].data = sortedDrawdowns.map(d => d.max_drawdown.toFixed(2));
                    drawdownChart.update();
                }
            })
            .catch(console.error);
    }

    initStatisticsCharts();
    setInterval(fetch24HStatistics, 3000);
    setInterval(fetchPageStatisticsData, 3000);
    fetch24HStatistics();
    fetchPageStatisticsData();

    // ── Share Statistics Button Logic ─────────────────────────────
    const shareBtn = document.getElementById('share-statistics-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const originalText = shareBtn.innerHTML;
            shareBtn.innerHTML = 'Generating...';
            shareBtn.disabled = true;

            try {
                // Target the entire page-section inside statistics page to capture all charts and stats
                const dashboard = document.querySelector('#statistics-page .page-section');
                if (!dashboard) throw new Error('Dashboard not found');

                // Add temporary header for the screenshot
                const tempHeader = document.createElement('div');
                tempHeader.style.display = 'flex';
                tempHeader.style.justifyContent = 'center';
                tempHeader.style.marginBottom = '25px';
                tempHeader.style.marginTop = '10px';
                tempHeader.innerHTML = '<h1 class="logo" style="margin:0; font-size: 2.2rem;">🚀 Liquidation <span class="highlight">Trader</span> <span style="color: var(--text-muted); font-weight: 500; margin-left: 8px;">Statistics</span></h1>';
                dashboard.insertBefore(tempHeader, dashboard.firstChild);

                // Generate canvas
                const canvas = await html2canvas(dashboard, {
                    backgroundColor: '#1a1a2e', // Match theme background
                    scale: 2, // Higher resolution
                    onclone: (clonedDoc) => {
                        // Add padding to the captured area for better framing
                        const clonedDashboard = clonedDoc.querySelector('#statistics-page .page-section');
                        if (clonedDashboard) {
                            clonedDashboard.style.padding = '15px';
                            clonedDashboard.style.boxSizing = 'border-box';
                        }

                        // html2canvas doesn't support background-clip: text properly.
                        // We need to replace the gradient with a solid color for the screenshot.
                        const highlightTexts = clonedDoc.querySelectorAll('.highlight-text');
                        highlightTexts.forEach(el => {
                            el.style.background = 'none';
                            el.style.webkitBackgroundClip = 'initial';
                            el.style.webkitTextFillColor = 'initial';
                            el.style.color = '#00e676'; // Set to our primary green color
                        });
                    }
                });

                // Remove temporary header
                dashboard.removeChild(tempHeader);

                // Convert canvas to blob
                canvas.toBlob(async (blob) => {
                    if (!blob) throw new Error('Failed to create image blob');

                    const file = new File([blob], 'statistics-snapshot.png', { type: 'image/png' });

                    // Try Web Share API first
                    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                        try {
                            await navigator.share({
                                files: [file],
                                title: 'My Trading Statistics',
                                text: 'Check out my latest trading statistics!'
                            });
                        } catch (err) {
                            if (err.name !== 'AbortError') {
                                console.error('Share failed:', err);
                                downloadImage(blob);
                            }
                        }
                    } else {
                        // Fallback to direct download
                        downloadImage(blob);
                    }
                    
                    // Reset button state
                    shareBtn.innerHTML = originalText;
                    shareBtn.disabled = false;
                }, 'image/png');

            } catch (error) {
                console.error('Error generating share image:', error);
                shareBtn.innerHTML = originalText;
                shareBtn.disabled = false;
                showToast('Failed to generate image', 'error'); // Assuming a showToast function exists
            }
        });

        function downloadImage(blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'statistics-snapshot.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }


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
                    CB_BYPASS_ON_POSITION: 'false',
                    RSI_OVERBOUGHT_DIR: 'above',
                    RSI_OVERSOLD_DIR: 'under',
                    RSI_OVERBOUGHT_SIGNAL: 'sell',
                    RSI_OVERSOLD_SIGNAL: 'buy',
                    RSI_BYPASS_ON_POSITION: 'false',
                    DMI_THRESHOLD_DIR: 'under',
                    DMI_THRESHOLD_UPPER: '30',
                    DMI_PDI_SIGNAL: 'sell',
                    DMI_MDI_SIGNAL: 'buy',
                    DMI_BYPASS_ON_POSITION: 'false',
                    MS_BULLISH_SIGNAL: 'buy',
                    MS_BEARISH_SIGNAL: 'sell',
                    MS_EXTREME_FEAR_SIGNAL: 'none',
                    MS_EXTREME_GREED_SIGNAL: 'none',
                    MS_BYPASS_ON_POSITION: 'false',
                    SNEAKY_PIVOT_BUY_SIGNAL: 'buy',
                    SNEAKY_PIVOT_SELL_SIGNAL: 'sell',
                    SNEAKY_PIVOT_BYPASS_ON_POSITION: 'false'
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

// --- Account History Modal Logic ---
window.openAccountHistoryModal = function() {
    const modal = document.getElementById('accountHistoryModal');
    if (modal) {
        modal.style.display = 'flex';
        fetchAccountHistory();
    }
};

let accountHistoryChartInstance = null;
let cachedTransfers = [];
let currentTransfersPage = 1;
const TRANSFERS_PER_PAGE = 10;

function fetchAccountHistory() {
    fetch('/api/account-history')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                renderAccountHistoryChart(data.chartData);
                cachedTransfers = data.transfers || [];
                currentTransfersPage = 1;
                renderTransfersTable();
            }
        })
        .catch(err => console.error('Error fetching account history', err));
}

function renderAccountHistoryChart(chartData) {
    const ctx = document.getElementById('accountHistoryChart');
    if (!ctx) return;
    
    if (accountHistoryChartInstance) {
        accountHistoryChartInstance.destroy();
    }
    
    const labels = chartData.map(d => d.date);
    const walletValues = chartData.map(d => d.total_wallet_value);
    const cumulativeTransfers = chartData.map(d => d.cumulative_transfer);

    accountHistoryChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Wallet Value',
                    data: walletValues,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.1)',
                    borderWidth: 2,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'Cumulative Transfer (TP)',
                    data: cumulativeTransfers,
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    borderWidth: 2,
                    tension: 0.1,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                title: { display: false }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b949e' }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b949e' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#8b949e' }
                }
            }
        }
    });
}

function renderTransfersTable() {
    const tbody = document.getElementById('transfersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const startIdx = (currentTransfersPage - 1) * TRANSFERS_PER_PAGE;
    const endIdx = startIdx + TRANSFERS_PER_PAGE;
    const pageData = cachedTransfers.slice(startIdx, endIdx);
    
    pageData.forEach(tr => {
        const row = document.createElement('tr');
        const date = new Date(tr.timestamp).toLocaleString();
        row.innerHTML = `
            <td>${date}</td>
            <td style="color: var(--success-color)">+${formatSelectedCurrency(tr.amount)}</td>
            <td>${tr.from_account}</td>
            <td style="text-align: right;">${tr.to_account}</td>
        `;
        tbody.appendChild(row);
    });
    
    if (pageData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No internal transfers recorded.</td></tr>';
    }
    
    document.getElementById('transfersPageInfo').textContent = `Page ${currentTransfersPage} of ${Math.max(1, Math.ceil(cachedTransfers.length / TRANSFERS_PER_PAGE))}`;
    document.getElementById('prevTransfersBtn').disabled = currentTransfersPage === 1;
    document.getElementById('nextTransfersBtn').disabled = endIdx >= cachedTransfers.length;
}

document.addEventListener('DOMContentLoaded', () => {
    // Modal events
    const closeBtn = document.getElementById('closeAccountHistoryBtn');
    const modal = document.getElementById('accountHistoryModal');
    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }
    
    const prevBtn = document.getElementById('prevTransfersBtn');
    const nextBtn = document.getElementById('nextTransfersBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentTransfersPage > 1) {
                currentTransfersPage--;
                renderTransfersTable();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if ((currentTransfersPage * TRANSFERS_PER_PAGE) < cachedTransfers.length) {
                currentTransfersPage++;
                renderTransfersTable();
            }
        });
    }

    // ── Connection Status Diagnostics & Health Monitor ─────────────
    let cachedConnections = [];
    let cachedConnectionSummary = null;
    let selectedConnCategory = 'all';
    let connSearchQuery = '';

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatTimeAgo(timestamp) {
        if (!timestamp) return 'Never';
        const diffMs = Date.now() - timestamp;
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 5) return 'Just now';
        if (diffSec < 60) return `${diffSec}s ago`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
    }

    function formatUptime(seconds) {
        if (!seconds && seconds !== 0) return '--';
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        if (m < 60) return `${m}m ${s}s`;
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return `${h}h ${rm}m`;
    }

    function getLatencyClass(latency) {
        if (!latency || latency <= 0) return '';
        if (latency < 150) return 'latency-good';
        if (latency < 400) return 'latency-warn';
        return 'latency-slow';
    }

    function getProtocolTag(protocol) {
        const p = (protocol || 'REST').toUpperCase();
        if (p === 'WSS' || p === 'WS') return '<span class="proto-tag tag-wss">WSS</span>';
        if (p === 'HTTPS' || p === 'HTTP') return '<span class="proto-tag tag-http">HTTPS</span>';
        return '<span class="proto-tag tag-rest">REST</span>';
    }

    function fetchConnectionStatus() {
        return fetch('/api/connections/status')
            .then(res => res.json())
            .then(data => {
                cachedConnections = data.connections || [];
                cachedConnectionSummary = data.summary || null;

                updateSidebarConnectionWidget(cachedConnectionSummary, cachedConnections);
                renderConnectionHeroMetrics(cachedConnectionSummary, cachedConnections);
                renderFilteredConnections();
            })
            .catch(err => {
                console.error('Failed to fetch connection status:', err);
            });
    }

    function updateSidebarConnectionWidget(summary, connections) {
        if (!summary) return;

        const badgeEl = document.getElementById('sidebar-overall-badge');
        const dotConsolidated = document.getElementById('dot-consolidated');
        const dotWs = document.getElementById('dot-ws');
        const valWs = document.getElementById('val-ws');
        const dotRest = document.getElementById('dot-rest');
        const valRest = document.getElementById('val-rest');
        const dotExt = document.getElementById('dot-ext');
        const valExt = document.getElementById('val-ext');

        // Consolidated status dot for collapsed sidebar
        if (dotConsolidated) {
            dotConsolidated.className = 'conn-dot';
            if (summary.error > 0) {
                dotConsolidated.classList.add('dot-error');
            } else if (summary.connecting > 0) {
                dotConsolidated.classList.add('dot-warning');
            } else if (summary.connected > 0) {
                dotConsolidated.classList.add('dot-connected');
            } else {
                dotConsolidated.classList.add('dot-idle');
            }
        }

        // Overall status badge
        if (badgeEl) {
            badgeEl.className = 'conn-widget-badge';
            if (summary.error > 0) {
                badgeEl.classList.add('badge-danger');
                badgeEl.textContent = `${summary.error} Err`;
            } else if (summary.connecting > 0) {
                badgeEl.classList.add('badge-warning');
                badgeEl.textContent = 'Connecting';
            } else if (summary.connected > 0) {
                badgeEl.classList.add('badge-healthy');
                badgeEl.textContent = 'Operational';
            } else {
                badgeEl.textContent = 'Idle';
            }
        }

        // Category 1: WebSocket
        const wsCat = summary.categories?.websocket || {};
        if (dotWs && valWs) {
            dotWs.className = 'conn-dot';
            if (wsCat.error > 0) {
                dotWs.classList.add('dot-error');
                valWs.textContent = 'ERR';
                valWs.style.color = '#ff3b3b';
            } else if (wsCat.connected > 0) {
                dotWs.classList.add('dot-connected');
                valWs.textContent = `${wsCat.connected} Active`;
                valWs.style.color = '#00e676';
            } else {
                dotWs.classList.add('dot-idle');
                valWs.textContent = 'Idle';
                valWs.style.color = 'var(--text-muted)';
            }
        }

        // Category 2: Exchange REST
        const restCat = summary.categories?.exchange_rest || {};
        if (dotRest && valRest) {
            dotRest.className = 'conn-dot';
            if (restCat.error > 0) {
                dotRest.classList.add('dot-error');
                valRest.textContent = 'ERR';
                valRest.style.color = '#ff3b3b';
            } else if (restCat.avgLatencyMs) {
                dotRest.classList.add('dot-connected');
                valRest.textContent = `${restCat.avgLatencyMs}ms`;
                valRest.style.color = '#00e676';
            } else if (restCat.connected > 0) {
                dotRest.classList.add('dot-connected');
                valRest.textContent = 'OK';
                valRest.style.color = '#00e676';
            } else {
                dotRest.classList.add('dot-idle');
                valRest.textContent = 'Idle';
                valRest.style.color = 'var(--text-muted)';
            }
        }

        // Category 3: External APIs
        const extCat = summary.categories?.external_api || {};
        if (dotExt && valExt) {
            dotExt.className = 'conn-dot';
            if (extCat.error > 0) {
                dotExt.classList.add('dot-error');
                valExt.textContent = 'ERR';
                valExt.style.color = '#ff3b3b';
            } else if (extCat.avgLatencyMs) {
                dotExt.classList.add('dot-connected');
                valExt.textContent = `${extCat.avgLatencyMs}ms`;
                valExt.style.color = '#00e676';
            } else if (extCat.connected > 0) {
                dotExt.classList.add('dot-connected');
                valExt.textContent = 'OK';
                valExt.style.color = '#00e676';
            } else {
                dotExt.classList.add('dot-idle');
                valExt.textContent = 'Idle';
                valExt.style.color = 'var(--text-muted)';
            }
        }
    }

    function renderConnectionHeroMetrics(summary, connections) {
        if (!summary) return;

        // Overall
        const heroOverallVal = document.getElementById('hero-overall-val');
        const heroOverallSub = document.getElementById('hero-overall-sub');
        const heroUptimeMeta = document.getElementById('hero-uptime-meta');

        const activeTotal = summary.connected;
        const totalTracked = summary.total - (summary.disabled || 0);
        const healthPct = totalTracked > 0 ? Math.round((activeTotal / totalTracked) * 100) : 0;

        if (heroOverallVal) heroOverallVal.textContent = `${healthPct}%`;
        if (heroOverallSub) heroOverallSub.textContent = `${summary.connected}/${summary.total} Active`;
        if (heroUptimeMeta) heroUptimeMeta.textContent = `Uptime: ${formatUptime(summary.uptimeSeconds)} · ${summary.error} Errors`;

        // WS
        const wsCat = summary.categories?.websocket || {};
        const heroWsVal = document.getElementById('hero-ws-val');
        const heroWsSub = document.getElementById('hero-ws-sub');
        if (heroWsVal) heroWsVal.textContent = `${wsCat.connected} / ${wsCat.total} Active`;
        if (heroWsSub) heroWsSub.textContent = `${(wsCat.messageCount || 0).toLocaleString()} msgs`;

        // Exchange REST
        const restCat = summary.categories?.exchange_rest || {};
        const heroRestVal = document.getElementById('hero-rest-val');
        const heroRestSub = document.getElementById('hero-rest-sub');
        if (heroRestVal) heroRestVal.textContent = restCat.avgLatencyMs ? `${restCat.avgLatencyMs} ms avg` : (restCat.connected > 0 ? 'Active' : 'Idle');
        if (heroRestSub) heroRestSub.textContent = `${(restCat.requestCount || 0).toLocaleString()} reqs`;

        // External APIs
        const extCat = summary.categories?.external_api || {};
        const heroExtVal = document.getElementById('hero-ext-val');
        const heroExtSub = document.getElementById('hero-ext-sub');
        if (heroExtVal) heroExtVal.textContent = extCat.avgLatencyMs ? `${extCat.avgLatencyMs} ms avg` : (extCat.connected > 0 ? 'Active' : 'Idle');
        if (heroExtSub) heroExtSub.textContent = `${(extCat.requestCount || 0).toLocaleString()} reqs`;

        // Tab counts
        const countAll = document.getElementById('count-all');
        const countWs = document.getElementById('count-ws');
        const countRest = document.getElementById('count-rest');
        const countExt = document.getElementById('count-ext');

        if (countAll) countAll.textContent = summary.total;
        if (countWs) countWs.textContent = wsCat.total || 0;
        if (countRest) countRest.textContent = restCat.total || 0;
        if (countExt) countExt.textContent = extCat.total || 0;
    }

    function renderFilteredConnections() {
        const grid = document.getElementById('connections-grid');
        if (!grid) return;

        let filtered = cachedConnections.slice();

        // Filter by category
        if (selectedConnCategory !== 'all') {
            filtered = filtered.filter(c => c.category === selectedConnCategory);
        }

        // Filter by search query
        if (connSearchQuery.trim()) {
            const q = connSearchQuery.toLowerCase().trim();
            filtered = filtered.filter(c => 
                (c.name && c.name.toLowerCase().includes(q)) ||
                (c.target && c.target.toLowerCase().includes(q)) ||
                (c.id && c.id.toLowerCase().includes(q)) ||
                (c.protocol && c.protocol.toLowerCase().includes(q)) ||
                (c.details?.type && c.details.type.toLowerCase().includes(q))
            );
        }

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                    No connection endpoints match the current filter or search criteria.
                </div>
            `;
            return;
        }

        grid.innerHTML = filtered.map(conn => {
            const status = conn.status || 'idle';
            const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
            const latencyText = conn.lastLatencyMs !== null && conn.lastLatencyMs !== undefined ? `${conn.lastLatencyMs} ms` : '--';
            const latencyClass = getLatencyClass(conn.lastLatencyMs);
            const isWs = conn.category === 'websocket';
            const counterTitle = isWs ? 'Messages' : 'Requests';
            const counterVal = (isWs ? conn.messageCount : conn.requestCount) || 0;
            const errorCount = conn.errorCount || 0;
            const lastActiveText = formatTimeAgo(conn.lastActivity);

            let errorHtml = '';
            if (conn.lastError && (status === 'error' || errorCount > 0)) {
                errorHtml = `
                    <div class="conn-error-banner" title="${escapeHtml(conn.lastError)}">
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0;">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(conn.lastError)}</span>
                    </div>
                `;
            }

            return `
                <div class="conn-item-card status-${status}" id="conn-card-${conn.id}">
                    <div class="conn-item-top">
                        <div class="conn-item-title-wrap">
                            <div class="conn-item-title-row">
                                ${getProtocolTag(conn.protocol)}
                                <span class="conn-item-name">${escapeHtml(conn.name)}</span>
                            </div>
                            <span class="conn-item-desc">${escapeHtml(conn.details?.type || conn.category)}</span>
                        </div>
                        <div class="conn-status-badge badge-${status}">
                            <span class="conn-dot dot-${status}"></span>
                            <span>${statusLabel}</span>
                        </div>
                    </div>

                    <div class="conn-item-target-box" title="${escapeHtml(conn.target)}">
                        ${escapeHtml(conn.target)}
                    </div>

                    <div class="conn-item-metrics">
                        <div class="conn-metric-col">
                            <span class="conn-metric-title">Latency</span>
                            <span class="conn-metric-num ${latencyClass}">${latencyText}</span>
                        </div>
                        <div class="conn-metric-col">
                            <span class="conn-metric-title">${counterTitle}</span>
                            <span class="conn-metric-num">${counterVal.toLocaleString()}</span>
                        </div>
                        <div class="conn-metric-col">
                            <span class="conn-metric-title">Errors</span>
                            <span class="conn-metric-num" style="${errorCount > 0 ? 'color: #ff3b3b;' : ''}">${errorCount}</span>
                        </div>
                    </div>

                    ${errorHtml}

                    <div class="conn-item-footer">
                        <span>Last seen: <strong>${lastActiveText}</strong></span>
                        <button class="btn-test-conn" data-conn-id="${conn.id}" title="Ping / Test connection now">
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            <span>Test</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Attach event listeners to test buttons
        grid.querySelectorAll('.btn-test-conn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.connId;
                testIndividualConnection(id, btn);
            });
        });
    }

    function testIndividualConnection(id, btn) {
        if (!btn) return;
        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="spinning-icon" width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="32" stroke-linecap="round" fill="none"></circle>
            </svg>
            <span>Testing...</span>
        `;

        fetch('/api/connections/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        })
            .then(res => res.json())
            .then(data => {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                if (data.success && (data.result?.success || data.result?.latencyMs !== undefined)) {
                    showToast({
                        title: 'Connection Test Passed',
                        message: `${id}: Latency ${data.result?.latencyMs !== undefined ? data.result.latencyMs + 'ms' : 'OK'}`,
                        type: 'success'
                    });
                } else {
                    showToast({
                        title: 'Connection Test Result',
                        message: `${id}: ${data.result?.message || data.error || 'Status: ' + (data.result?.status || 'idle')}`,
                        type: data.result?.status === 'disabled' ? 'info' : 'warning'
                    });
                }
                fetchConnectionStatus();
            })
            .catch(err => {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                showToast({
                    title: 'Test Failed',
                    message: err.message,
                    type: 'error'
                });
                fetchConnectionStatus();
            });
    }

    function testAllConnections() {
        const btn = document.getElementById('btn-test-all-connections');
        if (!btn) return;

        const origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="spinning-icon" width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="32" stroke-linecap="round" fill="none"></circle>
            </svg>
            <span>Testing All...</span>
        `;

        fetch('/api/connections/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'all' })
        })
            .then(res => res.json())
            .then(data => {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                showToast({
                    title: 'Health Probe Complete',
                    message: 'Finished running diagnostics across all endpoints.',
                    type: 'success'
                });
                fetchConnectionStatus();
            })
            .catch(err => {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                showToast({
                    title: 'Probe Error',
                    message: err.message,
                    type: 'error'
                });
                fetchConnectionStatus();
            });
    }

    // Connect toolbar controls
    const tabButtons = document.querySelectorAll('.conn-tab');
    tabButtons.forEach(tab => {
        tab.addEventListener('click', () => {
            tabButtons.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            selectedConnCategory = tab.dataset.category || 'all';
            renderFilteredConnections();
        });
    });

    const searchInput = document.getElementById('conn-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            connSearchQuery = e.target.value;
            renderFilteredConnections();
        });
    }

    const refreshBtn = document.getElementById('btn-refresh-connections');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            fetchConnectionStatus();
            showToast({ title: 'Refreshed', message: 'Connection statuses updated.', type: 'info' });
        });
    }

    const testAllBtn = document.getElementById('btn-test-all-connections');
    if (testAllBtn) {
        testAllBtn.addEventListener('click', testAllConnections);
    }

    // Initial connection fetch & background periodic update (every 3.5s)
    fetchConnectionStatus();
    setInterval(() => {
        fetchConnectionStatus();
    }, 3500);
});
