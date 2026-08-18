import { settings, saveSettings } from '../store.js';
import { getQuoteForCode, getChartData, ensureIndustryCache, getIndustry, getChipsDataForCode, downloadChipsData, getHistoricalKLine, syncStockData, loadStockDataFromCache, syncLatestChipsData, getLastChipsUpdateInfo, ensureStockNames, ensurePEYieldCache, ensureEtfNavCache, ensureRevenueYoYCache, ensureEpsCache } from '../api/twstock.js';
import { renderIntradayChart, renderKLineChart } from '../components/charts.js';
import { renderChipsAdvanced as renderChipsChart } from '../components/chips-ui.js';
import { calculateStockMetrics } from './trades.js';

let updateInterval = null;
let currentQuotes = {};
let expandedStockCode = null;
let expandedTab = 'quote';
let marketSortColumn = 'code';
let marketSortDirection = 'asc';
let currentMarketTab = 'full';

export function getAllWatchedCodes() {
    const codesSet = new Set(settings.watchList || []);
    if (settings.customLists) {
        settings.customLists.forEach(list => {
            if (list.codes) {
                list.codes.forEach(code => codesSet.add(code));
            }
        });
    }
    return Array.from(codesSet);
}
export function initMarket() {
    const btnAdd = document.getElementById('btn-market-add');
    const inputAdd = document.getElementById('market-add-input');
    const btnRefresh = document.getElementById('btn-market-refresh');
    const btnBatchDelete = document.getElementById('btn-market-batch-delete');

    if (btnBatchDelete) {
        btnBatchDelete.addEventListener('click', () => {
            if (window.marketTab && window.marketTab.batchDelete) {
                window.marketTab.batchDelete();
            }
        });
    }

    if (btnAdd && inputAdd) {
        const targetSelect = document.getElementById('market-add-target');
        btnAdd.addEventListener('click', () => {
            addStock(inputAdd.value, targetSelect ? targetSelect.value : 'watchList');
            inputAdd.value = '';
        });

        inputAdd.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addStock(inputAdd.value, targetSelect ? targetSelect.value : 'watchList');
                inputAdd.value = '';
            }
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            // Provide a quick feedback for refresh action
            const svg = btnRefresh.querySelector('svg');
            if (svg) svg.classList.add('animate-spin');
            refreshQuotes(true).then(() => {
                if (svg) svg.classList.remove('animate-spin');
            });
        });
    }

    function showCustomDialog({ title, content, type = 'alert', onConfirm }) {
        const overlay = document.createElement('div');
        overlay.id = 'custom-dialog-overlay';
        overlay.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 opacity-0 transition-opacity duration-300';

        const dialog = document.createElement('div');
        dialog.className = 'bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden transform scale-95 transition-all duration-300';

        let buttonsHtml = '';
        if (type === 'confirm') {
            buttonsHtml = `
                <button id="custom-dialog-cancel" class="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors">取消</button>
                <button id="custom-dialog-confirm" class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm shadow-blue-200">確定更新</button>
            `;
        } else {
            buttonsHtml = `
                <button id="custom-dialog-confirm" class="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm shadow-blue-200">我知道了</button>
            `;
        }

        dialog.innerHTML = `
            <div class="p-6 pb-4">
                <div class="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${type === 'confirm' ? 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' : 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}"></path>
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-2">${title}</h3>
                <div class="text-slate-600 text-sm whitespace-pre-wrap leading-relaxed">${content}</div>
            </div>
            <div class="px-6 pb-6 flex gap-3">
                ${buttonsHtml}
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // trigger animation
        requestAnimationFrame(() => {
            overlay.classList.remove('opacity-0');
            dialog.classList.remove('scale-95');
        });

        const close = () => {
            overlay.classList.add('opacity-0');
            dialog.classList.add('scale-95');
            setTimeout(() => overlay.remove(), 300);
        };

        const confirmBtn = dialog.querySelector('#custom-dialog-confirm');
        const cancelBtn = dialog.querySelector('#custom-dialog-cancel');

        if (confirmBtn) {
            confirmBtn.onclick = () => {
                close();
                if (onConfirm) onConfirm();
            };
        }
        if (cancelBtn) {
            cancelBtn.onclick = close;
        }
    }

    // Expose functions globally for inline onclick
    window.marketTab = {
        refreshSingle: async (code) => {
            const btn = document.getElementById(`btn-refresh-single-wrapper-${code}`);
            const icon = document.getElementById(`btn-refresh-single-${code}`);
            const rowIcon = document.getElementById(`btn-refresh-row-${code}`);

            if (icon) icon.classList.add('animate-spin');
            if (rowIcon) rowIcon.classList.add('animate-spin');

            // 跳出通知告知使用者籌碼無法單獨取得
            // alert(`已為您單獨更新「${code}」的最新報價。\n\n※ 由於證交所 API 限制，【籌碼資料】無法單獨分開取得。若需更新籌碼資料，請使用畫面上方全局的「整理 / 更新」按鈕去其他地方取回！`);

            const result = await syncStockData(code, 'SINGLE');
            if (result) {
                currentQuotes[code] = result.quote;
                chartDataCache[code] = {
                    intraday: result.intraday,
                    technical: result.technical,
                    historicalChipsKLine: result.historicalChipsKLine,
                    lastUpdated: result.lastUpdated
                };
            }

            if (icon) icon.classList.remove('animate-spin');
            if (rowIcon) rowIcon.classList.remove('animate-spin');
            renderList();

            // 跳出通知告知使用者籌碼無法單獨取得
            setTimeout(() => {
                let chipsInfoStr = '未知';
                let recommendUpdate = false;

                try {
                    if (settings.chipsLastDownload && settings.chipsLastDownload.timestamp) {
                        const dateObj = new Date(settings.chipsLastDownload.timestamp);
                        const timeStr = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getDate()).padStart(2, '0')} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

                        // 顯示抓取時間與抓取的目標資料日期(endDate)
                        chipsInfoStr = `${settings.chipsLastDownload.endDate} (抓取時間: ${timeStr})`;

                        const lastDateStr = settings.chipsLastDownload.endDate.replace(/-/g, '');
                        const now = new Date();
                        const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

                        // 簡單判斷：如果最後更新日期不是今天，且現在時間超過 17:00，建議更新
                        if (lastDateStr < todayStr && now.getHours() >= 17) {
                            recommendUpdate = true;
                        } else if (lastDateStr < todayStr && now.getHours() < 17) {
                            // 如果是早上，且連昨天的都沒有，也建議更新
                            const yesterday = new Date(now.getTime() - 86400000);
                            const yesterdayStr = `${yesterday.getFullYear()}${String(yesterday.getMonth() + 1).padStart(2, '0')}${String(yesterday.getDate()).padStart(2, '0')}`;
                            if (lastDateStr < yesterdayStr) {
                                recommendUpdate = true;
                            }
                        }
                    }
                } catch (e) {
                    console.error("解析 chipsLastDownload 失敗", e);
                }

                let msg = `※ 證交所的【籌碼資料】為全市場統一發布，無法針對單一股票單獨下載。\n`;
                msg += `目前系統內的籌碼最後更新為：${chipsInfoStr}\n\n`;

                if (recommendUpdate) {
                    msg += `💡 系統偵測到今天可能有最新的籌碼資料，建議您進行全局更新。\n\n是否要現在立即幫您一併把全市場的「最新籌碼資料」都下載回來？`;
                    showCustomDialog({
                        title: `已單獨更新「${code}」的最新報價`,
                        content: msg,
                        type: 'confirm',
                        onConfirm: async () => {
                            const icon = document.getElementById(`btn-refresh-single-${code}`);
                            const rowIcon = document.getElementById(`btn-refresh-row-${code}`);
                            if (icon) icon.classList.add('animate-spin');
                            if (rowIcon) rowIcon.classList.add('animate-spin');

                            // 1. 抓取全市場籌碼
                            await syncLatestChipsData();
                            // 2. 重新單獨更新此檔股票的報價與籌碼
                            const updatedRecord = await syncStockData(code, true);
                            if (updatedRecord) {
                                currentQuotes[code] = updatedRecord.quote;
                                chartDataCache[code] = {
                                    intraday: updatedRecord.intraday,
                                    technical: updatedRecord.technical,
                                    historicalChipsKLine: updatedRecord.historicalChipsKLine,
                                    lastUpdated: updatedRecord.lastUpdated
                                };
                            }

                            if (icon) icon.classList.remove('animate-spin');
                            if (rowIcon) rowIcon.classList.remove('animate-spin');
                            renderList();

                            // 若目前展開的是這檔股票的籌碼頁籤，強制重新渲染
                            if (expandedStockCode === code && expandedTab === 'chips') {
                                window.marketTab.toggleStockDetails(code);
                                setTimeout(() => window.marketTab.toggleStockDetails(code), 50);
                            }
                        }
                    });
                } else {
                    msg += `系統判斷目前的籌碼資料已經是最新的，無須重複下載浪費網路流量！\n(若仍需強制重新下載，請點擊左上角的「全局更新」按鈕)`;
                    showCustomDialog({
                        title: `已單獨更新「${code}」的最新報價`,
                        content: msg,
                        type: 'alert'
                    });
                }
            }, 100);
        },

        switchTab: (tabId) => {
            currentMarketTab = tabId;
            renderList();
        },
        promptAddCustomList: () => {
            const listName = prompt("請輸入新自訂清單的名稱：\n(例如：科技股、高股息)");
            if (listName && listName.trim()) {
                if (!settings.customLists) settings.customLists = [];
                const id = 'list_' + Date.now();
                settings.customLists.push({ id, name: listName.trim(), codes: [] });
                saveSettings();
                window.marketTab.switchTab(`custom_${id}`);
            }
        },
        manageCustomLists: () => {
            if (!settings.customLists || settings.customLists.length === 0) {
                alert("目前還沒有任何自訂清單！\n您可以點擊旁邊的 + 按鈕來新增。");
                return;
            }

            let html = '<div class="space-y-3 mt-4 text-left">';
            settings.customLists.forEach(list => {
                html += `<div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-lg">
                    <span class="font-medium text-slate-700">${list.name} <span class="text-xs text-slate-400 font-normal ml-1">(${list.codes.length} 檔)</span></span>
                    <div class="space-x-1">
                        <button onclick="window.marketTab.renameCustomList('${list.id}')" class="text-blue-500 hover:text-blue-700 hover:bg-blue-50 p-1.5 rounded-md transition-colors text-xs font-medium">重新命名</button>
                        <button onclick="window.marketTab.deleteCustomList('${list.id}')" class="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-md transition-colors text-xs font-medium">刪除</button>
                    </div>
                </div>`;
            });
            html += '</div>';

            showCustomDialog({
                title: '管理自訂清單',
                content: html,
                type: 'alert'
            });
        },
        deleteCustomList: (id) => {
            if (confirm("確定要刪除這個自訂清單嗎？\n(這只會刪除清單分類，不會從您的總自選股中刪除裡面的股票)")) {
                settings.customLists = settings.customLists.filter(l => l.id !== id);
                if (currentMarketTab === `custom_${id}`) {
                    currentMarketTab = 'full';
                }
                saveSettings();
                renderList();
                
                // 關閉 Modal 並重新開啟以更新畫面
                const overlay = document.getElementById('custom-dialog-overlay');
                if (overlay) overlay.remove();
                
                window.marketTab.manageCustomLists();
            }
        },
        renameCustomList: (id) => {
            const list = settings.customLists.find(l => l.id === id);
            if (!list) return;
            const newName = prompt('請輸入新的清單名稱：', list.name);
            if (newName !== null && newName.trim() !== '') {
                list.name = newName.trim();
                saveSettings();
                renderList();
                
                // 關閉 Modal 並重新開啟以更新畫面
                const overlay = document.getElementById('custom-dialog-overlay');
                if (overlay) overlay.remove();
                
                window.marketTab.manageCustomLists();
            }
        },
        promptSetStockCustomLists: (code) => {
            if (!settings.customLists || settings.customLists.length === 0) {
                alert("目前還沒有任何自訂清單！\n您可以點擊上方的 + 按鈕來新增清單。");
                return;
            }

            let html = '<div class="space-y-3 mt-4 text-left">';
            settings.customLists.forEach(list => {
                const isChecked = list.codes.includes(code);
                html += `<label class="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors"><input type="checkbox" id="cb_custom_${list.id}" value="${list.id}" ${isChecked ? 'checked' : ''} class="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"><span class="font-medium text-slate-700">${list.name}</span></label>`;
            });
            html += '</div>';

            showCustomDialog({
                title: `設定 ${code} 的所屬清單`,
                content: html,
                type: 'confirm',
                onConfirm: () => {
                    let changed = false;
                    settings.customLists.forEach(list => {
                        const cb = document.getElementById(`cb_custom_${list.id}`);
                        if (cb) {
                            const wasChecked = list.codes.includes(code);
                            const nowChecked = cb.checked;
                            if (nowChecked && !wasChecked) {
                                list.codes.push(code);
                                changed = true;
                            } else if (!nowChecked && wasChecked) {
                                list.codes = list.codes.filter(c => c !== code);
                                changed = true;
                            }
                        }
                    });
                    if (changed) {
                        saveSettings();
                        renderList();
                    }
                }
            });
        },
        deleteStock: (code) => {
            if (confirm(`確定要從自選清單移除 ${code} 嗎？`)) {
                deleteStock(code);
            }
        },
        fetchChipsForMarket: async (code) => {
            const container = document.getElementById(`chart-chips-${code}`);
            if (container) {
                container.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-24 text-slate-400">
                        <svg class="animate-spin w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        <p class="text-sm" id="inline-chips-progress-${code}">全市場籌碼資料抓取中...</p>
                    </div>
                `;
            }
            try {
                // Use settings dates or default to 30 days ago
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                const startDate = settings.chipsStartDate || thirtyDaysAgo.toISOString().split('T')[0];
                const endDate = settings.chipsEndDate || now.toISOString().split('T')[0];

                await downloadChipsData(startDate, endDate, (current, total, date) => {
                    const progEl = document.getElementById(`inline-chips-progress-${code}`);
                    if (progEl) progEl.innerText = `全市場籌碼資料抓取中... ${current} / ${total} (${date})`;
                }, false);

                settings.chipsLastDownload = {
                    endDate: endDate,
                    timestamp: Date.now()
                };
                saveSettings();

                if (expandedStockCode === code && expandedTab === 'chips') {
                    renderChipsData(code);
                }
            } catch (e) {
                console.error('更新市場資訊時發生錯誤:', e);
                if (container) {
                    container.innerHTML = '<div class="w-full h-full flex items-center justify-center text-red-400 text-sm">載入籌碼資料失敗</div>';
                }
            }
        },
        batchDelete: () => {
            const checked = document.querySelectorAll('.market-checkbox:checked');
            if (checked.length === 0) return;

            if (confirm(`確定要移除這 ${checked.length} 檔股票嗎？`)) {
                let isCustomList = currentMarketTab.startsWith('custom_');
                let customId = isCustomList ? currentMarketTab.replace('custom_', '') : null;
                let customList = isCustomList ? (settings.customLists || []).find(l => String(l.id) === customId) : null;

                checked.forEach(cb => {
                    const code = cb.dataset.code;
                    if (isCustomList && customList) {
                        // 僅從當前自訂清單中移除
                        customList.codes = customList.codes.filter(c => c !== code);
                    } else {
                        // 從全局 (watchList) 與所有自訂清單中移除
                        if (settings.watchList) {
                            settings.watchList = settings.watchList.filter(c => c !== code);
                            delete currentQuotes[code];
                        }
                        if (settings.customLists) {
                            settings.customLists.forEach(l => {
                                l.codes = l.codes.filter(c => c !== code);
                            });
                        }
                    }
                });
                saveSettings();
                renderList();
            }
        },
        toggleStockDetails: (code) => {
            if (expandedStockCode === code) {
                expandedStockCode = null; // collapse
            } else {
                expandedStockCode = code;
                expandedTab = 'quote'; // reset to default tab
            }
            renderList();
        },
        setExpandedTab: (tab) => {
            expandedTab = tab;
            renderList();
        },
        sortBy: (col) => {
            if (marketSortColumn === col) {
                marketSortDirection = marketSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                marketSortColumn = col;
                marketSortDirection = (col === 'code') ? 'asc' : 'desc';
            }
            renderList();
        },
        renderList: () => renderList(),
        refreshGroup: async (groupName) => {
            // 找出該分類的所有股票代號
            const allItems = getAllWatchedCodes().map(code => {
                const quote = currentQuotes[code] || {};
                const metrics = calculateStockMetrics(code, quote.price || 0);
                return { code, metrics };
            });

            const groupFilters = {
                '完整持股': i => i.metrics.shares >= 1000,
                '零股持股': i => i.metrics.shares > 0 && i.metrics.shares < 1000,
                '已售清空': i => i.metrics.shares === 0
            };
            const filter = groupFilters[groupName];
            if (!filter) return;

            const codes = allItems.filter(filter).map(i => i.code);
            if (codes.length === 0) return;

            // 顯示更新中的圖示
            const groupBtn = document.getElementById(`btn-refresh-group-${groupName}`);
            const groupIcon = groupBtn?.querySelector('svg');
            if (groupIcon) groupIcon.classList.add('animate-spin');

            // 移除區塊更新中不該觸發的「全市場」籌碼同步

            if (!settings.marketQuotesCache) settings.marketQuotesCache = {};
            let cacheUpdated = false;
            for (const code of codes) {
                const result = await syncStockData(code, 'GROUP');
                if (result) {
                    currentQuotes[code] = result.quote;
                    chartDataCache[code] = {
                        intraday: result.intraday,
                        technical: result.technical,
                        historicalChipsKLine: result.historicalChipsKLine,
                        lastUpdated: result.lastUpdated
                    };
                    settings.marketQuotesCache[code] = result.quote;
                    cacheUpdated = true;
                }
            }
            if (cacheUpdated) saveSettings();
            if (groupIcon) groupIcon.classList.remove('animate-spin');
            renderList();
        }
    };
    window.renderMarketTabFunc = renderMarket;
}

