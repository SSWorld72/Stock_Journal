/**
 * GAS Proxy (跨網域抓取代理) 模組
 * 
 * 透過 Google Apps Script (GAS) 作為 Serverless Proxy，
 * 繞過瀏覽器 CORS 限制，抓取任意第三方 API 資料。
 * 
 * 原理：將原本的 URL 參數轉換為 POST Body 傳送給 GAS，
 * GAS 收到後代為發送 GET 請求並回傳結果。
 */

/**
 * 透過 GAS 轉傳請求
 * @param {string} gasUrl - 您的 GAS Web App URL
 * @param {string} path - 欲抓取的目標 API 路徑或網址 (含 ? 之後的 query parameters)
 * @param {Object} [additionalParams={}] - (可選) 需要附加在 POST body 裡的其他參數（例如 client_id, app_v 等）
 * @returns {Promise<Response>}
 */
export function fetchViaGas(gasUrl, path, additionalParams = {}) {
    if (!gasUrl) {
        console.warn('[GAS Proxy] 尚未提供 GAS Web App URL。');
        return Promise.reject(new Error('Missing GAS Web App URL'));
    }

    // 解析 path 為結構化參數 (藏進 POST Body)
    const parts = path.split('?');
    const postBody = { route: parts[0] };

    if (parts.length > 1) {
        const searchParams = new URLSearchParams(parts.slice(1).join('?'));
        for (const [key, val] of searchParams.entries()) {
            postBody[key] = val;
        }
    }

    // 附加額外參數 (強制於最後覆寫，防止惡意 URL 參數污染)
    for (const [key, val] of Object.entries(additionalParams)) {
        postBody[key] = val;
    }

    return fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(postBody)
    });
}

/**
 * 取得轉換後的 GAS 完整網址 (通常用於 GET 請求模式，不建議傳遞敏感資料)
 * @param {string} gasUrl - 您的 GAS Web App URL
 * @param {string} path - 目標 API 路徑
 * @param {Object} [additionalParams={}] - (可選) 需要附加的其他參數
 * @returns {string} 轉換後的 URL
 */
export function getGasProxyUrl(gasUrl, path, additionalParams = {}) {
    if (!gasUrl) {
        console.warn('[GAS Proxy] 尚未提供 GAS Web App URL。');
        return null;
    }

    const parts = path.split('?');
    let routeParams = '?route=' + parts[0];
    
    if (parts.length > 1) {
        routeParams += '&' + parts.slice(1).join('?');
    }
    
    for (const [key, val] of Object.entries(additionalParams)) {
        if (val !== undefined && val !== null) {
            routeParams += `&${encodeURIComponent(key)}=${encodeURIComponent(val)}`;
        }
    }

    return gasUrl + routeParams;
}
