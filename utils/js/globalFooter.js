/**
 * 全域置底頁尾模組 (Global Footer Module)
 * 供各個獨立專案共用相同的 Footer UI 與樣式
 */

export function initGlobalFooter(config) {
    const {
        containerId, // 可選，若提供則注入該元素內，否則預設 append 到 body
        appName = '未命名專案',
        version = 'v1.0.0',
        githubUrl = '#',
        releaseDate = 'YYYY-MM-DD'
    } = config;

    const footerHtml = `
        <div class="max-w-7xl mx-auto w-full flex flex-col sm:flex-row justify-between items-center text-xs text-slate-500 dark:text-slate-400 gap-3">
            <div class="flex items-center gap-2">
                <span class="font-bold text-slate-700 dark:text-slate-300">${appName}</span>
                <span class="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60 px-2 py-0.5 rounded font-mono font-semibold text-[11px]">${version}</span>
            </div>
            <div class="flex items-center gap-3">
                <a href="${githubUrl}" target="_blank"
                    class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-1 font-medium">
                    <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                    GitHub 專案
                </a>
                <span class="text-slate-300 dark:text-slate-700">|</span>
                <span>發布日期: ${releaseDate}</span>
            </div>
        </div>
    `;

    const existingFooter = document.getElementById('global-footer-element');
    if (existingFooter) {
        existingFooter.remove();
    }

    // 建立 <footer> 元素，確保帶有原本設計的 Sticky 排版屬性
    const footerEl = document.createElement('footer');
    footerEl.id = 'global-footer-element';
    footerEl.className = 'bg-white dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 px-5 py-2.5 shrink-0 z-20 sticky bottom-0 mt-auto';
    footerEl.innerHTML = footerHtml;

    if (containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.appendChild(footerEl);
        } else {
            console.warn(`[GlobalFooter] 找不到容器 ID: ${containerId}，改為附加至 body`);
            document.body.appendChild(footerEl);
        }
    } else {
        document.body.appendChild(footerEl);
    }
}
