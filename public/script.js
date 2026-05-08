document.addEventListener('DOMContentLoaded', () => {
    // ── Login Form ────────────────────────────────────────────────
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
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
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    // Form Loading and Saving
    const form = document.getElementById('config-form');

    function loadConfig() {
        fetch('/api/config')
            .then(res => res.json())
            .then(data => {
                for (const key in data) {
                    if (['WEBUI_AUTH_ENABLED', 'CMC_FILTER_ENABLED', 'ENABLE_VWAP_STRATEGY', 'ENABLE_RSI_STRATEGY', 'ENABLE_ADX_STRATEGY', 'ENABLE_TRAILING_PROFIT', 'ENABLE_DCA_MARTINGALE', 'ENABLE_DYNAMIC_THRESHOLDS'].includes(key)) {
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
            })
            .catch(console.error);
    }

    loadConfig();

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

        const adxCb = document.getElementById('ENABLE_ADX_STRATEGY');
        if (adxCb) formData.set('ENABLE_ADX_STRATEGY', adxCb.checked ? 'true' : 'false');

        const isVwapChecked = vwapCb && vwapCb.checked;
        const isRsiChecked = rsiCb && rsiCb.checked;
        const isAdxChecked = adxCb && adxCb.checked;

        if (!isVwapChecked && !isRsiChecked && !isAdxChecked) {
            const msg = document.getElementById('save-status');
            msg.textContent = 'Error: At least one strategy must be enabled.';
            msg.style.color = 'var(--danger)';
            msg.classList.add('show');
            setTimeout(() => { msg.classList.remove('show'); msg.style.color = ''; }, 3000);
            return;
        }

        const data = Object.fromEntries(formData.entries());

        fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
            .then(res => res.json())
            .then(result => {
                const msg = document.getElementById('save-status');
                msg.textContent = result.message;
                msg.classList.add('show');
                setTimeout(() => msg.classList.remove('show'), 3000);
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
    const controlMsg = document.getElementById('control-msg');
    let currentBtcPrice = 0;

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
            });
    }

    setInterval(fetchStatus, 2000);
    fetchStatus();

    // Controls
    let controlMsgTimeout;

    btnStart.addEventListener('click', () => {
        fetch('/api/bot/start', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                controlMsg.textContent = data.message;
                controlMsg.style.color = data.success ? 'var(--accent)' : 'var(--danger)';
                fetchStatus();

                if (data.success) {
                    if (controlMsgTimeout) clearTimeout(controlMsgTimeout);
                    controlMsgTimeout = setTimeout(() => {
                        controlMsg.textContent = '';
                    }, 10000);
                }
            });
    });

    btnStop.addEventListener('click', () => {
        fetch('/api/bot/stop', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                controlMsg.textContent = data.message;
                controlMsg.style.color = data.success ? 'var(--accent)' : 'var(--danger)';
                fetchStatus();

                if (data.success) {
                    if (controlMsgTimeout) clearTimeout(controlMsgTimeout);
                    controlMsgTimeout = setTimeout(() => {
                        controlMsg.textContent = '';
                    }, 10000);
                }
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
    const tbodyPositions = document.getElementById('positions-tbody');

    function formatUsd(val) {
        return '$' + parseFloat(val || 0).toFixed(2);
    }

    function formatPnl(val) {
        const num = parseFloat(val || 0);
        const sign = num > 0 ? '+' : '';
        const clz = num >= 0 ? 'pnl-positive' : 'pnl-negative';
        return `<span class="${clz}">${sign}${num.toFixed(2)}</span>`;
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
                if (!data || data.length === 0) {
                    tbodyPositions.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">&mdash; No active positions tracked yet &mdash;</td></tr>';
                } else {
                    tbodyPositions.innerHTML = data.map(p => {
                        const sideStr = (p.side || '').toLowerCase();
                        const sideClz = (sideStr === 'buy' || sideStr === 'long') ? 'side-buy' : 'side-sell';
                        const sideText = (p.side || 'UNKNOWN').toUpperCase();
                        return `<tr>
                            <td><strong>${p.symbol}</strong></td>
                            <td><span class="${sideClz}">${sideText}</span></td>
                            <td>${p.size}</td>
                            <td>${parseFloat(p.entry_price || 0).toFixed(4)}</td>
                            <td>${parseFloat(p.mark_price || 0).toFixed(4)}</td>
                            <td>${parseFloat(p.liq_price || 0).toFixed(4)}</td>
                            <td>${parseFloat(p.tp_price || 0).toFixed(4)}</td>
                            <td>${parseFloat(p.sl_price || 0).toFixed(4)}</td>
                            <td>${formatPnl(p.unrealized_pnl)}</td>
                        </tr>`;
                    }).join('');
                }
            }).catch(console.error);
    }

    setInterval(fetchAccountData, 2000);
    fetchAccountData();

    // Liquidations Live Stream
    const tbodyLiquidations = document.getElementById('liquidations-tbody');
    const tbodyDashboardLiquidations = document.getElementById('dashboard-liquidations-tbody');

    function fetchLiquidations() {
        const liqPageActive = document.getElementById('liquidations-page').classList.contains('active');
        const dashPageActive = document.getElementById('dashboard').classList.contains('active');
        if (!liqPageActive && !dashPageActive) return;

        fetch('/api/liquidations')
            .then(res => res.json())
            .then(data => {
                const thresholdInput = document.getElementById('LIQUIDATION_VALUE_THRESHOLD');
                const currencyInput = document.getElementById('LIQUIDATION_VALUE_CURRENCY');
                const dynamicCb = document.getElementById('ENABLE_DYNAMIC_THRESHOLDS');
                const useDynamic = dynamicCb ? dynamicCb.checked : false;
                
                const threshold = parseFloat(thresholdInput ? thresholdInput.value : 0) || 0;
                const currency = currencyInput ? currencyInput.value : 'USD';
                
                let effectiveThreshold = threshold;
                if (currency === 'BTC' && currentBtcPrice > 0) {
                    effectiveThreshold = threshold * currentBtcPrice;
                }

                const bases = Object.keys(globalDynamicThresholds).sort((a, b) => b.length - a.length);

                const getThresholdForLiq = (liq) => {
                    let currentThreshold = effectiveThreshold;
                    if (useDynamic) {
                        const symUpper = (liq.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                        for (const base of bases) {
                            if (symUpper.startsWith(base)) {
                                currentThreshold = globalDynamicThresholds[base];
                                break;
                            }
                        }
                    }
                    return currentThreshold;
                };

                if (tbodyLiquidations) {
                    if (!data || data.length === 0) {
                        tbodyLiquidations.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">&mdash; No liquidations tracked yet &mdash;</td></tr>';
                    } else {
                        tbodyLiquidations.innerHTML = data.map(liq => {
                            const sideStr = (liq.side || '').toLowerCase();
                            const sideClz = (sideStr === 'buy' || sideStr === 'long') ? 'side-buy' : 'side-sell';
                            const timeStr = new Date(liq.timestamp).toLocaleTimeString();

                            const liqValue = parseFloat(liq.value || 0);
                            const currentThreshold = getThresholdForLiq(liq);
                            const isHighValue = liqValue >= currentThreshold;
                            const highlightClass = isHighValue ? 'liq-highlight' : '';

                            return `<tr class="${highlightClass}">
                                <td style="color: var(--text-muted);">${timeStr}</td>
                                <td style="text-transform: capitalize;">${liq.exchange}</td>
                                <td><strong>${liq.symbol}</strong></td>
                                <td><span class="${sideClz}">${(liq.side || 'unknown').toUpperCase()}</span></td>
                                <td>${parseFloat(liq.price || 0).toFixed(4)}</td>
                                <td>${liq.amount}</td>
                                <td>$${parseFloat(liq.value || 0).toFixed(2)}</td>
                            </tr>`;
                        }).join('');
                    }
                }

                if (tbodyDashboardLiquidations && dashPageActive) {
                    const highValueLiqs = data.filter(liq => parseFloat(liq.value || 0) >= getThresholdForLiq(liq)).slice(0, 10);
                    if (highValueLiqs.length === 0) {
                        tbodyDashboardLiquidations.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">&mdash; No recent high value liquidations &mdash;</td></tr>';
                    } else {
                        tbodyDashboardLiquidations.innerHTML = highValueLiqs.map(liq => {
                            const sideStr = (liq.side || '').toLowerCase();
                            const sideClz = (sideStr === 'buy' || sideStr === 'long') ? 'side-buy' : 'side-sell';
                            const timeStr = new Date(liq.timestamp).toLocaleTimeString();
                            return `<tr class="liq-highlight">
                                <td style="color: var(--text-muted);">${timeStr}</td>
                                <td style="text-transform: capitalize;">${liq.exchange}</td>
                                <td><strong>${liq.symbol}</strong></td>
                                <td><span class="${sideClz}">${(liq.side || 'unknown').toUpperCase()}</span></td>
                                <td>${parseFloat(liq.price || 0).toFixed(4)}</td>
                                <td>${liq.amount}</td>
                                <td>$${parseFloat(liq.value || 0).toFixed(2)}</td>
                            </tr>`;
                        }).join('');
                    }
                }
            }).catch(console.error);
    }

    setInterval(fetchLiquidations, 1500); // slightly faster polling for live feeling
    fetchLiquidations();

    // Dynamic Thresholds Live Stream
    const tbodyDynamicThresholds = document.getElementById('dynamic-thresholds-tbody');
    let globalDynamicThresholds = {};

    function fetchDynamicThresholdTable() {
        const pageActive = document.getElementById('dynamic-thresholds-page').classList.contains('active');

        fetch('/api/dynamic-thresholds')
            .then(res => res.json())
            .then(data => {
                const mapped = data.mapped || [];
                globalDynamicThresholds = data.rawMap || {};
                
                if (pageActive && tbodyDynamicThresholds) {
                    if (mapped.length === 0) {
                        tbodyDynamicThresholds.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">&mdash; Bot is stopped or no pairs loaded &mdash;</td></tr>';
                    } else {
                        tbodyDynamicThresholds.innerHTML = mapped.map(item => {
                            const isDynamic = item.status === 'Dynamic (API)';
                            const statusColor = isDynamic ? 'var(--accent)' : 'var(--text-muted)';
                            return `<tr>
                                <td><strong>${item.symbol}</strong></td>
                                <td>$${parseFloat(item.threshold || 0).toFixed(2)}</td>
                                <td><span style="color: ${statusColor}">${item.status}</span></td>
                            </tr>`;
                        }).join('');
                    }
                }
            }).catch(console.error);
    }

    setInterval(fetchDynamicThresholdTable, 5000);
    fetchDynamicThresholdTable();

    // Trade Decisions Live Stream
    const tbodyTradeDecisions = document.getElementById('trade-decisions-tbody');

    function fetchTradeDecisions() {
        const pageActive = document.getElementById('trade-decisions-page').classList.contains('active');
        if (!pageActive) return;

        fetch('/api/trade-decisions')
            .then(res => res.json())
            .then(data => {
                if (!tbodyTradeDecisions) return;
                
                if (!data || data.length === 0) {
                    tbodyTradeDecisions.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">&mdash; No trade evaluations tracked yet &mdash;</td></tr>';
                } else {
                    tbodyTradeDecisions.innerHTML = data.map(record => {
                        const timeStr = new Date(record.timestamp).toLocaleTimeString();
                        
                        const formatStrategy = (strat, name) => {
                            if (!strat) return `<span style="color: var(--text-muted)">Disabled</span>`;
                            if (strat.error) return `<span style="color: var(--danger)">${strat.error}</span>`;
                            
                            const signal = strat.signal ? strat.signal.toUpperCase() : 'NONE';
                            const signalClz = strat.signal === 'buy' ? 'side-buy' : (strat.signal === 'sell' ? 'side-sell' : '');
                            
                            let details = '';
                            if (name === 'VWAP') {
                                details = `V: ${strat.value.toFixed(2)} | U: ${strat.upper.toFixed(2)} | L: ${strat.lower.toFixed(2)}`;
                            } else if (name === 'RSI') {
                                details = `V: ${strat.value.toFixed(2)} | OB: ${strat.overbought} | OS: ${strat.oversold}`;
                            } else if (name === 'ADX') {
                                details = `V: ${strat.value.toFixed(2)} | +DI: ${strat.plusDI.toFixed(2)} | -DI: ${strat.minusDI.toFixed(2)}`;
                            }
                            
                            return `<div style="font-size: 0.85em;">
                                <span class="${signalClz}" style="font-weight: bold;">${signal}</span><br>
                                <span style="color: var(--text-muted)">${details}</span>
                            </div>`;
                        };

                        const confluenceText = record.confluence ? (record.confluence.matched ? `<span class="side-${record.confluence.side}">${record.confluence.side.toUpperCase()}</span>` : `<span style="color: var(--danger)">MISSED</span>`) : 'N/A';
                        const outcomeClz = record.reason === 'Trade Executed' ? 'pnl-positive' : (record.reason.startsWith('Error') ? 'pnl-negative' : '');

                        return `<tr>
                            <td style="color: var(--text-muted);">${timeStr}</td>
                            <td><strong>${record.symbol}</strong></td>
                            <td>$${parseFloat(record.price || 0).toFixed(4)}</td>
                            <td>${formatStrategy(record.vwap, 'VWAP')}</td>
                            <td>${formatStrategy(record.rsi, 'RSI')}</td>
                            <td>${formatStrategy(record.adx, 'ADX')}</td>
                            <td>${confluenceText}</td>
                            <td><span class="${outcomeClz}">${record.reason}</span></td>
                        </tr>`;
                    }).join('');
                }
            }).catch(console.error);
    }

    setInterval(fetchTradeDecisions, 2000);
    fetchTradeDecisions();

    // ── Toast Notification System ───────────────────────────────
    const toastContainer = document.getElementById('toast-container');

    function showOrderToast(order) {
        const isSell = order.side === 'SELL';
        const sideLabel = isSell ? 'SHORT Executed' : 'LONG Executed';
        const sideClass = isSell ? 'toast-sell' : '';
        const price = parseFloat(order.price || 0);
        const amount = parseFloat(order.amount || 0);
        const value = parseFloat(order.value || price * amount);
        const timeStr = new Date(order.timestamp).toLocaleTimeString();
        const shortId = order.id ? String(order.id).slice(-8) : 'N/A';

        const toast = document.createElement('div');
        toast.className = `toast ${sideClass}`;
        toast.innerHTML = `
            <div class="toast-header">
                <div class="toast-title">
                    ${sideLabel}
                </div>
                <button class="toast-close" title="Dismiss">✕</button>
            </div>
            <div class="toast-symbol">${order.symbol}</div>
            <div class="toast-details">
                <div class="toast-detail-row"><span>Type</span><span>${order.type || 'MARKET'}</span></div>
                <div class="toast-detail-row"><span>Side</span><span>${order.side}</span></div>
                <div class="toast-detail-row"><span>Price</span><span>$${price.toFixed(4)}</span></div>
                <div class="toast-detail-row"><span>Amount</span><span>${amount}</span></div>
                <div class="toast-detail-row"><span>Leverage</span><span>${order.leverage}×</span></div>
                <div class="toast-detail-row"><span>Value</span><span>$${value.toFixed(2)}</span></div>
            </div>
            <div class="toast-time">Order ID: …${shortId} · ${timeStr}</div>
            <div class="toast-progress"></div>
        `;

        toastContainer.appendChild(toast);

        // Manual close
        toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));

        // Auto-dismiss after 6s (matches progress bar animation)
        const timer = setTimeout(() => dismissToast(toast), 6000);
        toast._dismissTimer = timer;
    }

    function dismissToast(toast) {
        clearTimeout(toast._dismissTimer);
        toast.classList.add('toast-hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
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

});
