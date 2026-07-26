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
                    if (['WEBUI_AUTH_ENABLED', 'CMC_FILTER_ENABLED', 'ENABLE_CIRCUIT_BREAKER', 'ENABLE_VWAP_STRATEGY', 'ENABLE_RSI_STRATEGY', 'ENABLE_DMI_STRATEGY', 'ENABLE_MARKET_SENTIMENT_STRATEGY', 'ENABLE_TRAILING_PROFIT', 'ENABLE_DCA_MARTINGALE', 'ENABLE_DYNAMIC_THRESHOLDS', 'ENABLE_RUNAWAY_HELPER', 'REPLACE_BELOW_MIN_THRESHOLD', 'ENABLE_AUTO_TRANSFER', 'ENABLE_ISOLATION_MODE', 'REDUCE_TP_TRAILING_BY_HALF_IN_ISOLATION', 'ENABLE_ANON_REPORTING', 'ENABLE_24H_VOLUME_FILTER', 'ENABLE_PAPER_TRADING'].includes(key)) {
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

        const anonCb = document.getElementById('ENABLE_ANON_REPORTING');
        if (anonCb) formData.set('ENABLE_ANON_REPORTING', anonCb.checked ? 'true' : 'false');

        const paperCb = document.getElementById('ENABLE_PAPER_TRADING');
        if (paperCb) formData.set('ENABLE_PAPER_TRADING', paperCb.checked ? 'true' : 'false');

        const isVwapChecked = vwapCb && vwapCb.checked;
        const isRsiChecked = rsiCb && rsiCb.checked;
        const isDmiChecked = dmiCb && dmiCb.checked;
        const isFgChecked = fgCb && fgCb.checked;

        if (!isVwapChecked && !isRsiChecked && !isDmiChecked && !isFgChecked) {
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
            'MS_BULLISH_SIGNAL', 'MS_BEARISH_SIGNAL', 'MS_EXTREME_FEAR_SIGNAL', 'MS_EXTREME_GREED_SIGNAL', 'MS_BYPASS_ON_POSITION'
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
    const isolationStatusDot = document.getElementById('isolation-status-indicator')?.querySelector('.dot');
    const isolationStatusText = document.getElementById('isolation-status-text');
    const controlMsg = document.getElementById('control-msg');
    let currentBtcPrice = 0;
    let lastIsolationMode = null;

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

    window.renderPositionStats = function (symbol) {
        const position = currentPositionsList.find(p => p.symbol === symbol);
        if (!position) return;

        const sideStr = (position.side || '').toLowerCase();
        const isBuy = sideStr === 'buy' || sideStr === 'long';
        const sideClz = isBuy ? 'buy' : 'sell';

        let posValue = (parseFloat(position.size || 0) * parseFloat(position.entry_price || 0));
        let posValueStr = posValue > 0 ? posValue.toFixed(4) : '0.0000';

        let trailingActivationPercent = parseFloat(document.getElementById('TRAILING_ACTIVATION_PERCENTAGE')?.value || 0);
        let trailingPriceStr = 'N/A';
        if (trailingActivationPercent > 0) {
            let multiplier = trailingActivationPercent / 100;
            let tp = isBuy ? (position.entry_price * (1 + multiplier)) : (position.entry_price * (1 - multiplier));
            trailingPriceStr = tp.toFixed(4);
        }

        let leverage = parseInt(document.getElementById('TRADE_LEVERAGE')?.value || 10);
        let margin = posValue / leverage;
        let marginStr = margin > 0 ? margin.toFixed(4) : '0.0000';
        let pnlPercentStr = '0.00%';
        if (margin > 0) {
            let pnlPercent = (parseFloat(position.unrealized_pnl || 0) / margin) * 100;
            pnlPercentStr = (pnlPercent > 0 ? '+' : '') + pnlPercent.toFixed(2) + '%';
        }

        document.getElementById('position-detail-stats').innerHTML = `
            <div class="position-detail-banner" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 30px; margin-top: 10px; border-left: 4px solid ${isBuy ? 'var(--accent)' : 'var(--danger)'};">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 20px; margin-bottom: 20px;">
                    <div style="font-size: 28px; font-weight: 800; letter-spacing: -1px;">${position.symbol}</div>
                    <div class="pos-side ${sideClz}" style="font-size: 14px; padding: 6px 14px;">${(position.side || 'UNKNOWN').toUpperCase()}</div>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 24px;">
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Size</span>
                        <span class="pos-detail-value" style="font-size: 18px;">${position.size}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Entry Price</span>
                        <span class="pos-detail-value" style="font-size: 18px;">${parseFloat(position.entry_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Mark Price</span>
                        <span class="pos-detail-value" style="font-size: 18px;">${parseFloat(position.mark_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Liq. Price</span>
                        <span class="pos-detail-value" style="color: var(--danger); font-size: 18px;">${parseFloat(position.liq_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">TP Price</span>
                        <span class="pos-detail-value" style="color: var(--accent); font-size: 18px;">${parseFloat(position.tp_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">SL Price</span>
                        <span class="pos-detail-value" style="color: var(--danger); font-size: 18px;">${parseFloat(position.sl_price || 0).toFixed(4)}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Trailing Price</span>
                        <span class="pos-detail-value" style="font-size: 18px;">${trailingPriceStr}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Value</span>
                        <span class="pos-detail-value" style="font-size: 18px;">${posValueStr}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Margin</span>
                        <span class="pos-detail-value" style="font-size: 18px;">${marginStr}</span>
                    </div>
                    <div class="pos-detail-item">
                        <span class="pos-detail-label">Last Update</span>
                        <span class="pos-detail-value" style="font-size: 16px;">${position.updated_at ? new Date(position.updated_at).toLocaleTimeString() : 'Unknown'}</span>
                    </div>
                    <div class="pos-detail-item" style="border-left: 1px solid var(--border-color); padding-left: 20px; min-width: max-content;">
                        <span class="pos-detail-label">Unrealized PnL</span>
                        <div style="font-size: 22px; font-weight: 800; margin-top: 4px;">
                            ${formatPnl(position.unrealized_pnl)} 
                            <span style="font-size: 14px; font-weight: 600; color: ${parseFloat(position.unrealized_pnl) >= 0 ? 'var(--accent)' : 'var(--danger)'}; margin-left: 4px;">(${pnlPercentStr})</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    window.closePositionDetail = function () {
        document.getElementById('position-detail-page').classList.remove('active');
        document.getElementById('positions').classList.add('active');

        if (currentTvWidget) {
            currentTvWidget.remove();
            currentTvWidget = null;
        }
    };

    window.refreshPositions = function () {
        const btn = document.getElementById('refresh-positions-btn');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        const originalText = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-right: 4px; animation: spin 1s linear infinite;">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                        </svg>
                        Refreshing...`;

        fetch('/api/positions/refresh', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast({ title: 'Success', message: 'Positions manually refreshed.', type: 'success' });
                    fetchAccountData(); // Update UI
                } else {
                    showToast({ title: 'Error', message: data.message || 'Failed to refresh positions.', type: 'error' });
                }
            })
            .catch(err => {
                console.error(err);
                showToast({ title: 'Error', message: 'Failed to trigger refresh.', type: 'error' });
            })
            .finally(() => {
                let countdown = 60;
                btn.innerHTML = `Wait ${countdown}s`;
                const timer = setInterval(() => {
                    countdown--;
                    if (countdown <= 0) {
                        clearInterval(timer);
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    } else {
                        btn.innerHTML = `Wait ${countdown}s`;
                    }
                }, 1000);
            });
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
                    currentPositionsList = data;
                    positionsContainer.innerHTML = data.map(p => {
                        const sideStr = (p.side || '').toLowerCase();
                        const isBuy = sideStr === 'buy' || sideStr === 'long';
                        const sideClz = isBuy ? 'buy' : 'sell';
                        const cardClz = isBuy ? 'pos-card-buy' : 'pos-card-sell';
                        const sideText = (p.side || 'UNKNOWN').toUpperCase();

                        return `
                        <div class="position-card ${cardClz}">
                            <div class="pos-header">
                                <div class="pos-symbol" style="cursor: pointer; text-decoration: underline;" onclick="openPositionDetail('${p.symbol}')" title="View Details">${p.symbol}</div>
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

                let currentPositionsCount = 0;
                let cumulativePnl = 0;
                if (data && data.length > 0) {
                    currentPositionsCount = data.length;
                    cumulativePnl = data.reduce((sum, p) => sum + (parseFloat(p.unrealized_pnl) || 0), 0);
                }
                
                const summaryBar = document.getElementById('positions-summary-bar');
                if (summaryBar) {
                    summaryBar.style.display = currentPositionsCount > 1 ? 'flex' : 'none';
                }

                const elSummaryCount = document.getElementById('summary-current-positions');
                const elSummaryPnl = document.getElementById('summary-cumulative-pnl');
                
                if (elSummaryCount) elSummaryCount.textContent = currentPositionsCount;
                if (elSummaryPnl) {
                    const cur = localStorage.getItem('selectedCurrency') || 'USD';
                    const convertedPnl = convertFromUsd(cumulativePnl);
                    const pnlText = (convertedPnl > 0 ? '+' : '') + convertedPnl.toFixed(2) + ' ' + cur;
                    elSummaryPnl.textContent = pnlText;
                    elSummaryPnl.style.color = convertedPnl >= 0 ? 'var(--accent)' : 'var(--danger)';
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
            tbodyTradeDecisions.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">${searchVal ? `&mdash; No matching trade evaluations found for "${searchVal}" &mdash;` : '&mdash; No trade evaluations tracked yet &mdash;'}</td></tr>`;
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

    // ── 24H Statistics Dashboard ──────────────────────────────────
    let tradesChartInst = null;
    let strategiesChartInst = null;
    let marginHistoryChart = null;
    let pnlSymbolChart = null;
    let pnlSideChart = null;
    let pnlWinRateChart = null;
    let drawdownChart = null;

    function initStatisticsCharts() {
        const tradesCtx = document.getElementById('tradesChart');
        if (tradesCtx) {
            tradesChartInst = new Chart(tradesCtx, {
                type: 'doughnut',
                data: {
                    labels: ['BUY', 'SELL'],
                    datasets: [{
                        data: [0, 0],
                        backgroundColor: ['#00e676', '#ff3b3b'],
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#8a94a6',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1
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
                            label: 'BUY',
                            data: [],
                            backgroundColor: '#00e676',
                            borderRadius: 4
                        },
                        {
                            label: 'SELL',
                            data: [],
                            backgroundColor: '#ff3b3b',
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: false, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { stacked: false, beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }
                    },
                    plugins: {
                        legend: { labels: { color: '#8a94a6' } },
                        tooltip: {
                            backgroundColor: 'rgba(20, 23, 31, 0.95)',
                            titleColor: '#e0e4eb',
                            bodyColor: '#e0e4eb',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1
                        }
                    }
                }
            });
        }

        const marginCtx = document.getElementById('marginHistoryChart');
        if (marginCtx) {
            marginHistoryChart = new Chart(marginCtx, {
                type: 'line',
                data: { labels: [], datasets: [
                    { label: 'Used Margin (%)', data: [], borderColor: '#00e676', backgroundColor: 'rgba(0, 230, 118, 0.1)', fill: true, tension: 0.4, yAxisID: 'y' },
                    { label: 'Position Count', data: [], borderColor: '#2196f3', backgroundColor: 'rgba(33, 150, 243, 0.1)', fill: false, tension: 0.4, yAxisID: 'y1', borderDash: [5, 5] },
                    { label: 'Isolation Threshold', data: [], borderColor: '#ff3d00', backgroundColor: 'transparent', fill: false, tension: 0, yAxisID: 'y', pointRadius: 0, borderDash: [2, 2] }
                ] },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { 
                        legend: { display: true, labels: { color: 'rgba(255, 255, 255, 0.7)' } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) label += ': ';
                                    if (context.parsed.y !== null) label += context.parsed.y;
                                    if (context.dataset.label === 'Position Count' && context.dataset.openSymbols) {
                                        const symbols = context.dataset.openSymbols[context.dataIndex];
                                        if (symbols) {
                                            label += ` (${symbols})`;
                                        }
                                    }
                                    return label;
                                }
                            }
                        }
                    }, 
                    scales: { 
                        y: { beginAtZero: true, suggestedMax: 20, position: 'left' },
                        y1: { beginAtZero: true, suggestedMax: 5, position: 'right', grid: { drawOnChartArea: false }, ticks: { stepSize: 1 } }
                    } 
                }
            });
        }

        const pnlSymCtx = document.getElementById('pnlSymbolChart');
        if (pnlSymCtx) {
            pnlSymbolChart = new Chart(pnlSymCtx, {
                type: 'doughnut',
                data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
            });
        }

        const pnlSideCtx = document.getElementById('pnlSideChart');
        if (pnlSideCtx) {
            pnlSideChart = new Chart(pnlSideCtx, {
                type: 'doughnut',
                data: { labels: ['BUY Position', 'SELL Position'], datasets: [{ data: [0, 0], backgroundColor: ['#00e676', '#ff3b3b'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
            });
        }

        const pnlWinRateCtx = document.getElementById('pnlWinRateChart');
        if (pnlWinRateCtx) {
            pnlWinRateChart = new Chart(pnlWinRateCtx, {
                type: 'doughnut',
                data: { labels: ['Win % (BUY pos)', 'Win % (SELL pos)'], datasets: [{ data: [0, 0], backgroundColor: ['#00e676', '#ff3b3b'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
            });
        }

        const drawdownCtx = document.getElementById('drawdownChart');
        if (drawdownCtx) {
            drawdownChart = new Chart(drawdownCtx, {
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Max Drawdown', data: [], backgroundColor: 'rgba(255, 59, 59, 0.8)', borderRadius: 4 }] },
                options: { 
                    indexAxis: 'y', 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { 
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return context.raw + '%';
                                }
                            }
                        }
                    }, 
                    scales: { 
                        x: { 
                            beginAtZero: true, 
                            max: 0, 
                            reverse: true,
                            ticks: {
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        } 
                    } 
                }
            });
        }
    }

    function fetch24HStatistics() {
        const pageActive = document.getElementById('statistics-page').classList.contains('active');
        if (!pageActive) return;

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

    function fetchPageStatisticsData() {
        const pageActive = document.getElementById('statistics-page').classList.contains('active');
        if (!pageActive) return;

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
                    document.getElementById('stats-dynamic-high').innerText = '$' + (data.dynamicThresholds.max || 0).toFixed(2);
                    document.getElementById('stats-dynamic-low').innerText = '$' + (data.dynamicThresholds.min || 0).toFixed(2);
                }

                if (data.closedPnls) {
                    let symMap = {};
                    let buyPosCount = 0;
                    let sellPosCount = 0;
                    let buyPosWin = 0;
                    let sellPosWin = 0;

                    for (let pnl of data.closedPnls) {
                        symMap[pnl.symbol] = (symMap[pnl.symbol] || 0) + pnl.pnl;
                        const side = pnl.side ? pnl.side.toUpperCase() : '';
                        if (side === 'SELL' || side === 'LONG' || side === 'BUY_POSITION') {
                            buyPosCount++;
                            if (pnl.pnl > 0) buyPosWin++;
                        } else if (side === 'BUY' || side === 'SHORT' || side === 'SELL_POSITION') {
                            sellPosCount++;
                            if (pnl.pnl > 0) sellPosWin++;
                        }
                    }

                    if (pnlSymbolChart) {
                        const syms = Object.keys(symMap);
                        pnlSymbolChart.data.labels = syms;
                        pnlSymbolChart.data.datasets[0].data = syms.map(s => symMap[s]);
                        const bgColors = syms.map((s, i) => `hsl(${(i * 360 / syms.length)}, 70%, 50%)`);
                        pnlSymbolChart.data.datasets[0].backgroundColor = bgColors;
                        pnlSymbolChart.update();

                        const legendDiv = document.getElementById('pnl-symbol-legend');
                        if (legendDiv) {
                            legendDiv.innerHTML = syms.map((s, i) => `
                                <div class="legend-item"><span class="legend-color" style="background-color: ${bgColors[i]}"></span>${s}</div>
                            `).join('');
                        }
                    }

                    if (pnlSideChart) {
                        pnlSideChart.data.datasets[0].data = [buyPosCount, sellPosCount];
                        pnlSideChart.update();

                        document.getElementById('stats-pnl-buy-count').innerText = buyPosCount;
                        document.getElementById('stats-pnl-sell-count').innerText = sellPosCount;
                    }

                    if (pnlWinRateChart) {
                        const rawBuyWinRate = buyPosCount > 0 ? (buyPosWin / buyPosCount) * 100 : 0;
                        const rawSellWinRate = sellPosCount > 0 ? (sellPosWin / sellPosCount) * 100 : 0;
                        const totalRate = rawBuyWinRate + rawSellWinRate;
                        
                        const buyWinRate = totalRate > 0 ? (rawBuyWinRate / totalRate) * 100 : 0;
                        const sellWinRate = totalRate > 0 ? (rawSellWinRate / totalRate) * 100 : 0;

                        pnlWinRateChart.data.datasets[0].data = [buyWinRate, sellWinRate];
                        pnlWinRateChart.update();

                        document.getElementById('stats-pnl-buy-win').innerText = buyWinRate.toFixed(2) + '%';
                        document.getElementById('stats-pnl-sell-win').innerText = sellWinRate.toFixed(2) + '%';
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
                    MS_BYPASS_ON_POSITION: 'false'
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