let chartDataCache = {};

async function renderCharts(code) {
    const quote = currentQuotes[code];
    if (!quote) return;

    const intradayContainer = document.getElementById(`chart-intraday-${code}`);
    const techContainer = document.getElementById(`chart-technical-${code}`);

    if (!intradayContainer || !techContainer) return;

    const data = chartDataCache[code] || {};

    if (data.intraday && data.intraday.length > 0) {
        intradayContainer.innerHTML = '';
        renderIntradayChart(intradayContainer, data.intraday, quote);
    } else {
        intradayContainer.innerHTML = '<div class="w-full h-full flex items-center justify-center text-slate-400 text-sm">無資料 (請點擊更新)</div>';
    }

    if (data.technical && data.technical.length > 0) {
        techContainer.innerHTML = '';
        renderKLineChart(techContainer, data.technical);
    } else {
        techContainer.innerHTML = '<div class="w-full h-full flex items-center justify-center text-slate-400 text-sm">無資料 (請點擊更新)</div>';
    }
}

async function renderChipsData(code) {
    const container = document.getElementById(`chart-chips-${code}`);
    if (!container) return;

    try {
        const data = chartDataCache[code] || {};
        const priceData = data.historicalChipsKLine || [];
        const chipsData = await getChipsDataForCode(code, 0); // 0 means no limit, fetch all available

        if (!document.getElementById(`chart-chips-${code}`)) return;
        renderChipsChart(container, chipsData, code, priceData);
    } catch (e) {
        console.error('批次獲取報價時發生錯誤:', e);
        container.innerHTML = '<div class="w-full h-full flex items-center justify-center text-red-400 text-sm">載入籌碼資料失敗</div>';
    }
}

