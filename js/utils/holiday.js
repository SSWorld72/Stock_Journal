// ==========================================
// 股海手札 - 台股休市日行事曆與營業日計算模組
// 支援 TWSE 證交所與行政院人事行政總處 (DGPA) 動態年度抓取
// 完全由 API 與開放資料動態獲取，無須硬編碼任何年份
// 支援寫入 IndexedDB / LocalStorage，並整合 JSON / JSONL 備份與還原
// ==========================================

import { settings, saveSettings } from '../store.js';
import { putRecord, getRecord } from '../db.js';
import { getApiUrl } from '../api/twstock.js';

const STORAGE_KEY_HOLIDAYS = 'twstock_holidays';
const STORAGE_KEY_YEAR = 'twstock_holiday_year';
const STORAGE_KEY_LAST_UPDATED = 'twstock_holiday_last_updated';
const STORAGE_KEY_REMINDER = 'twstock_holiday_reminder';
const IDB_STORE_KEY = 'twstock_holidays_data';

/**
 * @typedef {Object} HolidayState
 * @property {Set<string>} holidays - 所有已快取的休市日集合 (格式: YYYY-MM-DD，支援跨年度)
 * @property {number} year - 最近一次抓取或當前關注之年份
 * @property {number} lastUpdated - 上次更新時間戳記
 */

// 載入本地儲存之休市日快取（支援跨年度累積）
function loadInitialHolidayState() {
    let holidays = new Set();
    let year = new Date().getFullYear();
    let lastUpdated = 0;

    try {
        // 優先從 settings 或 localStorage 讀取
        const savedFromSettings = settings?.holidays;
        if (Array.isArray(savedFromSettings) && savedFromSettings.length > 0) {
            holidays = new Set(savedFromSettings);
            year = settings.holidayYear || year;
            lastUpdated = settings.holidayLastUpdated || 0;
        } else {
            const savedHolidays = localStorage.getItem(STORAGE_KEY_HOLIDAYS);
            if (savedHolidays) {
                const arr = JSON.parse(savedHolidays);
                if (Array.isArray(arr)) {
                    holidays = new Set(arr);
                }
            }
            const savedYear = localStorage.getItem(STORAGE_KEY_YEAR);
            if (savedYear) year = parseInt(savedYear, 10) || year;

            const savedUpdated = localStorage.getItem(STORAGE_KEY_LAST_UPDATED);
            if (savedUpdated) lastUpdated = parseInt(savedUpdated, 10) || 0;
        }
    } catch {
        // 使用空集合
    }

    return { holidays, year, lastUpdated };
}

let holidayState = loadInitialHolidayState();
const holidayListeners = new Set();

function notifyHolidayListeners() {
    holidayListeners.forEach(fn => {
        try { fn(); } catch (e) { console.error(e); }
    });
}

export function subscribeHoliday(fn) {
    holidayListeners.add(fn);
    return () => holidayListeners.delete(fn);
}

export function getTaiwanHolidays() {
    return holidayState.holidays;
}

export function getHolidayYear() {
    return holidayState.year;
}

export function getHolidayLastUpdated() {
    return holidayState.lastUpdated;
}

export function getHolidayReminderSetting() {
    try {
        return settings?.holidayReminder || localStorage.getItem(STORAGE_KEY_REMINDER) || 'yearly';
    } catch {
        return 'yearly';
    }
}

export function setHolidayReminderSetting(val) {
    try {
        if (settings) settings.holidayReminder = val;
        localStorage.setItem(STORAGE_KEY_REMINDER, val);
        saveSettings();
        notifyHolidayListeners();
    } catch (e) {
        console.error(e);
    }
}

/**
 * 將休市日狀態同步持久化至 LocalStorage、Settings 與 IndexedDB
 */
export async function persistHolidayState() {
    const datesArr = Array.from(holidayState.holidays).sort();
    
    // 1. LocalStorage
    try {
        localStorage.setItem(STORAGE_KEY_HOLIDAYS, JSON.stringify(datesArr));
        localStorage.setItem(STORAGE_KEY_YEAR, holidayState.year.toString());
        localStorage.setItem(STORAGE_KEY_LAST_UPDATED, holidayState.lastUpdated.toString());
    } catch (e) {
        console.error('LocalStorage 儲存休市日快取失敗:', e);
    }

    // 2. Settings Store (IndexedDB + LocalStorage)
    try {
        if (settings) {
            settings.holidays = datesArr;
            settings.holidayYear = holidayState.year;
            settings.holidayLastUpdated = holidayState.lastUpdated;
            await saveSettings();
        }
    } catch (e) {
        console.error('Settings 儲存休市日快取失敗:', e);
    }

    // 3. 直接存入 IndexedDB Settings
    try {
        await putRecord('Settings', {
            key: IDB_STORE_KEY,
            data: {
                dates: datesArr,
                year: holidayState.year,
                lastUpdated: holidayState.lastUpdated
            }
        });
    } catch (e) {
        // 忽略單獨寫入失敗
    }
}

