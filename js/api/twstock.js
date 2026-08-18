/**
 * TWSE / TPEx Stock Quote API
 * 即時報價 → TWSE MIS
 * 歷史 K 線 → TWSE STOCK_DAY / TPEx st43
 * 當日走勢 → Yahoo Finance Chart (TWSE 無免費盤中 API)
 */

import { settings, saveSettings } from '../store.js';
import { getRecord, putRecord, getAllRecords } from '../db.js';
import { isTaiwanBusinessDay } from '../utils/holiday.js';

// ===== Client IP & ID 追蹤快取 (供 GAS 記錄日誌) =====
let cachedClientIp = null;
let ipFetchPromise = null;

export async function fetchClientIp() {
    if (cachedClientIp) return cachedClientIp;
    try {
        const sessionIp = sessionStorage.getItem('sj_client_ip');
        if (sessionIp) {
            cachedClientIp = sessionIp;
            return cachedClientIp;
        }
    } catch (_) {}
    if (!ipFetchPromise) {
        ipFetchPromise = (async () => {
            try {
                const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.ip) {
                        cachedClientIp = data.ip;
                        try { sessionStorage.setItem('sj_client_ip', data.ip); } catch (_) {}
                        return data.ip;
                    }
                }
            } catch (_) {}
            return 'unknown';
        })();
    }
    return ipFetchPromise;
}

// 頁面初始化時背景靜默獲取一次 IP
if (typeof window !== 'undefined') {
    setTimeout(() => { fetchClientIp().catch(() => {}); }, 600);
}

function getOrCreateClientId() {
    try {
        let cid = localStorage.getItem('sj_client_id');
        if (!cid) {
            cid = 'usr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
            localStorage.setItem('sj_client_id', cid);
        }
        return cid;
    } catch (_) {
        return 'usr_guest';
    }
}

function getDeviceName() {
    try {
        const ua = navigator.userAgent;
        let device = "Desktop";
        if (/Mobile|Android|iP(hone|od|ad)/i.test(ua)) device = "Mobile";
        
        let os = "Unknown";
        if (/Windows/.test(ua)) os = "Windows";
        else if (/Mac OS X/.test(ua)) os = "macOS";
        else if (/Android/.test(ua)) os = "Android";
        else if (/iOS|iPhone|iPad|iPod/.test(ua)) os = "iOS";
        else if (/Linux/.test(ua)) os = "Linux";
        
        return `${device} (${os})`;
    } catch (_) {
        return "Unknown Device";
    }
}
import { fetchViaGas, getGasProxyUrl } from '../../utils/js/gasProxy.js';

export function getApiUrl(path) {
    if (settings.apiProxyMode === 'local') {
        return 'http://localhost:8080' + path;
    }
    
    const additionalParams = {
        client_id: getOrCreateClientId(),
        app_v: '26.9.1.0',
        device: getDeviceName()
    };
    
    if (cachedClientIp && cachedClientIp !== 'unknown') {
        additionalParams.client_ip = cachedClientIp;
    }

    return getGasProxyUrl(settings.gasUrl || '', path, additionalParams);
}

/**
 * 統一 API 請求 helper。
 * - GAS 模式：將所有參數包在 POST Body 中，網址只露出 GAS Web App URL 本身。
 * - 本地模式：維持傳統 GET 網址傳參。
 * @param {string} path - API 路徑，例如 '/api/quote?code=2330.TW&interval=1d&range=3mo'
 * @returns {Promise<Response>}
 */
export function fetchApi(path) {
    if (settings.apiProxyMode === 'local') {
        return fetch('http://localhost:8080' + path);
    }

    const additionalParams = {
        client_id: getOrCreateClientId(),
        app_v: '26.9.1.0',
        device: getDeviceName(),
        client_ip: cachedClientIp || 'unknown'
    };

    return fetchViaGas(settings.gasUrl || '', path, additionalParams);
}

// ===== 共用 Headers =====
const TWSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Referer': 'https://mis.twse.com.tw/stock/index.jsp',
};

// ===== 工具函式 =====
function parseNum(s) {
    if (s === '' || s === '-' || s == null) return null;
    const cleaned = String(s).replace(/,/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
}

function parseIntSafe(s) {
    if (s == null) return 0;
    const cleaned = String(s).replace(/,/g, '');
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : 0;
}

function firstNum(s) {
    if (s == null) return null;
    return parseNum(String(s).split('_')[0]);
}

function firstInt(s) {
    if (s == null) return 0;
    return parseIntSafe(String(s).split('_')[0]);
}

// ===== 空報價模板 =====
function emptyQuote(code, status, error) {
    return {
        code, name: (settings.stockNamesCache && settings.stockNamesCache[code]) || '', exchange: 'tse',
        price: null, open: null, high: null, low: null, yesterday: null,
        bid: null, ask: null, bidVolume: 0, askVolume: 0,
        tickVolume: 0, volume: 0,
        change: 0, changePercent: 0, tradeTime: '',
        timestamp: Date.now(), status, error,
        peRatio: null, dividendYield: null, pbRatio: null,
        revenueYoY: null, revenueMoM: null, revenue: null, revenuePeriod: '',
        eps: null, epsPeriod: '', peg: null,
    };
}

// ===== 股票名稱快取 =====
let stockNamesCache = null;
let isCaching = false;

export async function ensureStockNames() {
    if (stockNamesCache && Object.keys(stockNamesCache).length > 0) return;
    while (isCaching) {
        await new Promise(r => setTimeout(r, 200));
    }
    if (stockNamesCache && Object.keys(stockNamesCache).length > 0) return;
    isCaching = true;
    try {
        try {
            const dbCache = await getRecord('MarketCache', '_GLOBAL_STOCK_NAMES');
            if (dbCache && dbCache.data && Date.now() - dbCache.lastUpdated < 7 * 24 * 60 * 60 * 1000) {
                stockNamesCache = dbCache.data;
                settings.stockNamesCache = stockNamesCache; // 同步至設定檔以便備份
                saveSettings();
                console.log(`[TWStock] 股票名稱快取載入完成 (from DB): ${Object.keys(stockNamesCache).length} 檔`);
                isCaching = false;
                return;
            }
        } catch (e) { console.warn('[資料庫] 載入股票名稱快取（_GLOBAL_STOCK_NAMES）失敗:', e); }

        stockNamesCache = {};
        const [tseRes, otcRes] = await Promise.all([
            fetchApi('/api/names?type=twse').catch(e => { console.error('上市股票名稱抓取錯誤:', e); return null; }),
            fetchApi('/api/names?type=tpex').catch(e => { console.error('上櫃股票名稱抓取錯誤:', e); return null; })
        ]);

        if (tseRes && tseRes.ok) {
            const data = await tseRes.json();
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.Code && item.Name) {
                        stockNamesCache[item.Code.trim()] = item.Name.trim();
                    }
                });
            } else {
                console.warn('[TWStock] ensureStockNames: TSE 回應非陣列格式', typeof data);
            }
        }
        
        if (otcRes && otcRes.ok) {
            const data = await otcRes.json();
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.SecuritiesCompanyCode && item.CompanyName) {
                        stockNamesCache[item.SecuritiesCompanyCode.trim()] = item.CompanyName.trim();
                    }
                });
            } else {
                console.warn('[TWStock] ensureStockNames: OTC 回應非陣列格式', typeof data);
            }
        }
        
        if (Object.keys(stockNamesCache).length > 0) {
            settings.stockNamesCache = stockNamesCache; // 同步至設定檔以便備份
            saveSettings();
            putRecord('MarketCache', {
                code: '_GLOBAL_STOCK_NAMES',
                data: stockNamesCache,
                lastUpdated: Date.now()
            }).catch(e => console.warn('[資料庫] 儲存股票名稱快取（_GLOBAL_STOCK_NAMES）失敗:', e));
        }
        console.log("[TWStock] 股票名稱快取載入完成 (from API):", Object.keys(stockNamesCache).length, "檔");
    } catch (e) {
        console.error('解析股票名稱失敗', e);
    }
    isCaching = false;
}

// ===== 股票產業別快取 =====
let industryCachePromise = null;