export async function renderMarket() {
    const allCodes = getAllWatchedCodes();
    if (allCodes.length > 0) {
        Promise.all(allCodes.map(code => ensureIndustryCache(code))).catch(e => {
            console.error('[市場] 批次快取產業分類失敗:', e);
        });
    }

    // Populate from IndexedDB first
    for (const code of getAllWatchedCodes()) {
        const data = await loadStockDataFromCache(code);
        if (data) {
            currentQuotes[code] = data.quote;
            chartDataCache[code] = {
                intraday: data.intraday,
                technical: data.technical,
                historicalChipsKLine: data.historicalChipsKLine,
                lastUpdated: data.lastUpdated
            };
        }
    }

    // 如果是手動更新，強制呼叫 renderList 以清除預設的 Loading 轉圈圈
    renderList();

    if (updateInterval) clearInterval(updateInterval);
    const freq = settings.refreshFreq !== undefined ? settings.refreshFreq : 15000;

    if (freq > 0) {
        refreshQuotes();
        updateInterval = setInterval(() => {
            const now = new Date();
            const day = now.getDay();
            const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

            if (settings.tradingHoursOnly) {
                if (day === 0 || day === 6) return;
                if (timeStr < '08:30' || timeStr > '13:45') return;
            } else {
                const start = settings.updateStartTime || '00:00';
                const end = settings.updateEndTime || '23:59';
                if (timeStr < start || timeStr > end) return;
            }
            refreshQuotes();
        }, freq);
    }
}

export function cleanupMarket() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

async function addStock(code, targetListId = 'watchList') {
    code = code.trim().toUpperCase();
    if (!code) return;

    // Ensure watchList exists
    if (!settings.watchList) {
        settings.watchList = [];
    }

    // UI 回饋：按鈕顯示載入中
    const btnAdd = document.getElementById('btn-market-add');
    const originalBtnHtml = btnAdd ? btnAdd.innerHTML : '';
    if (btnAdd) {
        btnAdd.innerHTML = `<svg class="animate-spin w-4 h-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> 驗證中...`;
        btnAdd.disabled = true;
    }

    try {
        // 使用者要求極速：不連線抓現價，只抓名稱快取
        if (typeof ensureStockNames === 'function') {
            await ensureStockNames();
        }
        
        const stockName = (settings.stockNamesCache && settings.stockNamesCache[code]) || '資料載入中...';
        
        // 建立預設的空報價物件，讓畫面可以立刻顯示代碼與名稱
        const quote = {
            code: code,
            name: stockName,
            price: 0,
            change: 0,
            changePercent: 0,
            volume: 0,
            status: 'empty'
        };

        let needsSave = false;
        if (!settings.watchList.includes(code)) {
            settings.watchList.push(code);
            needsSave = true;
        }

        if (targetListId !== 'watchList') {
            // 處理舊版 id 型別問題，一律轉字串比對
            let customId = String(targetListId);
            if (customId.startsWith('custom_')) {
                customId = customId.replace('custom_', '');
            }
            const customList = settings.customLists.find(l => String(l.id) === customId);
            if (customList && !customList.codes.includes(code)) {
                customList.codes.push(code);
                needsSave = true;
            }
        } else {
            if (!needsSave) {
                alert('已經在自選清單中！');
                return;
            }
        }

        if (needsSave) {
            saveSettings();
            // 直接把快速驗證拿到的基本資料 (包含代碼、名稱、現價) 塞進當前顯示用物件
            currentQuotes[code] = quote;
            // 立即渲染畫面讓使用者馬上看到，不觸發任何背景抓取
            if (typeof renderList === 'function') {
                renderList();
            }
        }
    } finally {
        // 還原按鈕狀態
        if (btnAdd) {
            btnAdd.innerHTML = originalBtnHtml;
            btnAdd.disabled = false;
        }
    }
}

function deleteStock(code) {
    if (!settings.watchList) return;

    let isCustomList = currentMarketTab.startsWith('custom_');
    let customId = isCustomList ? currentMarketTab.replace('custom_', '') : null;
    let customList = isCustomList ? (settings.customLists || []).find(l => String(l.id) === customId) : null;

    if (isCustomList && customList) {
        // 僅從當前自訂清單中移除
        customList.codes = customList.codes.filter(c => c !== code);
    } else {
        // 從全局 (watchList) 與所有自訂清單中移除
        settings.watchList = settings.watchList.filter(c => c !== code);
        delete currentQuotes[code];
        if (settings.customLists) {
            settings.customLists.forEach(l => {
                l.codes = l.codes.filter(c => c !== code);
            });
        }
    }

    saveSettings();
    renderList();
}

async function refreshQuotes(isManual = false) {
    const listStatus = document.getElementById('market-list-status');
    const allCodes = getAllWatchedCodes();
    const count = allCodes.length;

    if (listStatus) {
        listStatus.innerText = count > 0 ? `自選清單 (${count} 檔)` : `已清空 (0 檔)`;
    }

    if (count === 0) {
        const container = document.getElementById('market-watch-list');
        if (container) {
            container.innerHTML = '<tr><td colspan="10" class="px-4 py-10 text-center text-slate-400">尚未加入自選股</td></tr>';
        }
        return;
    }

    // --- 進入個股迴圈前，統一執行「全域資料」快取檢查與更新 ---
    if (isManual) {
        // [Phase 1]: 每日全域大表 (確保名稱、本益比/殖利率、營收YoY、季報EPS、籌碼已快取)
        await ensureStockNames();
        await ensurePEYieldCache();
        await ensureRevenueYoYCache(false);
        await ensureEpsCache(false);
        await syncLatestChipsData(); // 循序等待，避免 Log 與其他抓取交叉顯示

        // [Phase 3]: 盤中全域大表 (強制抓取最新 ETF 淨值，防呆交由 API 內部控管)
        await ensureEtfNavCache(true);
    }

    for (const code of allCodes) {
        const updateMode = isManual ? 'GLOBAL' : 'AUTO';
        const result = await syncStockData(code, updateMode);
        if (result) {
            currentQuotes[code] = result.quote;
            chartDataCache[code] = {
                intraday: result.intraday,
                technical: result.technical,
                historicalChipsKLine: result.historicalChipsKLine,
                lastUpdated: result.lastUpdated
            };
        }
    }

    renderList();
}