/**
 * 匯入或還原休市日資料（供 JSON / JSONL 備份還原使用）
 */
export async function importHolidaysFromData(data) {
    if (!data) return false;
    let dates = [];
    let year = new Date().getFullYear();
    let lastUpdated = Date.now();

    if (Array.isArray(data)) {
        dates = data;
    } else if (typeof data === 'object') {
        dates = data.dates || data.holidays || [];
        year = data.year || data.holidayYear || year;
        lastUpdated = data.lastUpdated || data.holidayLastUpdated || lastUpdated;
        if (data.reminder || data.holidayReminder) {
            setHolidayReminderSetting(data.reminder || data.holidayReminder);
        }
    }

    if (!Array.isArray(dates) || dates.length === 0) return false;

    // 合併既有資料
    const merged = new Set(holidayState.holidays);
    dates.forEach(d => {
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
            merged.add(d);
        }
    });

    holidayState = {
        holidays: merged,
        year: year,
        lastUpdated: lastUpdated
    };

    await persistHolidayState();
    notifyHolidayListeners();
    return true;
}

/**
 * 取得休市日備份封裝物件（供 JSON 匯出使用）
 */
export function getHolidayExportData() {
    return {
        holidays: Array.from(holidayState.holidays).sort(),
        holidayYear: holidayState.year,
        holidayLastUpdated: holidayState.lastUpdated,
        holidayReminder: getHolidayReminderSetting()
    };
}

/**
 * 判斷是否需要提醒使用者更新休市日行事曆
 */
export function isHolidayReminderDue() {
    const reminder = getHolidayReminderSetting();
    if (reminder === 'never') return false;

    const lastUpdated = holidayState.lastUpdated;
    if (!lastUpdated) return true;

    const now = Date.now();
    const elapsedDays = (now - lastUpdated) / (1000 * 60 * 60 * 24);

    switch (reminder) {
        case 'monthly':
            return elapsedDays >= 30;
        case 'quarterly':
            return elapsedDays >= 90;
        case 'yearly':
        default: {
            const currentYear = new Date().getFullYear();
            return holidayState.year < currentYear || elapsedDays >= 365;
        }
    }
}

/**
 * 從 TWSE 官方頁面解析休市日 HTML 表格
 */
export function parseTwseHolidayHTML(html) {
    const dates = [];
    let year = new Date().getFullYear();

    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(html)) !== null) {
        const row = rowMatch[1];
        const tdRe = /<td[^>]*>\s*(\d{4})[-/](\d{2})[-/](\d{2})\s*<\/td>/i;
        const tdMatch = tdRe.exec(row);
        if (!tdMatch) continue;
        const dateStr = `${tdMatch[1]}-${tdMatch[2]}-${tdMatch[3]}`;
        year = parseInt(tdMatch[1], 10);

        // 檢查該列說明是否為休市，排除「開始交易」「最後交易」等正常交易日
        const isTradingDay = /開始交易|最後交易/.test(row);
        const isHoliday = /放假|休市|補假|除夕|春節|紀念日|勞動節|兒童節|清明|掃墓|端午|中秋|國慶|元旦|無交易/.test(row);

        if (isHoliday && !isTradingDay) {
            const d = new Date(dateStr + 'T00:00:00');
            const day = d.getDay();
            if (day !== 0 && day !== 6) {
                dates.push(dateStr);
            }
        }
    }

    return { dates: Array.from(new Set(dates)).sort(), year };
}

/**
 * 從行政院人事行政總處 (DGPA) 開放資料 JSON 解析休市日
 */
export function parseDgpaHolidayJSON(list) {
    const dates = [];
    let year = new Date().getFullYear();
    if (!Array.isArray(list)) return { dates, year };

    list.forEach(item => {
        const dStr = String(item.date || '').replace(/\D/g, '');
        if (dStr.length === 8) {
            const y = dStr.slice(0, 4);
            const m = dStr.slice(4, 6);
            const d = dStr.slice(6, 8);
            year = parseInt(y, 10);
            const iso = `${y}-${m}-${d}`;
            if (item.isHoliday === true || item.holidayCategory === '國定假日' || item.isHoliday === 'true') {
                const dateObj = new Date(iso + 'T00:00:00');
                const day = dateObj.getDay();
                if (day !== 0 && day !== 6) {
                    dates.push(iso);
                }
            }
        }
    });

    return { dates: Array.from(new Set(dates)).sort(), year };
}

/**
 * 動態取得最新休市日行事曆（支援指定年份、TWSE 與人事行政總處雙資料來源）
 * @param {number} [targetYear] 目標年份，預設為當前年份
 */