export async function ensureIndustryCache(code) {
    if (!settings.stockIndustries) settings.stockIndustries = {};
    const industryCount = Object.keys(settings.stockIndustries).length;
    
    // 如果已經有這個代碼，而且快取數量大於 500 (確保不是之前的失敗殘留)，就直接返回
    if (settings.stockIndustries[code] && industryCount > 500) return;

    // 防止重複呼叫，改用 Promise 來等待同一批次的請求
    if (!industryCachePromise) {
        industryCachePromise = (async () => {
            try {
                const [tseRes, otcRes] = await Promise.all([
                    fetchApi('/api/industry?type=twse').catch(e => null),
                    fetchApi('/api/industry?type=tpex').catch(e => null)
                ]);

        let updated = false;

        const INDUSTRY_MAP = {
            '01': '水泥工業', '02': '食品工業', '03': '塑膠工業', '04': '紡織纖維', '05': '電機機械', '06': '電器電纜',
            '07': '化學工業', '08': '玻璃陶瓷', '09': '造紙工業', '10': '鋼鐵工業', '11': '橡膠工業', '12': '汽車工業',
            '14': '建材營造', '15': '航運業', '16': '觀光餐旅', '17': '金融保險', '18': '貿易百貨', '20': '其他業',
            '21': '化學工業', '22': '生技醫療', '23': '油電燃氣', '24': '半導體業', '25': '電腦及週邊', '26': '光電業',
            '27': '通信網路', '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意',
            '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活'
        };

        if (tseRes && tseRes.ok) {
            const data = await tseRes.json();
            if (Array.isArray(data)) {
                data.forEach(item => {
                    const code = item.公司代號;
                    const indCode = item.產業別;
                    if (code && indCode) {
                        settings.stockIndustries[code.trim()] = INDUSTRY_MAP[indCode.trim()] || indCode.trim();
                        updated = true;
                    }
                });
            } else {
                console.warn('[TWStock] ensureIndustryCache: TSE 回應非陣列格式', typeof data);
            }
        }
        
        if (otcRes && otcRes.ok) {
            const data = await otcRes.json();
            if (Array.isArray(data)) {
                data.forEach(item => {
                    const code = item.SecuritiesCompanyCode;
                    const indCode = item.SecuritiesIndustryCode;
                    if (code && indCode) {
                        settings.stockIndustries[code.trim()] = INDUSTRY_MAP[indCode.trim()] || indCode.trim();
                        updated = true;
                    }
                });
            } else {
                console.warn('[TWStock] ensureIndustryCache: OTC 回應非陣列格式', typeof data);
            }
        }
        
        if (updated) {
            console.log("股票產業別快取更新完成", Object.keys(settings.stockIndustries).length, "檔");
            if (typeof saveSettings === 'function') saveSettings();
        }

            } catch (e) {
                console.error('解析股票產業分類失敗', e);
            }
        })();
    }

    // 等待全域抓取完成
    await industryCachePromise;

    // 如果這次有指定 code，但抓完後還是沒有（例如是 ETF），就塞個預設值避免下次重複抓
    if (code && !settings.stockIndustries[code]) {
        settings.stockIndustries[code] = '基金';
        if (typeof saveSettings === 'function') saveSettings();
    }
}

export function getIndustry(code) {
    const isETF = code.startsWith('00') && code.length >= 4;
    
    // 如果快取根本還沒準備好（例如剛開網頁的瞬間）
    if (!settings.stockIndustries) return isETF ? '基金' : '載入中...';
    
    const rawVal = settings.stockIndustries[code];
    // 如果快取裡真的沒有這檔股票的產業資料
    if (!rawVal) return isETF ? '基金' : '未知';
    
    // 確保轉為字串
    const val = String(rawVal).trim();
    
    // 如果快取裡殘留的是舊版的純數字代碼，在此做向下相容轉換
    const INDUSTRY_MAP = {
        '01': '水泥工業', '02': '食品工業', '03': '塑膠工業', '04': '紡織纖維', '05': '電機機械', '06': '電器電纜',
        '07': '化學工業', '08': '玻璃陶瓷', '09': '造紙工業', '10': '鋼鐵工業', '11': '橡膠工業', '12': '汽車工業',
        '14': '建材營造', '15': '航運業', '16': '觀光餐旅', '17': '金融保險', '18': '貿易百貨', '20': '其他業',
        '21': '化學工業', '22': '生技醫療', '23': '油電燃氣', '24': '半導體業', '25': '電腦及週邊', '26': '光電業',
        '27': '通信網路', '28': '電子零組件', '29': '電子通路', '30': '資訊服務', '31': '其他電子', '32': '文化創意',
        '33': '農業科技', '34': '電子商務', '35': '綠能環保', '36': '數位雲端', '37': '運動休閒', '38': '居家生活'
    };
    
    return INDUSTRY_MAP[val] || val;
}

// ===== TWSE MIS 即時報價 =====
async function fetchMis(exch, code) {
    const ex_ch = `${exch}_${code}.tw`;
    const apiPath = `/api/twse-quote?code=${ex_ch}`;
    console.log(`[TWSE MIS] fetchMis(${exch}, ${code}) POST ${apiPath}`);
    try {
        const resp = await fetchApi(apiPath);
        if (!resp.ok) {
            console.warn(`[TWSE MIS] fetchMis(${exch}, ${code}) FAILED → HTTP ${resp.status}`);
            return null;
        }
        const data = await resp.json();
        if (!data?.msgArray || data.msgArray.length === 0) {
            console.warn(`[TWSE MIS] fetchMis(${exch}, ${code}) empty msgArray`);
            return null;
        }
        const item = data.msgArray[0];
        console.log(`[TWSE MIS] fetchMis(${exch}, ${code}) GOT: c=${item.c} n=${item.n} z=${item.z} ex=${item.ex}`);
        return item;
    } catch (err) {
        console.error(`[TWSE MIS] fetchMis(${exch}, ${code}) EXCEPTION:`, err.message);
        return null;
    }
}

// 判斷 MIS 回傳是否為「有效的資料」
// 上市查詢上櫃股票時，MIS 會回傳空殼（z="-", n 不存在），不能當成有效
function misHasData(r) {
    return !!r && (!!r.n || parseNum(r.z) != null);
}

// ===== 取得即時報價 =====
async function fetchQuoteFromMis(code) {
    let raw = null;
    let exch = 'tse';

    // 先查上市
    raw = await fetchMis('tse', code);
    console.log(`[TWStock] getQuote(${code}) tse raw: hasData=${misHasData(raw)} n=${raw?.n} z=${raw?.z}`);

    if (!misHasData(raw)) {
        // 上市沒有有效資料 → 嘗試上櫃
        const otcRaw = await fetchMis('otc', code);
        console.log(`[TWStock] getQuote(${code}) otc raw: hasData=${misHasData(otcRaw)} n=${otcRaw?.n} z=${otcRaw?.z}`);
        if (misHasData(otcRaw)) {
            raw = otcRaw;
            exch = 'otc';
        } else if (!raw && otcRaw) {
            raw = otcRaw;
            exch = 'otc';
        }
    }

    if (!raw) {
        return emptyQuote(code, 'error', 'No data from TWSE MIS');
    }

    // ===== 報價取值=====
    const price = parseNum(raw.z);
    let displayPrice = price;
    // z 為 "-" 時（無最新成交，盤後），依序嘗試：最佳買賣中點 → 昨收價
    const bidForMid = parseNum(String(raw.b || '').split('_')[0]);
    const askForMid = parseNum(String(raw.a || '').split('_')[0]);
    if (displayPrice == null && bidForMid != null && askForMid != null) {
        displayPrice = (bidForMid + askForMid) / 2;
    }
    if (displayPrice == null) {
        const yest = parseNum(raw.y);
        if (yest != null) displayPrice = yest;
    }

    const open = parseNum(raw.o);
    const high = parseNum(raw.h);
    const low = parseNum(raw.l);
    const yesterday = parseNum(raw.y);
    const volume = parseIntSafe(raw.v);
    const tickVolume = parseIntSafe(raw.tv) || parseIntSafe(raw.s);
    const bid = firstNum(raw.b);
    const ask = firstNum(raw.a);
    const bidVolume = firstInt(raw.g);
    const askVolume = firstInt(raw.f);
    const tradeTime = typeof raw.t === 'string' ? raw.t : '';
    const change = (displayPrice != null && yesterday != null) ? displayPrice - yesterday : 0;
    const changePercent = (yesterday != null && yesterday > 0 && displayPrice != null) ? (change / yesterday) * 100 : 0;

    return {
        code,
        name: raw.n || stockNamesCache[code] || (settings.stockNamesCache && settings.stockNamesCache[code]) || '',
        exchange: exch,
        price: displayPrice,
        open, high, low,
        yesterday,
        bid, ask, bidVolume, askVolume,
        tickVolume, volume,
        change: parseFloat(change.toFixed(2)),
        changePercent: parseFloat(changePercent.toFixed(2)),
        tradeTime,
        quoteDate: raw.d || '',
        timestamp: Date.now(),
        status: displayPrice == null ? 'closed' : 'ok',
        error: null,
        peRatio: null,
        dividendYield: null,
    };
}

// ===== MA 均線計算 =====
function calculateMA(closes, period) {
    if (!closes || closes.length < period) return null;
    let sum = 0;
    let validCount = 0;
    for (let i = closes.length - 1; i >= 0 && validCount < period; i--) {
        if (closes[i] != null) {
            sum += closes[i];
            validCount++;
        }
    }
    return validCount === period ? (sum / period) : null;
}