function getBrokersForCode(code) {
    const transactions = settings.transactions || [];
    const brokerIds = new Set();
    transactions.forEach(t => {
        if (t.code === code && t.brokerId) {
            brokerIds.add(t.brokerId);
        }
    });
    if (brokerIds.size === 0) return '<span class="text-slate-400">-</span>';
    const brokers = settings.brokers || [];
    const brokerObjs = [];
    brokerIds.forEach(id => {
        const b = brokers.find(br => br.id === id || String(br.id) === String(id));
        if (b) brokerObjs.push(b);
    });

    if (brokerObjs.length === 0) return '<span class="text-slate-400">-</span>';

    const colors = [
        'bg-blue-50 text-blue-600 border-blue-200',
        'bg-emerald-50 text-emerald-600 border-emerald-200',
        'bg-amber-50 text-amber-600 border-amber-200',
        'bg-purple-50 text-purple-600 border-purple-200',
        'bg-rose-50 text-rose-600 border-rose-200',
        'bg-indigo-50 text-indigo-600 border-indigo-200',
        'bg-cyan-50 text-cyan-600 border-cyan-200',
        'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200'
    ];

    const badges = brokerObjs.map(b => {
        const idx = brokers.findIndex(br => br.id === b.id);
        let color = colors[0];
        if (idx !== -1) {
            color = colors[idx % colors.length];
        } else {
            let hash = 0;
            for (let i = 0; i < b.name.length; i++) hash = b.name.charCodeAt(i) + ((hash << 5) - hash);
            color = colors[Math.abs(hash) % colors.length];
        }
        return `<span class="inline-block px-2 py-0.5 ${color} rounded text-[13px] font-medium border shadow-sm">${b.name}</span>`;
    });

    const rows = [];
    for (let i = 0; i < badges.length; i += 2) {
        const chunk = badges.slice(i, i + 2);
        rows.push(`<div class="flex items-center justify-center gap-1">${chunk.join('')}</div>`);
    }
    return `<div class="flex flex-col items-center justify-center gap-1">${rows.join('')}</div>`;
}

function getSortedCodes() {
    const codes = getAllWatchedCodes();

    codes.sort((a, b) => {
        const qA = currentQuotes[a];
        const qB = currentQuotes[b];
        let valA, valB;

        switch (marketSortColumn) {
            case 'code':
                valA = a;
                valB = b;
                return marketSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            case 'change':
                valA = qA?.change ?? 0;
                valB = qB?.change ?? 0;
                break;
            case 'changePercent':
                valA = qA?.changePercent ?? 0;
                valB = qB?.changePercent ?? 0;
                break;
            case 'volume':
                valA = qA?.volume ?? 0;
                valB = qB?.volume ?? 0;
                break;
            default:
                return 0;
        }
        return marketSortDirection === 'asc' ? valA - valB : valB - valA;
    });
    return codes;
}

function updateMarketSortIcons() {
    ['code', 'change', 'changePercent', 'volume'].forEach(col => {
        const icon = document.getElementById(`market-sort-icon-${col}`);
        if (icon) {
            if (marketSortColumn === col) {
                icon.innerText = marketSortDirection === 'asc' ? '▲' : '▼';
                icon.classList.remove('text-slate-300');
                icon.classList.add('text-blue-500');
            } else {
                icon.innerText = '';
                icon.classList.add('text-slate-300');
                icon.classList.remove('text-blue-500');
            }
        }
    });
}

