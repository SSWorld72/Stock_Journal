const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 8080;

const originalLog = console.log;
const originalError = console.error;
function getTimeString() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `[${yyyy}${mm}${dd} ${hh}:${min}:${ss}]`;
}
console.log = function(...args) { originalLog(getTimeString(), ...args); };
console.error = function(...args) { originalError(getTimeString(), ...args); };

const server = http.createServer((req, res) => {
    // Add CORS headers to allow browser fetch
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    // API Endpoint
    if (parsedUrl.pathname === '/api/quote') {
        const symbol = parsedUrl.searchParams.get('code'); // e.g. "2330.TW"
        const range = parsedUrl.searchParams.get('range') || '1d';
        const interval = parsedUrl.searchParams.get('interval') || '1d';
        
        if (!symbol) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing code parameter' }));
            return;
        }

        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
        console.log(`[代理] 正在抓取即時報價 (from Yahoo Finance API): ${targetUrl}`);

        fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            }
        })
        .then(r => r.text())
        .then(text => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(text);
        })
        .catch(err => {
            console.error(`[代理] 抓取即時報價發生錯誤 (from Yahoo Finance API):`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        
        return;
    }

    if (parsedUrl.pathname === '/api/twse-quote') {
        const code = parsedUrl.searchParams.get('code'); // e.g. "tse_2330.tw"
        const targetUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${code}&json=1&delay=0&_=${Date.now()}`;
        console.log(`[代理] 正在抓取上市即時報價 (from 台灣證券交易所 API): ${code}`);
        fetch(targetUrl, {
            headers: {
                'Referer': 'https://mis.twse.com.tw/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })
        .then(r => r.json())
        .then(data => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        })
        .catch(err => {
            console.error(`[代理] 抓取上市即時報價失敗 (from 台灣證券交易所 API) [${code}]:`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        return;
    }

    if (parsedUrl.pathname === '/api/names') {
        const type = parsedUrl.searchParams.get('type') || 'twse';
        const targetUrl = type === 'twse' 
            ? 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
            : 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
        
        fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            }
        })
        .then(r => r.text())
        .then(text => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(text);
        })
        .catch(err => {
            console.error(`[代理] 抓取代碼清單失敗 (from 台灣證券交易所/櫃買中心 API):`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        
        return;
    }

    if (parsedUrl.pathname === '/api/industry') {
        const type = parsedUrl.searchParams.get('type') || 'twse';
        const targetUrl = type === 'twse' 
            ? 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
            : 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
        
        console.log(`[代理] 正在抓取產業分類 (from 台灣證券交易所/櫃買中心 API) (${type}): ${targetUrl}`);
        fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })
        .then(r => r.text())
        .then(text => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(text);
        })
        .catch(err => {
            console.error(`[代理] 抓取產業分類失敗 (from 台灣證券交易所/櫃買中心 API):`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        
        return;
    }

    // 月營業收入彙總表 (YoY)
    if (parsedUrl.pathname === '/api/revenue-yoy') {
        const type = parsedUrl.searchParams.get('type') || 'twse';
        const targetUrl = type === 'twse'
            ? 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
            : 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O';
        
        console.log(`[代理] 正在抓取月營收 YoY (from 台灣證券交易所/櫃買中心 API) (${type}): ${targetUrl}`);
        fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })
        .then(r => r.text())
        .then(text => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(text);
        })
        .catch(err => {
            console.error(`[代理] 抓取月營收 YoY 失敗 (from 台灣證券交易所/櫃買中心 API) (${type}):`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        
        return;
    }

    // 綜合損益表 (EPS)
    if (parsedUrl.pathname === '/api/eps') {
        const type = parsedUrl.searchParams.get('type') || 'twse';
        const targetUrl = type === 'twse'
            ? 'https://openapi.twse.com.tw/v1/opendata/t187ap14_L'
            : 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O';
        
        console.log(`[代理] 正在抓取季報 EPS (from 台灣證券交易所/櫃買中心 API) (${type}): ${targetUrl}`);
        fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })
        .then(r => r.text())
        .then(text => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(text);
        })
        .catch(err => {
            console.error(`[代理] 抓取季報 EPS 失敗 (from 台灣證券交易所/櫃買中心 API) (${type}):`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });
        
        return;
    }

    // 上市歷史日 K 線（TWSE STOCK_DAY）
    if (parsedUrl.pathname === '/api/twse-daily') {
        const date = parsedUrl.searchParams.get('date');
        const stockNo = parsedUrl.searchParams.get('stockNo');
        const targetUrl = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(stockNo)}`;
        console.log(`[代理] 正在抓取上市歷史日 K 線 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.twse.com.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上櫃歷史日 K 線（TPEx st43）
    if (parsedUrl.pathname === '/api/tpex-daily') {
        const d = parsedUrl.searchParams.get('d');
        const stkno = parsedUrl.searchParams.get('stkno');
        const targetUrl = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${encodeURIComponent(d)}&stkno=${encodeURIComponent(stkno)}`;
        console.log(`[代理] 正在抓取上櫃歷史日 K 線 (from 櫃買中心 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tpex.org.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上市籌碼：三大法人 (T86)
    if (parsedUrl.pathname === '/api/twse-inst') {
        const date = parsedUrl.searchParams.get('date');
        const targetUrl = `https://www.twse.com.tw/fund/T86?response=json&date=${date}&selectType=ALL`;
        console.log(`[代理] 正在抓取上市三大法人買賣超 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上市籌碼：融資融券餘額 (MI_MARGN)
    if (parsedUrl.pathname === '/api/twse-margin') {
        const date = parsedUrl.searchParams.get('date');
        const targetUrl = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=ALL`;
        console.log(`[代理] 正在抓取上市融資融券餘額 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上櫃籌碼：三大法人 (3itrade_hedge)
    if (parsedUrl.pathname === '/api/tpex-inst') {
        const d = parsedUrl.searchParams.get('d');
        const targetUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(d)}`;
        console.log(`[代理] 正在抓取上櫃三大法人買賣超 (from 櫃買中心 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上櫃籌碼：融資融券餘額 (margin_bal)
    if (parsedUrl.pathname === '/api/tpex-margin') {
        const d = parsedUrl.searchParams.get('d');
        const targetUrl = `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${encodeURIComponent(d)}`;
        console.log(`[代理] 正在抓取上櫃融資融券餘額 (from 櫃買中心 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // Yahoo Finance 歷史 K 線
    if (parsedUrl.pathname === '/api/historical') {
        const code = parsedUrl.searchParams.get('code');
        const range = parsedUrl.searchParams.get('range') || '6mo';
        const interval = parsedUrl.searchParams.get('interval') || '1d';
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}?interval=${interval}&range=${range}`;
        console.log(`[代理] 正在抓取歷史 K 線 (from Yahoo Finance API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 本益比 / 殖利率（TWSE BWIBBU）
    if (parsedUrl.pathname === '/api/bwibbu') {
        const date = parsedUrl.searchParams.get('date');
        const targetUrl = `https://www.twse.com.tw/exchangeReport/BWIBBU_d?response=json&date=${date}&selectType=ALL`;
        console.log(`[代理] 正在抓取上市本益比/殖利率 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.twse.com.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上櫃 本益比 / 殖利率 (TPEx peratio_analysis)
    if (parsedUrl.pathname === '/api/tpex-peratio') {
        const date = parsedUrl.searchParams.get('date'); // YYYY/MM/DD (民國年)
        const targetUrl = `https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php?l=zh-tw&d=${date}&o=json`;
        console.log(`[代理] 正在抓取上櫃本益比/殖利率 (from 櫃買中心 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tpex.org.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // ETF 即時預估淨值 (TWSE all_etf.txt)
    if (parsedUrl.pathname === '/api/etf-nav') {
        const targetUrl = 'https://mis.twse.com.tw/stock/data/all_etf.txt';
        console.log(`[代理] 正在抓取 ETF 即時預估淨值 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上市三大法人買賣超 (TWSE T86)
    if (parsedUrl.pathname === '/api/twse-inst') {
        const date = parsedUrl.searchParams.get('date'); // YYYYMMDD
        const targetUrl = `https://www.twse.com.tw/fund/T86?response=json&date=${date}&selectType=ALL`;
        console.log(`[代理] 正在抓取上市三大法人買賣超 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.twse.com.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上市信用交易 (TWSE MI_MARGN)
    if (parsedUrl.pathname === '/api/twse-margin') {
        const date = parsedUrl.searchParams.get('date'); // YYYYMMDD
        const targetUrl = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=ALL`;
        console.log(`[代理] 正在抓取上市融資融券餘額 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.twse.com.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上櫃三大法人買賣超 (TPEx 3itrade_hedge_result)
    if (parsedUrl.pathname === '/api/tpex-inst') {
        const d = parsedUrl.searchParams.get('d'); // YYY/MM/DD (民國年)
        const targetUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${encodeURIComponent(d)}&se=EW&t=D`;
        console.log(`[代理] 正在抓取上櫃三大法人買賣超 (from 櫃買中心 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tpex.org.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 上櫃信用交易 (TPEx margin_bal_result)
    if (parsedUrl.pathname === '/api/tpex-margin') {
        const d = parsedUrl.searchParams.get('d'); // YYY/MM/DD (民國年)
        const targetUrl = `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&d=${encodeURIComponent(d)}`;
        console.log(`[代理] 正在抓取上櫃融資融券餘額 (from 櫃買中心 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tpex.org.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // TWSE 休市日行事曆 (TWSE holidaySchedule)
    if (parsedUrl.pathname === '/api/twse-holidays') {
        const targetUrl = 'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html';
        console.log(`[代理] 正在抓取休市日行事曆 (from 台灣證券交易所 API): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.twse.com.tw/' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // 行政院人事行政總處 辦公日曆表 (DGPA Holidays)
    if (parsedUrl.pathname === '/api/dgpa-holidays') {
        const year = parsedUrl.searchParams.get('year') || new Date().getFullYear();
        const targetUrl = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
        console.log(`[代理] 正在抓取辦公日曆表 (from 行政院人事行政總處): ${targetUrl}`);
        fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.text())
        .then(text => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(text); })
        .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
    }

    // Default 404
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`[股海手札] 本地代理伺服器已啟動！`);
    console.log(`請保持此視窗開啟，網頁才能取得最新報價資料。`);
    console.log(`伺服器位址: http://localhost:${PORT}`);
    console.log(`=========================================`);
});
