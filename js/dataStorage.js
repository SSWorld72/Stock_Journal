import { settings } from './store.js';
import { exportChipsJSONL, importChipsJSONL } from './db.js';
import { processCsvContent } from './tabs/trades.js';
import { BackupManager } from '../utils/js/backupManager.js';
import { showOptionsModal } from '../utils/js/uiDialogs.js';

const backupManager = new BackupManager({
    containerId: 'jsonl-box',
    exportBtnId: 'btn-export-jsonl',
    importBtnId: 'btn-import-jsonl'
});

async function promptExportJSONLOptions() {
    return await showOptionsModal({
        title: 'JSONL 資料庫備份設定',
        subtitle: '請選擇您要匯出的備份內容與範圍',
        icon: '📦',
        choices: [
            {
                id: 'full',
                title: '完整備份 (推薦)',
                badge: '包含歷史籌碼',
                desc: '包含所有設定、交易紀錄、券商、行事曆，以及「籌碼與營收財報歷史資料庫」。檔案較大，但能實現 100% 無痛還原。',
                icon: '★',
                isPrimary: true
            },
            {
                id: 'light',
                title: '輕量備份',
                badge: '純設定與紀錄',
                desc: '僅備份核心資料（設定、交易紀錄、券商、行事曆）。不含籌碼與營收資料（匯入後需重新下載）。檔案極小。',
                icon: '⚡',
                isPrimary: false
            }
        ]
    });
}

export async function exportJSONL() {
    const choice = await promptExportJSONLOptions();
    if (!choice) return;

    const includeChips = (choice === 'full');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const typeStr = includeChips ? '完整備份' : '輕量備份';
    const filename = `股海手札_${typeStr}_${dateStr}.jsonl`;

    await backupManager.runExport({
        title: '全系統資料庫匯出中',
        initialDetail: '正在提取所有本地資料庫紀錄（含設定、交易、籌碼快取），請勿切換分頁或關閉視窗...',
        filename: filename,
        exportAction: async (progressCallback) => {
            // 注意 exportChipsJSONL 的參數順序是 (progressCallback, options)
            return await exportChipsJSONL(
                (progressData) => {
                    // db.js 裡回傳的是 { count, total }
                    if (progressData && typeof progressData === 'object') {
                        progressCallback(progressData.count, progressData.total);
                    } else {
                        progressCallback(progressData);
                    }
                }, 
                { includeTransactions: includeChips }
            );
        }
    });
}

export async function importJSONL(event) {
    const file = event.target.files[0];
    if (!file) return;

    const success = await backupManager.runImport({
        file: file,
        confirmMessage: "匯入 JSONL 備份檔將會還原系統設定、休市日曆並同步更新籌碼資料庫。\n\n【交易明細防重機制】完全相同的交易將自動略過跳過，不同的新交易將安全新增合併，原有未重複交易完整保留。\n\n確定要繼續匯入嗎？",
        title: '全系統資料庫匯入中',
        initialDetail: file.name.endsWith('.gz') 
            ? '正在解壓縮 gzip 串流並比對還原 IndexedDB，請勿切換分頁或關閉視窗...' 
            : '正在比對還原 IndexedDB 資料庫，請勿切換分頁或關閉視窗...',
        progressDetail: '正在寫入資料庫、比對交易防重並還原設定，請勿切換分頁或關閉視窗...',
        onSuccessReload: true,
        importAction: async (f, progressCallback) => {
            return await importChipsJSONL(f, progressCallback);
        }
    });

    event.target.value = '';
}