function renderList() {
    const container = document.getElementById('market-watch-list');
    if (!container) return;

    const sortedCodes = getSortedCodes();

    const listStatus = document.getElementById('market-list-status');
    if (listStatus) {
        listStatus.innerText = sortedCodes.length > 0 ? `自選清單 (${sortedCodes.length} 檔)` : `自選清單 (0 檔)`;
    }

    if (sortedCodes.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="10" class="px-2 py-10 text-center text-slate-400">尚未加入自選股</td>
            </tr>
        `;
        if (window.updateBatchDeleteUI) window.updateBatchDeleteUI();
        return;
    }

    container.innerHTML = '';

    const items = sortedCodes.map(code => {
        const quote = currentQuotes[code] || {
            code: code,
            name: (settings.stockNamesCache && settings.stockNamesCache[code]) || '無資料',
            price: 0,
            change: 0,
            changePercent: 0,
            volume: 0,
            status: 'empty'
        };
        const metrics = calculateStockMetrics(code, quote.price || 0);
        const hasTrades = (settings.transactions || []).some(t => t.code === code);
        return { code, quote, metrics, hasTrades };
    }).filter(i => i !== null);

    const groups = [
        { id: 'full', name: '完整持股', filter: i => i.metrics.shares >= 1000, items: [] },
        { id: 'odd', name: '零股持股', filter: i => i.metrics.shares > 0 && i.metrics.shares < 1000, items: [] },
        { id: 'sold', name: '已出清', filter: i => i.metrics.shares === 0 && i.hasTrades, items: [] },
        { id: 'tracking', name: '追蹤清單', filter: i => i.metrics.shares === 0 && !i.hasTrades, items: [] }
    ];

    if (settings.customLists) {
        settings.customLists.forEach(list => {
            groups.push({
                id: `custom_${list.id}`,
                name: list.name,
                filter: i => list.codes.includes(i.code),
                items: []
            });
        });
    }

    items.forEach(item => {
        // 先判斷原本互斥的四個基本群組
        let addedToBasic = false;
        for (let i = 0; i < 4; i++) {
            if (groups[i].filter(item)) {
                groups[i].items.push(item);
                addedToBasic = true;
                break;
            }
        }
        // 再判斷所有自訂清單，這可以重複加入
        for (let i = 4; i < groups.length; i++) {
            if (groups[i].filter(item)) {
                groups[i].items.push(item);
            }
        }
    });

    const format10k = (num) => {
        if (num === 0) return '-';
        if (Math.abs(num) >= 10000) return (num / 10000).toFixed(1) + '萬';
        return num.toLocaleString();
    };

    const renderItem = (item) => {
        if (expandedStockCode && item.code !== expandedStockCode) return;

        const { code, quote, metrics } = item;
        const isUp = quote.change > 0;
        const isDown = quote.change < 0;
        let priceColor = 'text-slate-800';

        if (isUp) {
            priceColor = 'text-price-up';
        } else if (isDown) {
            priceColor = 'text-price-down';
        }

        const formatPrice = (p) => p != null ? Number(p.toFixed(2)).toString() : '--';
        const priceDisplay = formatPrice(quote.price);
        const ma5Display = formatPrice(quote.ma5);
        const ma20Display = formatPrice(quote.ma20);
        const ma60Display = formatPrice(quote.ma60);

        const changeDisplay = isUp ? `+${formatPrice(quote.change)}` : (isDown ? formatPrice(quote.change) : '0');
        const changePctDisplay = isUp ? `+${formatPrice(quote.changePercent)}%` : (isDown ? `${formatPrice(quote.changePercent)}%` : '0%');
        const volumeDisplay = quote.volume > 0 ? quote.volume.toLocaleString() : '--';

        const brokerDisplay = getBrokersForCode(code);

        let timeDisplay = '--';
        if (quote.tradeTime) {
            timeDisplay = quote.tradeTime;
            if (quote.quoteDate) {
                const now = new Date();
                const todayStr = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
                if (quote.quoteDate !== todayStr || now.getHours() < 9) {
                    const m = quote.quoteDate.substring(4, 6);
                    const d = quote.quoteDate.substring(6, 8);
                    // 判斷是否為「昨天」：計算日期差距
                    const qYear = parseInt(quote.quoteDate.substring(0, 4));
                    const qMonth = parseInt(quote.quoteDate.substring(4, 6)) - 1;
                    const qDay = parseInt(quote.quoteDate.substring(6, 8));
                    const quoteDateObj = new Date(qYear, qMonth, qDay);
                    const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const diffDays = Math.round((todayObj - quoteDateObj) / (1000 * 60 * 60 * 24));
                    const dayLabel = diffDays === 1 ? '<span class="text-red-400 font-medium">(昨)</span> ' :
                        diffDays > 1 ? '<span class="text-slate-400 font-medium">(' + m + '/' + d + ')</span> ' : '';
                    timeDisplay = `${dayLabel}${m}/${d}<br/>${timeDisplay}`;
                }
            }
        } else if (quote.timestamp) {
            const date = new Date(quote.timestamp);
            timeDisplay = date.toLocaleTimeString('zh-TW', { hour12: false });
        }

        let sharesDisplay = '-';
        let costDisplay = '-';
        let mvDisplay = '-';
        let unrealizedDisplay = '-';
        let unrealizedColorText = 'text-slate-500 font-bold';
        let unrealizedColorBg = 'text-slate-500 font-bold';

        if (metrics.shares > 0) {
            sharesDisplay = metrics.shares.toLocaleString();
            costDisplay = Math.floor(metrics.totalCost).toLocaleString();
            mvDisplay = Math.floor(metrics.marketValue).toLocaleString();
            unrealizedDisplay = (metrics.unrealized > 0 ? '+' : '') + Math.floor(metrics.unrealized).toLocaleString();
            unrealizedColorText = metrics.unrealized > 0 ? 'text-profit' : (metrics.unrealized < 0 ? 'text-loss' : 'text-slate-500 font-bold');
            unrealizedColorBg = metrics.unrealized > 0 ? 'bg-profit' : (metrics.unrealized < 0 ? 'bg-loss' : 'text-slate-500 font-bold');
        } else if (metrics.shares === 0 && metrics.realized !== undefined) {
            // 已出清持股，顯示最終獲利
            mvDisplay = metrics.realized > 0 ? '最終獲利' : (metrics.realized < 0 ? '最終虧損' : '已實現');
            unrealizedDisplay = (metrics.realized > 0 ? '+' : '') + Math.floor(metrics.realized).toLocaleString();
            unrealizedColorText = metrics.realized > 0 ? 'text-profit' : (metrics.realized < 0 ? 'text-loss' : 'text-slate-500 font-bold');
            unrealizedColorBg = metrics.realized > 0 ? 'bg-profit' : (metrics.realized < 0 ? 'bg-loss' : 'text-slate-500 font-bold');
        }

        const row = document.createElement('tr');
        row.className = 'hover:bg-blue-50 transition-colors group align-top cursor-pointer';
        row.onclick = () => window.marketTab.toggleStockDetails(code);

        let col1Display, col2Display;
        const NA_TAG = '<span class="text-sm text-slate-400 font-normal">N/A</span>';
        const yieldStr = quote.dividendYield != null ? quote.dividendYield : NA_TAG;

        if (quote.isETF) {
            const navStr = quote.nav != null ? quote.nav.toFixed(2) : '--';
            const premStr = quote.premium != null ? `${quote.premium > 0 ? '+' : ''}${quote.premium.toFixed(2)}%` : '--';
            const premColor = quote.premium > 0 ? 'text-price-up' : (quote.premium < 0 ? 'text-price-down' : 'text-slate-500');
            col1Display = `<div class="w-full h-full flex flex-col justify-center" title="不適用 (Not Applicable)&#10;即時預估淨值 (Net Asset Value)"><div class="text-slate-800 font-medium">${NA_TAG}</div><div class="text-sm text-slate-400 mt-0.5">Est. NAV: ${navStr}</div></div>`;
            col2Display = `<div class="w-full h-full flex flex-col justify-center" title="不適用 (Not Applicable)&#10;預估折溢價 (Premium/Discount)&#10;正值為溢價，負值為折價"><div class="text-slate-800 font-medium">${NA_TAG}</div><div class="text-sm ${premColor} mt-0.5">Prem: ${premStr}</div></div>`;
        } else {
            const peStr = quote.peRatio != null ? quote.peRatio : NA_TAG;
            const navVal = (quote.price && quote.pbRatio) ? (quote.price / quote.pbRatio).toFixed(2) : '--';

            let formatRevPeriod = quote.revenuePeriod || '';
            if (/^\d{4,5}$/.test(formatRevPeriod)) {
                formatRevPeriod = `${formatRevPeriod.slice(0, formatRevPeriod.length - 2)}年${formatRevPeriod.slice(formatRevPeriod.length - 2)}月`;
            } else if (/^\d{6}$/.test(formatRevPeriod)) {
                formatRevPeriod = `${formatRevPeriod.slice(0, 4)}年${formatRevPeriod.slice(4, 6)}月`;
            }

            col1Display = `<div class="w-full h-full flex flex-col justify-center" title="本益比 (Price-to-Earnings Ratio)&#10;估算每股淨值 (Book Value Per Share)&#10;由公式「當前股價 ÷ 股價淨值比(PB)」反推估算"><div class="text-slate-800 font-medium">${peStr}</div><div class="text-sm text-slate-400 mt-0.5">BVPS: ${navVal}</div></div>`;
            const yoyTitle = `殖利率 (Dividend Yield)&#10;月營收年增率 (YoY)：&#10;比較本月與去年同月的營收成長。&#10;正值代表成長，負值代表衰退。${formatRevPeriod ? `&#10;(資料期間: ${formatRevPeriod})` : ''}`;
            const yoyStr = quote.revenueYoY != null ? `<div class="text-xs ${quote.revenueYoY > 0 ? 'text-price-up' : (quote.revenueYoY < 0 ? 'text-price-down' : 'text-slate-400')} mt-0.5">YoY: ${quote.revenueYoY > 0 ? '+' : ''}${Math.round(quote.revenueYoY * 100) / 100}%</div>` : '';
            col2Display = `<div class="w-full h-full flex flex-col justify-center" title="${yoyTitle}"><div class="text-slate-800 font-medium">${yieldStr}</div>${yoyStr}</div>`;
        }

        row.innerHTML = `
            <td class="px-2 py-3 text-center align-top" onclick="event.stopPropagation()">
                <div class="flex flex-col items-center justify-start h-full">
                    <div class="pt-1 flex items-center justify-center">
                        <input type="checkbox" class="market-checkbox rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" data-code="${code}">
                    </div>
                    <!-- 隱形佔位符，對應右邊的「名稱」那一行，解決「少換一行」的問題 -->
                    <div class="mt-0.5 text-sm leading-tight text-transparent select-none opacity-0" aria-hidden="true">_</div>
                    <div class="mt-1 flex items-center justify-center">
                        <button class="text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-0.5 rounded" onclick="window.marketTab.deleteStock('${code}')" title="刪除">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </div>
            </td>
            <td class="px-2 py-3 text-slate-600">
                <div class="pt-0.5 font-medium text-slate-800 text-base">${code}</div>
                <div class="mt-0.5 hover:text-blue-600 transition-colors whitespace-normal break-words leading-tight font-medium text-sm" style="min-width: 80px;" title="${quote.name || '未知'}">${quote.name || '未知'}</div>
                <div class="flex items-center gap-1 mt-1">
                    <button class="text-pink-600 bg-pink-50 hover:bg-pink-100 hover:text-pink-700 p-0.5 rounded transition-colors border border-pink-100 shadow-sm" onclick="event.stopPropagation(); window.marketTab.refreshSingle('${code}')" title="更新如下...&#10;【個別更新】隨時盤中 (即時報價、盤中走勢圖)">
                        <svg id="btn-refresh-row-${code}" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    </button>
                    <span class="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium border border-blue-100">${quote.isETF ? 'ETF' : '股票'}</span>
                    ${getIndustry(code) ? `<span class="inline-block px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-medium border border-slate-200">${getIndustry(code)}</span>` : ''}
                </div>
            </td>
            <td class="px-2 py-3 text-center align-top">
                <div class="pt-1">${brokerDisplay}</div>
            </td>
            <td class="px-2 py-2 text-right">
                <div class="font-medium ${priceColor} pt-1">${priceDisplay}</div>
                <div class="text-[10px] text-slate-400 mt-1 flex flex-col gap-0.5" title="5日移動平均線 (5-Day Moving Average)&#10;20日移動平均線 / 月線 (20-Day Moving Average)&#10;60日移動平均線 / 季線 (60-Day Moving Average)">
                    <span>5MA: ${ma5Display}</span>
                    <span>20MA: ${ma20Display}</span>
                    <span>60MA: ${ma60Display}</span>
                </div>
            </td>
            <td class="px-2 py-2 text-right">
                <div class="${priceColor} pt-1">${changeDisplay}</div>
                <div class="${priceColor} mt-1">${changePctDisplay}</div>
            </td>
            <td class="px-2 py-3 text-right text-slate-600">${volumeDisplay}</td>
            <td class="px-2 py-3 text-center">${col1Display}</td>
            <td class="px-2 py-3 text-center">${col2Display}</td>
            <td class="px-2 py-3 text-center text-slate-400 text-sm">
                <div class="flex items-center justify-center gap-1">
                    <span>${timeDisplay}</span>
                </div>
            </td>
            <td class="px-2 py-2 text-right">
                <div class="font-medium text-slate-800 mb-1 ${metrics.shares > 0 && metrics.breakEvenPrice ? 'cursor-help' : ''}" ${metrics.shares > 0 && metrics.breakEvenPrice ? `title="持有股份：${sharesDisplay}&#10;損益兩平價：${metrics.breakEvenPrice.toFixed(2)}&#10;成本：${costDisplay}&#10;市值：${mvDisplay}&#10;盈虧：${unrealizedDisplay}"` : ''}>
                    ${sharesDisplay}${metrics.shares > 0 && metrics.breakEvenPrice ? ` <span class="text-[11px] text-slate-500 font-normal">(${metrics.breakEvenPrice.toFixed(2)})</span>` : ''}
                </div>
                <div class="${unrealizedColorBg} inline-flex flex-col items-end leading-tight text-right ml-auto min-w-[60px] p-1.5 rounded">
                    <div class="text-slate-500 font-normal text-[11px] mb-0.5">${costDisplay}</div>
                    <div class="${unrealizedColorText} font-medium text-sm">${mvDisplay}</div>
                    <div class="mt-0.5 font-medium ${unrealizedColorText}">${unrealizedDisplay}</div>
                </div>
            </td>
        `;

        container.appendChild(row);

        if (expandedStockCode === code) {
            const detailRow = document.createElement('tr');
            detailRow.className = 'bg-slate-50/50 border-b border-slate-100';

            const isTabQuote = expandedTab === 'quote';
            const isTabChips = expandedTab === 'chips';
            const isTabTrades = expandedTab === 'trades';

            const activeClass = "bg-white text-blue-700 shadow-sm ring-1 ring-slate-900/5";
            const inactiveClass = "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50";

            detailRow.innerHTML = `
                <td colspan="10" class="p-0">
                    <div class="px-6 py-5 shadow-inner bg-slate-50/50">
                        <div class="inline-flex items-center p-1.5 bg-slate-200/70 rounded-xl mb-6 shadow-inner">
                            <button onclick="window.marketTab.setExpandedTab('quote')" class="px-6 py-2 rounded-lg text-base font-bold transition-all ${isTabQuote ? activeClass : inactiveClass}">報價詳情</button>
                            <button onclick="window.marketTab.setExpandedTab('chips')" class="px-6 py-2 rounded-lg text-base font-bold transition-all ${isTabChips ? activeClass : inactiveClass}">籌碼分析</button>
                            <button onclick="window.marketTab.setExpandedTab('trades')" class="px-6 py-2 rounded-lg text-base font-bold transition-all ${isTabTrades ? activeClass : inactiveClass}">交易紀錄</button>
                        </div>
                        <div class="px-2 min-h-[120px]">
                            ${renderExpandedContent(quote)}
                        </div>
                    </div>
                </td>
            `;
            container.appendChild(detailRow);
        }
    };

    const tabsContainer = document.getElementById('market-tabs');
    if (tabsContainer && !expandedStockCode) {
        tabsContainer.style.display = 'flex';
        tabsContainer.innerHTML = '';
        groups.forEach(g => {
            const count = g.items.length;
            const isActive = currentMarketTab === g.id;
            const btn = document.createElement('button');
            btn.className = `px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg transition-colors border-b-2 flex items-center ${isActive
                ? 'border-blue-600 text-blue-700 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100/50'
                }`;
            btn.onclick = () => window.marketTab.switchTab(g.id);
            btn.innerHTML = `
                <button id="btn-refresh-group-${g.id}" class="mr-1.5 p-1 rounded-md text-slate-400 hover:text-pink-600 hover:bg-pink-50 transition-colors" onclick="event.stopPropagation(); window.marketTab.refreshGroup('${g.id}', event)" title="依序更新如下...&#10;【個別更新】每日一次 (歷史 K 線)&#10;【個別更新】隨時盤中 (即時報價、盤中走勢圖)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                </button>
                <span>${g.name}</span> <span class="ml-1 text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}">${count}</span>
            `;
            tabsContainer.appendChild(btn);
        });

        // 更新下拉選單
        const targetSelect = document.getElementById('market-add-target');
        if (targetSelect) {
            const currentVal = targetSelect.value;
            targetSelect.innerHTML = `<option value="watchList">預設自選</option>`;
            if (settings.customLists) {
                settings.customLists.forEach(list => {
                    const opt = document.createElement('option');
                    opt.value = list.id;
                    opt.textContent = list.name;
                    targetSelect.appendChild(opt);
                });
            }

            // 自動選取當前分類，若無則保留原本的選項
            if (currentMarketTab.startsWith('custom_')) {
                const customId = currentMarketTab.replace('custom_', '');
                targetSelect.value = customId;
            } else {
                targetSelect.value = 'watchList';
            }
        }
    } else if (tabsContainer) {
        tabsContainer.style.display = 'none';
    }

    if (expandedStockCode) {
        items.forEach(renderItem);
    } else {
        const activeGroup = groups.find(g => g.id === currentMarketTab) || groups[0];
        if (activeGroup && activeGroup.items.length > 0) {
            activeGroup.items.forEach(renderItem);
        } else {
            container.innerHTML = `<tr><td colspan="10" class="px-4 py-12 text-center text-slate-400">這個分類目前沒有任何資料</td></tr>`;
        }
    }

    updateMarketSortIcons();

    // Re-render charts for the expanded row if needed
    if (expandedStockCode) {
        if (expandedTab === 'quote') {
            setTimeout(() => renderCharts(expandedStockCode), 0);
        } else if (expandedTab === 'chips') {
            setTimeout(() => renderChipsData(expandedStockCode), 0);
        }
    }

    bindMarketCheckboxListeners();
}

