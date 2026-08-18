/**
 * IndexedDB Wrapper for Stock Journal
 * Handles initialization, schema, and basic CRUD operations.
 */

const DB_NAME = 'StockJournalDB';
const DB_VERSION = 3;

let dbInstance = null;

export function initDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) {
            resolve(dbInstance);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => {
            console.error('本地資料庫 (IndexedDB) 發生錯誤:', event.target.error);
            reject(event.target.error);
        };

        request.onblocked = (event) => {
            console.warn('本地資料庫 (IndexedDB) 被其他分頁阻擋。');
            alert('系統偵測到資料庫被其他分頁鎖定！請關閉其他股海手札的分頁後，重新整理本頁面，以免資料庫升級卡住。');
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Settings Store (Key-Value)
            if (!db.objectStoreNames.contains('Settings')) {
                db.createObjectStore('Settings', { keyPath: 'key' });
            }

            // Portfolios Store
            if (!db.objectStoreNames.contains('Portfolios')) {
                const portfoliosStore = db.createObjectStore('Portfolios', { keyPath: 'id' });
                portfoliosStore.createIndex('name', 'name', { unique: false });
            }

            // Transactions Store
            if (!db.objectStoreNames.contains('Transactions')) {
                const txStore = db.createObjectStore('Transactions', { keyPath: 'id' });
                txStore.createIndex('portfolioId', 'portfolioId', { unique: false });
                txStore.createIndex('stockCode', 'stockCode', { unique: false });
                txStore.createIndex('tradeDate', 'tradeDate', { unique: false });
            }

            // Chips Cache Store
            if (!db.objectStoreNames.contains('ChipsCache')) {
                const chipsStore = db.createObjectStore('ChipsCache', { keyPath: 'id' }); // id can be code_date
                chipsStore.createIndex('code', 'code', { unique: false });
                chipsStore.createIndex('date', 'date', { unique: false });
            }

            // Market Cache Store (Quotes and Kline)
            if (!db.objectStoreNames.contains('MarketCache')) {
                const marketStore = db.createObjectStore('MarketCache', { keyPath: 'code' });
                marketStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
            }
        };
    });
}

/**
 * Generic getter
 */
export async function getRecord(storeName, key) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Generic setter
 */
export async function putRecord(storeName, value) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all records from a store
 */
export async function getAllRecords(storeName) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all keys from a store
 */
export async function getAllKeys(storeName) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAllKeys();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getRecordsByIndex(storeName, indexName, queryValue) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.getAll(queryValue);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Export Full Database (Settings, Holidays, Portfolios, Transactions, ChipsCache, MarketCache) to JSONL format
 * @param {Function} progressCallback - function({ count, total })
 * @param {Object} options - { includeTransactions: boolean }
 */
