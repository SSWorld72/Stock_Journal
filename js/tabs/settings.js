import { settings, saveSettings } from '../store.js';
import { processCsvContent } from './trades.js';
import { exportChipsJSONL, importChipsJSONL } from '../db.js';
import { exportJSONL, importJSONL, exportCSV, importCSV, downloadTemplate } from '../dataStorage.js';
import { GasBackupModule } from '../../utils/js/gasBackupModule.js';

import {
    getTaiwanHolidays,
    getHolidayYear,
    getHolidayLastUpdated,
    getHolidayReminderSetting,
    setHolidayReminderSetting,
    isHolidayReminderDue,
    fetchTaiwanHolidays,
    subscribeHoliday,
    importHolidaysFromData,
    getHolidayExportData
} from '../utils/holiday.js';
import { ensureRevenueYoYCache, ensureEpsCache, getRevenueYoYCacheInfo, getEpsCacheInfo } from '../api/twstock.js';


export function initSettings() {
    // Add Broker button
    const btnAddBroker = document.getElementById('btn-add-broker');
    if (btnAddBroker) {
        btnAddBroker.addEventListener('click', addBroker);
    }



    const checkboxes = [
        { id: 'setting-pref-eps', key: 'showEPS' },
        { id: 'setting-pref-pe', key: 'showPE' },
        { id: 'setting-pref-peg', key: 'showPEG' },
        { id: 'setting-pref-yoy', key: 'showYoY' }
    ];

    checkboxes.forEach(({ id, key }) => {
        const cb = document.getElementById(id);
        if (cb) {
            cb.checked = !!settings[key];
            cb.addEventListener('change', (e) => {
                settings[key] = e.target.checked;
                saveSettings();
            });
        }
    });

    const refreshSelect = document.getElementById('setting-refresh-freq');
    if (refreshSelect) {
        if (settings.refreshFreq !== undefined) {
            refreshSelect.value = settings.refreshFreq.toString();
        } else {
            refreshSelect.value = "0";
        }
        refreshSelect.addEventListener('change', (e) => {
            settings.refreshFreq = parseInt(e.target.value, 10);
            saveSettings();
            // trigger refresh interval update if market tab is active
            if (window.renderMarketTabFunc) window.renderMarketTabFunc();
        });
    }

    // Update Start Time
    const updateStartInput = document.getElementById('setting-update-start');
    if (updateStartInput) {
        updateStartInput.value = settings.updateStartTime || '09:00';
        updateStartInput.addEventListener('change', (e) => {
            settings.updateStartTime = e.target.value;
            saveSettings();
        });
    }

    // Update End Time
    const updateEndInput = document.getElementById('setting-update-end');
    if (updateEndInput) {
        updateEndInput.value = settings.updateEndTime || '17:00';
        updateEndInput.addEventListener('change', (e) => {
            settings.updateEndTime = e.target.value;
            saveSettings();
        });
    }

    // Trading Hours Only
    const tradingHoursOnlyCheckbox = document.getElementById('setting-trading-hours-only');
    if (tradingHoursOnlyCheckbox) {
        tradingHoursOnlyCheckbox.checked = !!settings.tradingHoursOnly;
        tradingHoursOnlyCheckbox.addEventListener('change', (e) => {
            settings.tradingHoursOnly = e.target.checked;
            saveSettings();
        });
    }

    // API Proxy Mode
    const apiProxyModeSelect = document.getElementById('setting-api-proxy-mode');
    if (apiProxyModeSelect) {
        apiProxyModeSelect.value = settings.apiProxyMode || 'gas';
        apiProxyModeSelect.addEventListener('change', (e) => {
            settings.apiProxyMode = e.target.value;
            saveSettings();
        });
    }

    // GAS URL
    const gasUrlInput = document.getElementById('setting-gas-url');
    if (gasUrlInput) {
        gasUrlInput.value = settings.gasUrl || '';
        gasUrlInput.addEventListener('input', (e) => {
            settings.gasUrl = e.target.value.trim();
            saveSettings();
        });
    }

    // 初始化專屬私有雲端備份模組
    if (document.getElementById('gas-backup-module')) {
        window.gasBackupInstance = new GasBackupModule({
            appName: 'StockJournal',
            containerId: 'gas-backup-module',
            settingsObj: settings,
            onSaveSettings: saveSettings,
            getCleanPayload: () => {
                const payload = JSON.parse(JSON.stringify(settings));
                delete payload.marketQuotesCache;
                delete payload.revenueYoYCache;
                delete payload.epsCache;
                delete payload.chipsData;
                delete payload.chipsLastDownload;
                return payload;
            },
            generateRestoreConfirmMessage: (backupData) => {
                const txCount = (backupData.transactions && Array.isArray(backupData.transactions)) ? backupData.transactions.length : 0;
                const pfCount = (backupData.portfolios && Array.isArray(backupData.portfolios)) ? backupData.portfolios.length : 0;
                return `📦 雲端備份讀取成功！\n\n此備份包含：\n- 交易紀錄：${txCount} 筆\n- 投資組合：${pfCount} 組\n\n【警告】確定要使用這份資料覆蓋本機所有紀錄嗎？`;
            },
            onRestoreSuccess: () => {
                window.location.reload();
            },
            customDescriptionHtml: `
                <span class="font-medium text-emerald-600">✅ 完整備份：</span>您的所有交易紀錄、投資組合分類、系統偏好設定。<br>
                <span class="font-medium text-slate-400">❌ 刻意排除：</span>市場歷史快取 (EPS/營收/籌碼)、台股行事曆、除錯日誌。<br>
                <span class="font-medium text-blue-500">📄 雲端格式：</span>已排除海量籌碼資料，因此採用標準的 <b>.json</b> 格式 (非串流)，檔案極小且讀取快速。<br>
                <span class="text-slate-400 text-[10px]">(*排除的資料為公開資訊，系統在換新機時會自動重新下載，藉此保持私人備份檔的極致輕量與安全)</span>
            `
        });
    }

    // ETF Nav Update Mode
    const etfNavModeSelect = document.getElementById('setting-etf-nav-update-mode');
    if (etfNavModeSelect) {
        if (!settings.etfNavUpdateMode) settings.etfNavUpdateMode = 'manual';
        etfNavModeSelect.value = settings.etfNavUpdateMode;
        etfNavModeSelect.addEventListener('change', (e) => {
            settings.etfNavUpdateMode = e.target.value;
            saveSettings();
        });
    }

    // Chips Data Download
    const btnDownloadChips = document.getElementById('btn-download-chips');
    const startInput = document.getElementById('chips-start-date');
    const endInput = document.getElementById('chips-end-date');
    if (btnDownloadChips && startInput && endInput) {
        const now = new Date();
        const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthStr = new Date(lastMonth.getTime() - lastMonth.getTimezoneOffset() * 60000).toISOString().split('T')[0];

        startInput.value = lastMonthStr;
        endInput.value = todayStr;

        const forceCheckbox = document.getElementById('chips-force-download');
        if (forceCheckbox) {
            forceCheckbox.checked = settings.chipsForceDownload === true;
            forceCheckbox.addEventListener('change', (e) => {
                settings.chipsForceDownload = e.target.checked;
                saveSettings();
            });
        }

        const lastDownloadInfo = document.getElementById('chips-last-download-info');
        if (lastDownloadInfo) {
            if (settings.chipsLastDownload) {
                lastDownloadInfo.innerText = `上次更新時間：${new Date(settings.chipsLastDownload.timestamp).toLocaleString('zh-TW', { hour12: false })} (至 ${settings.chipsLastDownload.endDate})`;
            } else {
                lastDownloadInfo.innerText = '上次更新時間：無紀錄';
            }
        }

        btnDownloadChips.addEventListener('click', async () => {
            const startDate = startInput.value;
            const endDate = endInput.value;
            const force = document.getElementById('chips-force-download')?.checked || false;

            if (!startDate || !endDate) {
                alert('請選擇起始與結束日期');
                return;
            }

            if (startDate > endDate) {
                alert('起始日期不能大於結束日期');
                return;
            }

            if (!confirm(`確定要抓取從 ${startDate} 到 ${endDate} 的全市場籌碼資料嗎？\n(依據天數與網路狀況，可能會需要一段時間)`)) {
                return;
            }

            const container = document.getElementById('chips-progress-container');
            const progressText = document.getElementById('chips-progress-text');
            const progressDate = document.getElementById('chips-progress-date');

            btnDownloadChips.disabled = true;
            btnDownloadChips.classList.add('opacity-50', 'cursor-not-allowed');
            container.classList.remove('hidden');
            const spinner = container.querySelector('svg');
            if (spinner) spinner.classList.remove('hidden');

            if (window.setAppBusy) {
                window.setAppBusy(true, {
                    title: '籌碼資料批次下載中',
                    detail: `正在抓取 ${startDate} 至 ${endDate} 全市場三大法人與融資券資料...`,
                    progress: 5,
                    countText: '準備中...',
                    statusText: '連線證交所與櫃買中心...'
                });
            }

            try {
                const { downloadChipsData } = await import('../api/twstock.js');
                await downloadChipsData(startDate, endDate, (current, total, date) => {
                    const pct = total ? Math.round((current / total) * 100) : 0;
                    progressText.innerText = `抓取中... ${current} / ${total}`;
                    progressDate.innerText = `目前進度: ${date}`;

                    if (window.setAppBusy) {
                        window.setAppBusy(true, {
                            title: '籌碼資料批次下載中',
                            detail: `正在抓取 ${startDate} 至 ${endDate} 籌碼資料，請勿切換分頁...`,
                            progress: pct,
                            countText: `${current} / ${total} 天 (${date})`,
                            statusText: `進度 ${pct}%`
                        });
                    }
                }, force);
                progressText.innerText = `抓取完成！`;
                if (spinner) spinner.classList.add('hidden');

                const { getLastChipsUpdateInfo } = await import('../api/twstock.js');
                const info = await getLastChipsUpdateInfo();

                settings.chipsLastDownload = {
                    endDate: info ? info.date : endDate,
                    timestamp: Date.now()
                };
                settings.chipsStartDate = startDate;
                settings.chipsEndDate = endDate;
                saveSettings();
                if (lastDownloadInfo) {
                    lastDownloadInfo.innerText = `上次更新時間：${new Date(settings.chipsLastDownload.timestamp).toLocaleString('zh-TW', { hour12: false })} (至 ${settings.chipsLastDownload.endDate})`;
                }

                if (window.setAppBusy) {
                    window.setAppBusy(false, {
                        success: true,
                        message: `籌碼資料下載完成！已更新至 ${settings.chipsLastDownload.endDate}`
                    });
                }
            } catch (e) {
                console.error('抓取籌碼資料時發生錯誤:', e);
                progressText.innerText = '抓取過程發生錯誤';
                if (spinner) spinner.classList.add('hidden');
                if (window.setAppBusy) {
                    window.setAppBusy(false, {
                        error: true,
                        message: `籌碼下載失敗：${e.message}`
                    });
                }
            } finally {
                btnDownloadChips.disabled = false;
                btnDownloadChips.classList.remove('opacity-50', 'cursor-not-allowed');
                setTimeout(() => {
                    container.classList.add('hidden');
                }, 1500);
            }
        });
    }

    // K-Line Source
    const klineSourceSelect = document.getElementById('setting-kline-source');
    if (klineSourceSelect) {
        klineSourceSelect.value = settings.klineSource || 'yahoo';
        klineSourceSelect.addEventListener('change', (e) => {
            settings.klineSource = e.target.value;
            saveSettings();
        });
    }

    // Quote Source
    const quoteSourceSelect = document.getElementById('setting-quote-source');
    if (quoteSourceSelect) {
        quoteSourceSelect.value = settings.quoteSource || 'twse';
        quoteSourceSelect.addEventListener('change', (e) => {
            settings.quoteSource = e.target.value;
            saveSettings();
        });
    }

    // National Tax Settings
    const feeRateInput = document.getElementById('setting-fee-rate');
    if (feeRateInput) {
        feeRateInput.value = settings.feeRate !== undefined ? settings.feeRate : 0.1425;
        feeRateInput.addEventListener('change', (e) => {
            settings.feeRate = parseFloat(e.target.value) || 0.1425;
            saveSettings();
        });
    }

    const taxRateInput = document.getElementById('setting-tax-rate');
    if (taxRateInput) {
        taxRateInput.value = settings.taxRate !== undefined ? settings.taxRate : 0.3;
        taxRateInput.addEventListener('change', (e) => {
            settings.taxRate = parseFloat(e.target.value) || 0.3;
            saveSettings();
        });
    }

    const etfTaxRateInput = document.getElementById('setting-etf-tax-rate');
    if (etfTaxRateInput) {
        etfTaxRateInput.value = settings.etfTaxRate !== undefined ? settings.etfTaxRate : 0.1;
        etfTaxRateInput.addEventListener('change', (e) => {
            settings.etfTaxRate = parseFloat(e.target.value) || 0.1;
            saveSettings();
        });
    }

    const dayTradeTaxRateInput = document.getElementById('setting-daytrade-tax-rate');
    if (dayTradeTaxRateInput) {
        dayTradeTaxRateInput.value = settings.dayTradeTaxRate !== undefined ? settings.dayTradeTaxRate : 0.15;
        dayTradeTaxRateInput.addEventListener('change', (e) => {
            settings.dayTradeTaxRate = parseFloat(e.target.value) || 0.15;
            saveSettings();
        });
    }

    const dayTradeEtfTaxRateInput = document.getElementById('setting-daytrade-etf-tax-rate');
    if (dayTradeEtfTaxRateInput) {
        dayTradeEtfTaxRateInput.value = settings.dayTradeEtfTaxRate !== undefined ? settings.dayTradeEtfTaxRate : 0.05;
        dayTradeEtfTaxRateInput.addEventListener('change', (e) => {
            settings.dayTradeEtfTaxRate = parseFloat(e.target.value) || 0.05;
            saveSettings();
        });
    }

    // NHI Settings
    const nhiThresholdInput = document.getElementById('setting-nhi-threshold');
    if (nhiThresholdInput) {
        nhiThresholdInput.value = settings.nhiThreshold !== undefined ? settings.nhiThreshold : 20000;
        nhiThresholdInput.addEventListener('change', (e) => {
            settings.nhiThreshold = parseFloat(e.target.value) || 20000;
            saveSettings();
        });
    }

    const nhiTaxRateInput = document.getElementById('setting-nhi-tax-rate');
    if (nhiTaxRateInput) {
        nhiTaxRateInput.value = settings.nhiTaxRate !== undefined ? settings.nhiTaxRate : 2.11;
        nhiTaxRateInput.addEventListener('change', (e) => {
            settings.nhiTaxRate = parseFloat(e.target.value) || 2.11;
            saveSettings();
        });
    }

    // Preferences Checkboxes
    document.querySelectorAll('input[name="pref"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const prefs = Array.from(document.querySelectorAll('input[name="pref"]:checked')).map(el => el.value);
            settings.preferences = prefs;
            saveSettings();
        });
    });



    // System Logs Controls
    const btnClearLogs = document.getElementById('btn-clear-logs');
    if (btnClearLogs) {
        btnClearLogs.addEventListener('click', () => {
            if (window.clearAppLogs) window.clearAppLogs();
        });
    }

    const btnExportLogs = document.getElementById('btn-export-logs');
    if (btnExportLogs) {
        btnExportLogs.addEventListener('click', () => {
            if (!window.appLogs) return;

            // Only export filtered logs if a filter is active
            const filterEl = document.getElementById('log-time-filter');
            const keyword = filterEl ? filterEl.value.trim().toLowerCase() : '';
            const logsToExport = keyword ? window.appLogs.filter(log => log.toLowerCase().includes(keyword)) : window.appLogs;

            const logText = logsToExport.join('\n');
            const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(logText);

            const now = new Date();
            const yyyymmdd = now.getFullYear().toString() +
                (now.getMonth() + 1).toString().padStart(2, '0') +
                now.getDate().toString().padStart(2, '0');

            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `${yyyymmdd}_debug.log`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        });
    }

    const btnCopyLogs = document.getElementById('btn-copy-logs');
    if (btnCopyLogs) {
        btnCopyLogs.addEventListener('click', async () => {
            if (!window.appLogs) return;

            const filterEl = document.getElementById('log-time-filter');
            const keyword = filterEl ? filterEl.value.trim().toLowerCase() : '';
            const logsToCopy = keyword ? window.appLogs.filter(log => log.toLowerCase().includes(keyword)) : window.appLogs;

            if (logsToCopy.length === 0) {
                alert('沒有可複製的日誌！');
                return;
            }

            const logText = logsToCopy.join('\n');
            try {
                await navigator.clipboard.writeText(logText);
                const originalHtml = btnCopyLogs.innerHTML;
                btnCopyLogs.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> 已複製`;
                btnCopyLogs.classList.replace('text-slate-500', 'text-emerald-600');
                setTimeout(() => {
                    btnCopyLogs.innerHTML = originalHtml;
                    btnCopyLogs.classList.replace('text-emerald-600', 'text-slate-500');
                }, 2000);
            } catch (err) {
                alert('複製失敗，請檢查瀏覽器權限。');
            }
        });
    }

    const logFilter = document.getElementById('log-time-filter');
    if (logFilter) {
        logFilter.addEventListener('input', renderLogs);
    }

    // Bind log updates
    window.addEventListener('app-logs-updated', renderLogs);

    // Holiday Schedule Settings
    initHolidaySettings();

    // Financials Data Settings (EPS & YoY)
    initFinancialsSettings();

    // Expose functions globally so inline HTML onclick handlers still work
    window.settingsTab = {
        addBroker,
        deleteBroker,
        updateBroker,
        editBroker,
        saveBroker,
        setDefaultBroker,
        exportJSONL,
        importJSONL,
        exportCSV,
        importCSV,
        downloadTemplate,
        updateNhi: typeof updateNhi !== 'undefined' ? updateNhi : undefined
    };
}

export function renderSettings() {
    // Removed storage mode rendering and client ID loading

    if (document.getElementById('setting-tax-rate')) {
        document.getElementById('setting-tax-rate').value = settings.taxRate !== undefined ? settings.taxRate : 0.3;
    }
    if (document.getElementById('setting-etf-tax-rate')) {
        document.getElementById('setting-etf-tax-rate').value = settings.etfTaxRate !== undefined ? settings.etfTaxRate : 0.1;
    }
    if (document.getElementById('setting-daytrade-tax-rate')) {
        document.getElementById('setting-daytrade-tax-rate').value = settings.dayTradeTaxRate !== undefined ? settings.dayTradeTaxRate : 0.15;
    }
    if (document.getElementById('setting-daytrade-etf-tax-rate')) {
        document.getElementById('setting-daytrade-etf-tax-rate').value = settings.dayTradeEtfTaxRate !== undefined ? settings.dayTradeEtfTaxRate : 0.05;
    }

    if (document.getElementById('setting-nhi-threshold')) {
        document.getElementById('setting-nhi-threshold').value = settings.nhiThreshold !== undefined ? settings.nhiThreshold : 20000;
    }
    if (document.getElementById('setting-nhi-tax-rate')) {
        document.getElementById('setting-nhi-tax-rate').value = settings.nhiTaxRate !== undefined ? settings.nhiTaxRate : 2.11;
    }

    if (document.getElementById('setting-trading-hours-only')) {
        document.getElementById('setting-trading-hours-only').checked = !!settings.tradingHoursOnly;
    }



    document.querySelectorAll('input[name="pref"]').forEach(checkbox => {
        checkbox.checked = settings.preferences.includes(checkbox.value);
    });
    renderBrokers();
    renderHolidayUI();
    renderLogs();
}

function renderLogs() {
    const container = document.getElementById('system-logs-container');
    const filterEl = document.getElementById('log-time-filter');

    if (container && window.appLogs) {
        let logsToShow = window.appLogs;

        if (filterEl && filterEl.value.trim() !== '') {
            const keyword = filterEl.value.trim().toLowerCase();
            logsToShow = window.appLogs.filter(log => log.toLowerCase().includes(keyword));
        }

        if (logsToShow.length === 0 && window.appLogs.length > 0) {
            container.textContent = '沒有符合條件的日誌。';
        } else {
            container.textContent = logsToShow.join('\n');
        }
    }
}




let renderHolidayUI = () => { };

function initHolidaySettings() {
    const yearBadge = document.getElementById('holiday-year-badge');
    const warningBadge = document.getElementById('holiday-warning-badge');
    const statusMsg = document.getElementById('holiday-status-msg');
    const lastUpdatedText = document.getElementById('holiday-last-updated-text');
    const btnRefresh = document.getElementById('btn-refresh-holidays');
    const reminderBtns = document.querySelectorAll('.holiday-reminder-btn');

    renderHolidayUI = function () {
        const year = getHolidayYear();
        const holidays = getTaiwanHolidays();
        const lastUpdated = getHolidayLastUpdated();
        const reminder = getHolidayReminderSetting();
        const isDue = isHolidayReminderDue();

        if (yearBadge) {
            yearBadge.textContent = `${year} 年 (${holidays.size} 天休市)`;
        }

        if (warningBadge) {
            if (isDue) {
                warningBadge.classList.remove('hidden');
            } else {
                warningBadge.classList.add('hidden');
            }
        }

        if (lastUpdatedText) {
            if (lastUpdated) {
                const dateStr = new Date(lastUpdated).toLocaleString('zh-TW', { hour12: false });
                lastUpdatedText.textContent = `上次更新時間：${dateStr}`;
            } else {
                lastUpdatedText.textContent = '上次更新時間：無紀錄 (建議立即載入)';
            }
        }

        reminderBtns.forEach(btn => {
            const val = btn.getAttribute('data-val');
            if (val === reminder) {
                btn.className = 'holiday-reminder-btn text-xs px-2.5 py-1 rounded-md border cursor-pointer whitespace-nowrap transition-colors bg-blue-600 text-white border-blue-600';
            } else {
                btn.className = 'holiday-reminder-btn text-xs px-2.5 py-1 rounded-md border cursor-pointer whitespace-nowrap transition-colors bg-white text-slate-600 border-slate-200 hover:border-blue-400';
            }
        });
    };

    reminderBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.getAttribute('data-val');
            if (val) {
                setHolidayReminderSetting(val);
                renderHolidayUI();
            }
        });
    });

    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            btnRefresh.disabled = true;
            btnRefresh.textContent = '載入中...';
            if (statusMsg) {
                statusMsg.className = 'text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 block';
                statusMsg.textContent = '正在向 TWSE 證交所與人事行政總處查詢最新休市日...';
                statusMsg.classList.remove('hidden');
            }

            try {
                const res = await fetchTaiwanHolidays();
                if (res.success) {
                    if (statusMsg) {
                        statusMsg.className = 'text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 block';
                        statusMsg.textContent = `✅ 成功自【${res.source}】更新 ${res.year} 年休市日共 ${res.count} 天 (累計快取 ${res.totalCached} 天)`;
                    }
                } else {
                    if (statusMsg) {
                        statusMsg.className = 'text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 block';
                        statusMsg.textContent = `⚠ ${res.error || '載入失敗'}`;
                    }
                }
            } catch (err) {
                if (statusMsg) {
                    statusMsg.className = 'text-xs px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 block';
                    statusMsg.textContent = `❌ 更新失敗: ${err.message}`;
                }
            } finally {
                btnRefresh.disabled = false;
                btnRefresh.textContent = '重新載入';
                renderHolidayUI();
            }
        });
    }

    subscribeHoliday(renderHolidayUI);
    renderHolidayUI();
}

function initFinancialsSettings() {
    const yoyLastPeriod = document.getElementById('yoy-last-period');
    const yoyLastUpdated = document.getElementById('yoy-last-updated');
    const yoyCacheCount = document.getElementById('yoy-cache-count');
    const epsLastPeriod = document.getElementById('eps-last-period');
    const epsLastUpdated = document.getElementById('eps-last-updated');
    const epsCacheCount = document.getElementById('eps-cache-count');
    const statusText = document.getElementById('financials-status-text');
    const forceCheckbox = document.getElementById('financials-force-download');
    const btnSyncAll = document.getElementById('btn-sync-all-financials');
    const btnDownloadYoY = document.getElementById('btn-download-yoy');
    const btnDownloadEps = document.getElementById('btn-download-eps');

    const renderFinancialsUI = async () => {
        try {
            const [yoyInfo, epsInfo] = await Promise.all([
                getRevenueYoYCacheInfo(),
                getEpsCacheInfo()
            ]);

            if (yoyLastPeriod) yoyLastPeriod.textContent = yoyInfo.lastPeriod || '--';
            if (yoyLastUpdated) {
                yoyLastUpdated.textContent = yoyInfo.lastUpdated
                    ? new Date(yoyInfo.lastUpdated).toLocaleString('zh-TW', { hour12: false })
                    : '無紀錄';
            }
            if (yoyCacheCount) yoyCacheCount.textContent = `${yoyInfo.count} 檔`;

            if (epsLastPeriod) epsLastPeriod.textContent = epsInfo.lastPeriod || '--';
            if (epsLastUpdated) {
                epsLastUpdated.textContent = epsInfo.lastUpdated
                    ? new Date(epsInfo.lastUpdated).toLocaleString('zh-TW', { hour12: false })
                    : '無紀錄';
            }
            if (epsCacheCount) epsCacheCount.textContent = `${epsInfo.count} 檔`;
        } catch (e) {
            console.warn('[設定] 渲染財報 UI 失敗', e);
        }
    };

    if (btnDownloadYoY) {
        btnDownloadYoY.addEventListener('click', async () => {
            const force = forceCheckbox?.checked || false;
            btnDownloadYoY.disabled = true;
            btnDownloadYoY.textContent = '更新中...';
            if (statusText) statusText.textContent = '正在下載全市場月營收 (YoY) 資料...';
            try {
                await ensureRevenueYoYCache(force);
                if (statusText) statusText.textContent = '✅ 月營收 (YoY) 資料更新完成！';
            } catch (err) {
                if (statusText) statusText.textContent = `❌ 月營收更新失敗: ${err.message}`;
            } finally {
                btnDownloadYoY.disabled = false;
                btnDownloadYoY.textContent = '立即更新';
                await renderFinancialsUI();
            }
        });
    }

    if (btnDownloadEps) {
        btnDownloadEps.addEventListener('click', async () => {
            const force = forceCheckbox?.checked || false;
            btnDownloadEps.disabled = true;
            btnDownloadEps.textContent = '更新中...';
            if (statusText) statusText.textContent = '正在下載全市場季報每股盈餘 (EPS) 資料...';
            try {
                await ensureEpsCache(force);
                if (statusText) statusText.textContent = '✅ 季報每股盈餘 (EPS) 更新完成！';
            } catch (err) {
                if (statusText) statusText.textContent = `❌ 季報 EPS 更新失敗: ${err.message}`;
            } finally {
                btnDownloadEps.disabled = false;
                btnDownloadEps.textContent = '立即更新';
                await renderFinancialsUI();
            }
        });
    }

    if (btnSyncAll) {
        btnSyncAll.addEventListener('click', async () => {
            const force = forceCheckbox?.checked || false;
            btnSyncAll.disabled = true;
            btnSyncAll.innerHTML = `
                <svg class="animate-spin w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                更新中...
            `;
            if (statusText) statusText.textContent = '正在下載全市場營收 YoY 與季報 EPS...';
            try {
                await Promise.all([
                    ensureRevenueYoYCache(force),
                    ensureEpsCache(force)
                ]);
                if (statusText) statusText.textContent = '✅ 全市場財報資料（YoY、EPS）更新完成！';
            } catch (err) {
                if (statusText) statusText.textContent = `❌ 財報更新失敗: ${err.message}`;
            } finally {
                btnSyncAll.disabled = false;
                btnSyncAll.innerHTML = `
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    一鍵更新財報資料
                `;
                await renderFinancialsUI();
            }
        });
    }

    renderFinancialsUI();
}

const MAX_BROKERS = 8;

function renderBrokers() {
    const container = document.getElementById('brokers-list');
    if (!container) return;
    container.innerHTML = '';

    if (settings.brokers.length === 0) {
        container.innerHTML = `
            <div class="text-center py-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl lg:col-span-2">
                <p class="text-sm text-slate-400">尚未設定任何券商</p>
            </div>`;
        return;
    }

    // 券商主題色輪替調色盤（與市場監控、統計儀表板 1 對 1 完美對應）
    const themes = [
        { bg: 'bg-blue-50/50', border: 'border-blue-200', borderActive: 'border-blue-500 ring-1 ring-blue-500', hoverBorder: 'hover:border-blue-300', title: 'text-blue-900', accent: 'text-blue-600', badge: 'bg-blue-600', infoBg: 'bg-blue-50', infoBorder: 'border-blue-100', feeColor: 'text-blue-600', stockColor: 'text-blue-600', oddColor: 'text-blue-500' },
        { bg: 'bg-emerald-50/50', border: 'border-emerald-200', borderActive: 'border-emerald-500 ring-1 ring-emerald-500', hoverBorder: 'hover:border-emerald-300', title: 'text-emerald-900', accent: 'text-emerald-600', badge: 'bg-emerald-600', infoBg: 'bg-emerald-50', infoBorder: 'border-emerald-100', feeColor: 'text-emerald-600', stockColor: 'text-emerald-600', oddColor: 'text-emerald-500' },
        { bg: 'bg-amber-50/50', border: 'border-amber-200', borderActive: 'border-amber-500 ring-1 ring-amber-500', hoverBorder: 'hover:border-amber-300', title: 'text-amber-900', accent: 'text-amber-600', badge: 'bg-amber-600', infoBg: 'bg-amber-50', infoBorder: 'border-amber-100', feeColor: 'text-amber-600', stockColor: 'text-amber-600', oddColor: 'text-amber-500' },
        { bg: 'bg-purple-50/50', border: 'border-purple-200', borderActive: 'border-purple-500 ring-1 ring-purple-500', hoverBorder: 'hover:border-purple-300', title: 'text-purple-900', accent: 'text-purple-600', badge: 'bg-purple-600', infoBg: 'bg-purple-50', infoBorder: 'border-purple-100', feeColor: 'text-purple-600', stockColor: 'text-purple-600', oddColor: 'text-purple-500' },
        { bg: 'bg-rose-50/50', border: 'border-rose-200', borderActive: 'border-rose-500 ring-1 ring-rose-500', hoverBorder: 'hover:border-rose-300', title: 'text-rose-900', accent: 'text-rose-600', badge: 'bg-rose-600', infoBg: 'bg-rose-50', infoBorder: 'border-rose-100', feeColor: 'text-rose-600', stockColor: 'text-rose-600', oddColor: 'text-rose-500' },
        { bg: 'bg-indigo-50/50', border: 'border-indigo-200', borderActive: 'border-indigo-500 ring-1 ring-indigo-500', hoverBorder: 'hover:border-indigo-300', title: 'text-indigo-900', accent: 'text-indigo-600', badge: 'bg-indigo-600', infoBg: 'bg-indigo-50', infoBorder: 'border-indigo-100', feeColor: 'text-indigo-600', stockColor: 'text-indigo-600', oddColor: 'text-indigo-500' },
        { bg: 'bg-cyan-50/50', border: 'border-cyan-200', borderActive: 'border-cyan-500 ring-1 ring-cyan-500', hoverBorder: 'hover:border-cyan-300', title: 'text-cyan-900', accent: 'text-cyan-600', badge: 'bg-cyan-600', infoBg: 'bg-cyan-50', infoBorder: 'border-cyan-100', feeColor: 'text-cyan-600', stockColor: 'text-cyan-600', oddColor: 'text-cyan-500' },
        { bg: 'bg-fuchsia-50/50', border: 'border-fuchsia-200', borderActive: 'border-fuchsia-500 ring-1 ring-fuchsia-500', hoverBorder: 'hover:border-fuchsia-300', title: 'text-fuchsia-900', accent: 'text-fuchsia-600', badge: 'bg-fuchsia-600', infoBg: 'bg-fuchsia-50', infoBorder: 'border-fuchsia-100', feeColor: 'text-fuchsia-600', stockColor: 'text-fuchsia-600', oddColor: 'text-fuchsia-500' },
    ];

    settings.brokers.forEach((broker, idx) => {
        const isDefault = broker.isDefault;
        const discountStr = broker.discount === 10 ? '無折扣' : `${broker.discount}折`;
        const globalFeeRate = settings.feeRate !== undefined ? settings.feeRate : 0.1425;
        const effFeeRate = globalFeeRate * ((broker.discount || 10) / 10);
        const t = themes[idx % themes.length];

        const el = document.createElement('div');
        el.className = `rounded-xl p-5 relative group transition-all border ${t.bg} ${isDefault ? t.borderActive : `${t.border} ${t.hoverBorder}`}`;

        el.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-2">
                    <h4 class="text-lg font-bold ${t.title}">${broker.name}</h4>
                    ${isDefault ? `<span class="${t.badge} text-white text-[10px] px-2 py-0.5 rounded">預設</span>` : ''}
                </div>
                
                <div class="${t.infoBg} ${t.infoBorder} border px-4 py-1.5 rounded-lg flex items-center gap-6">
                    <span class="text-sm text-slate-500">原始資金</span>
                    <span class="font-bold text-slate-800">$${(broker.initialCapital || 0).toLocaleString()}</span>
                </div>

                <div class="flex items-center gap-3">
                    ${!isDefault ? `<button class="text-xs text-slate-400 hover:${t.accent} transition-colors" onclick="window.settingsTab.setDefaultBroker(${broker.id})">設為預設</button>` : ''}
                    <button class="text-slate-400 hover:${t.accent} transition-colors" onclick="window.settingsTab.editBroker(${broker.id})" title="編輯券商">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <button class="text-slate-400 hover:text-red-500 transition-colors" onclick="window.settingsTab.deleteBroker(${broker.id})" title="刪除券商">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
            
            <div class="grid grid-cols-2 gap-3 text-sm text-slate-600">
                <div>手續費折扣：<span class="${t.feeColor} font-medium">${discountStr}</span></div>
                <div>有效費率：<span class="${t.feeColor} font-medium">${effFeeRate.toFixed(4)}%</span></div>
                <div><span class="${t.stockColor} font-medium">全股</span> 最低手續費：$${broker.minFee || 20}</div>
                <div><span class="${t.oddColor} font-medium">零股</span> 最低：$${broker.minOddFee || 1}</div>
            </div>
        `;
        container.appendChild(el);
    });

    // 達到上限時隱藏「新增券商」按鈕
    const addBtn = document.getElementById('btn-add-broker');
    if (addBtn) {
        addBtn.classList.toggle('hidden', settings.brokers.length >= MAX_BROKERS);
    }
}

function addBroker() {
    if (settings.brokers.length >= MAX_BROKERS) {
        alert(`最多僅能設定 ${MAX_BROKERS} 組券商。`);
        return;
    }
    const isFirst = settings.brokers.length === 0;
    settings.brokers.push({
        id: Date.now(),
        name: '新券商',
        isDefault: isFirst,
        // feeRate is global now
        discount: 10,
        minFee: 20,
        minOddFee: 1,
        initialCapital: 0,
        taxRate: 0.3,
        etfTaxRate: 0.1,
        dayTradeTaxRate: 0.15,
        dayTradeEtfTaxRate: 0.05,
        nhiThreshold: 20000,
        nhiTaxRate: 2.11
    });
    saveSettings();
    renderBrokers();
    setTimeout(() => {
        const list = document.getElementById('brokers-list');
        list.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
}

function deleteBroker(id) {
    if (confirm('確定要刪除此券商設定嗎？')) {
        const wasDefault = settings.brokers.find(b => b.id === id)?.isDefault;
        settings.brokers = settings.brokers.filter(b => b.id !== id);

        if (wasDefault && settings.brokers.length > 0) {
            settings.brokers[0].isDefault = true;
        }

        saveSettings();
        renderBrokers();
    }
}

function setDefaultBroker(id) {
    settings.brokers.forEach(b => {
        b.isDefault = (b.id === id);
    });
    saveSettings();
    renderBrokers();
}

let activeEditModal = null;

function editBroker(id) {
    const broker = settings.brokers.find(b => b.id === id);
    if (!broker) return;

    // Remove existing modal if any
    if (activeEditModal) activeEditModal.remove();

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div class="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 class="font-bold text-slate-800">編輯券商參數</h3>
                <button class="text-slate-400 hover:text-slate-600" onclick="this.closest('.fixed').remove()">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
            
            <div class="p-5 overflow-y-auto custom-scrollbar flex-1 space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-slate-500 mb-1">券商名稱</label>
                        <input type="text" id="eb-name" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-sm" value="${broker.name}">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-500 mb-1">原始資金 ($)</label>
                        <input type="number" step="1" id="eb-initialCapital" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-sm" value="${broker.initialCapital}">
                    </div>
                </div>
                
                <div class="grid grid-cols-3 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-slate-500 mb-1">手續費折扣 (折)</label>
                        <input type="number" step="0.1" id="eb-discount" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-sm" value="${broker.discount}">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-500 mb-1">最低手續費 ($)</label>
                        <input type="number" step="1" id="eb-minFee" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-sm" value="${broker.minFee}">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-500 mb-1">零股最低手續費 ($)</label>
                        <input type="number" step="1" id="eb-minOddFee" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 text-sm" value="${broker.minOddFee}">
                    </div>
                </div>
            </div>
            
            <div class="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button class="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors" onclick="this.closest('.fixed').remove()">取消</button>
                <button class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all shadow-sm active:scale-95" onclick="window.settingsTab.saveBroker(${broker.id}, this.closest('.fixed'))">儲存設定</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    activeEditModal = modal;
}

function saveBroker(id, modalEl) {
    const broker = settings.brokers.find(b => b.id === id);
    if (!broker) return;

    broker.name = document.getElementById('eb-name').value;
    broker.discount = parseFloat(document.getElementById('eb-discount').value) || 0;
    broker.minFee = parseFloat(document.getElementById('eb-minFee').value) || 0;
    broker.minOddFee = parseFloat(document.getElementById('eb-minOddFee').value) || 0;
    broker.initialCapital = parseFloat(document.getElementById('eb-initialCapital').value) || 0;

    saveSettings();
    renderBrokers();
    modalEl.remove();
}

function updateBroker(id, field, value) {
    const broker = settings.brokers.find(b => b.id === id);
    if (broker) {
        broker[field] = (field === 'name') ? value : parseFloat(value) || 0;
        saveSettings();
    }
}

