/**
 * ============================================================================
 * UI Blocker & Progress Bar Module (uiBlocker.js)
 * ============================================================================
 * Global protection and data processing progress indicator, fully self-contained UI (dynamically injected Tailwind HTML).
 * Provides a full-screen lock overlay and local inline progress bars.
 * 
 * @example
 * import { setAppBusy, showInlineProgress, updateInlineProgress, hideInlineProgress } from '../../utils/js/uiBlocker.js';
 * 
 * // 1. Full-screen Lock Modal
 * setAppBusy(true, { title: 'Processing...', progress: 25 });
 * setAppBusy(false, { success: true, message: 'Complete!' });
 * 
 * // 2. Inline Progress Bar
 * showInlineProgress('import-box', 'Parsing file...');
 * updateInlineProgress('import-box', 150, 1000);
 * hideInlineProgress('import-box', 'Processed 1,000 records');
 */
/**
 * UI Blocker & Progress Display Module
 * 
 * Provides a full-screen overlay (to prevent accidental clicks and closing) and localized inline progress bar display.
 * This module [includes its own HTML UI], automatically injecting the required Tailwind UI structure when called.
 */

import { t } from './shared-i18n.js';

// Internal state
let isAppBusy = false;

function onBeforeUnload(e) {
    if (isAppBusy) {
        e.preventDefault();
        e.returnValue = t('utils.uiBlocker.beforeUnload');
        return e.returnValue;
    }
}

/**
 * Ensure the full-screen overlay HTML structure is injected into the DOM
 */
