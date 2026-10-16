/**
 * ============================================================================
 * Global Error Handler
 * ============================================================================
 * 
 * [Usage]
 * To ensure capturing all exceptions early during page load, please include this script 
 * in the `<head>` section of the application, as early as possible 
 * (recommended after external resources like Tailwind, but before the main app.js).
 * 
 * Example:
 * <head>
 *     ... other meta and css ...
 *     <script src="https://cdn.tailwindcss.com"></script>
 *     
 *     <!-- Include global error handler (intercept unexpected exceptions) -->
 *     <script src="utils/js/errorHandler.js"></script>
 *     
 *     <!-- Followed by the main application script -->
 *     <script type="module" src="js/app.js"></script>
 * </head>
 * 
 * [Features]
 * 1. Intercepts `window.onerror`: captures general runtime exceptions (System Error).
 * 2. Intercepts `window.onunhandledrejection`: captures unhandled Promise asynchronous exceptions.
 * 3. When an error occurs, displays a red/orange sticky banner at the top of the screen.
 * 4. Automatically filters out invalid "Script error." caused by cross-domain scripts (like CDN) in Safari.
 * ============================================================================
 */

(function() {
    // Prevent duplicate registration
    if (window._globalErrorHandlerInitialized) return;
    window._globalErrorHandlerInitialized = true;

    // Helper function to insert HTML after body is ready
    function appendErrorHtml(html) {
        if (document.body) {
            document.body.insertAdjacentHTML('beforeend', html);
        } else {
            // If error occurs before body is loaded, wait for DOMContentLoaded
            window.addEventListener('DOMContentLoaded', () => {
                document.body.insertAdjacentHTML('beforeend', html);
            });
        }
    }

    // 1. Handle general sync/async thrown errors
    window.addEventListener('error', function(e) {
        // Safari cross-domain scripts (like Tailwind CDN) only return blank "Script error.", ignore them directly
        if (e.message === 'Script error.' && (!e.filename || e.lineno === 0)) return;
        
        // Build error UI
        const sysTitle = window.t ? window.t('systemLogs.errorHandler.sysErrorTitle') : '🚨 System Error:';
        const unkErr = window.t ? window.t('systemLogs.errorHandler.unknownError') : 'Unknown Error';
        const unkSrc = window.t ? window.t('systemLogs.errorHandler.unknownSource') : 'Unknown Source';
        const lineNumTxt = window.t ? window.t('systemLogs.errorHandler.lineNum', { line: e.lineno || 0 }) : `Line ${e.lineno || 0}`;

        const errorHtml = `
            <div class="global-error-toast" style="position:fixed; top:50px; left:0; right:0; background:rgba(239,68,68,0.95); color:white; padding:20px; z-index:99999; word-break:break-all; backdrop-filter:blur(4px); border-bottom:4px solid #b91c1c; box-shadow:0 10px 25px -5px rgba(0,0,0,0.1); font-family: sans-serif;">
                <strong>${sysTitle}</strong><br>
                ${e.message || unkErr}<br>
                <span style="font-size:0.85em; opacity:0.8;">
                    ${e.filename || unkSrc} : ${lineNumTxt}
                </span>
                <button onclick="this.parentElement.remove()" style="position:absolute; top:10px; right:15px; font-weight:bold; cursor:pointer; background:none; border:none; color:white; font-size:16px;">✕</button>
            </div>
        `;
        appendErrorHtml(errorHtml);
    });

    // 2. Handle unhandled Promise errors (e.g. async function error without catch)
    window.addEventListener('unhandledrejection', function(e) {
        const reason = (e.reason && e.reason.stack) ? e.reason.stack : e.reason;
        
        // Build error UI
        const promTitle = window.t ? window.t('systemLogs.errorHandler.promiseErrorTitle') : '⚠️ Unhandled Promise Rejection:';
        const unkErr = window.t ? window.t('systemLogs.errorHandler.unknownError') : 'Unknown Error';

        const errorHtml = `
            <div class="global-promise-error-toast" style="position:fixed; top:150px; left:0; right:0; background:rgba(245,158,11,0.95); color:white; padding:20px; z-index:99999; word-break:break-all; backdrop-filter:blur(4px); border-bottom:4px solid #b45309; box-shadow:0 10px 25px -5px rgba(0,0,0,0.1); font-family: sans-serif;">
                <strong>${promTitle}</strong><br>
                ${reason || unkErr}<br>
                <button onclick="this.parentElement.remove()" style="position:absolute; top:10px; right:15px; font-weight:bold; cursor:pointer; background:none; border:none; color:white; font-size:16px;">✕</button>
            </div>
        `;
        appendErrorHtml(errorHtml);
    });
})();