// ===== 取得 Yahoo 歷史收盤（僅用於 MA 均線計算）=====
async function fetchYahooCloses(code, exch) {
    const symbol = exch === 'otc' ? `${code}.TWO` : `${code}.TW`;
    const url = getApiUrl(`/api/quote?code=${symbol}&interval=1d&range=3mo`);
    console.log(`[Yahoo] Fetching closes for MA: ${url}`);
    try {
        const res = await fetchApi(`/api/quote?code=${symbol}&interval=1d&range=3mo`);
        if (!res.ok) return [];
        const data = await res.json();
        return data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    } catch (e) {
        console.error(`[Yahoo] Error fetching closes:`, e.message);
        return [];
    }
}

// ===== Yahoo Finance 備援報價（同時取得 MA 所需歷史收盤） =====
async function fetchQuoteFromYahoo(code) {
    // 嘗試 .TW (上市) 再嘗試 .TWO (上櫃)
    for (const suffix of ['.TW', '.TWO']) {
        const symbol = `${code}${suffix}`;
        // 直接用 3mo，一次取得報價 + MA 均線所需的歷史收盤
// [POST 隱藏] 已改用 fetchApi() 直接呼叫
        try {
            const res = await fetchApi(`/api/quote?code=${symbol}&interval=1d&range=3mo`);
            if (!res.ok) continue;
            const data = await res.json();
            const result = data?.chart?.result?.[0];
            if (!result) continue;

            const meta = result.meta || {};
            const quotes = result.indicators?.quote?.[0] || {};
            const timestamps = result.timestamp || [];
            
            // 取最後一根 K 棒的資料
            const lastIdx = timestamps.length - 1;
            if (lastIdx < 0) continue;

            const price = meta.regularMarketPrice || quotes.close?.[lastIdx];
            if (price == null) continue;

            let prevClose = null;
            for (let i = lastIdx - 1; i >= 0; i--) {
                if (quotes.close[i] != null) {
                    prevClose = quotes.close[i];
                    break;
                }
            }
            if (prevClose == null) {
                prevClose = meta.chartPreviousClose || meta.previousClose;
            }

            const open = quotes.open?.[lastIdx];
            const high = quotes.high?.[lastIdx];
            const low = quotes.low?.[lastIdx];
            const volume = quotes.volume?.[lastIdx] || 0;
            const change = prevClose ? parseFloat((price - prevClose).toFixed(2)) : 0;
            const changePercent = prevClose ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;

            // 判斷最後一筆資料的日期與時間
            let lastDate;
            if (meta.regularMarketTime) {
                lastDate = new Date(meta.regularMarketTime * 1000);
            } else {
                lastDate = new Date(timestamps[lastIdx] * 1000);
            }
            
            const dateStr = `${lastDate.getFullYear()}${String(lastDate.getMonth() + 1).padStart(2, '0')}${String(lastDate.getDate()).padStart(2, '0')}`;
            const timeStr = lastDate.toLocaleTimeString('zh-TW', { hour12: false });

            const exch = suffix === '.TWO' ? 'otc' : 'tse';

            // 從 3mo 資料直接計算 MA 均線
            const closes = quotes.close || [];
            const ma5 = calculateMA(closes, 5);
            const ma20 = calculateMA(closes, 20);
            const ma60 = calculateMA(closes, 60);

            // 移除此處的單獨 Log，移至 getQuoteForCode 中統一輸出

            return {
                code,
                name: stockNamesCache[code] || (settings.stockNamesCache && settings.stockNamesCache[code]) || '',
                exchange: exch,
                price, open, high, low,
                yesterday: prevClose || null,
                bid: null, ask: null, bidVolume: 0, askVolume: 0,
                tickVolume: 0, volume,
                change, changePercent,
                tradeTime: timeStr,
                quoteDate: dateStr,
                timestamp: Date.now(),
                status: 'ok',
                error: null,
                peRatio: null,
                dividendYield: null,
                ma5, ma20, ma60,
                _source: 'yahoo'
            };
        } catch (e) {
            console.error(`[Yahoo Fallback] ${code}${suffix} error:`, e.message);
        }
    }
    return null;
}

// ===== 公開 API：取得完整報價 =====
export async function getQuoteForCode(code, forceBulk = false) {
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return emptyQuote('', 'error', '空代號');
    
    await ensureStockNames();

    try {
        // 1. 根據設定決定優先順序
        const preferYahoo = settings.quoteSource === 'yahoo';
        let quoteData = null;

        if (preferYahoo) {
            quoteData = await fetchQuoteFromYahoo(cleaned);
            if (!quoteData || quoteData.status === 'error') {
                console.warn(`[TWStock] Yahoo 失敗，嘗試 MIS 備援: ${cleaned}`);
                const misQuote = await fetchQuoteFromMis(cleaned);
                if (misQuote) quoteData = misQuote;
            }
        } else {
            quoteData = await fetchQuoteFromMis(cleaned);
            if (!quoteData || quoteData.status === 'error') {
                console.warn(`[TWStock] MIS 失敗，嘗試 Yahoo 備援: ${cleaned}`);
                const yahooQuote = await fetchQuoteFromYahoo(cleaned);
                if (yahooQuote) quoteData = yahooQuote;
            }
        }
        
        if (!quoteData || quoteData.status === 'error') {
            console.warn(`[TWStock] 查無股票代碼或無報價資料: ${cleaned}`);
            return emptyQuote(cleaned, 'error', '查無此代碼');
        }

        quoteData.isETF = cleaned.startsWith('00') && cleaned.length >= 4;

        // 3. 從 Yahoo 取得歷史收盤以計算 MA（若尚無 MA 資料）
        if (quoteData.ma5 == null) {
            const closes = await fetchYahooCloses(cleaned, quoteData.exchange);
            quoteData.ma5 = calculateMA(closes, 5);
            quoteData.ma20 = calculateMA(closes, 20);
            quoteData.ma60 = calculateMA(closes, 60);
        }

        // 4. 套用本益比 / 殖利率
        await ensurePEYieldCache();
        if (peYieldCache && peYieldCache[cleaned]) {
            quoteData.peRatio = peYieldCache[cleaned].peRatio;
            quoteData.dividendYield = peYieldCache[cleaned].dividendYield;
            quoteData.pbRatio = peYieldCache[cleaned].pbRatio;
        }

        // 5. 套用月營收 YoY 與季報 EPS 快取
        await ensureRevenueYoYCache(false);
        if (revenueYoYCache && revenueYoYCache[cleaned]) {
            quoteData.revenueYoY = revenueYoYCache[cleaned].yoy;
            quoteData.revenueMoM = revenueYoYCache[cleaned].mom;
            quoteData.revenue = revenueYoYCache[cleaned].revenue;
            quoteData.revenuePeriod = revenueYoYCache[cleaned].period;
        }

        await ensureEpsCache(false);
        if (epsCache && epsCache[cleaned]) {
            quoteData.eps = epsCache[cleaned].eps;
            quoteData.epsPeriod = epsCache[cleaned].period;
            quoteData.epsYear = epsCache[cleaned].year;
            quoteData.epsQuarter = epsCache[cleaned].quarter;
        }

        // 6. 動態計算 PEG (本益比 / 營收年增率)
        if (quoteData.peRatio != null && quoteData.revenueYoY != null && quoteData.revenueYoY > 0) {
            quoteData.peg = parseFloat((quoteData.peRatio / quoteData.revenueYoY).toFixed(2));
        } else {
            quoteData.peg = null;
        }

        // 7. 若是 ETF，抓取淨值與折溢價 (TWSE all_etf.txt)
        if (quoteData.isETF) {
            // 只讀取快取，不再於單股迴圈中觸發全域 API 下載
            await ensureEtfNavCache(false);
            
            if (etfNavCache && etfNavCache[cleaned]) {
                quoteData.nav = etfNavCache[cleaned].nav;
                quoteData.premium = etfNavCache[cleaned].premium;
            }
        }

        const srcName = quoteData._source === 'yahoo' ? 'Yahoo 備援' : 'MIS 官方';
        console.log(`[${srcName} API] ${cleaned} → price=${quoteData.price} change=${quoteData.change} date=${quoteData.quoteDate} MA5=${quoteData.ma5?.toFixed(2)} MA20=${quoteData.ma20?.toFixed(2)} MA60=${quoteData.ma60?.toFixed(2)}`);
        console.log(`[${srcName} API] 資料取得成功，重組成 [TWStock] 個股資訊完成: ${cleaned} ${quoteData.name} 現價=${quoteData.price} 漲跌=${quoteData.change} PE=${quoteData.peRatio} 殖利率=${quoteData.dividendYield} YoY=${quoteData.revenueYoY}% EPS=${quoteData.eps} PEG=${quoteData.peg}`);

        return quoteData;
        
    } catch (err) {
        console.error(`[TWStock] API 發生錯誤:`, err);
        return emptyQuote(cleaned, 'error', err.message);
    }
}

// ===== 本益比 / 殖利率快取=====
let peYieldCache = null;
let peYieldLoading = false;