function bindMarketCheckboxListeners() {
    const selectAllCheckbox = document.getElementById('market-select-all');
    const checkboxes = document.querySelectorAll('.market-checkbox');
    const batchDeleteBtn = document.getElementById('btn-market-batch-delete');
    const batchDeleteText = document.getElementById('btn-market-batch-delete-text');

    if (!selectAllCheckbox || !batchDeleteBtn) return;

    window.updateBatchDeleteUI = () => {
        const currentCheckboxes = document.querySelectorAll('.market-checkbox');
        const checkedCount = document.querySelectorAll('.market-checkbox:checked').length;
        if (checkedCount > 0) {
            batchDeleteBtn.classList.remove('hidden');
            batchDeleteBtn.classList.add('flex');
            batchDeleteText.innerText = `刪除所選 (${checkedCount})`;
        } else {
            batchDeleteBtn.classList.add('hidden');
            batchDeleteBtn.classList.remove('flex');
        }
        if (currentCheckboxes.length > 0) {
            selectAllCheckbox.checked = checkedCount > 0 && checkedCount === currentCheckboxes.length;
        } else {
            selectAllCheckbox.checked = false;
        }
    };

    // Use onchange to overwrite previous listeners from older render cycles
    selectAllCheckbox.onchange = (e) => {
        const currentCheckboxes = document.querySelectorAll('.market-checkbox');
        currentCheckboxes.forEach(cb => cb.checked = e.target.checked);
        window.updateBatchDeleteUI();
    };

    // New row checkboxes get fresh event listeners
    checkboxes.forEach(cb => {
        cb.onchange = window.updateBatchDeleteUI;
    });

    // Initial sync
    window.updateBatchDeleteUI();
}