export async function exportChipsJSONL(progressCallback, options = { includeTransactions: true }) {
    const db = await initDB();
    const encoder = new TextEncoder();
    let count = 0;
    const includeTransactions = options?.includeTransactions !== false;

    // ── 預先計算總筆數（Settings/Holidays/Portfolios 各 1 筆 + Transactions (可選) + ChipsCache + MarketCache）──
    let total = 4; // metadata 預估 4 筆（header, settings, holidays, portfolios）
    if (includeTransactions) {
        try {
            let txCount = await new Promise((res, rej) => {
                const req = db.transaction('Transactions', 'readonly').objectStore('Transactions').count();
                req.onsuccess = () => res(req.result);
                req.onerror = (e) => rej(e);
            });
            if (!txCount) {
                const { settings } = await import('./store.js');
                if (settings && settings.transactions) {
                    txCount = settings.transactions.length;
                }
            }
            total += (txCount || 0);
        } catch (_) { /* ignore */ }
    }
    try {
        const chipsCount = await new Promise((res, rej) => {
            const req = db.transaction('ChipsCache', 'readonly').objectStore('ChipsCache').count();
            req.onsuccess = () => res(req.result);
            req.onerror = (e) => rej(e);
        });
        total += chipsCount;
    } catch (_) { /* ignore */ }
    try {
        const marketCount = await new Promise((res, rej) => {
            const req = db.transaction('MarketCache', 'readonly').objectStore('MarketCache').count();
            req.onsuccess = () => res(req.result);
            req.onerror = (e) => rej(e);
        });
        total += marketCount;
    } catch (_) { /* ignore */ }

    if (progressCallback) progressCallback({ count: 0, total });

    // 建立可讀串流，分段 enqueue 資料行（避免一次性占滿記憶體）
    const jsonlStream = new ReadableStream({
        async start(controller) {
            // 0. 備份檔 Header 資訊 (供匯入時第一時間得知總筆數與版本)
            controller.enqueue(encoder.encode(JSON.stringify({
                _recordType: 'metadata',
                type: 'header',
                version: '26.7.0.0',
                exportDate: new Date().toISOString(),
                includeTransactions,
                totalRecords: total
            }) + '\n'));
            count++;

            // 1. 系統設定 (Settings)
            try {
                const { settings } = await import('./store.js');
                if (settings) {
                    const safeSettings = { ...settings };
                    delete safeSettings.marketQuotesCache;
                    // delete safeSettings.stockNamesCache; // 使用者要求匯出名稱
                    if (!includeTransactions) {
                        delete safeSettings.transactions;
                        delete safeSettings.brokers;
                        delete safeSettings.portfolios;
                        delete safeSettings.watchList;
                        // 確保安全，連帶移除所有個人敏感連線與 API 網址設定
                        delete safeSettings.gasUrl;
                        delete safeSettings.privateGasUrl;
                    }
                    controller.enqueue(encoder.encode(JSON.stringify({
                        _recordType: 'metadata', type: 'settings', data: safeSettings
                    }) + '\n'));
                    count++;
                }
            } catch (e) { console.warn('[匯出 JSONL] 設定警告:', e); }

            // 2. 休市日行事曆 (Holidays)
            try {
                const { getHolidayExportData } = await import('./utils/holiday.js');
                const holidayData = getHolidayExportData();
                if (holidayData && holidayData.holidays && holidayData.holidays.length > 0) {
                    controller.enqueue(encoder.encode(JSON.stringify({
                        _recordType: 'metadata', type: 'holidays', ...holidayData
                    }) + '\n'));
                    count++;
                }
            } catch (e) { console.warn('[匯出 JSONL] 休市日警告:', e); }

            // 3. 投資組合 (Portfolios) - 僅在完整備份時匯出
            if (includeTransactions) {
                try {
                    const portfolios = await getAllRecords('Portfolios');
                    if (portfolios && portfolios.length > 0) {
                        controller.enqueue(encoder.encode(JSON.stringify({
                            _recordType: 'metadata', type: 'portfolios', data: portfolios
                        }) + '\n'));
                        count++;
                    }
                } catch (e) { console.warn('[匯出 JSONL] 投資組合警告:', e); }
            }

            // 4. 所有交易紀錄 (Transactions) - 僅在 includeTransactions 為 true 時匯出
            if (includeTransactions) {
                try {
                    const { settings } = await import('./store.js');
                    let txList = await getAllRecords('Transactions');
                    if ((!txList || txList.length === 0) && settings && settings.transactions) {
                        txList = settings.transactions;
                    }
                    if (txList && txList.length > 0) {
                        for (const tx of txList) {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                _recordType: 'transaction', ...tx
                            }) + '\n'));
                            count++;
                        }
                    }
                } catch (e) { console.warn('[匯出 JSONL] 交易明細警告:', e); }
            }

            if (progressCallback) progressCallback({ count, total });

            // 5. 籌碼資料庫 (ChipsCache) — 用 cursor 逐筆串流
            await new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction('ChipsCache', 'readonly');
                    const store = transaction.objectStore('ChipsCache');
                    const request = store.openCursor();

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                _recordType: 'chips', ...cursor.value
                            }) + '\n'));
                            count++;
                            if (count % 2000 === 0 && progressCallback) {
                                progressCallback({ count, total });
                            }
                            cursor.continue();
                        } else {
                            resolve();
                        }
                    };
                    request.onerror = (e) => reject(e.target.error);
                } catch (e) { reject(e); }
            });

            // 6. 市場快取資料庫 (MarketCache) — PE/殖利率/名稱/K線
            await new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction('MarketCache', 'readonly');
                    const store = transaction.objectStore('MarketCache');
                    const request = store.openCursor();

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                _recordType: 'marketCache', ...cursor.value
                            }) + '\n'));
                            count++;
                            if (count % 2000 === 0 && progressCallback) {
                                progressCallback({ count, total });
                            }
                            cursor.continue();
                        } else {
                            resolve();
                        }
                    };
                    request.onerror = (e) => reject(e.target.error);
                } catch (e) { reject(e); }
            });

            if (progressCallback) progressCallback({ count, total });
            controller.close();
        }
    });

    // 透過 CompressionStream 串流壓縮為 gzip
    const compressedStream = jsonlStream.pipeThrough(new CompressionStream('gzip'));

    // 收集壓縮後的 chunks（壓縮後體積通常只有原檔 5~15%）
    const reader = compressedStream.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }

    const blob = new Blob(chunks, { type: 'application/gzip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = includeTransactions 
        ? `stock_journal_backup_${dateStr}.jsonl.gz` 
        : `stock_journal_clean_backup_${dateStr}.jsonl.gz`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    return count;
}

/**
 * Import Full Database from JSONL file with streaming batching & exact deduplication
 * 自動偵測 .gz 副檔名，支援 gzip 解壓後串流匯入。
 * 特色：完全相同的交易跳過 (Skip)，不同的新交易新增 (Add)，既有未重複之交易完整保留。
 * @param {File} file - The .jsonl or .jsonl.gz file
 * @param {Function} progressCallback - function(count, expectedTotal, fileSize, bytesRead)
 */
export async function importChipsJSONL(file, progressCallback) {
    const db = await initDB();

    // 自動偵測是否為 gzip 壓縮檔
    const isGzipped = file.name.endsWith('.gz');
    const fileSize = file.size; // 壓縮檔（或原始檔）的總位元組數
    let bytesRead = 0;

    // 建立位元組計量器，追蹤已讀取的壓縮位元組數
    const meterStream = new TransformStream({
        transform(chunk, controller) {
            bytesRead += chunk.byteLength;
            controller.enqueue(chunk);
        }
    });

    let sourceStream = file.stream().pipeThrough(meterStream);
    if (isGzipped) {
        sourceStream = sourceStream.pipeThrough(new DecompressionStream('gzip'));
    }

    const reader = sourceStream.getReader();
    const decoder = new TextDecoder();
    
    let partialLine = '';
    let totalCount = 0;
    let expectedTotal = null;
    
    // 先載入需要的模組，避免在 transaction 內 await 造成 TransactionInactiveError
    const { settings: settingsObj } = await import('./store.js');
    const { importHolidaysFromData } = await import('./utils/holiday.js');

    // ── 交易紀錄指紋特徵比對與多重集去重邏輯 ──
    const getTxFingerprint = (t) => {
        const normDate = (t.date || '').slice(0, 10);
        const brokerId = t.brokerId || '0';
        const normCode = String(t.code || '').trim().toUpperCase();
        const cat = t.category || 'trade';
        const type = t.type || 'buy';
        const dt = !!t.dayTrading;
        const price = Number(t.price || 0).toFixed(3);
        const qty = Number(t.quantity || t.shares || 0);
        const fee = Number(t.fee || 0);
        const tax = Number(t.tax || 0);
        const dps = Number(t.dps || 0).toFixed(3);
        const sdps = Number(t.sdps || 0).toFixed(3);
        const ratio = Number(t.ratio || t.splitRatio || 0).toFixed(3);
        const cash = Number(t.cash || 0).toFixed(3);
        const cleanNote = (t.note || '').replace(/[\[［]自動計算[\]］].*$/s, '').trim();

        return `${normDate}|${brokerId}|${normCode}|${cat}|${type}|${dt}|${price}|${qty}|${fee}|${tax}|${dps}|${sdps}|${ratio}|${cash}|${cleanNote}`;
    };

    // 載入當前系統既有交易紀錄
    let existingTxList = [];
    if (settingsObj.transactions && settingsObj.transactions.length > 0) {
        existingTxList = [...settingsObj.transactions];
    } else {
        try {
            existingTxList = (await getAllRecords('Transactions')) || [];
        } catch (_) {}
    }

    // 建立既有交易特徵計數 Map (多重集計數) 與 ID 集合
    const existingTxCounts = new Map();
    const existingIdSet = new Set();
    existingTxList.forEach(t => {
        if (t.id) existingIdSet.add(String(t.id));
        const fp = getTxFingerprint(t);
        existingTxCounts.set(fp, (existingTxCounts.get(fp) || 0) + 1);
    });

    let newlyAddedTransactions = [];
    let skippedTxCount = 0;
    let hasSettingsUpdate = false;
    let holidaysDataToImport = null;
    
    async function processBatch(lines) {
        if (lines.length === 0) return;
        return new Promise(async (resolve, reject) => {
            const transaction = db.transaction(['ChipsCache', 'Transactions', 'Portfolios', 'Settings', 'MarketCache'], 'readwrite');
            const chipsStore = transaction.objectStore('ChipsCache');
            const txStore = transaction.objectStore('Transactions');
            const portStore = transaction.objectStore('Portfolios');
            const marketStore = transaction.objectStore('MarketCache');
            
            transaction.oncomplete = () => resolve();
            transaction.onerror = (e) => reject(e.target.error);
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const record = JSON.parse(line);

                    // 1. 元資料 Metadata 處理
                    if (record._recordType === 'metadata' || record._type === 'metadata') {
                        if (record.type === 'header' && record.totalRecords) {
                            expectedTotal = record.totalRecords;
                        } else if (record.type === 'settings' && record.data) {
                            try {
                                const incomingSettings = { ...record.data };
                                // 保留既有 transactions，不讓 settings.data 盲目覆寫交易明細
                                delete incomingSettings.transactions;
                                Object.assign(settingsObj, incomingSettings);
                                hasSettingsUpdate = true;
                            } catch (err) {
                                console.error('還原 Settings 失敗:', err);
                            }
                        } else if (record.type === 'holidays') {
                            holidaysDataToImport = record;
                        } else if (record.type === 'portfolios' && Array.isArray(record.data)) {
                            for (const p of record.data) {
                                if (p && p.id) portStore.put(p);
                            }
                        }
                    } 
                    // 2. 交易明細紀錄 Transaction 處理 (精準防重：完全相同跳過，不同新增)
                    else if (record._recordType === 'transaction' || record._type === 'transaction') {
                        const txData = { ...record };
                        delete txData._recordType;
                        delete txData._type;
                        
                        const fp = getTxFingerprint(txData);
                        const count = existingTxCounts.get(fp) || 0;
                        if (count > 0) {
                            // 完全一模一樣的資料：跳過不重複寫入
                            existingTxCounts.set(fp, count - 1);
                            skippedTxCount++;
                        } else {
                            // 不同的新資料：產生 ID (若無或衝突) 並新增
                            if (!txData.id || existingIdSet.has(String(txData.id))) {
                                txData.id = 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
                            }
                            existingIdSet.add(String(txData.id));
                            txStore.put(txData);
                            newlyAddedTransactions.push(txData);
                        }
                    } 
                    // 3. 市場快取紀錄 MarketCache 處理
                    else if (record._recordType === 'marketCache' || record._type === 'marketCache') {
                        const marketData = { ...record };
                        delete marketData._recordType;
                        delete marketData._type;
                        if (marketData.code) {
                            marketStore.put(marketData);
                        }
                    }
                    // 4. 籌碼資料紀錄 ChipsCache 處理 (帶 _recordType='chips')
                    else if (record._recordType === 'chips') {
                        const chipsData = { ...record };
                        delete chipsData._recordType;
                        if (chipsData.id) {
                            chipsStore.put(chipsData);
                        }
                    }
                    // 5. 舊版備份相容：無 _recordType 但帶有 id 欄位的紀錄視為 ChipsCache
                    else if (record.id) {
                        chipsStore.put(record);
                    }
                } catch (e) {
                    console.error('JSON 解析錯誤 (行):', line, e);
                }
            }
        });
    }

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (partialLine) {
                    await processBatch([partialLine]);
                    totalCount++;
                }
                break;
            }
            
            const chunkText = decoder.decode(value, { stream: true });
            const textToProcess = partialLine + chunkText;
            const lines = textToProcess.split('\n');
            
            partialLine = lines.pop(); 
            
            const batchSize = 1000;
            for (let i = 0; i < lines.length; i += batchSize) {
                const batch = lines.slice(i, i + batchSize);
                await processBatch(batch);
                totalCount += batch.length;
                if (progressCallback) {
                    progressCallback(totalCount, expectedTotal, fileSize, bytesRead);
                }
            }
        }

        // 若有匯入休市日，統一處理
        if (holidaysDataToImport) {
            try {
                await importHolidaysFromData(holidaysDataToImport);
            } catch (err) {
                console.error('還原休市日失敗:', err);
            }
        }

        // 若有新交易明細新增，安全合併至 settings.transactions
        if (newlyAddedTransactions.length > 0) {
            try {
                const { saveSettings } = await import('./store.js');
                const mergedTrades = [...existingTxList, ...newlyAddedTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));
                settingsObj.transactions = mergedTrades;

                // 同步將新股票代碼加入自選股清單
                if (!settingsObj.watchList) settingsObj.watchList = [];
                const uniqueCodes = [...new Set(newlyAddedTransactions.map(t => t.code).filter(c => c))];
                uniqueCodes.forEach(code => {
                    if (!settingsObj.watchList.includes(code)) {
                        settingsObj.watchList.push(code);
                    }
                });

                await saveSettings();
            } catch (err) {
                console.error('同步新交易明細失敗:', err);
            }
        } else if (hasSettingsUpdate) {
            try {
                const { saveSettings } = await import('./store.js');
                await saveSettings();
            } catch (err) {
                console.error('儲存設定失敗:', err);
            }
        }
    } finally {
        reader.releaseLock();
    }
    
    return {
        totalCount,
        addedTxCount: newlyAddedTransactions.length,
        skippedTxCount
    };
}

export const exportFullJSONL = exportChipsJSONL;
export const importFullJSONL = importChipsJSONL;