function getLatestTradingDate() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const isAfterMarket = (h > 14) || (h === 14 && m >= 30);
    const day = now.getDay();
    if (day === 0) now.setDate(now.getDate() - 2);
    else if (day === 6) now.setDate(now.getDate() - 1);
    else if (!isAfterMarket) now.setDate(now.getDate() - 1);
    const d = now.getDay();
    if (d === 0) now.setDate(now.getDate() - 2);
    else if (d === 6) now.setDate(now.getDate() - 1);
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const da = String(now.getDate()).padStart(2, '0');
    return `${y}${mo}${da}`;
}

export async function ensurePEYieldCache() {
    if (peYieldCache) return;
    while (peYieldLoading) {
        await new Promise(r => setTimeout(r, 200));
    }
    if (peYieldCache) return;
    peYieldLoading = true;
    try {
        let dateStr = getLatestTradingDate();
        
        try {
            const dbCache = await getRecord('MarketCache', '_GLOBAL_BWIBBU');
            if (dbCache && dbCache.data && dbCache.dateStr === dateStr) {
                peYieldCache = dbCache.data;
                console.log(`[BWIBBU/TPEx] 載入完成 (from DB): ${Object.keys(peYieldCache).length} 檔`);
                peYieldLoading = false;
                return;
            }
        } catch (e) {
            console.warn('[資料庫] 載入本益比快取（_GLOBAL_BWIBBU）失敗:', e);
        }

        let url = getApiUrl(`/api/bwibbu?date=${dateStr}`);
        console.log(`[BWIBBU] Fetching PE/Yield: ${url}`);
        let resp = await fetchApi(`/api/bwibbu?date=${dateStr}`);
        let data = resp.ok ? await resp.json() : null;

        // 如果當日資料尚未公佈（通常是下午 3 點到 5 點間），自動回退一個交易日
        if (!data || data.stat !== 'OK' || !Array.isArray(data.data)) {
            console.log(`[BWIBBU] 今日資料尚未準備好，嘗試回退一個交易日...`);
            const fbDate = new Date();
            fbDate.setDate(fbDate.getDate() - 1);
            if (fbDate.getDay() === 0) fbDate.setDate(fbDate.getDate() - 2);
            else if (fbDate.getDay() === 6) fbDate.setDate(fbDate.getDate() - 1);
            const fy = fbDate.getFullYear(), fmo = String(fbDate.getMonth() + 1).padStart(2, '0'), fda = String(fbDate.getDate()).padStart(2, '0');
            dateStr = `${fy}${fmo}${fda}`;
            url = getApiUrl(`/api/bwibbu?date=${dateStr}`);
            resp = await fetchApi(`/api/bwibbu?date=${dateStr}`);
            data = resp.ok ? await resp.json() : null;
        }

        if (!data || data?.stat !== 'OK' || !Array.isArray(data?.data)) { peYieldLoading = false; return; }
        peYieldCache = {};
        for (const row of data.data) {
            const code = String(row[0] || '').trim();
            if (!code) continue;
            const peStr = String(row[5] || '').trim();
            const dyStr = String(row[3] || '').trim();
            const pbStr = String(row[6] || '').trim();
            peYieldCache[code] = {
                peRatio: peStr && peStr !== '-' ? parseFloat(peStr) : null,
                dividendYield: dyStr && dyStr !== '-' ? parseFloat(dyStr) : null,
                pbRatio: pbStr && pbStr !== '-' ? parseFloat(pbStr) : null,
            };
        }

        try {
            const y = parseInt(dateStr.substring(0, 4)) - 1911;
            const rocDate = `${y}/${dateStr.substring(4, 6)}/${dateStr.substring(6, 8)}`;
            const tpexUrl = getApiUrl(`/api/tpex-peratio?date=${rocDate}`);
            console.log(`[TPEx] Fetching PE/Yield: ${tpexUrl}`);
            let tpexResp = await fetchApi(`/api/tpex-peratio?date=${rocDate}`);
            let tpexData = tpexResp.ok ? await tpexResp.json() : null;
            if (tpexData && Array.isArray(tpexData.tables) && tpexData.tables.length > 0 && Array.isArray(tpexData.tables[0].data)) {
                for (const row of tpexData.tables[0].data) {
                    const code = String(row[0] || '').trim();
                    if (!code) continue;
                    const peStr = String(row[2] || '').trim(); // 本益比
                    const dyStr = String(row[5] || '').trim(); // 殖利率(%)
                    const pbStr = String(row[6] || '').trim(); // 股價淨值比
                    peYieldCache[code] = {
                        peRatio: peStr && peStr !== '-' && peStr !== 'N/A' ? parseFloat(peStr) : null,
                        dividendYield: dyStr && dyStr !== '-' && dyStr !== 'N/A' ? parseFloat(dyStr) : null,
                        pbRatio: pbStr && pbStr !== '-' && pbStr !== 'N/A' ? parseFloat(pbStr) : null,
                    };
                }
            }
        } catch (e) {
            console.error('[上櫃本益比] 錯誤:', e);
        }

        console.log(`[BWIBBU/TPEx] 載入完成 (from API): ${Object.keys(peYieldCache).length} 檔`);
        
        putRecord('MarketCache', {
            code: '_GLOBAL_BWIBBU',
            dateStr: dateStr,
            data: peYieldCache,
            lastUpdated: Date.now()
        }).catch(e => console.warn('[資料庫] 儲存本益比快取（_GLOBAL_BWIBBU）失敗:', e));
    } catch (e) {
        console.error('[上市本益比] 錯誤:', e);
    }
    peYieldLoading = false;
}

// ===== ETF 即時預估淨值快取 =====
let etfNavCache = null;
let etfNavLoading = false;
export async function ensureEtfNavCache(forceSync = false) {
    if (!forceSync && etfNavCache) return;
    while (etfNavLoading) {
        await new Promise(r => setTimeout(r, 200));
    }
    if (!forceSync && etfNavCache) return;
    etfNavLoading = true;
    try {
        const freq = parseInt(settings.etfNavUpdateMode || '0', 10);
        
        if (!forceSync) {
            try {
                const dbCache = await getRecord('MarketCache', '_GLOBAL_ETF_NAV');
                if (dbCache && dbCache.data) {
                    const age = Date.now() - dbCache.lastUpdated;
                    if (freq === 0 || age < freq) {
                        etfNavCache = dbCache.data;
                        console.log(`[TWStock] ETF淨值載入完成 (from DB): ${Object.keys(etfNavCache).length} 檔`);
                        etfNavLoading = false;
                        return;
                    }
                }
            } catch (e) {
                console.warn('[資料庫] 載入 ETF 淨值快取（_GLOBAL_ETF_NAV）失敗:', e);
            }
        }

        const url = getApiUrl(`/api/etf-nav`);
        console.log(`[TWStock] Fetching ETF NAV: ${url}`);
        const resp = await fetchApi(`/api/etf-nav`);
        const data = resp.ok ? await resp.json() : null;
        if (data) {
            etfNavCache = {};
            Object.values(data).forEach(arr => {
                if (Array.isArray(arr)) {
                    arr.forEach(g => {
                        if (g.msgArray) {
                            g.msgArray.forEach(etf => {
                                etfNavCache[etf.a] = {
                                    nav: etf.f ? parseFloat(etf.f) : null,
                                    premium: etf.g ? parseFloat(etf.g) : null,
                                };
                            });
                        }
                    });
                }
            });
            console.log(`[TWStock] ETF淨值載入完成 (from API): ${Object.keys(etfNavCache).length} 檔`);
            
            putRecord('MarketCache', {
                code: '_GLOBAL_ETF_NAV',
                data: etfNavCache,
                lastUpdated: Date.now()
            }).catch(e => console.warn('[資料庫] 儲存 ETF 淨值快取（_GLOBAL_ETF_NAV）失敗:', e));
        }
    } catch (e) {
        console.error('[TWStock] 取得 ETF 淨值時發生錯誤:', e);
    }
    etfNavLoading = false;
}

// ===== 月營收與年增率 (YoY) 快取 =====
let revenueYoYCache = null;
let revenueYoYLoading = false;
let revenueYoYPeriod = '';

