import { getRecord, putRecord } from './db.js';
// 依賴注入：自動同步統一由 window.gasBackupInstance 負責

export const STORAGE_KEY = 'stock_journal_settings_v1';

const DEFAULT_SETTINGS = {
    brokers: [
        { 
            id: Date.now(), 
            name: '預設券商', 
            isDefault: true,
            feeRate: 0.1425, 
            discount: 6.0, 
            minFee: 20,
            minOddFee: 1,
            initialCapital: 0,
            taxRate: 0.3,
            etfTaxRate: 0.1,
            dayTradeTaxRate: 0.15,
            dayTradeEtfTaxRate: 0.05,
            nhiThreshold: 20000,
            nhiTaxRate: 2.11
        }
    ],
    preferences: ['eps', 'pe', 'peg', 'yoy'],
    watchList: [],
    customLists: [], // 自訂清單 [{ id, name, codes: [] }]
    portfolios: [
        { id: 'default', name: '預設投資組合', initialCapital: 1000000 }
    ],
    transactions: [], // { id, portfolioId, date, code, type, quantity, price, fee, tax, total, note }
    klineSource: 'yahoo', // 'yahoo' or 'official'
    updateStartTime: '09:00',
    updateEndTime: '17:00',
    marketQuotesCache: {},
    stockNamesCache: {},
    refreshFreq: -1,
    nhiThreshold: 20000,
    nhiTaxRate: 2.11,
    tradingHoursOnly: true, // 預設僅在交易時段更新 (08:30~13:45)
    apiProxyMode: 'gas', // 'gas' or 'local'
    gasUrl: '', // 由使用者自行填入，不寫死於程式碼中
    privateGasUrl: '', // 專屬私有雲端備份 URL
    autoSyncInterval: 5000, // 變動後自動同步延遲 (預設 5 秒, 0 為關閉)
    backupOverwrite: false, // 預設不覆蓋
    backupVersions: 5 // 預設保留 5 個版本
};

export let settings = { ...DEFAULT_SETTINGS };

export async function loadSettings() {
    try {
        const idbRecord = await getRecord('Settings', STORAGE_KEY);
        if (idbRecord && idbRecord.data) {
            settings = { ...DEFAULT_SETTINGS, ...idbRecord.data };
            // Ensure transactions and portfolios are initialized
            if (!settings.portfolios) settings.portfolios = DEFAULT_SETTINGS.portfolios;
            if (!settings.transactions) settings.transactions = DEFAULT_SETTINGS.transactions;
            if (!settings.customLists) settings.customLists = DEFAULT_SETTINGS.customLists;
            
            // Clean up old 99999 codes for fee rebates and missing brokerId
            let needSave = false;
            let defaultBrokerId = (settings.brokers && settings.brokers.length > 0) ? settings.brokers[0].id : 0;
            settings.transactions.forEach(t => {
                if (t.category === 'fee_rebate' && t.code === '99999') {
                    t.code = '';
                    needSave = true;
                }
                if (t.brokerId === undefined) {
                    t.brokerId = defaultBrokerId;
                    needSave = true;
                }
            });

            if (settings.tradingHoursOnly === undefined) {
                settings.tradingHoursOnly = true;
                needSave = true;
            }
            if (settings.autoSyncInterval === undefined) { settings.autoSyncInterval = 5000; needSave = true; }
            if (settings.backupOverwrite === undefined) { settings.backupOverwrite = true; needSave = true; }
            if (settings.backupVersions === undefined) { settings.backupVersions = 1; needSave = true; }

            // Migrate brokers to new schema
            if (settings.brokers) {
                let hasDefault = false;
                settings.brokers.forEach((b, idx) => {
                    if (b.minFee === undefined) { b.minFee = 20; needSave = true; }
                    if (b.minOddFee === undefined) { b.minOddFee = 1; needSave = true; }
                    if (b.etfTaxRate === undefined) { b.etfTaxRate = 0.1; needSave = true; }
                    if (b.dayTradeTaxRate === undefined) { b.dayTradeTaxRate = 0.15; needSave = true; }
                    if (b.dayTradeEtfTaxRate === undefined) { b.dayTradeEtfTaxRate = 0.05; needSave = true; }
                    if (b.nhiThreshold === undefined) { b.nhiThreshold = 20000; needSave = true; }
                    if (b.nhiTaxRate === undefined) { b.nhiTaxRate = 2.11; needSave = true; }
                    if (b.initialCapital === undefined) { b.initialCapital = 0; needSave = true; }
                    
                    if (b.isDefault) hasDefault = true;
                });
                
                if (!hasDefault && settings.brokers.length > 0) {
                    settings.brokers[0].isDefault = true;
                    needSave = true;
                }
            }

            if (needSave) saveSettings();
            return;
        }
        
        // Fallback to localStorage migration
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
            if (!settings.portfolios) settings.portfolios = DEFAULT_SETTINGS.portfolios;
            if (!settings.transactions) settings.transactions = DEFAULT_SETTINGS.transactions;
            
            // Migrate brokers to new schema for localStorage fallback as well
            if (settings.brokers) {
                let hasDefault = false;
                settings.brokers.forEach((b) => {
                    if (b.minFee === undefined) b.minFee = 20;
                    if (b.minOddFee === undefined) b.minOddFee = 1;
                    if (b.etfTaxRate === undefined) b.etfTaxRate = 0.1;
                    if (b.dayTradeTaxRate === undefined) b.dayTradeTaxRate = 0.15;
                    if (b.dayTradeEtfTaxRate === undefined) b.dayTradeEtfTaxRate = 0.05;
                    if (b.nhiThreshold === undefined) b.nhiThreshold = 20000;
                    if (b.nhiTaxRate === undefined) b.nhiTaxRate = 2.11;
                    if (b.initialCapital === undefined) b.initialCapital = 0;
                    if (b.isDefault) hasDefault = true;
                });
                if (!hasDefault && settings.brokers.length > 0) {
                    settings.brokers[0].isDefault = true;
                }
            }
            
            let defaultBrokerId = (settings.brokers && settings.brokers.length > 0) ? settings.brokers[0].id : 0;
            settings.transactions.forEach(t => {
                if (t.category === 'fee_rebate' && t.code === '99999') t.code = '';
                if (t.brokerId === undefined) t.brokerId = defaultBrokerId;
            });

            if (settings.tradingHoursOnly === undefined) {
                settings.tradingHoursOnly = true;
            }
            if (settings.autoSyncInterval === undefined) settings.autoSyncInterval = 5000;
            if (settings.backupOverwrite === undefined) settings.backupOverwrite = true;
            if (settings.backupVersions === undefined) settings.backupVersions = 1;

            // Migrate to IDB
            await saveSettings();
            // Optional: localStorage.removeItem(STORAGE_KEY);
        }
    } catch (e) {
        console.error('載入設定失敗', e);
    }
}

export async function saveSettings() {
    try {
        await putRecord('Settings', { key: STORAGE_KEY, data: settings });
        if (window.gasBackupInstance) window.gasBackupInstance.triggerAutoSync(); // 觸發背景自動同步 (含防抖)
    } catch (e) {
        console.error('儲存設定至本地資料庫 (IndexedDB) 失敗', e);
        // Fallback to localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        if (window.gasBackupInstance) window.gasBackupInstance.triggerAutoSync(); // 觸發背景自動同步 (含防抖)
    }
}
