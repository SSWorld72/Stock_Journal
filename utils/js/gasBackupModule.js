/**
 * ============================================================================
 * GAS Private Cloud Backup Module (gasBackupModule.js)
 * ============================================================================
 * Handles connection to Google Apps Script (GAS) private cloud for data backup/restore,
 * and includes complete settings UI.
 * 
 * @example
 * import { GasBackupModule } from '../../utils/js/gasBackupModule.js';
 * 
 * window.gasBackupInstance = new GasBackupModule({
 *     containerId: 'gas-backup-module',
 *     settingsObj: settings,
 *     onSaveSettings: saveSettings,
 *     getCleanPayload: () => JSON.parse(JSON.stringify(settings)),
 *     onRestoreSuccess: () => window.location.reload()
 * });
 */
import { t } from './shared-i18n.js';

import { showConfirmModal } from './uiDialogs.js';
import { ZipBackupHelper } from './zipBackupHelper.js';
import { createTipBox } from './tipBox.js';

export class GasBackupModule {
    /**
     * Initialize module
     * @param {Object} config 
     * @param {string} config.containerId - Container ID for UI rendering
     * @param {Object} config.settingsObj - Reference to project's global settings object
     * @param {Function} config.onSaveSettings - Callback to save settings
     * @param {Function} config.getCleanPayload - Callback to get clean backup data (needs to clear unnecessary cache)
     * @param {Function} config.onRestoreSuccess - Callback after successful restore (usually window.location.reload())
     * @param {Function} [config.generateRestoreConfirmMessage] - (Optional) Custom restore confirmation message
     * @param {Function} [config.generateBackupSuccessMessage] - (Optional) Custom backup success message
     * @param {Function} [config.setAppBusy] - Callback to set UI busy state (optional)
     * @param {string} [config.customDescriptionHtml] - Custom description HTML (optional)
     * @param {string} [config.appName] - Project name identifier (default: UnknownApp)
     * @param {boolean} [config.useZip] - Whether to use ZIP compression (default: false)
     */
    constructor(config) {
        this.appName = config.appName || 'UnknownApp';
        this.containerId = config.containerId;
        this.settings = config.settingsObj;
        this.onSaveSettings = config.onSaveSettings;
        this.getCleanPayload = config.getCleanPayload;
        this.onRestoreSuccess = config.onRestoreSuccess;
        this.useGlobalRestoreMode = config.useGlobalRestoreMode || false;
        this.setAppBusy = config.setAppBusy || window.setAppBusy;
        this.useZip = config.useZip || false;
        this.titleHtml = config.titleHtml || null;
        this.tipBoxType = config.tipBoxType || 'success';
        
        // External custom message generators
        this.generateRestoreConfirmMessage = config.generateRestoreConfirmMessage || null;
        this.generateBackupSuccessMessage = config.generateBackupSuccessMessage || null;
        
        this.customDescriptionHtml = config.customDescriptionHtml || `
            <span class="font-medium text-emerald-600">${t('utils.gasBackup.defaultDescComplete')}</span>${t('utils.gasBackup.defaultDescNote')}<br>
            <span class="text-slate-400 text-[10px]">${t('utils.gasBackup.defaultDescHint')}</span>
        `;
        
        this.autoSyncTimer = null;
        this.renderUI();
        this.initHelpModal();
        this.bindEvents();
        
        // Listen to visibilitychange for mobile devices to immediately trigger backup when backgrounded
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.autoSyncTimer && !this.isSyncing) {
                console.log(t('utils.gasBackup.logAutoSyncForce'));
                clearTimeout(this.autoSyncTimer);
                this.autoSyncTimer = null;
                this.backupToPrivateCloud(true);
            }
        });
    }

    renderUI() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`GasBackupModule: Container #${this.containerId} not found`);
            return;
        }

        container.innerHTML = `
            <div style="padding-top: 16px;">
                <div class="flex items-center justify-between mb-1">
                    <h4 style="margin: 0; font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 6px; color: var(--text-main);">
                        ${this.titleHtml || t('utils.gasBackup.title')}
                    </h4>
                    <span class="text-[11px] font-medium px-2 py-0.5 rounded-full" style="background: var(--primary-color); color: #ffffff;">${t('utils.gasBackup.autoSyncBadge')}</span>
                </div>
                <p class="text-[0.85rem] mb-4 text-left" style="color: var(--text-muted); margin: 4px 0 12px 0;">
                    ${t('utils.gasBackup.desc')}
                </p>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3 p-3 rounded-lg border" style="background: var(--bg-color); border-color: var(--border-color);">
                    <div>
                        <label class="block text-xs font-medium text-main mb-1">${t('utils.gasBackup.autoSyncLabel')}</label>
                        <p class="text-[0.75rem] text-muted mb-2 leading-snug">${t('utils.gasBackup.autoSyncHint')}</p>
                        <select id="gas-setting-auto-sync-interval" class="form-control" style="padding: 0.5rem;">
                            <option value="0">${t('utils.gasBackup.autoSyncOff')}</option>
                            <option value="5000">${t('utils.gasBackup.sec5')}</option>
                            <option value="60000">${t('utils.gasBackup.min1')}</option>
                            <option value="180000">${t('utils.gasBackup.min3')}</option>
                            <option value="300000">${t('utils.gasBackup.min5')}</option>
                            <option value="600000">${t('utils.gasBackup.min10')}</option>
                            <option value="900000">${t('utils.gasBackup.min15')}</option>
                            <option value="1800000">${t('utils.gasBackup.min30')}</option>
                            <option value="3600000">${t('utils.gasBackup.hr1')}</option>
                            <option value="7200000">${t('utils.gasBackup.hr2')}</option>
                            <option value="14400000">${t('utils.gasBackup.hr4')}</option>
                            <option value="28800000">${t('utils.gasBackup.hr8')}</option>
                            <option value="86400000">${t('utils.gasBackup.hr24')}</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-muted mb-1" id="gas-label-backup-versions">${t('utils.gasBackup.backupVersions')}</label>
                        <select id="gas-setting-backup-versions" class="form-control" style="padding: 0.5rem;">
                            ${Array.from({length: 99}, (_, i) => '<option value="' + (i+1) + '">' + (i+1) + '</option>').join('\\n                            ')}
                        </select>
                    </div>
                    <div class="col-span-1 md:col-span-2 flex justify-end md:-mt-2">
                        <div id="gas-last-sync-time" class="text-[11px] text-muted hidden">${t('utils.gasBackup.lastSyncTime')}--</div>
                    </div>
                </div>
                
                <div class="flex flex-col md:flex-row gap-4 mb-3">
                    <div class="flex-1">
                        <div class="flex items-center justify-start gap-1.5 mb-1">
                            <label class="block text-xs font-medium text-muted">${t('utils.gasBackup.gasUrlLabel')}</label>
                            <svg id="btn-gas-url-help" class="w-[22px] h-[22px] text-blue-500 cursor-pointer hover:text-blue-400 transition-colors" viewBox="0 0 24 24" fill="currentColor" title="${t('utils.gasBackup.titleHelp')}" onclick="document.getElementById('gas-help-modal').classList.remove('hidden')">
                                <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
                            </svg>
                        </div>
                        <input type="text" id="gas-setting-private-gas-url"
                            class="form-control w-full" style="padding: 0.5rem;"
                            placeholder="https://script.google.com/macros/s/........./exec">
                        <div class="mt-2">
                            ${createTipBox({ type: this.tipBoxType, html: this.customDescriptionHtml, fontSize: '0.75rem' })}
                        </div>
                    </div>
                </div>

                <div class="flex flex-row gap-3">
                    <button id="gas-btn-cloud-backup"
                        class="btn-primary flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                        </svg>
                        ${t('utils.gasBackup.btnBackup')}
                    </button>
                    <button id="gas-btn-cloud-restore"
                        class="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-medium rounded-lg shadow-sm transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                        </svg>
                        ${t('utils.gasBackup.btnRestore')}
                    </button>
                </div>
                </div>
                
                ${this.useGlobalRestoreMode ? '' : `
                <div class="mt-4 pt-4 border-t border-slate-200/50 border-dashed dark:border-slate-700/50">
                    <label class="block text-xs font-medium text-muted mb-1">${t('utils.gasBackup.restoreModeLabel')}</label>
                    <select id="gas-setting-restore-mode"
                        class="form-control w-full text-sm block p-2 outline-none">
                        <option value="merge">${t('utils.gasBackup.restoreModeMerge')}</option>
                        <option value="overwrite">${t('utils.gasBackup.restoreModeOverwrite')}</option>
                    </select>
                </div>
                `}
            </div>
        `;
    }

    initHelpModal() {
        let gasHelpModal = document.getElementById('gas-help-modal');
        if (!gasHelpModal) {
            gasHelpModal = document.createElement('div');
            gasHelpModal.id = 'gas-help-modal';
            gasHelpModal.className = 'hidden fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4';
            gasHelpModal.innerHTML = `
                <div class="rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border bg-white dark:bg-slate-800" style="border-color: var(--border-color);">
                    <div class="px-5 py-4 flex justify-between items-center" style="background-color: var(--bg-color, #f8fafc); border-bottom: 1px solid var(--border-color);">
                        <h3 class="font-semibold text-lg flex items-center gap-2" style="color: var(--text-main);">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--primary-color);">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            ${t('utils.gasBackup.helpTitle')}
                        </h3>
                        <button id="btn-close-gas-help"
                            class="transition-colors focus:outline-none cursor-pointer" style="color: var(--text-muted);">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="p-5 text-sm leading-relaxed overflow-y-auto max-h-[70vh] space-y-4" style="color: var(--text-muted);">
                        <p>
                            ${t('utils.gasBackup.helpP1')}
                        </p>
                        <hr style="border-color: var(--border-color); opacity: 0.5;">

                        <div>
                            <strong class="px-2 py-1 rounded text-xs mb-2 inline-block" style="background-color: var(--active-bg); color: var(--active-text);">${t('utils.gasBackup.helpStep1')}</strong>
                            <ol class="list-decimal pl-5 space-y-1.5 mt-1" style="color: var(--text-muted);">
                                <li>${t('utils.gasBackup.helpStep1_1')}</li>
                                <li>${t('utils.gasBackup.helpStep1_2')}<code class="px-1 rounded text-[12px]" style="background-color: var(--bg-color); color: var(--secondary-color);">${this.appName}</code>。</li>
                                <li>${t('utils.gasBackup.helpStep1_3')}</li>
                                <li>${t('utils.gasBackup.helpStep1_4')}</li>
                            </ol>
                        </div>

                        <div>
                            <strong class="px-2 py-1 rounded text-xs mb-2 inline-block" style="background-color: var(--active-bg); color: var(--active-text);">${t('utils.gasBackup.helpStep2')}</strong>
                            <ol class="list-decimal pl-5 space-y-1.5 mt-1" style="color: var(--text-muted);">
                                <li>${t('utils.gasBackup.helpStep2_1')}</li>
                                <li>${t('utils.gasBackup.helpStep2_2')}</li>
                                <li><strong style="color: var(--secondary-color);">${t('utils.gasBackup.helpStep2_3')}</strong></li>
                                <li>${t('utils.gasBackup.helpStep2_4')}</li>
                            </ol>
                        </div>

                        <div>
                            <strong class="px-2 py-1 rounded text-xs mb-2 inline-block" style="background-color: var(--active-bg); color: var(--active-text);">${t('utils.gasBackup.helpStep3')}</strong>
                            <ol class="list-decimal pl-5 space-y-1.5 mt-1" style="color: var(--text-muted);">
                                <li>${t('utils.gasBackup.helpStep3_1')}</li>
                                <li>${t('utils.gasBackup.helpStep3_2')}</li>
                                <li>${t('utils.gasBackup.helpStep3_3')}</li>
                            </ol>
                        </div>

                        <div class="p-3 rounded-lg border" style="background-color: var(--active-bg); color: var(--text-main); border-color: var(--border-color);">
                            <div class="flex items-start gap-2">
                                <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color: var(--primary-color);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                <span class="text-xs leading-relaxed font-medium">${t('utils.gasBackup.helpTip')}</span>
                            </div>
                        </div>
                    </div>
                    <div class="px-5 py-4 flex justify-end" style="background-color: var(--bg-color); border-top: 1px solid var(--border-color);">
                        <button id="btn-gas-help-ok" class="px-5 py-2 font-medium rounded-lg transition-colors cursor-pointer" style="background-color: var(--primary-color); color: #fff;">${t('utils.gasBackup.btnOk')}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(gasHelpModal);
            
            // Bind close events
            const closeModal = () => gasHelpModal.classList.add('hidden');
            document.getElementById('btn-close-gas-help')?.addEventListener('click', closeModal);
            document.getElementById('btn-gas-help-ok')?.addEventListener('click', closeModal);
            // Click outside to close
            gasHelpModal.addEventListener('click', (e) => {
                if (e.target === gasHelpModal) closeModal();
            });
        }
    }

    bindEvents() {
        const gasUrlInput = document.getElementById('gas-setting-private-gas-url');
        if (gasUrlInput) {
            gasUrlInput.value = this.settings.privateGasUrl || '';
            gasUrlInput.addEventListener('input', (e) => {
                const oldUrl = this.settings.privateGasUrl;
                const newUrl = e.target.value.trim();
                this.settings.privateGasUrl = newUrl;
                
                // [Security] If initially empty url, stop any pending auto-sync to prevent empty data upload
                if (!oldUrl && newUrl) {
                    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
                    console.log(t('utils.gasBackup.logFirstUrl'));
                }
                
                this.onSaveSettings();
            });
        }

        const autoSyncIntervalSelect = document.getElementById('gas-setting-auto-sync-interval');
        if (autoSyncIntervalSelect) {
            autoSyncIntervalSelect.value = (this.settings.autoSyncInterval !== undefined ? this.settings.autoSyncInterval : 180000).toString();
            autoSyncIntervalSelect.addEventListener('change', (e) => {
                this.settings.autoSyncInterval = parseInt(e.target.value, 10);
                this.onSaveSettings();
            });
        }

        if (!this.useGlobalRestoreMode) {
            const restoreModeSelect = document.getElementById('gas-setting-restore-mode');
            if (restoreModeSelect) {
                restoreModeSelect.value = this.settings.cloudRestoreMode || 'merge';
                restoreModeSelect.addEventListener('change', (e) => {
                    this.settings.cloudRestoreMode = e.target.value;
                    this.onSaveSettings();
                });
            }
        }

        const backupVersionsInput = document.getElementById('gas-setting-backup-versions');
        
        if (backupVersionsInput) {
            backupVersionsInput.value = this.settings.backupVersions || 50;

            backupVersionsInput.addEventListener('change', (e) => {
                let val = parseInt(e.target.value, 10);
                if (val < 1) val = 1;
                if (val > 99) val = 99;
                e.target.value = val;
                this.settings.backupVersions = val;
                this.onSaveSettings();
            });
        }
        
        const syncTimeEl = document.getElementById('gas-last-sync-time');
        if (syncTimeEl) {
            if (this.settings.lastSyncTime) {
                syncTimeEl.textContent = `${t('utils.gasBackup.lastSyncTime')}${this.settings.lastSyncTime}`;
                syncTimeEl.classList.remove('hidden');
            } else {
                syncTimeEl.textContent = `${t('utils.gasBackup.lastSyncTime')}${t('utils.gasBackup.lastSyncNotSync')}`;
                syncTimeEl.classList.remove('hidden');
            }
        }

        const btnBackup = document.getElementById('gas-btn-cloud-backup');
        if (btnBackup) {
            btnBackup.addEventListener('click', () => this.backupToPrivateCloud(false));
        }

        const btnRestore = document.getElementById('gas-btn-cloud-restore');
        if (btnRestore) {
            btnRestore.addEventListener('click', () => this.restoreFromPrivateCloud());
        }

        // Bind help modal events
        const btnGasHelp = document.getElementById('btn-gas-url-help');
        const gasHelpModal = document.getElementById('gas-help-modal');
        const btnGasHelpClose = document.getElementById('btn-gas-help-close');
        const btnGasHelpOk = document.getElementById('btn-gas-help-ok');
        
        if (btnGasHelp && gasHelpModal) {
            btnGasHelp.addEventListener('click', () => gasHelpModal.classList.remove('hidden'));
            const closeModal = () => gasHelpModal.classList.add('hidden');
            
            if (btnGasHelpClose) btnGasHelpClose.addEventListener('click', closeModal);
            if (btnGasHelpOk) btnGasHelpOk.addEventListener('click', closeModal);
            // Click outside to close
            gasHelpModal.addEventListener('click', (e) => {
                if (e.target === gasHelpModal) closeModal();
            });
        }
    }

    triggerAutoSync() {
        if (!this.settings.privateGasUrl) return;
        
        const interval = this.settings.autoSyncInterval !== undefined ? this.settings.autoSyncInterval : 180000;
        if (interval <= 0) {
            if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
            return;
        }
        
        if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
        this.autoSyncTimer = setTimeout(() => {
            console.log(t('utils.gasBackup.logAutoSyncTrigger').replace('{interval}', interval));
            this.backupToPrivateCloud(true);
        }, interval);
    }

    stopAutoSync() {
        if (this.autoSyncTimer) {
            clearTimeout(this.autoSyncTimer);
            this.autoSyncTimer = null;
            console.log(t('utils.gasBackup.logAutoSyncStop'));
        }
    }

    async backupToPrivateCloud(isAutoSync = false) {
        if (this.isSyncing) {
            if (isAutoSync) {
                this.hasPendingAutoSync = true;
                console.log(t('utils.gasBackup.logAutoSyncQueueing'));
            }
            return;
        }

        this.isSyncing = true;
        this.hasPendingAutoSync = false;
        if (!this.settings.privateGasUrl) {
            if (!isAutoSync) {
                await showConfirmModal({
                    title: t('utils.gasBackup.needUrlTitle'),
                    message: t('utils.gasBackup.needUrlMsg'),
                    confirmText: t('utils.gasBackup.confirmKnown'),
                    cancelText: t('utils.gasBackup.confirmCancel'),
                    icon: '⚠️'
                });
            }
            return;
        }
        const btn = document.getElementById('gas-btn-cloud-backup');
        if (btn && !isAutoSync) btn.disabled = true;
        try {
            const payloadData = await this.getCleanPayload();
            
            // Read advanced backup settings from LocalStorage
            const backupSettings = JSON.parse(localStorage.getItem('global_backup_settings')) || {
                mode: 'daily',
                includePhotos: true
            };

            if (this.setAppBusy && !isAutoSync) {
                this.setAppBusy(true, {
                    title: t('utils.gasBackup.busyBackupTitle'),
                    detail: t('utils.gasBackup.busyBackupZip'),
                    statusText: t('utils.gasBackup.busyBackupZipStatus'),
                    progress: 20
                });
            }

            // 1. Generate backup data and filename
            const d = new Date();
            const pad = n => (n < 10 ? '0' + n : n);
            const timeStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
            
            let uploadData = '';
            let backupFileName = '';
            let fileSizeKb = '0';

            if (!this.useZip) {
                // Without ZIP compression, use raw JSON (formatted for readability)
                const jsonStr = JSON.stringify(payloadData, null, 2);
                backupFileName = `${this.appName}_PrivateBackup_${timeStr}.json`;
                const blob = new Blob([jsonStr], { type: 'application/json' });
                fileSizeKb = (blob.size / 1024).toFixed(1);

                uploadData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result;
                        resolve(result.substring(result.indexOf(',') + 1));
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } else {
                // Use ZIP compression and convert to Base64
                const zipBlob = await ZipBackupHelper.createBackupZip(payloadData, backupSettings);
                fileSizeKb = (zipBlob.size / 1024).toFixed(1);
                backupFileName = `${this.appName}_PrivateBackup_${timeStr}.zip`;

                uploadData = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result;
                        resolve(result.substring(result.indexOf(',') + 1));
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(zipBlob);
                });
            }

            // 3. Chunked Upload
            // Set each chunk size to 20MB (character length) to avoid unnecessary chunking for files < 20MB
            // The limit of Google Apps Script doPost is 50MB.
            const chunkSize = 20 * 1024 * 1024; 
            const totalChunks = Math.ceil(uploadData.length / chunkSize);
            const sessionId = 'session_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

            if (this.setAppBusy && !isAutoSync) {
                this.setAppBusy(true, {
                    title: t('utils.gasBackup.busyBackupTitle'),
                    detail: t('utils.gasBackup.busyBackupUploadDetail').replace('{size}', fileSizeKb).replace('{chunks}', totalChunks),
                    statusText: t('utils.gasBackup.busyBackupUploadStatus'),
                    progress: 40
                });
            }

            let resData = null;
            let success = false;
            
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, uploadData.length);
                const chunkStr = uploadData.substring(start, end);

                if (this.setAppBusy && !isAutoSync) {
                    this.setAppBusy(true, {
                        title: t('utils.gasBackup.busyBackupTitle'),
                        detail: t('utils.gasBackup.busyBackupUploadDetailProg').replace('{size}', fileSizeKb).replace('{chunks}', totalChunks).replace('{current}', i + 1).replace('{total}', totalChunks),
                        statusText: t('utils.gasBackup.busyBackupUploadStatusProg').replace('{current}', i + 1),
                        progress: 40 + Math.floor((i / totalChunks) * 60)
                    });
                }

                const uploadPayload = {
                    action: 'backup_chunk',
                    uploadSessionId: sessionId,
                    chunkIndex: i,
                    totalChunks: totalChunks,
                    data: chunkStr,
                    appName: this.appName,
                    fileName: backupFileName,
                    backupVersions: this.settings.backupVersions || 50
                };

                // GAS request function with automatic retry (handling cold start issue)
                // When GAS Serverless container is idle for a long time, the first request might return HTML (warming up)
                // If HTML is detected, automatically wait 4 seconds and retry, up to 2 times
                const MAX_RETRIES = 2;
                const RETRY_DELAY_MS = 4000;
                let lastError = null;
                resData = null;

                for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                    if (attempt > 0) {
                        console.warn(`[Cloud Backup] GAS cold start detected, waiting ${RETRY_DELAY_MS / 1000}s before retry (${attempt}/${MAX_RETRIES})...`);
                        if (this.setAppBusy && !isAutoSync) {
                            this.setAppBusy(true, {
                                title: t('utils.gasBackup.busyBackupTitle'),
                                detail: t('utils.gasBackup.coldStartDetected', `GAS container warming up, auto-retrying in ${RETRY_DELAY_MS / 1000}s...`).replace('{sec}', RETRY_DELAY_MS / 1000),
                                statusText: t('utils.gasBackup.coldStartRetrying', `Retrying (${attempt}/${MAX_RETRIES})`).replace('{current}', attempt).replace('{max}', MAX_RETRIES),
                                progress: 40 + Math.floor((i / totalChunks) * 60)
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    }

                    try {
                        const res = await fetch(this.settings.privateGasUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify(uploadPayload)
                        });

                        const text = await res.text();
                        try {
                            resData = JSON.parse(text);
                            lastError = null;
                            break; // Parsing successful, break the retry loop
                        } catch (parseErr) {
                            if (text.includes('<!DOCTYPE') || text.toLowerCase().includes('<html')) {
                                // GAS cold start returned HTML, record error and continue retry
                                lastError = new Error('GAS proxy returned HTML instead of JSON. Ensure your GAS Web App is deployed to: Execute as "Me" and Access to "Anyone".');
                                // If max retries reached, throw the error
                                if (attempt === MAX_RETRIES) throw lastError;
                                continue; // Continue to the next retry attempt
                            }
                            // Other parsing errors, throw immediately without retrying
                            throw new Error(`Failed to parse response: ${text.substring(0, 100)}...`);
                        }
                    } catch (fetchErr) {
                        // Network error from fetch itself, throw immediately without retrying
                        if (fetchErr.message && (fetchErr.message.includes('GAS proxy') || fetchErr.message.includes('Failed to parse'))) {
                            throw fetchErr;
                        }
                        throw fetchErr;
                    }
                }
                
                if (resData && resData.status === 'success') {
                    success = true;
                } else {
                    success = false;
                    throw new Error((resData && resData.message) ? resData.message : 'Cloud response error');
                }

                // If chunked upload, add a 2 second delay between chunks to allow Google Drive replication
                // Because GAS DriveApp is eventually consistent, reading a file created in a previous request too quickly might return empty data.
                if (totalChunks > 1 && i < totalChunks - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (success) {
                // Update sync time
                const syncTimeEl = document.getElementById('gas-last-sync-time');
                let twTime = '';
                if (syncTimeEl) {
                    const now = new Date();
                    twTime = new Intl.DateTimeFormat('zh-TW', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: false
                    }).format(now);
                    syncTimeEl.textContent = `${t('utils.gasBackup.lastSyncTime')}${twTime}`;
                    syncTimeEl.classList.remove('hidden');
                    syncTimeEl.style.color = ''; // Reset error color
                }
                
                this.settings.lastSyncTime = twTime;
                this.onSaveSettings();

                console.log(t('systemLogs.gasBackupModule.logBackupSuccess', { type: isAutoSync ? t('systemLogs.gasBackupModule.typeAuto') : t('systemLogs.gasBackupModule.typeManual'), size: fileSizeKb }));

                if (!isAutoSync) {
                    let successMsg = t('utils.gasBackup.backupSuccess');
                    if (typeof this.generateBackupSuccessMessage === 'function') {
                        successMsg = await this.generateBackupSuccessMessage(payloadData);
                    }
                    if (this.setAppBusy) {
                        this.setAppBusy(false, { success: true, message: successMsg });
                    } else {
                        await showConfirmModal({ title: t('utils.gasBackup.backupSuccess'), message: successMsg, confirmText: t('utils.gasBackup.confirmKnown'), icon: '✅' });
                    }
                }
            } else {
                throw new Error((resData && resData.message) || 'Cloud response error');
            }
        } catch (err) {
            console.error('Backup error:', err);
            
            const syncTimeEl = document.getElementById('gas-last-sync-time');
            if (syncTimeEl) {
                const now = new Date();
                const twTime = new Intl.DateTimeFormat('zh-TW', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                }).format(now);
                syncTimeEl.textContent = t('utils.gasBackup.backupErrorSync').replace('{time}', twTime).replace('{msg}', err.message);
                syncTimeEl.classList.remove('hidden');
                syncTimeEl.style.color = 'var(--danger-color, #ef4444)';
            }
            
            if (!isAutoSync) {
                if (this.setAppBusy) this.setAppBusy(false, { error: true, message: t('utils.gasBackup.backupFailTitle') });
                await showConfirmModal({ title: t('utils.gasBackup.backupFailTitle'), message: err.message, confirmText: t('utils.gasBackup.confirmKnown'), icon: '❌', isDanger: true });
            }
        } finally {
            if (btn && !isAutoSync) btn.disabled = false;
            this.isSyncing = false;
            
            // If there were new data changes during the sync, trigger auto sync again
            if (this.hasPendingAutoSync) {
                this.hasPendingAutoSync = false;
                console.log(t('utils.gasBackup.logAutoSyncRestart'));
                this.triggerAutoSync();
            }
        }
    }

    async restoreFromPrivateCloud() {
        this.isSyncing = false;
        this.hasPendingAutoSync = false;
        if (!this.settings.privateGasUrl) {
            await showConfirmModal({
                title: t('utils.gasBackup.needUrlTitle'),
                message: t('utils.gasBackup.needUrlMsg'),
                confirmText: t('utils.gasBackup.confirmKnown'),
                cancelText: t('utils.gasBackup.confirmCancel'),
                icon: '⚠️'
            });
            return;
        }
        
        const isConfirmed = await showConfirmModal({
            title: t('utils.gasBackup.warningRestoreTitle'),
            message: t('utils.gasBackup.warningRestoreMsg'),
            confirmText: t('utils.gasBackup.warningRestoreBtn'),
            cancelText: t('utils.gasBackup.confirmCancel'),
            icon: '⚠️',
            isDanger: true
        });
        
        if (!isConfirmed) {
            return;
        }
        const btn = document.getElementById('gas-btn-cloud-restore');
        if (btn) btn.disabled = true;
        try {
            if (this.setAppBusy) {
                this.setAppBusy(true, {
                    title: t('utils.gasBackup.busyRestoreTitle'),
                    detail: t('utils.gasBackup.busyRestoreList'),
                    statusText: t('utils.gasBackup.busyRestoreListStatus'),
                    progress: 20
                });
            }
            
            let fetchUrl = this.settings.privateGasUrl;
            const urlBase = fetchUrl.includes('?') ? `${fetchUrl}&appName=${encodeURIComponent(this.appName)}` : `${fetchUrl}?appName=${encodeURIComponent(this.appName)}`;
            
            // 1. Get version list
            const listRes = await fetch(`${urlBase}&action=list`);
            const listText = await listRes.text();
            let listPayload;
            try {
                listPayload = JSON.parse(listText);
            } catch (e) {
                console.error((window.t ? window.t('utils.gasBackupModule.errorNonJson') : 'Cloud returned non-JSON data:'), listText);
                let extraHint = '';
                if (listText.toLowerCase().includes('<html')) {
                    extraHint = (window.t ? window.t('utils.gasBackupModule.errorHtmlHint') : '\\n(System received webpage HTML instead of data. Please check: 1. Did you copy the script editor URL? It must be the "Web App" URL. 2. Is access set to "Anyone"?)');
                }
                throw new Error((window.t ? window.t('utils.gasBackupModule.errorParseCloud') : 'Unable to parse cloud data. Please verify the URL is correct and the GAS script is up to date.') + extraHint);
            }
            if (listPayload.status === 'error') {
                throw new Error((window.t ? window.t('utils.gasBackupModule.errorCloudResponse') : 'Cloud returned error: ') + listPayload.message);
            }

            const versions = listPayload.data || [];
            if (versions.length === 0) {
                throw new Error(window.t ? window.t('utils.gasBackupModule.errorNoBackup') : 'Restore failed: No backup data on the cloud yet.');
            }

            let selectedFileId = null;
            let selectedFileName = null;

            // 2. If only one version, restore directly; otherwise show selection modal
            if (versions.length === 1) {
                selectedFileId = versions[0].id || versions[0].fileId;
                selectedFileName = versions[0].name || versions[0].fileName;
            } else {
                if (this.setAppBusy) this.setAppBusy(false); // Temporarily close loading to show modal
                selectedFileId = await this.showVersionSelectModal(versions);
                if (!selectedFileId) {
                    return; // User canceled
                }
                selectedFileName = versions.find(v => (v.id || v.fileId) === selectedFileId)?.name || 'Backup.zip';
                if (this.setAppBusy) {
                    this.setAppBusy(true, {
                        title: t('utils.gasBackup.busyRestoreTitle'),
                        detail: t('utils.gasBackup.busyRestoreDownload').replace('{name}', selectedFileName),
                        statusText: t('utils.gasBackup.busyRestoreDownloadStatus'),
                        progress: 50
                    });
                }
            }
            
            // 3. Download specified version content
            const restoreRes = await fetch(`${urlBase}&action=download&fileId=${encodeURIComponent(selectedFileId)}`);
            const restoreText = await restoreRes.text();
            let payload;
            try {
                payload = JSON.parse(restoreText);
            } catch (e) {
                throw new Error(t('utils.gasBackup.errorDownloadFormat'));
            }
            
            if (payload.status === 'error') {
                throw new Error('Cloud response error: ' + payload.message);
            }
            
            let backupData = null;
            const isZip = payload.isZip || (selectedFileName && selectedFileName.endsWith('.zip'));

            if (isZip) {
                // Decode Base64 to ArrayBuffer and pass to ZipBackupHelper
                const base64String = payload.data;
                const binaryString = atob(base64String);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                backupData = await ZipBackupHelper.extractBackupZip(bytes.buffer);
            } else {
                // Legacy plaintext JSON compatibility
                let outerBackupData = payload.data;
                if (!outerBackupData) throw new Error(t('utils.gasBackup.errorBackupFormat'));
                
                if (typeof outerBackupData === 'string') {
                    try { 
                        outerBackupData = JSON.parse(outerBackupData); 
                    } catch(e) {
                        // Attempt Base64 decode (compatible with new GAS download action for legacy JSON files)
                        try {
                            const decodedStr = decodeURIComponent(escape(atob(outerBackupData)));
                            outerBackupData = JSON.parse(decodedStr);
                        } catch(e2) {
                            // Fall through to error handling
                        }
                    }
                }
                
                backupData = outerBackupData.data ? outerBackupData.data : outerBackupData;
                
                if (typeof backupData === 'string') {
                    try { backupData = JSON.parse(backupData); } catch(e) {
                        throw new Error(t('utils.gasBackup.errorCloudDataCorrupt'));
                    }
                }
            }

            let confirmMessage = t('utils.gasBackup.confirmRestoreMsg');
            if (typeof this.generateRestoreConfirmMessage === 'function') {
                confirmMessage = await this.generateRestoreConfirmMessage(backupData);
            }

            if (this.setAppBusy) this.setAppBusy(false);
            
            let isOverwrite = false;
            if (this.useGlobalRestoreMode) {
                const globalRestoreModeEl = document.getElementById('global-restore-mode');
                isOverwrite = globalRestoreModeEl ? (globalRestoreModeEl.value === 'overwrite') : false;
            } else {
                isOverwrite = this.settings.cloudRestoreMode === 'overwrite';
            }
            
            const isConfirmed = await showConfirmModal({
                title: t('utils.gasBackup.confirmRestoreTitle'),
                message: confirmMessage,
                confirmText: t('utils.gasBackup.confirmRestoreBtn'),
                cancelText: t('utils.gasBackup.confirmCancel'),
                icon: '📦',
                isDanger: isOverwrite
            });

            if (!isConfirmed) {
                return;
            }

            if (this.setAppBusy) {
                this.setAppBusy(true, {
                    title: t('utils.gasBackup.busyRestoreTitle'),
                    detail: t('utils.gasBackup.busyRestoreProcess'),
                    statusText: t('utils.gasBackup.busyRestoreProcessStatus'),
                    progress: 80
                });
            }

            const oldPrivateGasUrl = this.settings.privateGasUrl;
            
            for (const key in this.settings) {
                delete this.settings[key];
            }
            
            // Write global data
            if (backupData.preferences && backupData.preferences.gasSettings) {
                try {
                    const parsedGasSettings = typeof backupData.preferences.gasSettings === 'string' 
                        ? JSON.parse(backupData.preferences.gasSettings) 
                        : backupData.preferences.gasSettings;
                    Object.assign(this.settings, parsedGasSettings);
                } catch(e) {}
            } else {
                if (backupData.preferences && typeof backupData.preferences === 'object' && !Array.isArray(backupData.preferences)) {
                    Object.assign(this.settings, backupData.preferences);
                } else {
                    Object.assign(this.settings, backupData);
                }
            }
            
            const newPrivateGasUrl = this.settings.privateGasUrl;

            // 1. Check and ask for Private Gas Url
            if (newPrivateGasUrl && oldPrivateGasUrl && newPrivateGasUrl !== oldPrivateGasUrl) {
                const msg = t('utils.gasBackup.warningUrlDiff').replace('{newUrl}', newPrivateGasUrl).replace('{oldUrl}', oldPrivateGasUrl);
                if (!confirm(msg)) {
                    this.settings.privateGasUrl = oldPrivateGasUrl;
                }
            } else if (!newPrivateGasUrl && oldPrivateGasUrl) {
                this.settings.privateGasUrl = oldPrivateGasUrl;
            }

            await this.onSaveSettings();
            
            console.log(t('utils.gasBackup.restoreSuccessLog'));
            
            if (this.onRestoreSuccess) {
                await this.onRestoreSuccess(backupData);
            } else {
                if (this.setAppBusy) this.setAppBusy(false);
                await showConfirmModal({ title: t('utils.gasBackup.restoreSuccessTitle'), message: t('utils.gasBackup.restoreSuccessMsg'), confirmText: t('utils.gasBackup.confirmKnown'), icon: '✅' });
                window.location.reload();
            }
        } catch (err) {
            console.error('Restore error:', err);
            if (this.setAppBusy) this.setAppBusy(false, { error: true, message: t('utils.gasBackup.restoreFailTitle') });
            await showConfirmModal({ title: t('utils.gasBackup.restoreFailTitle'), message: err.message, confirmText: t('utils.gasBackup.confirmKnown'), icon: '❌', isDanger: true });
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // Create and show version selection modal
    showVersionSelectModal(versions) {
        return new Promise((resolve) => {
            // Build UI
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4';
            
            const modal = document.createElement('div');
            modal.className = 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden';
            
            // Header
            const header = document.createElement('div');
            header.className = 'px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900';
            header.innerHTML = `
                <h3 class="font-bold text-slate-800 dark:text-slate-100 text-base">${t('utils.gasBackup.modalVersionTitle')}</h3>
                <button class="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 transition-colors p-1" id="btn-close-version-modal">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            `;
            
            // Body
            const body = document.createElement('div');
            body.className = 'p-2 max-h-[60vh] overflow-y-auto';
            
            const list = document.createElement('div');
            list.className = 'flex flex-col gap-1';
            
            versions.forEach((v, index) => {
                const btn = document.createElement('button');
                btn.className = 'w-full text-left px-4 py-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 focus:bg-slate-50 dark:focus:bg-slate-700 focus:outline-none transition-colors group border border-transparent hover:border-slate-200 dark:hover:border-slate-600 flex items-center justify-between';
                
                const d = new Date(v.date || v.dateCreated);
                const dateStr = d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
                const timeStr = d.toLocaleTimeString('zh-TW', { hour12: false });
                
                let badge = '';
                if (index === 0) {
                    badge = `<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 ml-2">${t('utils.gasBackup.badgeLatest')}</span>`;
                }
                
                const displayFileName = (v.name || v.fileName || 'Backup').replace(/\.jsonl?$/, '');
                
                btn.innerHTML = `
                    <div class="flex flex-col">
                        <div class="flex items-center">
                            <span class="font-medium text-[var(--text-main)] group-hover:text-[var(--primary-color)]">${dateStr} ${timeStr}</span>
                            ${badge}
                        </div>
                        <span class="text-xs text-[var(--text-muted)] mt-0.5 font-mono">${displayFileName}</span>
                    </div>
                    <svg class="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--primary-color)] opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                `;
                
                btn.onclick = () => {
                    document.body.removeChild(overlay);
                    resolve(v.id || v.fileId);
                };
                list.appendChild(btn);
            });
            
            body.appendChild(list);
            modal.appendChild(header);
            modal.appendChild(body);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            // Close event
            document.getElementById('btn-close-version-modal').onclick = () => {
                document.body.removeChild(overlay);
                resolve(null);
            };
            
            // Click outside to close
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    resolve(null);
                }
            };
        });
    }
}