export async function fetchTaiwanHolidays(targetYear) {
    const curYear = targetYear || new Date().getFullYear();
    let fetchedDates = [];
    let fetchedYear = curYear;
    let sourceUsed = '';

    // 1. 優先嘗試 TWSE 證交所來源（具備股市春節封關等專屬休市）
    try {
        const endpoints = [
            getApiUrl('/api/twse-holidays'),
            'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html'
        ];

        for (const ep of endpoints) {
            if (!ep) continue;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const resp = await fetch(ep, {
                    headers: { 'Accept': 'text/html, */*' },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                if (resp.ok) {
                    const text = await resp.text();
                    if (text && text.includes('市場開休市日期')) {
                        const parsed = parseTwseHolidayHTML(text);
                        if (parsed.dates.length > 0) {
                            fetchedDates = parsed.dates;
                            fetchedYear = parsed.year;
                            sourceUsed = 'TWSE 證交所';
                            break;
                        }
                    }
                }
            } catch {
                // 嘗試下一個 endpoint
            }
        }
    } catch {
        // 繼續嘗試人事行政總處備援
    }

    // 2. 若 TWSE 失敗或需特定年份，嘗試人事行政總處 (DGPA) 資料源
    if (fetchedDates.length === 0) {
        try {
            const dgpaUrls = [
                getApiUrl(`/api/dgpa-holidays?year=${curYear}`),
                `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${curYear}.json`
            ];

            for (const ep of dgpaUrls) {
                if (!ep) continue;
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    const resp = await fetch(ep, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (resp.ok) {
                        const data = await resp.json();
                        const parsed = parseDgpaHolidayJSON(data);
                        if (parsed.dates.length > 0) {
                            fetchedDates = parsed.dates;
                            fetchedYear = parsed.year;
                            sourceUsed = '人事行政總處';
                            break;
                        }
                    }
                } catch {
                    // 嘗試下一個
                }
            }
        } catch {
            // 人事行政總處亦失敗
        }
    }

    if (fetchedDates.length === 0) {
        return {
            success: false,
            count: holidayState.holidays.size,
            year: holidayState.year,
            error: '無法連線至 TWSE 或人事行政總處，維持現有快取'
        };
    }

    // 將新抓取的日期合併進跨年度快取中
    const merged = new Set(holidayState.holidays);
    fetchedDates.forEach(d => merged.add(d));

    holidayState = {
        holidays: merged,
        year: fetchedYear,
        lastUpdated: Date.now()
    };

    // 持久化儲存至 IndexedDB 與 LocalStorage
    await persistHolidayState();
    notifyHolidayListeners();

    return {
        success: true,
        count: fetchedDates.length,
        totalCached: merged.size,
        year: fetchedYear,
        source: sourceUsed
    };
}

/**
 * 自動初始化：若本地快取為空，於背景自動抓取當前年度休市日
 */
export async function initHolidayScheduleAuto() {
    // 檢查 IndexedDB 是否已有資料
    if (holidayState.holidays.size === 0) {
        try {
            const idbData = await getRecord('Settings', IDB_STORE_KEY);
            if (idbData && idbData.data && Array.isArray(idbData.data.dates) && idbData.data.dates.length > 0) {
                holidayState = {
                    holidays: new Set(idbData.data.dates),
                    year: idbData.data.year || new Date().getFullYear(),
                    lastUpdated: idbData.data.lastUpdated || 0
                };
                notifyHolidayListeners();
                return;
            }
        } catch {
            // 忽略
        }
    }

    if (holidayState.holidays.size === 0 || isHolidayReminderDue()) {
        try {
            await fetchTaiwanHolidays();
        } catch (e) {
            console.warn('[Holiday] 背景初始化休市日失敗 (將使用預設營業日判斷):', e);
        }
    }
}

/**
 * 判斷指定日期是否為台股營業日（排除週六、週日與行事曆休市日）
 * @param {Date|string} date 日期物件或 'YYYY-MM-DD' 字串
 */
export function isTaiwanBusinessDay(date) {
    let d;
    if (typeof date === 'string') {
        d = new Date(date + (date.includes('T') ? '' : 'T00:00:00'));
    } else {
        d = new Date(date);
    }

    const day = d.getDay();
    if (day === 0 || day === 6) return false; // 週末

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(d.getDate()).padStart(2, '0');
    const isoKey = `${y}-${m}-${dayOfMonth}`;

    if (holidayState.holidays.has(isoKey)) return false; // 休市日
    return true;
}

/**
 * 計算指定天數後的營業日（例如 T+2 交割日，自動跳過週末與休市日）
 * @param {Date|string} date 起始日期
 * @param {number} days 營業日天數（預設 2）
 * @returns {Date} 目標營業日 Date 物件
 */
export function addBusinessDays(date, days = 2) {
    let current;
    if (typeof date === 'string') {
        current = new Date(date + (date.includes('T') ? '' : 'T00:00:00'));
    } else {
        current = new Date(date);
    }

    let added = 0;
    while (added < days) {
        current.setDate(current.getDate() + 1);
        if (isTaiwanBusinessDay(current)) {
            added++;
        }
    }
    return current;
}
