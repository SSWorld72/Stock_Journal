import { showInlineProgress, updateInlineProgress, hideInlineProgress, setAppBusy } from './uiBlocker.js';

/**
 * ============================================================================
 * Universal Backup Management Center (BackupManager)
 * ============================================================================
 * Coordinates the UI flow for exporting and importing data, including full-screen blockers,
 * inline progress bars, and button locking. The actual data processing logic is injected 
 * via parameters (exportAction, importAction) to achieve separation of concerns.
 * 
 * @example
 * import { BackupManager } from '../../utils/js/backupManager.js';
 * 
 * const backupMgr = new BackupManager({
 *     containerId: 'jsonl-box',
 *     exportBtnId: 'btn-export-jsonl',
 *     importBtnId: 'btn-import-jsonl'
 * });
 * backupMgr.setupExport(async () => { // Handle export logic });
 * backupMgr.setupImport(async (file) => { // Handle import logic });
 */
export class BackupManager {
    /**
     * @param {Object} options
     * @param {string} options.containerId - Container ID for inline progress bar (default 'jsonl-box')
     * @param {string} options.exportBtnId - Export button ID (default 'btn-export-jsonl')
     * @param {string} options.importBtnId - Import button ID (default 'btn-import-jsonl')
     */
    constructor(options = {}) {
        this.containerId = options.containerId || 'jsonl-box';
        this.exportBtnId = options.exportBtnId || 'btn-export-jsonl';
        this.importBtnId = options.importBtnId || 'btn-import-jsonl';
    }

    showProgress(label) { showInlineProgress(this.containerId, label); }
    updateProgress(count, total, label) { updateInlineProgress(this.containerId, count, total, label); }
    hideProgress(detail) { hideInlineProgress(this.containerId, detail); }

    toggleButtons(disabled) {
        const btnExport = document.getElementById(this.exportBtnId);
        const btnImport = document.getElementById(this.importBtnId);
        if (btnExport) { 
            btnExport.disabled = disabled; 
            disabled ? btnExport.classList.add('opacity-50', 'cursor-not-allowed') : btnExport.classList.remove('opacity-50', 'cursor-not-allowed'); 
        }
        if (btnImport) { 
            btnImport.disabled = disabled; 
            disabled ? btnImport.classList.add('opacity-50', 'cursor-not-allowed') : btnImport.classList.remove('opacity-50', 'cursor-not-allowed'); 
        }
    }