export async function ensureRevenueYoYCache(force = false) {
    if (!force && revenueYoYCache) return;
    while (revenueYoYLoading) {
        await new Promise(r => setTimeout(r, 200));
    }
    if (!force && revenueYoYCache) return;
    revenueYoYLoading = true;
    try {
        if (!force) {
            try {
                const dbCache = await getRecord('MarketCache', '_GLOBAL_REVENUE_YOY');
                if (dbCache && dbCache.data) {
                    const age = Date.now() - (dbCache.lastUpdated || 0);
                    // 若 24 小時內已更新過，且非強制更新，直接使用快取
                    if (age < 24 * 60 * 60 * 1000) {
                        revenueYoYCache = dbCache.data;
                        revenueYoYPeriod = dbCache.lastPeriod || '';
                        console.log(`[TWStock] 月營收 YoY 載入完成 (from DB): ${Object.keys(revenueYoYCache).length} 檔 (${revenueYoYPeriod})`);
                        revenueYoYLoading = false;
                        return;
                    }
                }
            } catch (e) {
                console.warn('[資料庫] 載入月營收快取（_GLOBAL_REVENUE_YOY）失敗:', e);
            }
        }

        revenueYoYCache = {};
        let detectedPeriod = '';

        // 1. 抓取上市公司月營收 (TWSE t187ap05_L)
        try {
            const twseUrl = getApiUrl('/api/revenue-yoy?type=twse');
            if (twseUrl) {
                console.log(`[TWStock] Fetching TWSE Revenue YoY: ${twseUrl}`);
                const resp = await fetchApi('/api/revenue-yoy?type=twse');
                const list = resp.ok ? await resp.json() : null;
                if (Array.isArray(list)) {
                    for (const item of list) {
                        const code = String(item['公司代號'] || item['證券代號'] || item['Code'] || '').trim();
                        if (!code) continue;
                        const yoyStr = item['營業收入-去年同月增減(%)'] ?? item['去年同月增減(%)'] ?? item['去年同期增減(%)'];
                        const momStr = item['營業收入-上月比較增減(%)'] ?? item['上月比較增減(%)'];
                        const revStr = item['營業收入-當月營收'] ?? item['當月營收'];
                        let period = String(item['資料年月'] || item['出表日期'] || '').trim();
                        if (/^\d{4,5}$/.test(period)) {
                            period = `${period.slice(0, period.length - 2)}年${period.slice(period.length - 2)}月`;
                        } else if (/^\d{6}$/.test(period)) {
                            period = `${period.slice(0, 4)}年${period.slice(4, 6)}月`;
                        }
                        if (period && !detectedPeriod) detectedPeriod = period;

                        revenueYoYCache[code] = {
                            yoy: yoyStr != null && yoyStr !== '-' && yoyStr !== 'N/A' ? parseFloat(String(yoyStr).replace(/,/g, '')) : null,
                            mom: momStr != null && momStr !== '-' && momStr !== 'N/A' ? parseFloat(String(momStr).replace(/,/g, '')) : null,
                            revenue: revStr != null && revStr !== '-' ? parseFloat(String(revStr).replace(/,/g, '')) : null,
                            period: period
                        };
                    }
                }
            }
        } catch (e) {
            console.error('[TWStock] 上市營收 YoY 抓取錯誤:', e);
        }

        // 2. 抓取上櫃公司月營收 (TPEx t187ap05_O)
        try {
            const tpexUrl = getApiUrl('/api/revenue-yoy?type=tpex');
            if (tpexUrl) {
                console.log(`[TWStock] Fetching TPEx Revenue YoY: ${tpexUrl}`);
                const resp = await fetchApi('/api/revenue-yoy?type=tpex');
                const list = resp.ok ? await resp.json() : null;
                if (Array.isArray(list)) {
                    for (const item of list) {
                        const code = String(item['公司代號'] || item['證券代號'] || item['Code'] || '').trim();
                        if (!code) continue;
                        const yoyStr = item['營業收入-去年同月增減(%)'] ?? item['去年同月增減(%)'] ?? item['去年同期增減(%)'];
                        const momStr = item['營業收入-上月比較增減(%)'] ?? item['上月比較增減(%)'];
                        const revStr = item['營業收入-當月營收'] ?? item['當月營收'];
                        const period = item['資料年月'] || item['出表日期'] || '';

                        revenueYoYCache[code] = {
                            yoy: yoyStr != null && yoyStr !== '-' && yoyStr !== 'N/A' ? parseFloat(String(yoyStr).replace(/,/g, '')) : null,
                            mom: momStr != null && momStr !== '-' && momStr !== 'N/A' ? parseFloat(String(momStr).replace(/,/g, '')) : null,
                            revenue: revStr != null && revStr !== '-' ? parseFloat(String(revStr).replace(/,/g, '')) : null,
                            period: period
                        };
                    }
                }
            }
        } catch (e) {
            console.error('[TWStock] 上櫃營收 YoY 抓取錯誤:', e);
        }

        revenueYoYPeriod = detectedPeriod;
        console.log(`[TWStock] 月營收 YoY 載入完成 (from API): ${Object.keys(revenueYoYCache).length} 檔 (${revenueYoYPeriod})`);

        if (Object.keys(revenueYoYCache).length > 0) {
            await putRecord('MarketCache', {
                code: '_GLOBAL_REVENUE_YOY',
                data: revenueYoYCache,
                lastPeriod: revenueYoYPeriod,
                lastUpdated: Date.now()
            }).catch(e => console.warn('[資料庫] 儲存月營收快取（_GLOBAL_REVENUE_YOY）失敗:', e));
        }
    } catch (e) {
        console.error('[TWStock] ensureRevenueYoYCache 發生錯誤:', e);
    }
    revenueYoYLoading = false;
}

export async function getRevenueYoYCacheInfo() {
    try {
        const dbCache = await getRecord('MarketCache', '_GLOBAL_REVENUE_YOY');
        if (dbCache) {
            return {
                lastUpdated: dbCache.lastUpdated || null,
                lastPeriod: dbCache.lastPeriod || '',
                count: dbCache.data ? Object.keys(dbCache.data).length : 0
            };
        }
    } catch (e) {
        console.warn('取得月營收快取資訊失敗 (getRevenueYoYCacheInfo)', e);
    }
    return { lastUpdated: null, lastPeriod: '', count: 0 };
}

// ===== 季報 EPS 快取 =====
let epsCache = null;
let epsLoading = false;
let epsPeriod = '';

export async function ensureEpsCache(force = false) {
    if (!force && epsCache) return;
    while (epsLoading) {
        await new Promise(r => setTimeout(r, 200));
    }
    if (!force && epsCache) return;
    epsLoading = true;
    try {
        if (!force) {
            try {
                const dbCache = await getRecord('MarketCache', '_GLOBAL_EPS');
                if (dbCache && dbCache.data) {
                    const age = Date.now() - (dbCache.lastUpdated || 0);
                    if (age < 24 * 60 * 60 * 1000) {
                        epsCache = dbCache.data;
                        epsPeriod = dbCache.lastPeriod || '';
                        console.log(`[TWStock] 季報 EPS 載入完成 (from DB): ${Object.keys(epsCache).length} 檔 (${epsPeriod})`);
                        epsLoading = false;
                        return;
                    }
                }
            } catch (e) {
                console.warn('[資料庫] 載入季報 EPS 快取（_GLOBAL_EPS）失敗:', e);
            }
        }

        epsCache = {};
        let detectedPeriod = '';

        // 1. 抓取上市公司綜合損益表 (TWSE t187ap14_L)
        try {
            const twseUrl = getApiUrl('/api/eps?type=twse');
            if (twseUrl) {
                console.log(`[TWStock] Fetching TWSE EPS: ${twseUrl}`);
                const resp = await fetchApi('/api/eps?type=twse');
                const list = resp.ok ? await resp.json() : null;
                if (Array.isArray(list)) {
                    for (const item of list) {
                        const code = String(item['公司代號'] || item['證券代號'] || item['Code'] || '').trim();
                        if (!code) continue;
                        const epsVal = item['基本每股盈餘（元）'] ?? item['基本每股盈餘(元)'] ?? item['基本每股盈餘'] ?? item['每股盈餘'] ?? item['EPS'];
                        const year = item['年度'] || '';
                        const quarter = item['季別'] || '';
                        const period = year && quarter ? `${year}Q${quarter}` : (item['出表日期'] || '');
                        if (period && !detectedPeriod) detectedPeriod = String(period).trim();

                        epsCache[code] = {
                            eps: epsVal != null && epsVal !== '-' && epsVal !== 'N/A' ? parseFloat(String(epsVal).replace(/,/g, '')) : null,
                            year,
                            quarter,
                            period
                        };
                    }
                }
            }
        } catch (e) {
            console.error('[TWStock] 上市 EPS 抓取錯誤:', e);
        }

        // 2. 抓取上櫃公司綜合損益表 (TPEx t187ap14_O)
        try {
            const tpexUrl = getApiUrl('/api/eps?type=tpex');
            if (tpexUrl) {
                console.log(`[TWStock] Fetching TPEx EPS: ${tpexUrl}`);
                const resp = await fetchApi('/api/eps?type=tpex');
                const list = resp.ok ? await resp.json() : null;
                if (Array.isArray(list)) {
                    for (const item of list) {
                        const code = String(item['公司代號'] || item['證券代號'] || item['Code'] || '').trim();
                        if (!code) continue;
                        const epsVal = item['基本每股盈餘（元）'] ?? item['基本每股盈餘(元)'] ?? item['基本每股盈餘'] ?? item['每股盈餘'] ?? item['EPS'];
                        const year = item['年度'] || '';
                        const quarter = item['季別'] || '';
                        const period = year && quarter ? `${year}Q${quarter}` : (item['出表日期'] || '');

                        epsCache[code] = {
                            eps: epsVal != null && epsVal !== '-' && epsVal !== 'N/A' ? parseFloat(String(epsVal).replace(/,/g, '')) : null,
                            year,
                            quarter,
                            period
                        };
                    }
                }
            }
        } catch (e) {
            console.error('[TWStock] 上櫃 EPS 抓取錯誤:', e);
        }

        epsPeriod = detectedPeriod;
        console.log(`[TWStock] 季報 EPS 載入完成 (from API): ${Object.keys(epsCache).length} 檔 (${epsPeriod})`);

        if (Object.keys(epsCache).length > 0) {
            await putRecord('MarketCache', {
                code: '_GLOBAL_EPS',
                data: epsCache,
                lastPeriod: epsPeriod,
                lastUpdated: Date.now()
            }).catch(e => console.warn('[資料庫] 儲存季報 EPS 快取（_GLOBAL_EPS）失敗:', e));
        }
    } catch (e) {
        console.error('[TWStock] ensureEpsCache 發生錯誤:', e);
    }
    epsLoading = false;
}

