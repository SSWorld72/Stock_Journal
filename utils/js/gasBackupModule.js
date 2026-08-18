/**
 * GAS 私有雲端備份模組 (跨專案通用)
 */

export class GasBackupModule {
    /**
     * 初始化模組
     * @param {Object} config 
     * @param {string} config.containerId - 渲染 UI 的容器 ID
     * @param {Object} config.settingsObj - 專案全域設定檔物件的參照
     * @param {Function} config.onSaveSettings - 儲存設定的回呼函數
     * @param {Function} config.getCleanPayload - 取得乾淨備份資料的回呼函數 (需清除不必要的快取)
     * @param {Function} config.onRestoreSuccess - 還原成功後的回呼函數 (通常是 window.location.reload())
     * @param {Function} [config.setAppBusy] - 設定 UI 忙碌狀態的回呼函數 (可選)
     * @param {string} [config.customDescriptionHtml] - 自訂的說明文字 HTML (可選)
     * @param {string} [config.appName] - 專案名稱標識 (預設: StockJournal)
     */
    constructor(config) {
        this.appName = config.appName || 'StockJournal';
        this.containerId = config.containerId;
        this.settings = config.settingsObj;
        this.onSaveSettings = config.onSaveSettings;
        this.getCleanPayload = config.getCleanPayload;
        this.onRestoreSuccess = config.onRestoreSuccess;
        this.generateRestoreConfirmMessage = config.generateRestoreConfirmMessage;
        this.setAppBusy = config.setAppBusy || window.setAppBusy;
        
        this.customDescriptionHtml = config.customDescriptionHtml || `
            <span class="font-medium text-emerald-600">✅ 完整備份：</span>您的所有紀錄與系統偏好設定。<br>
            <span class="text-slate-400 text-[10px]">(*保持私人備份檔的極致輕量與安全)</span>
        `;
        
        this.autoSyncTimer = null;
        this.renderUI();
        this.initHelpModal();
        this.bindEvents();
    }

