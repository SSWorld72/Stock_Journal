/**
 * Google Apps Script API Proxy (含存取日誌與自動封存機制)
 * 
 * 【功能說明】
 * 1. 代理抓取 TWSE / TPEx / Yahoo Finance / DGPA 籌碼與報價資料 (免除 CORS 限制)。
 * 2. 自動記錄呼叫者資訊至 Google 試算表 (時間、IP、Client ID、裝置、路由、參數、耗時)。
 * 3. 內建自動封存機制 (Auto-Archive)：當日誌超過 5,000 筆時自動歸檔並開啟全新日誌分頁。
 * 4. 容錯防護：日誌寫入異常絕不影響 API 資料回傳。
 */

// ===== 系統設定 =====
// 若為獨立腳本 (Standalone)，請在下行填入試算表 ID，或於「專案設定 > 指令碼屬性」設定 SPREADSHEET_ID
const SPREADSHEET_ID = '請在此填入您的試算表_ID'; 
const LOG_SHEET_NAME = 'API_Logs';
const ARCHIVE_ROW_THRESHOLD = 5000; // 超過此行數自動封存

// ===== Web App 入口 =====
function doGet(e) {
  const params = e ? (e.parameter || {}) : {};
  return processRequest(params);
}

function doPost(e) {
  let params = {};
  if (e && e.postData && e.postData.contents) {
    try {
      params = JSON.parse(e.postData.contents);
    } catch (err) {
      // 若不是 JSON，則預設為空物件
    }
  }
  return processRequest(params);
}

function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function processRequest(params) {
  const startTime = new Date().getTime();
  let status = 'SUCCESS';
  let errorMsg = '';
  let responseData = null;
  let mimeType = ContentService.MimeType.JSON;
  
  params = params || {};
  const route = params.route || '';
  const clientIp = params.client_ip || 'N/A';
  const clientId = params.client_id || 'anonymous';
  const appVersion = params.app_v || 'unknown';
  const device = params.device || 'Unknown';

  try {
    if (!route) {
      throw new Error('缺少 route 路由參數。範例：?route=/api/twse-quote&code=2330');
    }

    // 路由分發 (同步自基礎版)
    switch (route) {
      case '/api/quote':
        responseData = fetchYahooQuote(params);
        break;
      case '/api/twse-quote':
        responseData = fetchTwseQuote(params);
        break;
      case '/api/names':
        responseData = fetchNames(params);
        break;
      case '/api/industry':
        responseData = fetchIndustry(params);
        break;
      case '/api/twse-daily':
        responseData = fetchTwseDaily(params);
        break;
      case '/api/tpex-daily':
        responseData = fetchTpexDaily(params);
        break;
      case '/api/twse-inst':
        responseData = fetchTwseInst(params);
        break;
      case '/api/twse-margin':
        responseData = fetchTwseMargin(params);
        break;
      case '/api/tpex-inst':
        responseData = fetchTpexInst(params);
        break;
      case '/api/tpex-margin':
        responseData = fetchTpexMargin(params);
        break;
      case '/api/historical':
        responseData = fetchYahooHistorical(params);
        break;
      case '/api/bwibbu':
        responseData = fetchBwibbu(params);
        break;
      case '/api/tpex-peratio':
        responseData = fetchTpexPeratio(params);
        break;
      case '/api/revenue-yoy':
        responseData = fetchRevenueYoY(params);
        break;
      case '/api/eps':
        responseData = fetchEps(params);
        break;
      case '/api/etf-nav':
        responseData = fetchEtfNav(params);
        break;
      case '/api/twse-holidays':
        responseData = fetchTwseHolidays(params);
        mimeType = ContentService.MimeType.HTML;
        break;
      case '/api/dgpa-holidays':
        responseData = fetchDgpaHolidays(params);
        break;
      case '/api/ping':
        responseData = JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() });
        break;
      default:
        throw new Error('未知的路由 (Unknown route): ' + route);
    }

  } catch (err) {
    status = 'ERROR';
    errorMsg = err.message || String(err);
    responseData = JSON.stringify({ error: true, message: errorMsg });
  }

  const duration = new Date().getTime() - startTime;

  // 背景非阻塞寫入日誌 (即使寫入失敗也不影響 API 回應)
  try {
    logApiAccess({
      spreadsheetId: params.spreadsheet_id,
      timestamp: new Date(),
      clientIp: clientIp,
      clientId: clientId,
      device: device,
      route: route,
      params: JSON.stringify(params),
      appVersion: appVersion,
      duration: duration,
      status: status,
      errorMsg: errorMsg
    });
  } catch (logErr) {
    console.warn('[日誌紀錄] 寫入 Google 試算表失敗 (Log Error):', logErr);
  }

  return ContentService.createTextOutput(responseData).setMimeType(mimeType);
}

// ===== 日誌紀錄與自動封存核心 =====
function getLogSpreadsheet(userSpreadsheetId) {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (_) {}

  const scriptPropId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  const targetId = userSpreadsheetId || scriptPropId || SPREADSHEET_ID;
  if (targetId) {
    return SpreadsheetApp.openById(targetId);
  }
  return null;
}

