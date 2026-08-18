/**
 * ============================================================================
 * 通用置頂錯誤訊息提示 (Global Error Handler)
 * ============================================================================
 * 
 * 【使用方法】
 * 為了確保能捕捉到網頁載入初期的所有異常，請在應用程式的 `<head>` 區塊內，
 * 盡可能靠前的位置引入此腳本（建議放在 Tailwind 等外部資源之後，但在主程式 app.js 之前）。
 * 
 * 範例：
 * <head>
 *     ... 其他 meta 與 css ...
 *     <script src="https://cdn.tailwindcss.com"></script>
 *     
 *     <!-- 引入通用錯誤處理器 (攔截未預期異常) -->
 *     <script src="utils/js/errorHandler.js"></script>
 *     
 *     <!-- 接著才是應用程式的主程式 -->
 *     <script type="module" src="js/app.js"></script>
 * </head>
 * 
 * 【功能說明】
 * 1. 攔截 `window.onerror`：捕捉一般執行階段的例外錯誤 (System Error)。
 * 2. 攔截 `window.onunhandledrejection`：捕捉未處理的 Promise 非同步異常。
 * 3. 發生錯誤時，會在畫面正上方顯示紅/橘色的置頂橫幅，方便開發者與使用者立即察覺問題。
 * 4. 已自動過濾 Safari 等瀏覽器載入跨域腳本 (如 CDN) 時產生的無效 "Script error."。
 * ============================================================================
 */

(function() {
    // 避免重複註冊
    if (window._globalErrorHandlerInitialized) return;
    window._globalErrorHandlerInitialized = true;

    // 等待 body 準備好再插入 HTML 的輔助函式
    function appendErrorHtml(html) {
        if (document.body) {
            document.body.insertAdjacentHTML('beforeend', html);
        } else {
            // 若錯誤發生在 body 載入前，等待 DOMContentLoaded
            window.addEventListener('DOMContentLoaded', () => {
                document.body.insertAdjacentHTML('beforeend', html);
            });
        }
    }

    // 1. 處理一般同步/非同步拋出的錯誤
    window.addEventListener('error', function(e) {
        // Safari 跨域腳本 (如 Tailwind CDN) 只會回傳空白的 "Script error."，直接忽略
        if (e.message === 'Script error.' && (!e.filename || e.lineno === 0)) return;
        
        // 建立錯誤提示的 UI
        const errorHtml = `
            <div class="global-error-toast" style="position:fixed; top:50px; left:0; right:0; background:rgba(239,68,68,0.95); color:white; padding:20px; z-index:99999; word-break:break-all; backdrop-filter:blur(4px); border-bottom:4px solid #b91c1c; box-shadow:0 10px 25px -5px rgba(0,0,0,0.1); font-family: sans-serif;">
                <strong>🚨 系統發生異常 (System Error):</strong><br>
                ${e.message || '未知錯誤'}<br>
                <span style="font-size:0.85em; opacity:0.8;">
                    ${e.filename || '未知來源'} : 第 ${e.lineno || 0} 行
                </span>
                <button onclick="this.parentElement.remove()" style="position:absolute; top:10px; right:15px; font-weight:bold; cursor:pointer; background:none; border:none; color:white; font-size:16px;">✕</button>
            </div>
        `;
        appendErrorHtml(errorHtml);
    });

    // 2. 處理未捕獲的 Promise 錯誤 (例如 async 函數內報錯未 catch)
    window.addEventListener('unhandledrejection', function(e) {
        const reason = (e.reason && e.reason.stack) ? e.reason.stack : e.reason;
        
        // 建立錯誤提示的 UI
        const errorHtml = `
            <div class="global-promise-error-toast" style="position:fixed; top:150px; left:0; right:0; background:rgba(245,158,11,0.95); color:white; padding:20px; z-index:99999; word-break:break-all; backdrop-filter:blur(4px); border-bottom:4px solid #b45309; box-shadow:0 10px 25px -5px rgba(0,0,0,0.1); font-family: sans-serif;">
                <strong>⚠️ 未捕獲的非同步異常 (Promise Rejection):</strong><br>
                ${reason || '未知錯誤'}<br>
                <button onclick="this.parentElement.remove()" style="position:absolute; top:10px; right:15px; font-weight:bold; cursor:pointer; background:none; border:none; color:white; font-size:16px;">✕</button>
            </div>
        `;
        appendErrorHtml(errorHtml);
    });
})();