    renderUI() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`GasBackupModule: 找不到容器 #${this.containerId}`);
            return;
        }

        container.innerHTML = `
            <div class="bg-blue-50/40 dark:bg-slate-800/60 border border-blue-100/80 dark:border-slate-700/80 p-4 rounded-xl">
                <div class="flex items-center justify-between mb-3">
                    <label class="flex items-center text-sm font-semibold text-blue-950 dark:text-blue-200">
                        <svg class="w-4 h-4 text-blue-500 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                        </svg>
                        專屬私有雲端備份 (GAS Private Cloud) (JSON)
                        <div class="group relative inline-block ml-1 align-middle">
                            <svg class="w-[22px] h-[22px] text-blue-500 hover:text-blue-400 cursor-help transition-colors" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
                            </svg>
                            <div class="invisible group-hover:visible absolute z-50 w-64 p-2.5 mt-2 text-xs font-normal text-white bg-slate-800 dark:bg-slate-900 dark:border dark:border-slate-700 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-200"
                                style="white-space: normal; left: 0; top: 100%;">
                                填寫你專屬的 Backup GAS 網址，系統會透過安全的 POST 請求將你的所有資料加密傳輸並備份到你自己的 Google 雲端硬碟中。
                            </div>
                        </div>
                    </label>
                    <span class="text-[11px] font-medium bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">自動同步</span>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3 p-3 bg-white/60 dark:bg-slate-800/40 border border-blue-100 dark:border-slate-700/80 rounded-lg">
                    <div>
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">變動後自動同步延遲</label>
                        <select id="gas-setting-auto-sync-interval" class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none">
                            <option value="0">關閉自動同步</option>
                            <option value="5000">5 秒鐘</option>
                            <option value="60000">1 分鐘</option>
                            <option value="180000">3 分鐘</option>
                            <option value="300000">5 分鐘</option>
                            <option value="600000">10 分鐘</option>
                            <option value="900000">15 分鐘</option>
                            <option value="1800000">30 分鐘</option>
                            <option value="3600000">1 小時</option>
                            <option value="7200000">2 小時</option>
                            <option value="14400000">4 小時</option>
                            <option value="28800000">8 小時</option>
                            <option value="86400000">24 小時</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">是否直接覆蓋備份檔</label>
                        <select id="gas-setting-backup-overwrite" class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none">
                            <option value="true">是 (僅保留最新版本)</option>
                            <option value="false">否 (保留多個版本)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1" id="gas-label-backup-versions">保留版本數量 (1~10)</label>
                        <select id="gas-setting-backup-versions"
                            class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none disabled:bg-slate-100 disabled:dark:bg-slate-800 disabled:text-slate-400 disabled:dark:text-slate-500">
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                            <option value="6">6</option>
                            <option value="7">7</option>
                            <option value="8">8</option>
                            <option value="9">9</option>
                            <option value="10">10</option>
                        </select>
                    </div>
                </div>
                
                <div class="flex flex-col md:flex-row gap-4 mb-3">
                    <div class="flex-1">
                        <div class="flex items-center justify-start gap-1.5 mb-1">
                            <label class="block text-xs font-medium text-slate-600 dark:text-slate-400">專屬備份 GAS 網址</label>
                            <svg id="btn-gas-url-help" class="w-[22px] h-[22px] text-blue-500 cursor-pointer hover:text-blue-400 transition-colors" viewBox="0 0 24 24" fill="currentColor" title="點擊查看設定教學" onclick="document.getElementById('gas-help-modal').classList.remove('hidden')">
                                <path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/>
                            </svg>
                        </div>
                        <input type="text" id="gas-setting-private-gas-url"
                            class="w-full bg-white dark:bg-slate-900 border border-blue-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none transition-colors shadow-sm"
                            placeholder="https://script.google.com/macros/s/.../exec">
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed bg-white/50 dark:bg-slate-800/50 p-2 rounded border border-blue-50/50 dark:border-slate-700/50">
                            ${this.customDescriptionHtml}
                        </p>
                    </div>
                </div>

                <div class="flex gap-2">
                    <button id="gas-btn-cloud-backup"
                        class="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-blue-600 border border-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all shadow-sm active:scale-95">
                        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        備份至私有雲
                    </button>
                    <button id="gas-btn-cloud-restore" class="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-lg transition-colors border border-slate-200 dark:border-slate-600 disabled:opacity-50">
                        <svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        從雲端還原
                    </button>
                </div>
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
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
                    <div class="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 class="font-semibold text-slate-800 text-lg flex items-center gap-2">
                            <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                            專屬備份 GAS 網址申請教學
                        </h3>
                        <button id="btn-close-gas-help"
                            class="text-slate-400 hover:text-slate-600 transition-colors focus:outline-none">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="p-5 text-sm text-slate-600 leading-relaxed overflow-y-auto max-h-[70vh] space-y-4">
                        <p>
                            為了確保您的財務或私密資料<strong class="text-slate-800">絕對安全</strong>，本系統提供「專屬私有雲端備份」機制。
                            您的資料將直接上傳至您個人的 Google Drive，不經過任何第三方伺服器。
                        </p>
                        <hr class="border-slate-100">

                        <div>
                            <strong class="text-blue-700 bg-blue-50 px-2 py-1 rounded text-xs mb-2 inline-block">第一階段：貼上程式碼</strong>
                            <ol class="list-decimal pl-5 space-y-1.5 mt-1 text-slate-600">
                                <li>前往 <a href="https://script.google.com/" target="_blank" class="text-blue-600 hover:underline font-medium">Google Apps Script</a>，點選左上角的「＋ 新專案」。</li>
                                <li>點選左上方預設的「未命名的專案」，將它改名為容易辨識的名稱，例如：<code class="bg-slate-100 px-1 rounded text-pink-600">${this.appName} (私有雲端備份)</code>。</li>
                                <li>在中間的程式碼編輯區，把原本的 <code class="bg-slate-100 px-1 rounded text-pink-600 text-[11px]">function myFunction() {}</code> 全部刪除。</li>
                                <li>將本系統專屬的 <code class="bg-slate-100 px-1 rounded text-pink-600 font-mono text-[11px]">gas_private_backup.js</code> 程式碼全部貼上並儲存。</li>
                            </ol>
                        </div>

                        <div>
                            <strong class="text-blue-700 bg-blue-50 px-2 py-1 rounded text-xs mb-2 inline-block">第二階段：部署並設定權限</strong>
                            <ol class="list-decimal pl-5 space-y-1.5 mt-1 text-slate-600">
                                <li>點擊畫面右上角的藍色按鈕「部署」，選擇「新增部署作業」。</li>
                                <li>在跳出的視窗中，點擊左上角齒輪圖示，勾選「網頁應用程式」。</li>
                                <li><strong class="text-pink-600">【最重要】</strong>「執行身分」請務必選擇「我」，「誰可以存取」請選擇「所有人」。</li>
                                <li>設定好後，按下右下角的「部署」。</li>
                            </ol>
                        </div>

                        <div>
                            <strong class="text-blue-700 bg-blue-50 px-2 py-1 rounded text-xs mb-2 inline-block">第三階段：授權與取得網址</strong>
                            <ol class="list-decimal pl-5 space-y-1.5 mt-1 text-slate-600">
                                <li>(首次部署) 系統會跳出授權視窗，請點擊「授權存取」並選擇您的帳號。</li>
                                <li>(首次部署) 若出現警告，請點擊左下角「進階」->「前往 (不安全)」，然後點擊「允許」。</li>
                                <li>授權完成後，複製「網頁應用程式」下方的「網址 (URL)」，貼回設定頁面的格子中！</li>
                            </ol>
                        </div>

                        <div class="bg-blue-50 text-blue-800 p-3 rounded-lg border border-blue-100">
                            <div class="flex items-start gap-2">
                                <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                <span class="text-xs leading-relaxed font-medium">如果您已經部署過最新通用版 GAS，可以直接貼上同一個網址！不同專案的備份檔會自動獨立分開，不會互相覆蓋。</span>
                            </div>
                        </div>
                    </div>
                    <div class="px-5 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                        <button id="btn-gas-help-ok" class="px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/30">我了解了</button>
                    </div>
                </div>
            `;
            document.body.appendChild(gasHelpModal);
            
            // 綁定關閉事件
            const closeModal = () => gasHelpModal.classList.add('hidden');
            document.getElementById('btn-close-gas-help')?.addEventListener('click', closeModal);
            document.getElementById('btn-gas-help-ok')?.addEventListener('click', closeModal);
            // 點擊背景遮罩也可以關閉
            gasHelpModal.addEventListener('click', (e) => {
                if (e.target === gasHelpModal) closeModal();
            });
        }
    }

    bindEvents() {
        const gasUrlInput = document.getElementById('gas-setting-private-gas-url');
        if (gasUrlInput) {
            gasUrlInput.value = this.settings.privateGasUrl || '';
            gasUrlInput.addEventListener('change', (e) => {
                const oldUrl = this.settings.privateGasUrl;
                const newUrl = e.target.value.trim();
                this.settings.privateGasUrl = newUrl;
                
                // 【安全機制】如果原本沒有網址（代表新環境剛貼上準備還原），鎖定自動同步，防止空資料上傳
                if (!oldUrl && newUrl) {
                    this.isAutoSyncLocked = true;
                    console.log('[GasBackup] 初次設定 URL，已暫時鎖定自動同步，防止空資料覆蓋雲端。');
                }
                
                this.onSaveSettings();
            });
        }

        const autoSyncIntervalSelect = document.getElementById('gas-setting-auto-sync-interval');
        if (autoSyncIntervalSelect) {
            autoSyncIntervalSelect.value = (this.settings.autoSyncInterval !== undefined ? this.settings.autoSyncInterval : 5000).toString();
            autoSyncIntervalSelect.addEventListener('change', (e) => {
                this.settings.autoSyncInterval = parseInt(e.target.value, 10);
                this.onSaveSettings();
            });
        }

        const backupOverwriteSelect = document.getElementById('gas-setting-backup-overwrite');
        const backupVersionsInput = document.getElementById('gas-setting-backup-versions');
        
        if (backupOverwriteSelect && backupVersionsInput) {
            const updateVersionsState = () => {
                const isOverwrite = backupOverwriteSelect.value === 'true';
                backupVersionsInput.disabled = isOverwrite;
                if (isOverwrite) backupVersionsInput.value = 1;
            };

            backupOverwriteSelect.value = this.settings.backupOverwrite !== false ? 'true' : 'false';
            backupVersionsInput.value = this.settings.backupVersions || 1;
            updateVersionsState();

            backupOverwriteSelect.addEventListener('change', (e) => {
                this.settings.backupOverwrite = e.target.value === 'true';
                updateVersionsState();
                this.settings.backupVersions = parseInt(backupVersionsInput.value, 10) || 1;
                this.onSaveSettings();
            });

            backupVersionsInput.addEventListener('change', (e) => {
                let val = parseInt(e.target.value, 10);
                if (val < 1) val = 1;
                if (val > 10) val = 10;
                e.target.value = val;
                this.settings.backupVersions = val;
                this.onSaveSettings();
            });
        }

        const btnBackup = document.getElementById('gas-btn-cloud-backup');
        if (btnBackup) {
            btnBackup.addEventListener('click', () => this.backupToPrivateCloud(false));
        }

        const btnRestore = document.getElementById('gas-btn-cloud-restore');
        if (btnRestore) {
            btnRestore.addEventListener('click', () => this.restoreFromPrivateCloud());
        }

        // 綁定教學彈窗事件
        const btnGasHelp = document.getElementById('btn-gas-url-help');
        const gasHelpModal = document.getElementById('gas-help-modal');
        const btnGasHelpClose = document.getElementById('btn-gas-help-close');
        const btnGasHelpOk = document.getElementById('btn-gas-help-ok');
        
        if (btnGasHelp && gasHelpModal) {
            btnGasHelp.addEventListener('click', () => gasHelpModal.classList.remove('hidden'));
            const closeModal = () => gasHelpModal.classList.add('hidden');
            
            if (btnGasHelpClose) btnGasHelpClose.addEventListener('click', closeModal);
            if (btnGasHelpOk) btnGasHelpOk.addEventListener('click', closeModal);
            // 點擊背景關閉
            gasHelpModal.addEventListener('click', (e) => {
                if (e.target === gasHelpModal) closeModal();
            });
        }
    }

    triggerAutoSync() {
        if (!this.settings.privateGasUrl) return;
        
        const interval = this.settings.autoSyncInterval !== undefined ? this.settings.autoSyncInterval : 5000;
        if (interval <= 0) {
            if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
            return;
        }
        
        if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);
        this.autoSyncTimer = setTimeout(() => {
            console.log(`[雲端備份] 延遲 ${interval} 毫秒後觸發背景自動同步：準備將本地資料庫打包上傳至專屬私有雲進行備份。`);
            this.backupToPrivateCloud(true);
        }, interval);
    }

    async backupToPrivateCloud(isAutoSync = false) {
        if (!isAutoSync) {
            this.isAutoSyncLocked = false;
        }
        if (!this.settings.privateGasUrl) {
            if (!isAutoSync) alert('請先在上方輸入您的「專屬備份 GAS URL」！');
            return;
        }
        const btn = document.getElementById('gas-btn-cloud-backup');
        if (btn && !isAutoSync) btn.disabled = true;
        try {
            const payloadData = await this.getCleanPayload();
            
            const payload = {
                config: {
                    appName: this.appName,
                    overwrite: this.settings.backupOverwrite !== false,
                    versions: this.settings.backupVersions || 1
                },
                data: payloadData
            };
            
            const dataStr = JSON.stringify(payload);
            const dataSizeKb = (new Blob([dataStr]).size / 1024).toFixed(1);
            
            if (this.setAppBusy && !isAutoSync) {
                this.setAppBusy(true, {
                    title: '私有雲備份中',
                    detail: `正在打包所有資料並上傳至專屬雲端空間，請稍候... (檔案大小: ${dataSizeKb} KB)`,
                    statusText: '上傳中...',
                    progress: 50
                });
            }
            
            let resData = null;
            let success = false;
            
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const res = await fetch(this.settings.privateGasUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: dataStr
                    });
                    resData = await res.json();
                    success = (resData && resData.status === 'success');
                    if (success) break;
                } catch (err) {
                    if (attempt === 2) throw err;
                    console.warn(`備份第 1 次嘗試失敗 (${err.message})，正在重試...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            if (success) {
                if (!isAutoSync) {
                    alert('成功備份至私有雲！');
                    if (this.setAppBusy) this.setAppBusy(false, { success: true, message: '備份成功' });
                }
            } else {
                throw new Error((resData && resData.message) || '雲端回傳錯誤');
            }
        } catch (err) {
            console.error('備份發生錯誤:', err);
            if (!isAutoSync) {
                alert('備份失敗: ' + err.message);
                if (this.setAppBusy) this.setAppBusy(false, { error: true, message: '備份失敗' });
            }
        } finally {
            if (btn && !isAutoSync) btn.disabled = false;
        }
    }

    async restoreFromPrivateCloud() {
        this.isAutoSyncLocked = false;
        if (!this.settings.privateGasUrl) {
            alert('請先在上方輸入您的「專屬備份 GAS URL」！');
            return;
        }
        if (!confirm('警告：從雲端還原將會覆蓋本機所有的紀錄與設定！\n強烈建議您先使用備份工具進行本地備份。\n\n確定要繼續還原嗎？')) {
            return;
        }
        const btn = document.getElementById('gas-btn-cloud-restore');
        if (btn) btn.disabled = true;
        try {
            if (this.setAppBusy) {
                this.setAppBusy(true, {
                    title: '私有雲還原中',
                    detail: '正在連線取得備份版本清單...',
                    statusText: '連線中...',
                    progress: 20
                });
            }
            
            let fetchUrl = this.settings.privateGasUrl;
            const urlBase = fetchUrl.includes('?') ? `${fetchUrl}&appName=${encodeURIComponent(this.appName)}` : `${fetchUrl}?appName=${encodeURIComponent(this.appName)}`;
            
            // 1. 取得版本清單
            const listRes = await fetch(`${urlBase}&action=list`);
            const listText = await listRes.text();
            let listPayload;
            try {
                listPayload = JSON.parse(listText);
            } catch (e) {
                throw new Error('還原失敗：無法解析雲端資料。請確認網址正確且 GAS 腳本已更新至最新版。');
            }
            if (listPayload.status === 'error') {
                throw new Error('雲端回傳錯誤：' + listPayload.message);
            }

            const versions = listPayload.data || [];
            if (versions.length === 0) {
                throw new Error('還原失敗：雲端尚無備份資料。');
            }

            let selectedFileId = null;

            // 2. 如果只有一個版本，直接還原；否則顯示選擇選單
            if (versions.length === 1) {
                selectedFileId = versions[0].fileId;
            } else {
                if (this.setAppBusy) this.setAppBusy(false); // 暫時關閉 loading 以顯示選單
                selectedFileId = await this.showVersionSelectModal(versions);
                if (!selectedFileId) {
                    return; // 使用者取消
                }
                if (this.setAppBusy) {
                    this.setAppBusy(true, {
                        title: '私有雲還原中',
                        detail: '正在從專屬雲端下載指定的備份資料...',
                        statusText: '下載中...',
                        progress: 50
                    });
                }
            }
            
            // 3. 下載指定版本的內容
            const restoreRes = await fetch(`${urlBase}&action=restore&fileId=${encodeURIComponent(selectedFileId)}`);
            const restoreText = await restoreRes.text();
            let payload;
            try {
                payload = JSON.parse(restoreText);
            } catch (e) {
                throw new Error('還原失敗：無法解析下載的備份檔。');
            }
            
            if (payload.status === 'error') {
                throw new Error('雲端回傳錯誤：' + payload.message);
            }
            
            const outerBackupData = payload.data;
            if (!outerBackupData || Object.keys(outerBackupData).length === 0) {
                throw new Error('還原失敗：備份檔格式不正確或內容為空。');
            }
            // 處理新舊版本的資料結構差異 (新版有包含 config 和 data)
            let backupData = outerBackupData.data ? outerBackupData.data : outerBackupData;

            if (typeof backupData === 'string') {
                try {
                    backupData = JSON.parse(backupData);
                } catch (e) {
                    throw new Error('還原失敗：無法解析雲端備份資料，可能檔案已損壞。');
                }
            }

            let confirmMessage = '📦 雲端備份讀取成功！\n\n【警告】確定要使用這份資料覆蓋本機所有紀錄嗎？';
            if (typeof this.generateRestoreConfirmMessage === 'function') {
                confirmMessage = this.generateRestoreConfirmMessage(backupData);
            }

            if (!confirm(confirmMessage)) {
                if (this.setAppBusy) this.setAppBusy(false);
                return;
            }

            const oldPrivateGasUrl = this.settings.privateGasUrl;
            const oldGasUrl = this.settings.gasUrl; // StockJournal 專用
            
            for (const key in this.settings) {
                delete this.settings[key];
            }
            
            // 判斷是 TinyLedger 分離式設定，還是 StockJournal 綁定全域資料的設定
            if (backupData.preferences && backupData.preferences.gasSettings) {
                // TinyLedger: 只抽取出專屬的 gasSettings 寫入，避免 localStorage 爆滿
                try {
                    const parsedGasSettings = JSON.parse(backupData.preferences.gasSettings);
                    Object.assign(this.settings, parsedGasSettings);
                } catch(e) {
                    // ignore parse error
                }
            } else {
                // StockJournal (或舊版): 依賴本模組直接把整個 backupData 寫入全域 settings
                Object.assign(this.settings, backupData);
            }
            
            const newPrivateGasUrl = this.settings.privateGasUrl;
            const newGasUrl = this.settings.gasUrl;

            // 1. 檢查並詢問 Private Gas Url (私有雲端備份網址)
            if (newPrivateGasUrl && oldPrivateGasUrl && newPrivateGasUrl !== oldPrivateGasUrl) {
                const msg = `⚠️ 發現雲端備份中的「專屬備份 GAS 網址」與本機不同！\n\n[雲端] ${newPrivateGasUrl}\n[本機] ${oldPrivateGasUrl}\n\n是否要使用雲端備份的網址「覆蓋」本機網址？\n\n(按「確定」覆蓋，按「取消」保留本機網址)`;
                if (!confirm(msg)) {
                    this.settings.privateGasUrl = oldPrivateGasUrl;
                }
            } else if (!newPrivateGasUrl && oldPrivateGasUrl) {
                this.settings.privateGasUrl = oldPrivateGasUrl;
            }

            // 2. 檢查並詢問 Gas Url (API 報價代理網址 - 僅 StockJournal)
            if (newGasUrl && oldGasUrl && newGasUrl !== oldGasUrl) {
                const msg = `⚠️ 發現雲端備份中的「API 報價代理 GAS 網址」與本機不同！\n\n[雲端] ${newGasUrl}\n[本機] ${oldGasUrl}\n\n是否要使用雲端備份的網址「覆蓋」本機網址？\n\n(按「確定」覆蓋，按「取消」保留本機網址)`;
                if (!confirm(msg)) {
                    this.settings.gasUrl = oldGasUrl;
                }
            } else if (!newGasUrl && oldGasUrl) {
                this.settings.gasUrl = oldGasUrl;
            }
            
            await this.onSaveSettings();
            
            if (this.setAppBusy) this.setAppBusy(false);
            
            if (this.onRestoreSuccess) {
                await this.onRestoreSuccess(backupData);
            } else {
                alert('還原成功！系統將自動重新載入。');
                window.location.reload();
            }
        } catch (err) {
            console.error('還原發生錯誤:', err);
            alert('還原失敗: ' + err.message);
            if (this.setAppBusy) this.setAppBusy(false, { error: true, message: '還原失敗' });
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 建立並顯示版本選擇彈出視窗
    showVersionSelectModal(versions) {
        return new Promise((resolve) => {
            // 建立 UI
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[9999] p-4';
            
            const modal = document.createElement('div');
            modal.className = 'bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden';
            
            // Header
            const header = document.createElement('div');
            header.className = 'px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50';
            header.innerHTML = `
                <h3 class="font-bold text-slate-800 text-base">選擇還原版本</h3>
                <button class="text-slate-400 hover:text-slate-600 transition-colors p-1" id="btn-close-version-modal">
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
                btn.className = 'w-full text-left px-4 py-3 rounded-lg hover:bg-blue-50 focus:bg-blue-50 focus:outline-none transition-colors group border border-transparent hover:border-blue-100 flex items-center justify-between';
                
                const d = new Date(v.dateCreated);
                const dateStr = d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
                const timeStr = d.toLocaleTimeString('zh-TW', { hour12: false });
                
                let badge = '';
                if (index === 0) {
                    badge = '<span class="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 ml-2">最新</span>';
                }
                
                btn.innerHTML = `
                    <div class="flex flex-col">
                        <div class="flex items-center">
                            <span class="font-medium text-slate-700 group-hover:text-blue-700">${dateStr} ${timeStr}</span>
                            ${badge}
                        </div>
                        <span class="text-xs text-slate-400 mt-0.5 font-mono">${v.fileName.replace('.jsonl', '')}</span>
                    </div>
                    <svg class="w-5 h-5 text-slate-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                `;
                
                btn.onclick = () => {
                    document.body.removeChild(overlay);
                    resolve(v.fileId);
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
