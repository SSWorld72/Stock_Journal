import { showConfirmModal } from './uiDialogs.js';
import { createTipBox } from './tipBox.js';
import { t } from './shared-i18n.js';

/**
 * ============================================================================
 * Danger Zone & Database Cleanup
 * ============================================================================
 * Provides system-level dangerous operations (like clearing all data) 
 * with built-in confirmation dialogs and post-processing.
 * 
 * @example
 * import { mountDangerZone } from '../../utils/js/dangerZone.js';
 * 
 * // Bind the clear data button with auto double-confirmation
 * mountDangerZone({ containerId: 'btn-danger-clear', dbName: 'YourProjectDB' });
 */

/**
 * Shared utility function: Delete a specific IndexedDB database
 * @param {string} dbName - Database name
 * @returns {Promise<void>}
 */
export function deleteIndexedDB(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => {
            console.log(t('systemLogs.dangerZone.deleteSuccess', { dbName }));
            resolve();
        };
        request.onerror = (e) => {
            console.error(t('systemLogs.dangerZone.deleteFailed', { dbName }), e);
            reject(new Error("Failed to delete database"));
        };
        request.onblocked = () => {
            console.warn(t('systemLogs.dangerZone.deleteBlocked'));
            reject(new Error("Deletion blocked, please close other tabs"));
        };
    });
}


/**
 * Shared Danger Zone Module
 * Provides standardized danger zone UI and double confirmation logic for high-risk operations
 */
export class DangerZoneModule {
    /**
     * @param {Object} config 
     * @param {HTMLElement} config.container - DOM node to mount the danger zone
     * @param {string} [config.title] - Section title
     * @param {string} [config.description] - Description text
     * @param {string} [config.buttonText] - Button text
     * @param {string} [config.confirmTitle] - First confirmation title
     * @param {string} [config.confirmMessage] - First confirmation message
     * @param {string} [config.doubleConfirmTitle] - Second confirmation title
     * @param {string} [config.doubleConfirmMessage] - Second confirmation message
     * @param {Function} config.onClear - Async function for clear logic. Automatically reloads after execution.
     * @param {Function} [config.setBusy] - Optional loading state toggle function, e.g. (isBusy, msg) => {}
     */
    constructor(config) {
        this.container = config.container;
        this.config = {
            title: config.title || t('ui.settings.dangerZone.title', { default: '危險區域 (Danger Zone)' }),
            description: config.description || t('ui.settings.dangerZone.desc', { default: '清除所有本機資料與設定。此動作無法復原。' }),
            buttonText: config.buttonText || t('ui.settings.dangerZone.button', { default: '清除所有資料' }),
            confirmTitle: config.confirmTitle || t('ui.settings.dangerZone.confirmTitle', { default: '警告' }),
            confirmMessage: config.confirmMessage || t('ui.settings.dangerZone.confirmMsg', { default: '您確定要清除所有資料嗎？此動作無法復原。' }),
            doubleConfirmTitle: config.doubleConfirmTitle || t('ui.settings.dangerZone.doubleConfirmTitle', { default: '最終確認' }),
            doubleConfirmMessage: config.doubleConfirmMessage || t('ui.settings.dangerZone.doubleConfirmMsg', { default: '這是最後的警告。您真的確定要刪除所有資料嗎？' }),
            btnConfirm: config.btnConfirm || t('ui.settings.dangerZone.btnConfirm', { default: '確認清除' }),
            btnCancel: config.btnCancel || t('ui.settings.dangerZone.btnCancel', { default: '取消' }),
            btnDoubleConfirm: config.btnDoubleConfirm || t('ui.settings.dangerZone.btnDoubleConfirm', { default: '我確定' }),
            btnDoubleCancel: config.btnDoubleCancel || t('ui.settings.dangerZone.btnDoubleCancel', { default: '取消' }),
            busyTitle: config.busyTitle || t('ui.settings.dangerZone.busyTitle', { default: '正在清除資料' }),
            busyDetail: config.busyDetail || t('ui.settings.dangerZone.busyDetail', { default: '正在刪除所有資料，請稍候...' }),
            successMsg: config.successMsg || t('ui.settings.dangerZone.success', { default: '清除成功！' }),
            errorMsg: config.errorMsg || t('ui.settings.dangerZone.error', { default: '清除失敗：{error}' }),
            onClear: config.onClear,
            setBusy: config.setBusy || (() => { }),
            wrapperClass: config.wrapperClass
        };

        if (!this.container) {
            console.error('[DangerZone] Initialization failed: container mount point not provided');
            return;
        }

        this.render();
        this.bindEvents();
    }

