/**
 * ============================================================================
 * Cross-Domain API Proxy Module (gasProxy.js)
 * ============================================================================
 * Uses Google Apps Script (GAS) as a Serverless Proxy to bypass browser CORS 
 * cross-domain restrictions and fetch arbitrary third-party API data.
 * Packages original GET request parameters into a JSON POST Body and sends it to the specified GAS Web App.
 * 
 * @example
 * import { fetchViaGas } from '../../utils/js/gasProxy.js';
 * 
 * const gasUrl = 'https://script.google.com/macros/s/.../exec';
 * const targetApi = '/api/v1/some-data?id=123';
 * const extraParams = { app_v: '1.0.0', device: 'iOS' };
 * 
 * fetchViaGas(gasUrl, targetApi, extraParams)
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */

/**
 * Forward request via GAS
 * @param {string} gasUrl - Your GAS Web App URL
 * @param {string} path - Target API path or URL (including query parameters after ?)
 * @param {Object} [additionalParams={}] - (Optional) Additional parameters to append in POST body (e.g., client_id, app_v)
 * @returns {Promise<Response>}
 */
export function fetchViaGas(gasUrl, path, additionalParams = {}) {
    if (!gasUrl) {
        console.warn(window.t ? window.t('systemLogs.gasProxy.missingUrl') : '[GAS Proxy] GAS Web App URL is not provided.');
        return Promise.reject(new Error('Missing GAS Web App URL'));
    }

    // Parse path into structured parameters (hidden in POST Body)
    const parts = path.split('?');
    const postBody = { route: parts[0] };

    if (parts.length > 1) {
        const searchParams = new URLSearchParams(parts.slice(1).join('?'));
        for (const [key, val] of searchParams.entries()) {
            postBody[key] = val;
        }
    }

    // Append additional parameters (forcibly overwritten at the end to prevent malicious URL parameter pollution)
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
 * Get the converted full GAS URL (Usually for GET requests, not recommended for passing sensitive data)
 * @param {string} gasUrl - Your GAS Web App URL
 * @param {string} path - Target API path
 * @param {Object} [additionalParams={}] - (Optional) Additional parameters to append
 * @returns {string} Converted URL
 */
export function getGasProxyUrl(gasUrl, path, additionalParams = {}) {
    if (!gasUrl) {
        console.warn(window.t ? window.t('systemLogs.gasProxy.missingUrl') : '[GAS Proxy] GAS Web App URL is not provided.');
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