export async function getEpsCacheInfo() {
    try {
        const dbCache = await getRecord('MarketCache', '_GLOBAL_EPS');
        if (dbCache) {
            return {
                lastUpdated: dbCache.lastUpdated || null,
                lastPeriod: dbCache.lastPeriod || '',
                count: dbCache.data ? Object.keys(dbCache.data).length : 0
            };
        }
    } catch (e) {
        console.warn('取得 EPS 快取資訊失敗 (getEpsCacheInfo)', e);
    }
    return { lastUpdated: null, lastPeriod: '', count: 0 };
}

// ===== 民國日期轉換=====
function rocSlashDateToISO(rocDate) {
    const m = rocDate.trim().match(/^(\d+)\/(\d+)\/(\d+)$/);
    if (!m) return null;
    const year = 1911 + parseInt(m[1], 10);
    const month = m[2].padStart(2, '0');
    const day = m[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ===== K 線圖資料=====
async function fetchTseDaily(code, yyyymm) {
// [POST 隱藏] 已改用 fetchApi() 直接呼叫
    try {
        const resp = await fetchApi(`/api/twse-daily?date=${yyyymm}01&stockNo=${encodeURIComponent(code)}`);
        if (!resp.ok) return [];
        const data = await resp.json();
        if (data?.stat !== 'OK' || !Array.isArray(data?.data)) return [];
        const points = [];
        for (const row of data.data) {
            const dateISO = rocSlashDateToISO(row[0]);
            if (!dateISO) continue;
            const open = parseNum(row[3]);
            const high = parseNum(row[4]);
            const low = parseNum(row[5]);
            const close = parseNum(row[6]);
            const volume = parseIntSafe(row[1]);
            if (open == null || high == null || low == null || close == null) continue;
            points.push({ date: dateISO, open, high, low, close, volume });
        }
        return points;
    } catch {
        return [];
    }
}

async function fetchTpexDaily(code, yyyymm) {
    const rocYear = parseInt(yyyymm.slice(0, 4), 10) - 1911;
    const month = yyyymm.slice(4, 6);
    const rocDate = `${rocYear}/${month}`;
// [POST 隱藏] 已改用 fetchApi() 直接呼叫
    try {
        const resp = await fetchApi(`/api/tpex-daily?d=${encodeURIComponent(rocDate)}&stkno=${encodeURIComponent(code)}`);
        if (!resp.ok) return [];
        const data = await resp.json();
        if (!Array.isArray(data?.aaData)) return [];
        const points = [];
        for (const row of data.aaData) {
            const dateISO = rocSlashDateToISO(row[0]);
            if (!dateISO) continue;
            const open = parseNum(row[3]);
            const high = parseNum(row[4]);
            const low = parseNum(row[5]);
            const close = parseNum(row[6]);
            const volume = parseIntSafe(row[1]);
            if (open == null || high == null || low == null || close == null) continue;
            points.push({ date: dateISO, open, high, low, close, volume });
        }
        return points;
    } catch {
        return [];
    }
}

// ===== K 線多月合併=====
async function fetchKlineMultiMonths(code, exchange, months) {
    let points = null;
    if (settings.klineSource === 'yahoo') {
        try {
            const symbol = exchange === 'otc' ? `${code}.TWO` : `${code}.TW`;
// [POST 隱藏] 已改用 fetchApi() 直接呼叫
            const res = await fetchApi(`/api/quote?code=${symbol}&interval=1d&range=${months}mo`);
            if (res.ok) {
                const data = await res.json();
                const result = data?.chart?.result?.[0];
                const timestamps = result?.timestamp || [];
                const quote = result?.indicators?.quote?.[0] || {};
                const yahooPoints = [];
                for (let i = 0; i < timestamps.length; i++) {
                    if (quote.close[i] !== null) {
                        const d = new Date(timestamps[i] * 1000);
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, '0');
                        const day = String(d.getDate()).padStart(2, '0');
                        yahooPoints.push({
                            date: `${y}-${m}-${day}`,
                            open: quote.open[i],
                            high: quote.high[i],
                            low: quote.low[i],
                            close: quote.close[i],
                            volume: quote.volume[i]
                        });
                    }
                }
                points = yahooPoints;
            }
        } catch(e) {
            console.error('[Yahoo] 抓取歷史 K 線錯誤', e);
        }
    }
    
    if (!points) {
    // Official TWSE/TPEx (Fallback)
    const now = new Date();
    const ymList = [];
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        ymList.push(`${y}${m}`);
    }

    // 先嘗試上市
    const tseResults = await Promise.all(ymList.map(ym => fetchTseDaily(code, ym).catch(() => [])));
    let merged = tseResults.flat();
    if (merged.length === 0) {
        // 上市無資料 → 嘗試上櫃
        const tpexResults = await Promise.all(ymList.map(ym => fetchTpexDaily(code, ym).catch(() => [])));
        merged = tpexResults.flat();
    }

    // 去重 + 依日期排序
    const map = new Map();
    for (const p of merged) {
        if (!map.has(p.date)) map.set(p.date, p);
    }
    points = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
    return points;
}

// ===== 當日走勢=====
async function fetchYahooChart(symbol) {

// [POST 隱藏] 已改用 fetchApi() 直接呼叫
    try {
        const resp = await fetchApi(`/api/quote?code=${symbol}&interval=1m&range=1d`);
        if (!resp.ok) return null;
        const data = await resp.json();
        const r = data?.chart?.result?.[0];
        if (!r || !Array.isArray(r.timestamp)) return null;
        const closes = r.indicators?.quote?.[0]?.close;
        if (!Array.isArray(closes)) return null;
        const points = [];
        for (let i = 0; i < r.timestamp.length; i++) {
            const t = r.timestamp[i];
            const c = closes[i];
            if (typeof t === 'number' && typeof c === 'number' && Number.isFinite(c)) {
                points.push({ time: t, value: c });
            }
        }
        return points;
    } catch {
        return null;
    }
}

// ===== 公開 API：取得圖表資料 =====
export async function getChartData(code, exchange) {
    // ===== 技術線圖：改用 TWSE/TPEx 官方日K 資料=====
    let techData = [];
    try {
        const points = await fetchKlineMultiMonths(code, exchange, 6);
        techData = points.map(p => ({
            time: p.date, // Lightweight Charts 接受 "YYYY-MM-DD" 字串
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
            value: p.close // for volume/line if needed
        }));
    } catch (e) {
        console.error('Failed to fetch technical chart data', e);
    }


    // ===== 當日走勢：Yahoo Finance Chart=====
    let intradayData = [];
    const symbols = exchange === 'otc' ? [`${code}.TWO`, `${code}.TW`] : [`${code}.TW`, `${code}.TWO`];
    for (const sym of symbols) {
        const points = await fetchYahooChart(sym).catch(() => null);
        if (points && points.length > 0) {
            intradayData = points;
            break;
        }
    }

    return { technical: techData, intraday: intradayData };
}

// ===== 籌碼面資料抓取與儲存 (Phase 4) =====

export async function downloadChipsData(startDate, endDate, onProgress, force = false) {
    const dates = [];
    let d = new Date(startDate);
    const end = new Date(endDate);
    while (d <= end) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    
    let currentCount = 0;
    const totalCount = dates.length;

    for (const date of dates) {
        currentCount++;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        const dateStrTWSE = `${y}${m}${day}`; // YYYYMMDD
        const dateStrTPEx = `${y - 1911}/${m}/${day}`; // YYY/MM/DD
        const isoDate = `${y}-${m}-${day}`;
        
        if (onProgress) onProgress(currentCount, totalCount, isoDate);
        
        try {
            // 檢查是否為官方行事曆休市日 (如國定假日、春節、颱風假等)
            const isBusinessDay = isTaiwanBusinessDay(isoDate);
            if (!force && !isBusinessDay) {
                console.log(`[Chips] ${isoDate} 跳過抓取 (官方行事曆休市日/非營業日)`);
                continue;
            }

            // 檢查是否已經抓取過這天的資料
            const meta = await getRecord('ChipsCache', 'META_DATE_' + isoDate);

            // 智慧判斷：只有「明確標記缺少融資融券 (hasMargin === false)」且有法人資料的日期才需要單獨補抓
            if (!force && meta && meta.fetched && meta.count > 0 && meta.version === 2 && meta.hasMargin === false) {
                console.log(`[Chips] ${isoDate} 偵測到缺少融資融券，自動補抓中...`);
                if (onProgress) onProgress(currentCount, totalCount, isoDate + ' (補抓融資融券)');
                const patched = await patchMarginForDate(dateStrTWSE, dateStrTPEx, isoDate);
                await putRecord('ChipsCache', { ...meta, hasMargin: patched });
                if (patched) {
                    console.log(`[Chips] ${isoDate} ✅ 融資融券補抓成功`);
                } else {
                    console.log(`[Chips] ${isoDate} ⏳ 融資融券資料尚未公佈`);
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
                continue;
            }

            // 判斷是否為有效完整快取（hasMargin 為 true，或舊有歷史快取 count > 0 且非 hasMargin === false）
            const isFullyCached = meta && meta.fetched && meta.count > 0 && meta.version === 2 && meta.hasMargin !== false;

            // 若已有完整快取且不強制更新，則直接跳過
            if (!force && isFullyCached) {
                console.log(`[Chips] ${isoDate} 跳過抓取 (已有完整有效快取)`);
                continue;
            }

            console.log(`[Chips] 正在抓取 ${isoDate} 籌碼資料... (請稍候)`);
            const { count: recordCount, hasMargin } = await fetchAndStoreChipsForDate(dateStrTWSE, dateStrTPEx, isoDate);
            
            // 標記為已抓取，並記錄筆數與融資融券狀態（營業日即便無資料亦絕不隨意標記為休市日）
            await putRecord('ChipsCache', { 
                id: 'META_DATE_' + isoDate, 
                fetched: true, 
                timestamp: Date.now(), 
                count: recordCount, 
                version: 2, 
                hasMargin: hasMargin,
                isHoliday: false
            });

            if (recordCount === 0) {
                if (isoDate === todayStr) {
                    console.log(`[Chips] ${isoDate} 本日籌碼資料尚未公佈 (0 筆)`);
                } else {
                    console.log(`[Chips] ${isoDate} 營業日查無市場資料 (0 筆)`);
                }
            } else {
                const marginStatusText = hasMargin ? '' : ' (融資融券稍晚公佈)';
                console.log(`[Chips] ${isoDate} 籌碼抓取完成，共 ${recordCount} 筆${marginStatusText}`);
            }

            // 避免短時間發送大量請求被 API 阻擋，加入 1.5 秒延遲
            await new Promise(resolve => setTimeout(resolve, 1500));
        } catch(e) {
            console.error(`[Chips] Error fetching for ${isoDate}:`, e);
        }
    }
    
    return {};
}

async function fetchAndStoreChipsForDate(twseDate, tpexDate, isoDate) {
    const p1 = fetchApi(`/api/twse-inst?date=${twseDate}`).then(r=>r.json()).catch(()=>null);
    const p2 = fetchApi(`/api/twse-margin?date=${twseDate}`).then(r=>r.json()).catch(()=>null);
    const p3 = fetchApi(`/api/tpex-inst?d=${tpexDate}`).then(r=>r.json()).catch(()=>null);
    const p4 = fetchApi(`/api/tpex-margin?d=${tpexDate}`).then(r=>r.json()).catch(()=>null);
    
    const [twseInst, twseMargin, tpexInst, tpexMargin] = await Promise.all([p1, p2, p3, p4]);
    
    const dailyData = {}; // map code -> { inst, margin }
    
    // Parse TWSE Inst (T86)
    if (twseInst?.stat === 'OK' && Array.isArray(twseInst.data)) {
        for (const row of twseInst.data) {
            const code = row[0].trim();
            // T86 columns: 0:Code, 4:Foreign(外資買賣超), 10:Trust(投信買賣超), 11:Dealer(自營商買賣超合計)
            const foreign = parseNum(row[4]) || 0;
            const trust = parseNum(row[10]) || 0;
            const dealer = parseNum(row[11]) || 0;
            if (!dailyData[code]) dailyData[code] = { inst: null, margin: null };
            dailyData[code].inst = { foreign, trust, dealer };
        }
    }
    
    // Parse TWSE Margin (MI_MARGN)
    const twseMarginData = twseMargin?.data || (twseMargin?.tables ? twseMargin.tables[1].data : null);
    if (twseMargin?.stat === 'OK' && Array.isArray(twseMarginData)) {
        for (const row of twseMarginData) {
            const code = row[0].trim();
            // MI_MARGN columns: 0:Code, 1:Name, 2:MarginBuy, 3:MarginSell, 6:MarginBalance, 8:ShortBuy, 9:ShortSell, 12:ShortBalance
            const marginBuy = parseNum(row[2]) || 0;
            const marginSell = parseNum(row[3]) || 0;
            const marginBal = parseNum(row[6]) || 0;
            const shortBuy = parseNum(row[8]) || 0;
            const shortSell = parseNum(row[9]) || 0;
            const shortBal = parseNum(row[12]) || 0;
            if (!dailyData[code]) dailyData[code] = { inst: null, margin: null };
            dailyData[code].margin = { marginBuy, marginSell, marginBal, shortBuy, shortSell, shortBal };
        }
    }
    
    // Parse TPEx Inst
    const tpexInstData = tpexInst?.tables?.[0]?.data || tpexInst?.aaData;
    if (tpexInstData && Array.isArray(tpexInstData)) {
        for (const row of tpexInstData) {
            const code = row[0].trim();
            // 3itrade_hedge columns: 0:Code, 10:Foreign(外資買賣超), 13:Trust(投信買賣超)
            // If new format (tables), Dealer is 22. If old (aaData), it was 23.
            const isNewFormat = !!tpexInst?.tables;
            const foreign = parseNum(row[10]) || 0;
            const trust = parseNum(row[13]) || 0;
            const dealer = parseNum(row[isNewFormat ? 22 : 23]) || 0;
            if (!dailyData[code]) dailyData[code] = { inst: null, margin: null };
            dailyData[code].inst = { foreign, trust, dealer };
        }
    }
    
    // Parse TPEx Margin
    const tpexMarginData = tpexMargin?.tables?.[0]?.data || tpexMargin?.aaData;
    if (tpexMarginData && Array.isArray(tpexMarginData)) {
        for (const row of tpexMarginData) {
            const code = row[0].trim();
            const isNewFormat = !!tpexMargin?.tables;
            let marginBuy, marginSell, marginBal, shortBuy, shortSell, shortBal;
            if (isNewFormat) {
                // New format: 3:資買, 4:資賣, 6:資餘額, 12:券買, 11:券賣, 14:券餘額
                marginBuy = parseNum(row[3]) || 0;
                marginSell = parseNum(row[4]) || 0;
                marginBal = parseNum(row[6]) || 0;
                shortBuy = parseNum(row[12]) || 0;
                shortSell = parseNum(row[11]) || 0;
                shortBal = parseNum(row[14]) || 0;
            } else {
                marginBuy = parseNum(row[2]) || 0;
                marginSell = parseNum(row[3]) || 0;
                marginBal = parseNum(row[5]) || 0;
                shortBuy = parseNum(row[8]) || 0;
                shortSell = parseNum(row[9]) || 0;
                shortBal = parseNum(row[11]) || 0;
            }
            if (!dailyData[code]) dailyData[code] = { inst: null, margin: null };
            dailyData[code].margin = { marginBuy, marginSell, marginBal, shortBuy, shortSell, shortBal };
        }
    }
    
    // 判斷是否有融資融券資料（至少要有一筆 margin 非 null）
    let hasMargin = false;
    for (const data of Object.values(dailyData)) {
        if (data.margin && (data.margin.marginBal > 0 || data.margin.shortBal > 0 || data.margin.marginBuy > 0 || data.margin.marginSell > 0)) {
            hasMargin = true;
            break;
        }
    }

    // Save to DB
    let count = 0;
    for (const [code, data] of Object.entries(dailyData)) {
        const record = {
            id: `${code}_${isoDate}`,
            code: code,
            date: isoDate,
            inst: data.inst,
            margin: data.margin
        };
        await putRecord('ChipsCache', record).catch(e => console.warn(`Failed to put chip record ${record.id}`, e));
        count++;
    }
    return { count, hasMargin };
}

// 只補抓融資融券資料，合併到既有的三大法人記錄中
async function patchMarginForDate(twseDate, tpexDate, isoDate) {
    const p1 = fetchApi(`/api/twse-margin?date=${twseDate}`).then(r=>r.json()).catch(()=>null);
    const p2 = fetchApi(`/api/tpex-margin?d=${tpexDate}`).then(r=>r.json()).catch(()=>null);
    const [twseMargin, tpexMargin] = await Promise.all([p1, p2]);

    const marginMap = {};

    // Parse TWSE Margin
    const twseMarginData = twseMargin?.data || (twseMargin?.tables ? twseMargin.tables[1].data : null);
    if (twseMargin?.stat === 'OK' && Array.isArray(twseMarginData)) {
        for (const row of twseMarginData) {
            const code = row[0].trim();
            marginMap[code] = {
                marginBuy: parseNum(row[2]) || 0, marginSell: parseNum(row[3]) || 0,
                marginBal: parseNum(row[6]) || 0, shortBuy: parseNum(row[8]) || 0,
                shortSell: parseNum(row[9]) || 0, shortBal: parseNum(row[12]) || 0
            };
        }
    }

    // Parse TPEx Margin
    const tpexMarginData = tpexMargin?.tables?.[0]?.data || tpexMargin?.aaData;
    if (tpexMarginData && Array.isArray(tpexMarginData)) {
        for (const row of tpexMarginData) {
            const code = row[0].trim();
            const isNewFormat = !!tpexMargin?.tables;
            
            if (isNewFormat) {
                marginMap[code] = {
                    marginBuy: parseNum(row[3]) || 0, marginSell: parseNum(row[4]) || 0,
                    marginBal: parseNum(row[6]) || 0, shortBuy: parseNum(row[12]) || 0,
                    shortSell: parseNum(row[11]) || 0, shortBal: parseNum(row[14]) || 0
                };
            } else {
                marginMap[code] = {
                    marginBuy: parseNum(row[2]) || 0, marginSell: parseNum(row[3]) || 0,
                    marginBal: parseNum(row[5]) || 0, shortBuy: parseNum(row[8]) || 0,
                    shortSell: parseNum(row[9]) || 0, shortBal: parseNum(row[11]) || 0
                };
            }
        }
    }

    if (Object.keys(marginMap).length === 0) return false;

    // 合併到既有記錄（若無法人記錄亦新增）
    let patchCount = 0;
    for (const [code, margin] of Object.entries(marginMap)) {
        const existing = await getRecord('ChipsCache', `${code}_${isoDate}`);
        if (existing) {
            existing.margin = margin;
            await putRecord('ChipsCache', existing);
        } else {
            await putRecord('ChipsCache', {
                id: `${code}_${isoDate}`,
                code: code,
                date: isoDate,
                inst: null,
                margin: margin
            });
        }
        patchCount++;
    }
    console.log(`[Chips] ${isoDate} 融資融券補丁完成，更新 ${patchCount} 筆`);
    return true;
}

export async function getChipsDataForCode(code, limit = 30) {
    const { getRecordsByIndex } = await import('../db.js');
    const codeRecords = await getRecordsByIndex('ChipsCache', 'code', code);
    
    // Sort by date descending
    codeRecords.sort((a, b) => b.date.localeCompare(a.date));
        
    return limit ? codeRecords.slice(0, limit) : codeRecords;
}

// ===== 取得歷史 K 線報價（用於籌碼圖表收盤價疊加） =====
export async function getHistoricalKLine(code, exch = 'tse', range = '6mo') {
    const symbol = exch === 'otc' ? `${code}.TWO` : `${code}.TW`;

// [POST 隱藏] 已改用 fetchApi() 直接呼叫
    try {
        const res = await fetchApi(`/api/quote?code=${symbol}&interval=1d&range=${range}`);
        if (!res.ok) return [];
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) return [];
        
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        
        const kline = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] != null) {
                const date = new Date(timestamps[i] * 1000);
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                kline.push({
                    date: dateStr,
                    close: closes[i]
                });
            }
        }
        return kline;
    } catch (e) {
        console.error(`[Yahoo] Error fetching historical KLine:`, e.message);
        return [];
    }
}