    render() {
        const wrapperClass = this.config.wrapperClass !== undefined ? this.config.wrapperClass : 'settings-section mb-8 rounded-3xl p-4 sm:p-5 border';
        
        // Use standard settings-section large card structure to align width with other sections
        this.container.innerHTML = `
            <div class="${wrapperClass}" style="background: var(--surface-color); border-color: var(--border-color);">
                <div class="flex items-center gap-3 mb-4 px-2">
                    <div class="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm border"
                        style="background: var(--active-bg); color: #ef4444; border-color: var(--border-color);">
                        <svg style="width: 1.1rem; height: 1.1rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                    </div>
                    <h3 class="m-0 text-[1.05rem] font-bold tracking-wide" style="color: #ef4444;">${this.config.title}</h3>
                </div>
                <div class="rounded-2xl overflow-hidden shadow-sm border" style="background: var(--bg-color); border-color: var(--border-color);">
                    <div style="padding: 16px;">
                        ${createTipBox({ type: 'danger', html: this.config.description })}
                    </div>
                    <div style="padding: 0;">
                        <button id="btn-danger-zone-execute" 
                            style="width: 100%; background-color: #fef2f2; color: #ef4444; border: none; border-top: 1px solid #fecaca; padding: 16px; font-weight: 600; display: flex; justify-content: center; align-items: center; gap: 6px; transition: all 0.2s; cursor: pointer; border-radius: 0 0 16px 16px;"
                            onmouseover="this.style.backgroundColor='#fee2e2';"
                            onmouseout="this.style.backgroundColor='#fef2f2';">
                            <svg style="width: 1.25rem; height: 1.25rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                            </svg>
                            ${this.config.buttonText}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    bindEvents() {
        const btn = this.container.querySelector('#btn-danger-zone-execute');
        btn.addEventListener('click', async () => {
            // First confirmation
            const firstConfirm = await showConfirmModal({
                title: this.config.confirmTitle,
                message: this.config.confirmMessage,
                isDanger: true,
                confirmText: this.config.btnConfirm,
                cancelText: this.config.btnCancel,
                icon: '⚠️'
            });

            if (!firstConfirm) return;

            // Second confirmation
            const secondConfirm = await showConfirmModal({
                title: this.config.doubleConfirmTitle,
                message: this.config.doubleConfirmMessage,
                isDanger: true,
                confirmText: this.config.btnDoubleConfirm,
                cancelText: this.config.btnDoubleCancel,
                icon: '🔥'
            });

            if (!secondConfirm) return;

            // Execute clear logic
            if (this.config.setBusy) {
                this.config.setBusy(true, { 
                    title: this.config.busyTitle, 
                    detail: this.config.busyDetail 
                });
            }

            try {
                if (typeof this.config.onClear === 'function') {
                    await this.config.onClear();
                }

                // Reload page after successful clear to reflect latest state
                if (this.config.setBusy) this.config.setBusy(false);
                alert(this.config.successMsg);
                window.location.reload();

            } catch (error) {
                console.error('[DangerZone] Failed to clear data:', error);
                if (this.config.setBusy) this.config.setBusy(false);
                alert(this.config.errorMsg.replace('{error}', error.message));
            }
        });
    }
}

/**
 * High-level utility: Mount Danger Zone in one click
 * Encapsulates instance creation, database deletion, and localStorage clearing logic.
 * 
 * @param {Object} config
 * @param {string} config.containerId - DOM element ID to mount to
 * @param {string} config.dbName - IndexedDB name to delete
 * @param {string} [config.localStorageKey] - LocalStorage key to delete
 * @param {string} [config.description] - Custom description text
 * @param {Function} [config.preClear] - Pre-clear hook (useful for closing DB connections)
 */
export function mountDangerZone(config) {
    const container = document.getElementById(config.containerId);
    if (!container) {
        console.warn(`[DangerZone] Mount point #${config.containerId} not found`);
        return;
    }

    new DangerZoneModule({
        container: container,
        description: config.description,
        onClear: async () => {
            if (typeof config.preClear === 'function') {
                await config.preClear();
            }
            if (config.dbName) {
                await deleteIndexedDB(config.dbName);
            }
            if (config.localStorageKey) {
                localStorage.removeItem(config.localStorageKey);
            }
        }
    });
}
