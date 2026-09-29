import { settings } from '../store.js';

/**
 * 從富果 Fugle API 取得即時報價
 */
export async function fetchQuoteFromFugle(code) {
    const token = settings.fugleToken;
    if (!token) return null;
    
    // 只取數字代碼 (如 2330.TW -> 2330)
    const symbol = code.split('.')[0];

    try {
        const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${symbol}`;
        const res = await fetch(url, {
            headers: {
                'X-API-KEY': token
            },
            signal: AbortSignal.timeout(5000)
        });
        
        if (!res.ok) {
            console.warn(`[Fugle] Quote API Error for ${symbol}: ${res.status}`);
            return null;
        }

        const data = await res.json();
        if (!data || data.closePrice == null) return null;

        // Fugle 的 timestamp 可能是毫秒 (13位) 或微秒 (16位)
        const ts = data.lastTrade?.time || data.lastUpdated;
        let timeStr = '';
        if (ts) {
            const ms = ts > 10000000000000 ? Math.floor(ts / 1000) : ts;
            const d = new Date(ms);
            timeStr = d.toLocaleTimeString('zh-TW', { hour12: false });
        }

        return {
            price: data.closePrice,
            open: data.openPrice,
            high: data.highPrice,
            low: data.lowPrice,
            yesterday: data.referencePrice || data.previousClose,
            change: data.change,
            changePercent: data.changePercent,
            volume: data.total?.tradeVolume || 0,
            quoteDate: data.date.replace(/[-/]/g, ''), // 轉換為 YYYYMMDD 格式
            tradeTime: timeStr,
            peRatio: null,
            dividendYield: null,
            eps: null,
            revenueYoY: null,
            status: 'ok',
            _source: 'fugle'
        };

    } catch (e) {
        console.error(`[Fugle] Exception fetchQuoteFromFugle ${symbol}:`, e);
        return null;
    }
}

/**
 * 從富果 Fugle API 取得歷史 K 線
 */
export async function fetchHistoricalKLineFromFugle(code) {
    const token = settings.fugleToken;
    if (!token) return null;
    
    const symbol = code.split('.')[0];

    try {
        const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${symbol}?timeframe=D`;
        const res = await fetch(url, {
            headers: {
                'X-API-KEY': token
            },
            signal: AbortSignal.timeout(5000)
        });
        
        if (!res.ok) {
            console.warn(`[Fugle] KLine API Error for ${symbol}: ${res.status}`);
            return null;
        }

        const json = await res.json();
        const data = json.data;
        if (!data || !Array.isArray(data)) return null;

        const kline = [];
        // Fugle 的資料順序由新到舊，反轉以符合舊有系統
        for (let i = data.length - 1; i >= 0; i--) {
            if (data[i].close != null) {
                kline.push({
                    date: data[i].date.replace(/\//g, '-'),
                    close: data[i].close
                });
            }
        }

        return kline;

    } catch (e) {
        console.error(`[Fugle] Exception fetchHistoricalKLineFromFugle ${symbol}:`, e);
        return null;
    }
}