export async function syncLatestChipsData() {
    const now = new Date();
    // 依使用者要求：只抓取前一天和當天的資料 (降低迴圈檢查數量)
    // 若需抓取更早之前的歷史籌碼，使用者會透過設定頁面下載
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    // 隱式呼叫，不顯示進度條
    await downloadChipsData(oneDayAgo, now, null, false);
    
    // 更新設定中的全域最後抓取時間
    const info = await getLastChipsUpdateInfo();
    const isoNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    settings.chipsLastDownload = {
        endDate: info ? info.date : isoNow,
        timestamp: Date.now()
    };
    saveSettings();
}

export function isQuoteDataUpToDate(lastUpdatedTimestamp) {
    if (!lastUpdatedTimestamp) return false;
    const now = new Date();
    const lastUpdated = new Date(lastUpdatedTimestamp);
    
    // 如果現在是營業日的盤中時間 (09:00 - 13:45)，永遠不視為「已是最新」，強制需要更新
    const timeValue = now.getHours() * 100 + now.getMinutes();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isTodayBusinessDay = isTaiwanBusinessDay(todayIso);
    if (isTodayBusinessDay && timeValue >= 900 && timeValue < 1345) {
        return false;
    }
    
    // 找出最近一次的收盤時間 (設定為 13:45 確保盤後零股與最後資料都穩定)
    let recentClose = new Date(now);
    recentClose.setHours(13, 45, 0, 0); 
    
    if (now.getDay() === 0 || now.getDay() === 6) { 
        // 週末 -> 退回上週五的 13:45
        const daysToSubtract = now.getDay() === 0 ? 2 : 1; 
        recentClose.setDate(recentClose.getDate() - daysToSubtract);
    } else if (now.getTime() < recentClose.getTime()) {
        // 平日，但現在時間還沒到今天的收盤時間 -> 退回上一個交易日的 13:45
        let daysToSubtract = 1;
        if (now.getDay() === 1) daysToSubtract = 3; // 星期一 -> 星期五
        recentClose.setDate(recentClose.getDate() - daysToSubtract);
    }
    
    // 如果快取的最後更新時間，比「最近一次收盤時間」還要晚，代表資料已經是最新的
    return lastUpdated.getTime() >= recentClose.getTime();
}