function ensureModalUI() {
    if (document.getElementById('modal-app-busy')) return;

    const modalHTML = `
    <!-- Global App Busy / Heavy Processing Modal -->
    <div id="modal-app-busy" class="fixed inset-0 bg-slate-900/60 backdrop-blur-xs hidden flex items-center justify-center z-[9999] transition-opacity duration-200">
        <div class="bg-white rounded-2xl shadow-2xl p-6 sm:p-8 max-w-md w-[90%] border border-slate-100 flex flex-col items-center text-center">
            <!-- Animated Icon -->
            <div class="relative mb-4">
                <div id="app-busy-icon-bg" class="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                    <svg id="app-busy-spinner" class="animate-spin w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3.5"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <svg id="app-busy-success-icon" class="w-8 h-8 text-emerald-600 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                    </svg>
                    <svg id="app-busy-error-icon" class="w-8 h-8 text-rose-600 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </div>
                <span id="app-busy-ping" class="absolute top-0 right-0 flex h-3.5 w-3.5">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-500"></span>
                </span>
            </div>

            <h3 id="app-busy-title" class="text-lg font-bold text-slate-800 mb-1.5">${t('utils.uiBlocker.title')}</h3>
            <p id="app-busy-detail" class="text-xs text-slate-500 mb-5 leading-relaxed">${t('utils.uiBlocker.detail')}</p>

            <!-- Progress Bar Container -->
            <div id="app-busy-bar-container" class="w-full bg-slate-100 rounded-full h-2.5 mb-2 overflow-hidden">
                <div id="app-busy-bar" class="bg-gradient-to-r from-blue-500 to-indigo-600 h-2.5 rounded-full transition-all duration-150 ease-out" style="width: 5%"></div>
            </div>

            <div id="app-busy-stats" class="w-full flex justify-between items-center text-xs text-slate-400 mb-2">
                <span id="app-busy-status">${t('utils.uiBlocker.status')}</span>
                <span id="app-busy-count" class="font-medium text-slate-600 font-mono">${t('utils.uiBlocker.countZero')}</span>
            </div>

            <!-- Security / Anti-disturb Pill -->
            <div class="mt-3 px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-lg text-[11px] text-amber-700 flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <span>${t('utils.uiBlocker.antiDisturb')}</span>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Set the state of the full-screen overlay
 * @param {boolean} busy - Whether to lock the screen
 * @param {Object} options - Options (title, detail, countText, statusText, progress, success, error, message)
 */
export function setAppBusy(busy, options = {}) {
    ensureModalUI();
    
    isAppBusy = !!busy;
    if (typeof window !== 'undefined') {
        window.isAppBusy = isAppBusy;
    }
    
    const modal = document.getElementById('modal-app-busy');
    const titleEl = document.getElementById('app-busy-title');
    const detailEl = document.getElementById('app-busy-detail');
    const barEl = document.getElementById('app-busy-bar');
    const countEl = document.getElementById('app-busy-count');
    const statusEl = document.getElementById('app-busy-status');
    const spinner = document.getElementById('app-busy-spinner');
    const successIcon = document.getElementById('app-busy-success-icon');
    const errorIcon = document.getElementById('app-busy-error-icon');
    const ping = document.getElementById('app-busy-ping');
    const iconBg = document.getElementById('app-busy-icon-bg');

    if (isAppBusy) {
        window.addEventListener('beforeunload', onBeforeUnload);
        if (modal) modal.classList.remove('hidden');

        if (titleEl && options.title) titleEl.textContent = options.title;
        if (detailEl && options.detail) {
            detailEl.textContent = options.detail;
            detailEl.className = "text-xs text-slate-500 mb-5 leading-relaxed whitespace-pre-line";
        }
        if (countEl) {
            if (options.countText) {
                countEl.classList.remove('hidden');
                countEl.textContent = options.countText;
            } else {
                countEl.classList.add('hidden');
            }
        }
        if (statusEl && options.statusText) statusEl.textContent = options.statusText;
        
        if (barEl && typeof options.progress === 'number') {
            barEl.style.width = `${Math.max(3, Math.min(100, options.progress))}%`;
        }

        // Ensure spinner is running
        if (spinner) spinner.classList.remove('hidden');
        if (successIcon) successIcon.classList.add('hidden');
        if (errorIcon) errorIcon.classList.add('hidden');
        if (ping) ping.classList.remove('hidden');
        if (iconBg) {
            iconBg.className = "w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center text-blue-600";
        }
    } else {
        window.removeEventListener('beforeunload', onBeforeUnload);

        if (options.success) {
            if (barEl) barEl.style.width = '100%';
            if (statusEl) statusEl.textContent = t('utils.uiBlocker.success');
            if (detailEl && options.message) {
                detailEl.textContent = options.message;
                detailEl.className = "text-[13px] text-emerald-700 font-medium mb-5 leading-relaxed bg-emerald-50/80 border border-emerald-100 py-2 px-3 rounded-lg w-full text-left whitespace-pre-line";
            }
            if (spinner) spinner.classList.add('hidden');
            if (ping) ping.classList.add('hidden');
            if (successIcon) successIcon.classList.remove('hidden');
            if (iconBg) {
                iconBg.className = "w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600";
            }
            if (countEl) countEl.classList.add('hidden'); // Hide count on success

            setTimeout(() => {
                if (modal && !isAppBusy) modal.classList.add('hidden');
            }, 5000);
        } else if (options.error) {
            if (statusEl) statusEl.textContent = t('utils.uiBlocker.error');
            if (detailEl && options.message) {
                detailEl.textContent = options.message;
                detailEl.className = "text-[13px] text-rose-700 font-medium mb-5 leading-relaxed bg-rose-50/80 border border-rose-100 py-2 px-3 rounded-lg w-full text-left";
            }
            if (spinner) spinner.classList.add('hidden');
            if (ping) ping.classList.add('hidden');
            if (errorIcon) errorIcon.classList.remove('hidden');
            if (iconBg) {
                iconBg.className = "w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center text-rose-600";
            }
            setTimeout(() => {
                if (modal && !isAppBusy) modal.classList.add('hidden');
            }, 3000);
        } else {
            if (modal) modal.classList.add('hidden');
        }
    }
}

/**
 * Ensure the inline progress bar HTML structure is injected into the target container
 * @param {string} containerId - Target container ID
 */
function ensureInlineProgressUI(containerId) {
    const parent = document.getElementById(containerId);
    if (!parent) return null;
    
    // Do not inject again if this progress bar already exists
    let progressContainer = document.getElementById(`${containerId}-progress-box`);
    if (progressContainer) return progressContainer;

    const html = `
    <div id="${containerId}-progress-box" class="hidden mt-3 bg-white/80 border border-indigo-200 p-3 rounded-lg">
        <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
                <svg class="animate-spin w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span id="${containerId}-progress-label" class="text-xs font-medium text-indigo-800">${t('utils.uiBlocker.inlineLabel')}</span>
            </div>
            <span id="${containerId}-progress-count" class="text-xs font-mono text-indigo-600">${t('utils.uiBlocker.inlineZero')}</span>
        </div>
        <div class="w-full bg-indigo-100 rounded-full h-1.5 overflow-hidden">
            <div id="${containerId}-progress-bar" class="bg-indigo-500 h-full rounded-full transition-all duration-300 ease-out" style="width: 5%"></div>
        </div>
        <p id="${containerId}-progress-detail" class="text-[11px] text-indigo-600/70 mt-1"></p>
    </div>`;
    parent.insertAdjacentHTML('beforeend', html);
    return document.getElementById(`${containerId}-progress-box`);
}

/**
 * Show inline progress bar
 * @param {string} containerId - ID of the parent container to mount to
 * @param {string} label - Progress bar title
 */
export function showInlineProgress(containerId, label) {
    const box = ensureInlineProgressUI(containerId);
    if (!box) return;
    
    box.classList.remove('hidden');
    const labelEl = document.getElementById(`${containerId}-progress-label`);
    const countEl = document.getElementById(`${containerId}-progress-count`);
    const barEl = document.getElementById(`${containerId}-progress-bar`);
    const detailEl = document.getElementById(`${containerId}-progress-detail`);
    
    if (labelEl && label) labelEl.textContent = label;
    if (countEl) countEl.textContent = t('utils.uiBlocker.inlineZero');
    if (barEl) barEl.style.width = '5%';
    if (detailEl) detailEl.textContent = '';
}

/**
 * Update inline progress bar values
 * @param {string} containerId 
 * @param {number} count 
 * @param {number} total 
 * @param {string} label 
 */
export function updateInlineProgress(containerId, count, total, label) {
    const countEl = document.getElementById(`${containerId}-progress-count`);
    const barEl = document.getElementById(`${containerId}-progress-bar`);
    const labelEl = document.getElementById(`${containerId}-progress-label`);
    
    if (countEl) {
        countEl.textContent = total
            ? t('utils.uiBlocker.inlineCountTotal', { count: count.toLocaleString(), total: total.toLocaleString() })
            : t('utils.uiBlocker.inlineCount', { count: count.toLocaleString() });
    }
    if (labelEl && label) labelEl.textContent = label;
    if (barEl) {
        const pct = total ? Math.min(95, Math.round((count / total) * 100)) : Math.min(90, 5 + Math.log10(count + 1) * 18);
        barEl.style.width = `${pct}%`;
    }
}

/**
 * Hide inline progress bar
 * @param {string} containerId 
 * @param {string} detail - Completion message
 */
export function hideInlineProgress(containerId, detail) {
    const box = document.getElementById(`${containerId}-progress-box`);
    if (!box) return;

    const barEl = document.getElementById(`${containerId}-progress-bar`);
    const labelEl = document.getElementById(`${containerId}-progress-label`);
    const detailEl = document.getElementById(`${containerId}-progress-detail`);
    
    if (barEl) barEl.style.width = '100%';
    if (labelEl) labelEl.textContent = t('utils.uiBlocker.inlineSuccess');
    if (detailEl && detail) detailEl.textContent = detail;
    
    // Auto hide after 4 seconds
    setTimeout(() => {
        box.classList.add('hidden');
    }, 4000);
}
