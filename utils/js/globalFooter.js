/**
 * ============================================================================
 * Global Footer Module (globalFooter.js)
 * ============================================================================
 * Provides a shared Footer UI and styling for independent projects.
 * 
 * @example
 * import { initGlobalFooter } from '../../utils/js/globalFooter.js';
 * 
 * initGlobalFooter({
 *     appName: 'ProjectName',
 *     author: 'YourName',
 *     githubUrl: 'https://github.com/YourAccount/ProjectName',
 *     releaseDate: '2026-08-17'
 * });
 */

import { t } from './shared-i18n.js';

export function initGlobalFooter(config) {
    const {
        containerId, // Optional, injects into the specified element if provided, otherwise defaults to appending to body
        appName = t('ui.footer.unnamedProject'),
        version = 'v1.0.0',
        githubUrl = '#',
        releaseDate = null
    } = config;

    const footerHtml = `
        <div class="max-w-7xl mx-auto w-full flex flex-row justify-between items-center text-xs gap-3">
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
                    ${t('ui.footer.githubProject')}
                </a>
                ${releaseDate ? `<span class="text-slate-300 dark:text-slate-700">|</span><span>${t('ui.footer.releaseDate', { date: releaseDate })}</span>` : ''}
            </div>
        </div>
    `;

    const existingFooter = document.getElementById('global-footer-element');
    if (existingFooter) {
        existingFooter.remove();
    }

    // Create <footer> element, ensuring it retains the original sticky layout properties
    const footerWrapper = document.createElement('footer');
    footerWrapper.id = 'global-footer-element';
    footerWrapper.className = 'w-full py-2.5 px-5 z-40 transition-colors duration-200 sticky bottom-0 mt-auto shrink-0';
    footerWrapper.style.backgroundColor = 'var(--surface-color, #ffffff)';
    footerWrapper.style.borderTop = '1px solid var(--border-color, #e2e8f0)';
    footerWrapper.style.color = 'var(--text-muted, #64748b)';
    footerWrapper.innerHTML = footerHtml;

    if (containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.appendChild(footerWrapper);
        } else {
            console.warn(`[GlobalFooter] Container ID not found: ${containerId}, appending to body instead`);
            document.body.appendChild(footerWrapper);
        }
    } else {
        document.body.appendChild(footerWrapper);
    }
}