export function exportCSV() {
    if (!settings.transactions || settings.transactions.length === 0) {
        alert('目前沒有任何交易紀錄可匯出');
        return;
    }

    const headers = ['日期', '證券商', '代碼', '名稱', '交易別', '股數', '單價', '折讓', '配息', '配股(元)', '手續費', '交易稅', '類型', '當沖', '分拆比', '減資比', '備註'];
    
    let csvContent = '';
    
    // 0. 輸出系統設定區塊
    if (settings.gasUrl) {
        csvContent += '#系統欄位說明,GAS_URL,,,,,,,,,,,,,,,,\n';
        csvContent += `#系統設定,${settings.gasUrl || ''},,,,,,,,,,,,,,,,\n`;
    }

    // 1. 輸出券商設定區塊
    if (settings.brokers && settings.brokers.length > 0) {
        csvContent += '#券商欄位說明,券商名稱,基本資金,手續費率,折讓(折),低消,零股低消,現股稅率,ETF稅率,當沖稅率,當沖ETF稅率,二代健保門檻,二代健保費率,,,,\n';
        settings.brokers.forEach(b => {
            const row = [
                '#券商設定',
                b.name || '',
                b.initialCapital !== undefined ? b.initialCapital : 0,
                b.feeRate !== undefined ? b.feeRate : 0.1425,
                b.discount !== undefined ? b.discount : 10,
                b.minFee !== undefined ? b.minFee : 20,
                b.minOddFee !== undefined ? b.minOddFee : 1,
                b.taxRate !== undefined ? b.taxRate : 0.3,
                b.etfTaxRate !== undefined ? b.etfTaxRate : 0.1,
                b.dayTradeTaxRate !== undefined ? b.dayTradeTaxRate : 0.15,
                b.dayTradeEtfTaxRate !== undefined ? b.dayTradeEtfTaxRate : 0.05,
                b.nhiThreshold !== undefined ? b.nhiThreshold : 20000,
                b.nhiTaxRate !== undefined ? b.nhiTaxRate : 2.11,
                '', '', '', ''
            ];
            csvContent += row.join(',') + '\n';
        });
    }

    // 2. 輸出交易明細標題
    csvContent += headers.join(',') + '\n';

    const typeMapping = {
        'buy': '現買',
        'sell': '現賣',
        'cash': '配息',
        'stock': '配股',
        'both': '配息+配股',
        'reduction': '減資',
        'split': '分割',
        'deposit': '存入',
        'withdraw': '取出',
        'rebate': '折讓'
    };

    const sortedTx = [...settings.transactions].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.id.localeCompare(b.id);
    });

    sortedTx.forEach(t => {
        let date = t.date || '';
        let broker = (settings.brokers && settings.brokers.find(b => b.id === t.brokerId))?.name || '';
        let code = t.code || '';
        let name = (settings.stockNamesCache && settings.stockNamesCache[code]) || '';
        let type = typeMapping[t.type] || t.type;
        if (t.dayTrading) type = t.type === 'buy' ? '當沖買' : '當沖賣';

        let qty = '';
        let price = '';
        let rebate = '';
        let divCash = '';
        let divStock = '';
        let stockType = t.stockType === 'etf' ? 'ETF' : '';
        let dt = t.dayTrading ? 'Y' : '';
        let splitRatio = '';
        let reduceRatio = '';
        let note = (t.note || '').replace(/[\r\n]+/g, ' ').replace(/,/g, '，').replace(/"/g, '""').replace(/\[/g, '［').replace(/\]/g, '］');

        if (t.category === 'trade') {
            qty = t.quantity || 0;
            price = t.price || 0;
        } else if (t.category === 'account') {
            qty = t.amount || 0;
            price = '';
        } else if (t.category === 'fee_rebate') {
            rebate = t.amount || 0;
        } else if (t.category === 'dividend') {
            if (t.type === 'cash') divCash = t.dps || 0;
            if (t.type === 'stock') divStock = t.dps || 0;
            if (t.type === 'both') {
                divCash = t.dps || 0;
                divStock = t.sdps || 0;
            }
        } else if (t.category === 'capital_change') {
            if (t.type === 'reduction') {
                qty = t.ratio || 0;
                price = t.cash || 0;
            } else if (t.type === 'split') {
                splitRatio = t.splitRatio || 0;
            }
        }

        const fee = t.fee || '';
        const tax = t.tax || '';
        const safeNote = note ? `"${note}"` : '';
        const row = [date, broker, code, name, type, qty, price, rebate, divCash, divStock, fee, tax, stockType, dt, splitRatio, reduceRatio, safeNote];
        csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    a.download = `twsj_${yyyy}${mm}${dd}_${hh}${min}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export function importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        processCsvContent(text);

        if (window.renderTradesTabFunc) {
            window.renderTradesTabFunc();
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

export function downloadTemplate() {
    const bom = '\uFEFF';
    const headers = ['日期', '證券商', '代碼', '名稱', '交易別', '股數', '單價', '折讓', '配息', '配股(元)', '手續費', '交易稅', '類型', '當沖', '分拆比', '減資比', '備註'];
    const rows = [
        // ── 存入資金 (deposit) ──
        ['2025/01/02', '元富', '', '', '存入', '', '', '', '10000000', '', '', '', '', '', '', '', '測試存入筆記'],
        ['2025/01/03', '富邦', '', '', '存入', '', '', '', '6000000', '', '', '', '', '', '', '', ''],
        ['2025/01/04', '凱基', '', '', '存入', '', '', '', '2000000', '', '', '', '', '', '', '', '"範例：這句話有逗號,因此必須用引號括起來"'],

        // ── 現買 (buy) ──
        ['2025/01/06', '元富', '2330', '台積電', '現買', '3000', '1080', '', '', '', '', '', '', '', '', '', ''],
        ['2025/01/06', '元富', '0050', '元大台灣50', '現買', '12000', '185', '', '', '', '', '', 'ETF', '', '', '', ''],
        ['2025/01/07', '元富', '2303', '聯電', '現買', '25000', '52', '', '', '', '', '', '', '', '', '', ''],
        ['2025/01/08', '富邦', '2317', '鴻海', '現買', '10000', '182', '', '', '', '', '', '', '', '', '', ''],
        ['2025/01/08', '富邦', '2454', '聯發科', '現買', '800', '1210', '', '', '', '', '', '', '', '', '', ''],
        ['2025/01/09', '富邦', '2881', '富邦金', '現買', '12000', '73', '', '', '', '', '', '', '', '', '', ''],
        ['2025/01/09', '富邦', '0056', '元大高股息', '現買', '15000', '36', '', '', '', '', '', 'ETF', '', '', '', ''],

        // ── 現賣 (sell) ──
        ['2025/03/05', '元富', '2303', '聯電', '現賣', '25000', '55', '', '', '', '', '', '', '', '', '', ''],
        ['2025/03/17', '富邦', '2317', '鴻海', '現賣', '5000', '192', '', '', '', '', '', '', '', '', '', ''],

        // ── 當沖買 (dayTradeBuy) ──
        ['2025/04/14', '元富', '2603', '長榮', '當沖買', '6000', '162', '', '', '', '', '', '', '是', '', '', ''],
        ['2025/04/15', '凱基', '2137', '笙泉', '當沖買', '5000', '201', '', '', '', '', '', '', '是', '', '', ''],

        // ── 當沖賣 (dayTradeSell) ──
        ['2025/04/14', '元富', '2603', '長榮', '當沖賣', '6000', '165', '', '', '', '', '', '', '是', '', '', ''],
        ['2025/04/15', '凱基', '2137', '笙泉', '當沖賣', '5000', '208', '', '', '', '', '', '', '是', '', '', ''],

        // ── 配息 (cash dividend) ──
        ['2025/06/15', '元富', '2330', '台積電', '配息', '3000', '', '', '3.5', '', '', '', '', '', '', '', ''],
        ['2025/06/18', '富邦', '0056', '元大高股息', '配息', '15000', '', '', '1.5', '', '', '', 'ETF', '', '', '', ''],

        // ── 配股 (stock dividend) ──
        ['2025/07/20', '元富', '2303', '聯電', '配股', '25000', '', '', '', '0.5', '', '', '', '', '', '', ''],

        // ── 配息+配股 (both) ──
        ['2025/07/25', '富邦', '2881', '富邦金', '配息+配股', '12000', '', '', '2.0', '0.3', '', '', '', '', '', '', ''],

        // ── 折讓 (fee_rebate) ──
        ['2025/09/25', '元富', '2454', '聯發科', '折讓', '', '', '$200', '', '', '', '', '', '', '', '', ''],
        ['2025/09/25', '富邦', '2881', '富邦金', '折讓', '', '', '$80', '', '', '', '', '', '', '', '', ''],

        // ── 減資 (reduction) ──
        ['2025/10/20', '元富', '3131', '弘塑', '減資', '0.8', '9.5', '', '', '', '', '', '', '', '', '', ''],
        ['2025/10/20', '富邦', '2303', '聯電', '減資', '0.95', '1.04', '', '', '', '', '', '', '', '', '', ''],

        // ── 分割 (split) ──
        ['2025/11/12', '元富', '2330', '台積電', '分割', '', '', '', '', '', '', '', '', '', '2', '', '一股拆二股'],
        ['2025/11/12', '富邦', '2454', '聯發科', '分割', '', '', '', '', '', '', '', '', '', '5', '', '一股拆五股'],

        // ── 取出資金 (withdraw) ──
        ['2025/12/01', '元富', '', '', '取出', '', '', '', '500000', '', '', '', '', '', '', '', ''],
        ['2025/12/01', '富邦', '', '', '取出', '', '', '', '300000', '', '', '', '', '', '', '', ''],
    ];

    let csvContent = headers.join(',') + '\n';
    rows.forEach(r => { csvContent += r.join(',') + '\n'; });

    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'StockJournal_Sample.csv';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