// ===== Market Data IndexedDB Sync (Phase 5) =====
export async function syncStockData(code, updateMode = 'GLOBAL') {
    // 智慧判斷：如果資料已經涵蓋最新收盤時間後，就無須再次下載
    // (因應按鈕分層，不再判斷是否為手動，盤後一律智慧略過)
    const cached = await loadStockDataFromCache(code);
    if (cached && isQuoteDataUpToDate(cached.lastUpdated)) {
        return cached;
    }

    const forceBulk = (updateMode === 'GLOBAL');
    const quote = await getQuoteForCode(code, forceBulk);
    if (!quote || quote.status === 'error') {
        return null;
    }
    
    const exch = quote.exchange || 'tse';
    
    // fetch charts and kline
    const charts = await getChartData(code, exch);
    
    let histKLine = cached ? cached.historicalChipsKLine : [];
    const fetchKline = (updateMode === 'GLOBAL' || updateMode === 'GROUP' || updateMode === 'AUTO');
    
    if (fetchKline) {
        histKLine = await getHistoricalKLine(code, exch, '6mo') || [];
    }
    
    const record = {
        code: code,
        quote: quote,
        intraday: charts.intraday || [],
        technical: charts.technical || [],
        historicalChipsKLine: histKLine || [],
        lastUpdated: Date.now()
    };
    
    await putRecord('MarketCache', record);
    return record;
}

export async function loadStockDataFromCache(code) {
    return await getRecord('MarketCache', code);
}

export async function getLastChipsUpdateInfo() {
    // 快速路徑：往前回溯 60 天，通常更新日期都在這幾天內
    const now = new Date();
    for (let i = 0; i < 60; i++) {
        const d = new Date(now.getTime() - i * 86400000);
        const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const meta = await getRecord('ChipsCache', 'META_DATE_' + isoDate);
        if (meta && meta.fetched === true && meta.count > 0) {
            return {
                date: isoDate,
                timestamp: meta.timestamp || null
            };
        }
    }

    // 退避方案：如果前 60 天都沒資料，再呼叫 getAllKeys 找尋歷史
    const { getAllKeys } = await import('../db.js');
    const allKeys = await getAllKeys('ChipsCache');
    
    // 過濾出 META_DATE_ 開頭的 key，並由大到小排序 (最新日期在前)
    const metaKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith('META_DATE_'));
    if (metaKeys.length === 0) return null;
    metaKeys.sort().reverse();
    
    // 依序檢查最新的 key，找到第一個有實際抓到資料的 (count > 0)
    for (const key of metaKeys) {
        const meta = await getRecord('ChipsCache', key);
        if (meta && meta.fetched === true && meta.count > 0) {
            return {
                date: key.replace('META_DATE_', ''),
                timestamp: meta.timestamp || null
            };
        }
    }
    return null;
}