function logApiAccess(logData) {
  const ss = getLogSpreadsheet(logData.spreadsheetId);
  if (!ss) return; 

  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = createLogSheet(ss, LOG_SHEET_NAME);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow >= ARCHIVE_ROW_THRESHOLD) {
    sheet = archiveAndResetLogSheet(ss, sheet);
  }

  const timeStr = Utilities.formatDate(logData.timestamp, "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([
    timeStr,
    logData.clientIp,
    logData.clientId,
    logData.device,
    logData.route,
    logData.params,
    logData.appVersion,
    logData.duration,
    logData.status,
    logData.errorMsg
  ]);
}

function createLogSheet(ss, sheetName) {
  const sheet = ss.insertSheet(sheetName);
  const headers = [
    '時間 (Timestamp)',
    '客戶端 IP (Client IP)',
    '裝置識別碼 (Client ID)',
    '裝置名稱 (Device)',
    '請求路由 (Route)',
    '查詢參數 (Params)',
    '前端版本 (Version)',
    '耗時 (ms)',
    '狀態 (Status)',
    '錯誤訊息 (Error)'
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground('#334155')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function archiveAndResetLogSheet(ss, currentSheet) {
  const now = new Date();
  const archiveName = 'Logs_' + Utilities.formatDate(now, "Asia/Taipei", "yyyyMMdd_HHmmss");
  
  try {
    currentSheet.setName(archiveName);
  } catch (e) {
    currentSheet.setName(archiveName + '_' + Math.floor(Math.random() * 1000));
  }

  return createLogSheet(ss, LOG_SHEET_NAME);
}

// ===== 各 API 抓取實作邏輯 (同步自基礎版) =====

// ----- 實作各個抓取邏輯 -----

function fetchYahooQuote(params) {
  const symbol = params.code;
  const range = params.range || '1d';
  const interval = params.interval || '1d';
  if (!symbol) throw new Error('缺少 code 股票代號參數 (Missing code parameter)');
  
  let targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}`;
  
  if (params.period1 && params.period2) {
    targetUrl += `&period1=${params.period1}&period2=${params.period2}`;
  } else {
    targetUrl += `&range=${range}`;
  }
  
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTwseQuote(params) {
  const code = params.code;
  // TWSE delay=0
  const targetUrl = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${code}&json=1&delay=0&_=${new Date().getTime()}`;
  const response = UrlFetchApp.fetch(targetUrl, { 
    muteHttpExceptions: true,
    headers: { 'Referer': 'https://mis.twse.com.tw/' }
  });
  return response.getContentText();
}

function fetchNames(params) {
  const type = params.type || 'twse';
  const targetUrl = type === 'twse' 
      ? 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
      : 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchIndustry(params) {
  const type = params.type || 'twse';
  const targetUrl = type === 'twse' 
      ? 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
      : 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTwseDaily(params) {
  const date = params.date;
  const stockNo = params.stockNo;
  const targetUrl = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(stockNo)}`;
  const response = UrlFetchApp.fetch(targetUrl, { 
    muteHttpExceptions: true,
    headers: { 'Referer': 'https://www.twse.com.tw/' }
  });
  return response.getContentText();
}

function fetchTpexDaily(params) {
  const d = params.d;
  const stkno = params.stkno;
  const targetUrl = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${encodeURIComponent(d)}&stkno=${encodeURIComponent(stkno)}`;
  const response = UrlFetchApp.fetch(targetUrl, { 
    muteHttpExceptions: true,
    headers: { 'Referer': 'https://www.tpex.org.tw/' }
  });
  return response.getContentText();
}

function fetchTwseInst(params) {
  const date = params.date;
  const targetUrl = `https://www.twse.com.tw/fund/T86?response=json&date=${date}&selectType=ALL`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTwseMargin(params) {
  const date = params.date;
  const targetUrl = `https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date=${date}&selectType=ALL`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTpexInst(params) {
  const d = params.d;
  const targetUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(d)}`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTpexMargin(params) {
  const d = params.d;
  const targetUrl = `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${encodeURIComponent(d)}`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchYahooHistorical(params) {
  const code = params.code;
  const range = params.range || '6mo';
  const interval = params.interval || '1d';
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}?interval=${interval}&range=${range}`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchBwibbu(params) {
  const date = params.date;
  const targetUrl = `https://www.twse.com.tw/exchangeReport/BWIBBU_d?response=json&date=${date}&selectType=ALL`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTpexPeratio(params) {
  const date = params.date;
  const targetUrl = `https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php?l=zh-tw&d=${date}&o=json`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchRevenueYoY(params) {
  const type = params.type || 'twse';
  const targetUrl = type === 'twse'
      ? 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'
      : 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O';
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchEps(params) {
  const type = params.type || 'twse';
  const targetUrl = type === 'twse'
      ? 'https://openapi.twse.com.tw/v1/opendata/t187ap14_L'
      : 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O';
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchEtfNav(params) {
  const targetUrl = 'https://mis.twse.com.tw/stock/data/all_etf.txt';
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchTwseHolidays(params) {
  const targetUrl = 'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=html';
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}

function fetchDgpaHolidays(params) {
  const year = params.year || new Date().getFullYear();
  const targetUrl = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
  const response = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true });
  return response.getContentText();
}