function renderExpandedContent(quote) {
    if (expandedTab === 'quote') {
        const meta = quote.meta || {};

        const isUp = quote.change > 0;
        const isDown = quote.change < 0;
        let priceColor = 'text-slate-800';
        if (isUp) priceColor = 'text-price-up';
        else if (isDown) priceColor = 'text-price-down';

        const formatPrice = (p) => p != null ? Number(p.toFixed(2)).toString() : '--';
        const priceDisplay = formatPrice(quote.price);
        const changeDisplay = isUp ? `+${formatPrice(quote.change)}` : (isDown ? formatPrice(quote.change) : '0');
        const changePctDisplay = isUp ? `+${formatPrice(quote.changePercent)}%` : (isDown ? `${formatPrice(quote.changePercent)}%` : '0%');
        const volumeDisplay = quote.volume > 0 ? quote.volume.toLocaleString() : '--';
        let tradeTime = '--';
        if (quote.tradeTime) {
            tradeTime = quote.tradeTime;
            if (quote.quoteDate) {
                const now = new Date();
                const todayStr = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
                if (quote.quoteDate !== todayStr || now.getHours() < 9) {
                    const m = quote.quoteDate.substring(4, 6);
                    const d = quote.quoteDate.substring(6, 8);
                    const qYear = parseInt(quote.quoteDate.substring(0, 4));
                    const qMonth = parseInt(quote.quoteDate.substring(4, 6)) - 1;
                    const qDay = parseInt(quote.quoteDate.substring(6, 8));
                    const quoteDateObj = new Date(qYear, qMonth, qDay);
                    const todayObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const diffDays = Math.round((todayObj - quoteDateObj) / (1000 * 60 * 60 * 24));
                    const dayLabel = diffDays === 1 ? '<span class="text-red-400 font-medium">(昨收)</span> ' :
                        diffDays > 1 ? '<span class="text-slate-400 font-medium">(' + m + '/' + d + ')</span> ' : '';
                    tradeTime = `${dayLabel}${m}/${d}<br/>${tradeTime}`;
                }
            }
        } else if (quote.timestamp) {
            const date = new Date(quote.timestamp);
            tradeTime = date.toLocaleTimeString('zh-TW', { hour12: false });
        }
        let formatRevPeriod = quote.revenuePeriod || '';
        if (/^\d{4,5}$/.test(formatRevPeriod)) {
            formatRevPeriod = `${formatRevPeriod.slice(0, formatRevPeriod.length - 2)}年${formatRevPeriod.slice(formatRevPeriod.length - 2)}月`;
        } else if (/^\d{6}$/.test(formatRevPeriod)) {
            formatRevPeriod = `${formatRevPeriod.slice(0, 4)}年${formatRevPeriod.slice(4, 6)}月`;
        }

        return `
            <div class="space-y-4 animate-[fadeIn_0.2s_ease-in-out]">
                <!-- Huge Price Display -->
                <div class="flex justify-between items-end border-b border-slate-200 pb-4">
                    <div>
                        <div class="text-4xl font-bold ${priceColor} mb-2">${priceDisplay}</div>
                        <div class="flex items-center gap-3">
                            <span class="text-base font-medium ${priceColor}">${changeDisplay} (${changePctDisplay})</span>
                            <span class="text-xs text-slate-400">成交時間 ${tradeTime}</span>
                            <button id="btn-refresh-single-wrapper-${quote.code}" onclick="window.marketTab.refreshSingle('${quote.code}')" class="text-blue-600 hover:text-blue-800 transition-colors bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded text-xs flex items-center gap-1 shadow-sm border border-blue-200/50" title="更新如下...&#10;【個別更新】隨時盤中 (即時報價、盤中走勢圖)">
                                <svg id="btn-refresh-single-${quote.code}" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                <span id="btn-refresh-single-text-${quote.code}">更新報價</span>
                            </button>
                        </div>
                    </div>
                    <div class="text-right flex flex-col items-end gap-2">
                        <div class="flex items-center gap-4">
                            <div>
                                <div class="text-xs text-slate-400 mb-1">總量</div>
                                <div class="text-2xl font-bold text-slate-800">${volumeDisplay}</div>
                            </div>
                        </div>
                        <button onclick="window.marketTab.promptSetStockCustomLists('${quote.code}')" class="px-2 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded text-xs font-medium transition-colors border border-slate-200 mt-1">
                            設定自訂清單
                        </button>
                    </div>
                </div>

                <!-- Stats Grid (Open, High, Low, Yesterday, Amplitude) -->
                <div class="grid grid-cols-5 gap-3 text-sm">
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs">開盤</div>
                        <div class="font-semibold text-slate-800 text-lg">${quote.open != null ? quote.open.toFixed(2) : '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs">最高</div>
                        <div class="font-semibold text-red-600 text-lg">${quote.high != null ? quote.high.toFixed(2) : '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs">最低</div>
                        <div class="font-semibold text-green-600 text-lg">${quote.low != null ? quote.low.toFixed(2) : '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs">昨收</div>
                        <div class="font-semibold text-slate-800 text-lg">${quote.yesterday != null ? quote.yesterday.toFixed(2) : '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs">漲幅</div>
                        <div class="font-semibold ${priceColor} text-lg">${changePctDisplay}</div>
                    </div>
                </div>

                <!-- Financial & Valuation Metrics Grid -->
                ${quote.isETF ? `
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20 relative">
                        <div class="text-slate-500 text-xs" title="即時預估淨值 (Net Asset Value)">Est. NAV</div>
                        <div class="font-semibold text-slate-800 text-lg">${quote.nav != null ? quote.nav.toFixed(2) : '--'}</div>
                        <div class="absolute top-2 right-2 text-[10px] text-slate-400">來源: TWSE</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs" title="預估折溢價 (Premium/Discount)&#10;正值為溢價，負值為折價">Premium</div>
                        <div class="font-semibold ${quote.premium > 0 ? 'text-red-500' : (quote.premium < 0 ? 'text-green-500' : 'text-slate-800')} text-lg">${quote.premium != null ? `${quote.premium > 0 ? '+' : ''}${quote.premium.toFixed(2)}%` : '--'}</div>
                    </div>
                </div>
                ` : `
                <div class="grid grid-cols-3 sm:grid-cols-6 gap-2.5 text-sm">
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs" title="本益比 (Price-to-Earnings Ratio)">P/E Ratio</div>
                        <div class="font-semibold text-slate-800 text-base sm:text-lg">${quote.peRatio || '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20">
                        <div class="text-slate-500 text-xs" title="殖利率 (Dividend Yield)">Yield</div>
                        <div class="font-semibold text-slate-800 text-base sm:text-lg">${quote.dividendYield ? quote.dividendYield + '%' : '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20" title="非官方財報淨值，由「當前股價 ÷ 股價淨值比(PB)」公式反推估算，可能有些微誤差。">
                        <div class="text-slate-500 text-xs flex items-center justify-between">
                            <span title="估算每股淨值 (Book Value Per Share)">BVPS</span>
                            <svg class="w-3 h-3 text-slate-300 hover:text-slate-500 cursor-help transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div class="font-semibold text-slate-800 text-base sm:text-lg">${(quote.price && quote.pbRatio) ? (quote.price / quote.pbRatio).toFixed(2) : '--'}</div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20" title="月營收年增率 (YoY)：&#10;比較本月與去年同月的營收成長。&#10;正值代表成長，負值代表衰退。${formatRevPeriod ? `&#10;(資料期間: ${formatRevPeriod})` : ''}">
                        <div class="text-slate-500 text-xs flex items-center justify-between">
                            <span>營收 YoY</span>
                            ${formatRevPeriod ? `<span class="text-[10px] text-slate-400 font-normal scale-90">${formatRevPeriod}</span>` : ''}
                        </div>
                        <div class="font-semibold ${quote.revenueYoY > 0 ? 'text-price-up' : (quote.revenueYoY < 0 ? 'text-price-down' : 'text-slate-800')} text-base sm:text-lg">
                            ${quote.revenueYoY != null ? `${quote.revenueYoY > 0 ? '+' : ''}${Math.round(quote.revenueYoY * 100) / 100}%` : '--'}
                        </div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20" title="${quote.epsPeriod ? `資料期間: ${quote.epsPeriod}` : ''}">
                        <div class="text-slate-500 text-xs flex items-center justify-between">
                            <span>季報 EPS</span>
                            ${quote.epsPeriod ? `<span class="text-[10px] text-slate-400 font-normal scale-90">${quote.epsPeriod}</span>` : ''}
                        </div>
                        <div class="font-semibold text-slate-800 text-base sm:text-lg">
                            ${quote.eps != null ? `${quote.eps} 元` : '--'}
                        </div>
                    </div>
                    <div class="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-between h-20" title="本益成長比 (PEG) = 本益比 ÷ 營收年增率(YoY)。數值 < 1 通常代表成長股評價具吸引力。">
                        <div class="text-slate-500 text-xs flex items-center justify-between">
                            <span>PEG 指標</span>
                            <svg class="w-3 h-3 text-slate-300 hover:text-slate-500 cursor-help transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div class="font-semibold ${quote.peg != null && quote.peg < 1 ? 'text-emerald-600' : 'text-slate-800'} text-base sm:text-lg">
                            ${quote.peg != null ? quote.peg : (quote.peRatio && quote.revenueYoY != null && quote.revenueYoY <= 0 ? '<span class="text-xs text-slate-400 font-normal">YoY≤0</span>' : '--')}
                        </div>
                    </div>
                </div>
                `}

                <!-- Placeholders for Charts -->
                <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
                    <h4 class="text-sm font-semibold text-slate-800 mb-4">當日走勢 (Intraday Chart)</h4>
                    <div id="chart-intraday-${quote.code}" class="h-64 bg-slate-50 rounded flex items-center justify-center text-slate-400 text-xs border border-dashed border-slate-200">
                        圖表建置中...
                    </div>
                </div>
                <div class="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
                    <h4 class="text-sm font-semibold text-slate-800 mb-4">技術線圖 (Technical Chart)</h4>
                    <div id="chart-technical-${quote.code}" class="h-96 bg-slate-50 rounded flex items-center justify-center text-slate-400 text-xs border border-dashed border-slate-200">
                        圖表建置中...
                    </div>
                </div>
            </div>
        `;
    } else if (expandedTab === 'chips') {
        return `
            <div id="chart-chips-${quote.code}" class="min-h-[200px]">
                <div class="flex flex-col items-center justify-center h-24 text-slate-400">
                    <svg class="animate-spin w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <p class="text-sm">載入籌碼資料中...</p>
                </div>
            </div>
        `;
    } else if (expandedTab === 'trades') {
        const stockCode = quote.code;
        const trades = (settings.transactions || []).filter(t => t.code === stockCode);

        let html = `
            <div class="flex justify-between items-center mb-3 px-1">
                <span class="text-sm font-medium text-slate-700">交易紀錄明細</span>
                <button onclick="if(window.openTradeModal) window.openTradeModal('${stockCode}')" class="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded transition-colors flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    新增紀錄
                </button>
            </div>
        `;

        const metrics = calculateStockMetrics(stockCode, quote.price || 0);

        const colorVal = (val, prefix = '') => {
            if (val > 0) return `<span class="bg-profit text-sm">${prefix}${val.toLocaleString()}</span>`;
            if (val < 0) return `<span class="bg-loss text-sm">${val.toLocaleString()}</span>`;
            return `<span class="text-slate-500 font-medium">${prefix}${val.toLocaleString()}</span>`;
        };

        if (trades.length > 0 && metrics) {
            const adjustedAvgPrice = metrics.shares > 0 ? (metrics.totalCost - metrics.realized) / metrics.shares : 0;
            const fifoAdjustedAvgPrice = metrics.fifo.shares > 0 ? (metrics.fifo.totalCost - metrics.fifo.realized) / metrics.fifo.shares : 0;

            html += `
                <div class="bg-white dark:bg-[#2D2D2D] text-slate-800 dark:text-slate-200 rounded-xl p-4 mb-4 shadow-sm border border-slate-200 dark:border-[#3D3D3D] text-sm transition-colors">
                    <div class="text-slate-500 dark:text-slate-400 mb-3 font-medium">持股摘要</div>
                    <div class="grid grid-cols-2 gap-4 mb-4 border-b border-slate-100 dark:border-[#3D3D3D] pb-4">
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">持股 (股)</div>
                            <div class="text-xl font-bold text-slate-900 dark:text-white">${metrics.shares.toLocaleString()}</div>
                        </div>
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">目前市值</div>
                            <div class="text-xl font-bold text-purple-600 dark:text-purple-400">${Math.round(metrics.marketValue).toLocaleString()}</div>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-4 mb-4 border-b border-slate-100 dark:border-[#3D3D3D] pb-4">
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">持股成本</div>
                            <div class="text-lg font-semibold text-red-500 dark:text-red-400">${Math.round(metrics.totalCost).toLocaleString()}</div>
                        </div>
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">損益兩平價</div>
                            <div class="text-lg font-semibold text-amber-600 dark:text-yellow-500">${metrics.breakEvenPrice.toFixed(2)}</div>
                            <div class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">含手續費及交易稅</div>
                        </div>
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">已實現</div>
                            <div class="text-lg font-semibold">${colorVal(Math.round(metrics.realized), (metrics.realized > 0 ? '+' : ''))}</div>
                        </div>
                    </div>
                    
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-2">
                        <div class="text-slate-600 dark:text-slate-300">
                            均價 <span class="font-bold text-slate-900 dark:text-white mr-3">${metrics.avgPrice.toFixed(2)}</span>
                            <span class="text-green-600 dark:text-green-500 text-sm">扣除獲利後均價 ${adjustedAvgPrice.toFixed(2)}</span>
                        </div>
                        <div class="text-slate-600 dark:text-slate-300">未實現 ${colorVal(Math.round(metrics.unrealized), (metrics.unrealized > 0 ? '+' : ''))}</div>
                    </div>
                    
                    <div class="text-slate-500 dark:text-slate-400 mb-3 font-medium flex items-center gap-2">
                        FIFO（先進先出）算法
                    </div>
                    <div class="grid grid-cols-3 gap-4 mb-4 border-b border-slate-100 dark:border-[#3D3D3D] pb-4">
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">剩餘成本</div>
                            <div class="text-lg font-semibold text-red-500 dark:text-red-400">${Math.round(metrics.fifo.totalCost).toLocaleString()}</div>
                        </div>
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">損益兩平價</div>
                            <div class="text-lg font-semibold text-amber-600 dark:text-yellow-500">${metrics.fifo.breakEvenPrice.toFixed(2)}</div>
                            <div class="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">含手續費及交易稅</div>
                        </div>
                        <div>
                            <div class="text-slate-400 dark:text-slate-400 text-xs mb-1">已實現</div>
                            <div class="text-lg font-semibold">${colorVal(Math.round(metrics.fifo.realized), (metrics.fifo.realized > 0 ? '+' : ''))}</div>
                        </div>
                    </div>
                    
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div class="text-slate-600 dark:text-slate-300">
                            均價 <span class="font-bold text-slate-900 dark:text-white mr-3">${metrics.fifo.avgPrice.toFixed(2)}</span>
                            <span class="text-slate-500 dark:text-slate-400 text-sm">扣除獲利後均價 ${fifoAdjustedAvgPrice.toFixed(2)}</span>
                        </div>
                        <div class="text-slate-600 dark:text-slate-300">未實現 ${colorVal(Math.round(metrics.fifo.unrealized), (metrics.fifo.unrealized > 0 ? '+' : ''))}</div>
                    </div>
                </div>
            `;
        }

        if (trades.length === 0) {
            html += `
                <div class="flex flex-col items-center justify-center h-20 text-slate-400 bg-slate-50 rounded-lg">
                    <p class="text-sm">尚無此檔股票的交易紀錄</p>
                </div>
            `;
            return html;
        }

        html += `
            <table class="w-full text-left text-sm text-slate-600">
                <thead class="text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                        <th class="pb-2 font-medium">日期</th>
                        <th class="pb-2 font-medium">類型</th>
                        <th class="pb-2 text-right font-medium">數量/比例/配股</th>
                        <th class="pb-2 text-right font-medium">單價/退現/配息配股資訊</th>
                        <th class="pb-2 text-right font-medium">總額/配息</th>
                        <th class="pb-2 text-right font-medium w-8"></th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
        `;

        // Sort trades by date descending
        const sortedTrades = [...trades].sort((a, b) => new Date(b.date) - new Date(a.date));

        sortedTrades.forEach(t => {
            let typeColor = 'text-slate-600 bg-slate-50';
            let typeText = '未知';
            let displayQty = '-';
            let displayPrice = '-';

            if (t.category === 'trade' || !t.category) {
                if (t.type === 'buy' || t.type === 'sell') {
                    const isBuy = t.type === 'buy';
                    const isOdd = t.isOddLot || t.stockType === 'oddLot' || (t.quantity > 0 && t.quantity % 1000 !== 0);
                    typeText = isBuy ? '買進' : '賣出';
                    typeColor = isBuy ? 'text-price-up bg-rose-50' : 'text-price-down bg-emerald-50';
                    if (isOdd) typeText += ' (零股)';
                    displayQty = (t.quantity || 0).toLocaleString();
                    displayPrice = (t.price || 0).toFixed(2);
                }
            } else if (t.category === 'dividend') {
                typeColor = t.type === 'both' ? 'text-indigo-700 bg-indigo-100' : 'text-indigo-600 bg-indigo-50';
                if (t.type === 'cash') {
                    typeText = '配息';
                    displayQty = '-';
                    displayPrice = t.dps ? t.dps.toString() : '-';
                } else if (t.type === 'stock') {
                    typeText = '配股';
                    displayQty = (t.amount || 0).toLocaleString();
                    displayPrice = t.dps ? t.dps.toString() : '-';
                } else if (t.type === 'both') {
                    typeText = '配息+配股';
                    displayQty = (t.stockAmount || 0).toLocaleString();
                    displayPrice = `息${t.dps || 0} 股${t.sdps || 0}`;
                }
            } else if (t.category === 'capital_change') {
                typeColor = 'text-orange-600 bg-orange-50';
                typeText = t.type === 'reduction' ? '減資' : '分割';
                displayQty = (t.ratio || t.splitRatio || 0).toString();
                displayPrice = t.type === 'reduction' ? (t.cash || 0).toString() : '-';
            } else if (t.category === 'account') {
                typeColor = 'text-teal-600 bg-teal-50';
                typeText = t.type === 'deposit' ? '存入' : '取出';
            } else if (t.category === 'fee_rebate') {
                typeColor = 'text-purple-600 bg-purple-50';
                typeText = '折讓';
            }

            let amountColor = '';
            if (t.total > 0) {
                const isPayment = (!t.category || t.category === 'trade') && t.type === 'buy';
                const isIncome = ((!t.category || t.category === 'trade') && t.type === 'sell') || t.category === 'dividend' || t.category === 'fee_rebate' || (t.category === 'capital_change' && t.type === 'reduction');
                if (isPayment) amountColor = 'bg-loss';
                else if (isIncome) amountColor = 'bg-profit';
            }

            html += `
                <tr class="hover:bg-blue-50 transition-colors group">
                    <td class="py-2">${t.date}</td>
                    <td class="py-2">
                        <span class="px-2 py-0.5 rounded text-xs ${typeColor}">${typeText}</span>
                    </td>
                    <td class="py-2 text-right">${displayQty}</td>
                    <td class="py-2 text-right">${displayPrice}</td>
                    <td class="py-2 text-right">
                        <span class="${amountColor} font-medium">${(t.total || 0).toLocaleString()}</span>
                    </td>
                    <td class="py-2 text-right space-x-1">
                        <button onclick="if(window.openTradeModal) window.openTradeModal('${stockCode}', '${t.id}')" class="opacity-0 group-hover:opacity-100 text-blue-500 hover:text-blue-700 transition-opacity" title="編輯">
                            <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                        </button>
                        <button onclick="if(window.tradesTab) window.tradesTab.deleteTrade('${t.id}')" class="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity" title="刪除">
                            <svg class="w-4 h-4 inline-block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        return html;
    }
    return '';
}