    /**
     * Execute export process
     * @param {Object} config
     * @param {string} config.title - Main title for the blocker
     * @param {string} config.initialDetail - Initial subtitle for the blocker
     * @param {string} config.filename - Output filename
     * @param {Function} config.exportAction - Async function handling the actual export logic, receives progressCallback
     */
    async runExport({ title, initialDetail, filename, exportAction }) {
        this.toggleButtons(true);
        try {
            this.showProgress(window.t ? window.t('systemLogs.backupManager.prepExport') : 'Preparing export...');
            setAppBusy(true, {
                title: title || (window.t ? window.t('systemLogs.backupManager.exportTitle') : 'Database Export'),
                detail: initialDetail || (window.t ? window.t('systemLogs.backupManager.exportExtractDetail') : 'Extracting all local database records, please do not switch tabs or close the window...'),
                progress: 5,
                countText: window.t ? window.t('systemLogs.backupManager.prepStatus') : 'Preparing...',
                statusText: window.t ? window.t('systemLogs.backupManager.collectStatus') : 'Collecting data...'
            });

            // exportAction returns Blob or string
            const fileData = await exportAction((count, total) => {
                this.updateProgress(count, total, window.t ? window.t('systemLogs.backupManager.exporting') : 'Exporting...');
                const pct = total ? Math.min(99, Math.round((count / total) * 100)) : 10;
                const countDisplay = total 
                    ? `${count.toLocaleString()} / ${total.toLocaleString()} ${window.t ? window.t('systemLogs.backupManager.countRecords', { count: '' }).replace(' ', '') : 'records'} (${pct}%)` 
                    : (window.t ? window.t('systemLogs.backupManager.countRecords', { count: count.toLocaleString() }) : `${count.toLocaleString()} records`);
                setAppBusy(true, {
                    title: title || (window.t ? window.t('systemLogs.backupManager.exportTitle') : 'Database Export'),
                    detail: window.t ? window.t('systemLogs.backupManager.genBackupDetail') : 'Generating backup file, please do not switch tabs or close the window...',
                    progress: pct,
                    countText: countDisplay,
                    statusText: window.t ? window.t('systemLogs.backupManager.exportedStatus', { count: count.toLocaleString() }) : `Exported ${count.toLocaleString()} records`
                });
            });

            if (fileData !== undefined && fileData !== null && typeof fileData !== 'number') {
                const blob = typeof fileData === 'string' ? new Blob([fileData], { type: 'application/x-jsonlines' }) : fileData;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            this.hideProgress(window.t ? window.t('systemLogs.backupManager.exportSuccess', { filename }) : `Backup successful! Downloaded ${filename}`);
            setAppBusy(false, {
                success: true,
                message: window.t ? window.t('systemLogs.backupManager.exportSuccess', { filename }) : `Backup complete! Successfully downloaded ${filename}`
            });
        } catch (err) {
            console.error("Export Error:", err);
            this.hideProgress(window.t ? window.t('systemLogs.backupManager.exportFailedIcon', { msg: err.message }) : `❌ Export failed: ${err.message}`);
            setAppBusy(false, {
                error: true,
                message: window.t ? window.t('systemLogs.backupManager.exportFailed', { msg: err.message }) : `Export failed: ${err.message}`
            });
        } finally {
            this.toggleButtons(false);
        }
    }

    /**
     * Execute import process
     * @param {Object} config
     * @param {File} config.file - File selected by the user
     * @param {string} config.confirmMessage - Confirmation message before import (skip if empty)
     * @param {string} config.title - Main title for the blocker
     * @param {string} config.initialDetail - Initial subtitle for the blocker
     * @param {string} config.progressDetail - Subtitle during import progress
     * @param {Function} config.importAction - Async function handling actual import logic, receives (file, progressCallback)
     * @param {boolean} config.onSuccessReload - Whether to automatically reload page on success
     */
    async runImport({ file, confirmMessage, title, initialDetail, progressDetail, importAction, onSuccessReload = false }) {
        if (!file) return false;

        if (confirmMessage && !confirm(confirmMessage)) {
            return false;
        }

        const startTime = performance.now();
        const isGz = file.name.endsWith('.gz');

        this.toggleButtons(true);
        try {
            this.showProgress(isGz ? (window.t ? window.t('systemLogs.backupManager.importGz') : 'Importing... extracting gzip') : (window.t ? window.t('systemLogs.backupManager.importing') : 'Importing...'));
            setAppBusy(true, {
                title: title || (window.t ? window.t('systemLogs.backupManager.importTitle') : 'Database Import'),
                detail: initialDetail || (isGz ? (window.t ? window.t('systemLogs.backupManager.importGzDetail') : 'Extracting and restoring database, please do not switch tabs or close the window...') : (window.t ? window.t('systemLogs.backupManager.importDetail') : 'Restoring database, please do not switch tabs or close the window...')),
                progress: 5,
                countText: window.t ? window.t('systemLogs.backupManager.prepStatus') : 'Preparing...',
                statusText: window.t ? window.t('systemLogs.backupManager.readingFile') : 'Reading file...'
            });

            // importAction must return the total processed count, or an object { totalCount, addedTxCount, skippedTxCount }
            const result = await importAction(file, (count, expectedTotal, fileSize, bytesRead) => {
                let pct = 0;
                let pctText = '';
                let progressTotal = expectedTotal;
                if (expectedTotal) {
                    pct = Math.min(99, Math.round((count / expectedTotal) * 100));
                    pctText = ` (${pct}%)`;
                } else if (fileSize && bytesRead) {
                    pct = Math.min(99, Math.round((bytesRead / fileSize) * 100));
                    pctText = ` (${pct}%)`;
                }
                this.updateProgress(count, progressTotal, (window.t ? window.t('systemLogs.backupManager.importing') : 'Importing...') + pctText);

                const countDisplay = expectedTotal 
                    ? `${count.toLocaleString()} / ${expectedTotal.toLocaleString()} ${window.t ? window.t('systemLogs.backupManager.countRecords', { count: '' }).replace(' ', '') : 'records'} (${pct}%)`
                    : (pct ? `${pct}%` : '');
                
                setAppBusy(true, {
                    title: title || (window.t ? window.t('systemLogs.backupManager.importTitle') : 'Database Import'),
                    detail: progressDetail || (window.t ? window.t('systemLogs.backupManager.writingDb') : 'Writing to database, please do not switch tabs or close the window...'),
                    progress: pct || 10,
                    countText: countDisplay,
                    statusText: window.t ? window.t('systemLogs.backupManager.processedStatus', { count: count.toLocaleString() }) : `Processed ${count.toLocaleString()} records`
                });
            });

            const total = typeof result === 'object' ? (result.totalCount || result.total || 0) : result;
            const addedTx = typeof result === 'object' ? (result.addedTxCount || result.added || 0) : 0;
            const skippedTx = typeof result === 'object' ? (result.skippedTxCount || result.skipped || 0) : 0;
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

            let txSummary = '';
            if (addedTx > 0 || skippedTx > 0) {
                txSummary = window.t ? window.t('systemLogs.backupManager.txSummary', { added: addedTx, skipped: skippedTx }) : ` (Added ${addedTx}, skipped ${skippedTx} duplicates)`;
            }

            this.hideProgress(window.t ? window.t('systemLogs.backupManager.importResult', { total: total.toLocaleString(), summary: txSummary, elapsed }) : `Processed ${total.toLocaleString()} records${txSummary}, took ${elapsed} s`);
            setAppBusy(false, {
                success: true,
                message: (window.t ? window.t('systemLogs.backupManager.importSuccess', { total: total.toLocaleString(), summary: txSummary, elapsed }) : `Database restore complete! Processed ${total.toLocaleString()} records${txSummary}, took ${elapsed} s`) + (onSuccessReload ? (window.t ? window.t('systemLogs.backupManager.reloading') : ', reloading automatically...') : '')
            });

            if (onSuccessReload) {
                setTimeout(() => window.location.reload(), 2000);
            }
            return true;
        } catch (err) {
            console.error("Import Error:", err);
            this.hideProgress(window.t ? window.t('systemLogs.backupManager.importFailedIcon', { msg: err.message }) : `❌ Import failed: ${err.message}`);
            setAppBusy(false, {
                error: true,
                message: window.t ? window.t('systemLogs.backupManager.importFailed', { msg: err.message }) : `Import failed: ${err.message}`
            });
            return false;
        } finally {
            this.toggleButtons(false);
        }
    }
}
