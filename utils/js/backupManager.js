import { showInlineProgress, updateInlineProgress, hideInlineProgress, setAppBusy } from './uiBlocker.js';

/**
 * 泛用備份管理中心 (BackupManager)
 * 負責統整與協調匯出、匯入的 UI 流程，包含全螢幕防護罩、行內進度條、按鈕鎖定等。
 * 實際的資料處理邏輯則透過參數 (exportAction, importAction) 傳入，實現關注點分離。
 */
export class BackupManager {
    /**
     * @param {Object} options
     * @param {string} options.containerId - 行內進度條的容器 ID (預設 'jsonl-box')
     * @param {string} options.exportBtnId - 匯出按鈕 ID (預設 'btn-export-jsonl')
     * @param {string} options.importBtnId - 匯入按鈕 ID (預設 'btn-import-jsonl')
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
     * 執行匯出流程
     * @param {Object} config
     * @param {string} config.title - 防護罩主標題
     * @param {string} config.initialDetail - 防護罩初始副標題
     * @param {string} config.filename - 輸出的檔案名稱
     * @param {Function} config.exportAction - 負責實際匯出邏輯的 async 函式，會接收 progressCallback
     */
    async runExport({ title, initialDetail, filename, exportAction }) {
        this.toggleButtons(true);
        try {
            this.showProgress('準備匯出中...');
            setAppBusy(true, {
                title: title || '資料庫匯出中',
                detail: initialDetail || '正在提取所有本地資料庫紀錄，請勿切換分頁或關閉視窗...',
                progress: 5,
                countText: '準備中...',
                statusText: '收集資料中...'
            });

            // exportAction 回傳 Blob 或 string
            const fileData = await exportAction((count, total) => {
                this.updateProgress(count, total, '匯出中...');
                const pct = total ? Math.min(99, Math.round((count / total) * 100)) : 10;
                const countDisplay = total 
                    ? `${count.toLocaleString()} / ${total.toLocaleString()} 筆 (${pct}%)` 
                    : `${count.toLocaleString()} 筆`;
                setAppBusy(true, {
                    title: title || '資料庫匯出中',
                    detail: '正在生成備份檔案，請勿切換分頁或關閉視窗...',
                    progress: pct,
                    countText: countDisplay,
                    statusText: `已匯出 ${count.toLocaleString()} 筆`
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

            this.hideProgress(`備份成功！已下載 ${filename}`);
            setAppBusy(false, {
                success: true,
                message: `備份完成！已成功下載 ${filename}`
            });
        } catch (err) {
            console.error("Export Error:", err);
            this.hideProgress(`❌ 匯出失敗：${err.message}`);
            setAppBusy(false, {
                error: true,
                message: `匯出失敗：${err.message}`
            });
        } finally {
            this.toggleButtons(false);
        }
    }

    /**
     * 執行匯入流程
     * @param {Object} config
     * @param {File} config.file - 使用者選擇的檔案
     * @param {string} config.confirmMessage - 匯入前的確認提示文字 (若為空則不提示)
     * @param {string} config.title - 防護罩主標題
     * @param {string} config.initialDetail - 防護罩初始副標題
     * @param {string} config.progressDetail - 匯入進行中的副標題
     * @param {Function} config.importAction - 負責實際匯入邏輯的 async 函式，會接收 (file, progressCallback)
     * @param {boolean} config.onSuccessReload - 匯入完成後是否自動重新整理頁面
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
            this.showProgress(`匯入中...${isGz ? ' 解壓縮 gzip' : ''}`);
            setAppBusy(true, {
                title: title || '資料庫匯入中',
                detail: initialDetail || (isGz ? '正在解壓縮並還原資料庫，請勿切換分頁或關閉視窗...' : '正在還原資料庫，請勿切換分頁或關閉視窗...'),
                progress: 5,
                countText: '準備中...',
                statusText: '讀取檔案中...'
            });

            // importAction 必須回傳總處理筆數，或物件 { totalCount, addedTxCount, skippedTxCount }
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
                this.updateProgress(count, progressTotal, `匯入中...${pctText}`);

                const countDisplay = expectedTotal 
                    ? `${count.toLocaleString()} / ${expectedTotal.toLocaleString()} 筆 (${pct}%)`
                    : (pct ? `${pct}%` : '');
                
                setAppBusy(true, {
                    title: title || '資料庫匯入中',
                    detail: progressDetail || '正在寫入資料庫，請勿切換分頁或關閉視窗...',
                    progress: pct || 10,
                    countText: countDisplay,
                    statusText: `已處理 ${count.toLocaleString()} 筆`
                });
            });

            const total = typeof result === 'object' ? (result.totalCount || result.total || 0) : result;
            const addedTx = typeof result === 'object' ? (result.addedTxCount || result.added || 0) : 0;
            const skippedTx = typeof result === 'object' ? (result.skippedTxCount || result.skipped || 0) : 0;
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

            let txSummary = '';
            if (addedTx > 0 || skippedTx > 0) {
                txSummary = `（新增 ${addedTx} 筆，略過 ${skippedTx} 筆重複）`;
            }

            this.hideProgress(`共處理 ${total.toLocaleString()} 筆紀錄${txSummary}，耗時 ${elapsed} 秒`);
            setAppBusy(false, {
                success: true,
                message: `資料庫還原完成！共處理 ${total.toLocaleString()} 筆紀錄${txSummary}，耗時 ${elapsed} 秒${onSuccessReload ? '，正在自動重新載入...' : ''}`
            });

            if (onSuccessReload) {
                setTimeout(() => window.location.reload(), 2000);
            }
            return true;
        } catch (err) {
            console.error("Import Error:", err);
            this.hideProgress(`❌ 匯入失敗：${err.message}`);
            setAppBusy(false, {
                error: true,
                message: `匯入失敗：${err.message}`
            });
            return false;
        } finally {
            this.toggleButtons(false);
        }
    }
}
