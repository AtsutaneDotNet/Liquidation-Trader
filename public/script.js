document.addEventListener('DOMContentLoaded', () => {
    // Sidebar Toggle
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

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
                    const el = document.getElementById(key);
                    if (el) {
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
                const threshold = parseFloat(thresholdInput ? thresholdInput.value : 0) || 0;

                if (tbodyLiquidations) {
                    if (!data || data.length === 0) {
                        tbodyLiquidations.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">&mdash; No liquidations tracked yet &mdash;</td></tr>';
                    } else {
                        tbodyLiquidations.innerHTML = data.map(liq => {
                            const sideStr = (liq.side || '').toLowerCase();
                            const sideClz = (sideStr === 'buy' || sideStr === 'long') ? 'side-buy' : 'side-sell';
                            const timeStr = new Date(liq.timestamp).toLocaleTimeString();

                            const liqValue = parseFloat(liq.value || 0);
                            const isHighValue = liqValue >= threshold;
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
                    const highValueLiqs = data.filter(liq => parseFloat(liq.value || 0) >= threshold).slice(0, 10);
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
});
