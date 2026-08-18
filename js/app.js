import { loadSettings, settings } from './store.js';
import '../utils/js/logger.js';
import { initSettings, renderSettings } from './tabs/settings.js';
import { initMarket, renderMarket, cleanupMarket } from './tabs/market.js?v=42';
import { initTrades, renderTrades, initGlobalTradeModal } from './tabs/trades.js?v=42';
import { initStats, renderStats } from './tabs/stats.js?v=42';
import { initGlobalFooter } from '../utils/js/globalFooter.js';
let currentTab = null;

// === System Logs Tracker ===
// Moved to utils/js/logger.js



// === Setup File Protocol Guard ===
if (window.location.protocol === 'file:') {
    document.body.innerHTML = `
        <div class="h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
            <div class="bg-white p-8 rounded-2xl shadow-sm border border-red-100 max-w-lg">
                <div class="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                </div>
                <h2 class="text-xl font-bold text-slate-800 mb-2">無法在本地模式執行</h2>
                <p class="text-slate-500 text-sm leading-relaxed mb-6">
                    本系統採用原生的 ES Module 模組化架構，基於瀏覽器安全性考量 (CORS)，不支援直接點擊 <code>index.html</code> (file:///) 開啟。<br><br>
                    請透過網頁伺服器（例如 <strong>IIS, Apache, Nginx</strong> 或是 VSCode 的 <strong>Live Server</strong>）以 <code>http://localhost</code> 的方式開啟本系統。
                </p>
            </div>
        </div>
    `;
    throw new Error("Cannot run ES Modules via file:// protocol.");
}

// === App Initialization ===
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadSettings();
        initGlobalTradeModal();
        setupTabNavigation();

        // Update Global Sync Badge (Fixed to Local Database)
        const syncDot = document.getElementById('sync-dot');
        const syncBadge = document.getElementById('sync-status');
        if (syncDot && syncBadge) {
            syncDot.className = "w-2.5 h-2.5 rounded-full bg-blue-500";
            syncBadge.className = "w-7 h-7 bg-blue-50 rounded-full flex items-center justify-center transition-colors cursor-pointer border border-blue-200";
        }

        // Initialize Global Footer
        initGlobalFooter({
            appName: '股海手札 (Stock Journal)',
            version: 'v2.0.1 (Serverless)',
            githubUrl: 'https://github.com/SSWorld72/Stock_Journal',
            releaseDate: '2026-08-18'
        });

        // Load default tab (Market)
        await loadTab('market');
    } catch (err) {
        document.body.innerHTML = `<div style="color:red; padding:20px;"><h1>App Crash</h1><pre>${err.stack}</pre></div>`;
        console.error(err);
    }
});

// === Global Busy / Heavy Task Protection ===
let isAppBusy = false;

const onBeforeUnload = (e) => {
    if (isAppBusy) {
        e.preventDefault();
        e.returnValue = '資料庫正在處理或匯入中，離開頁面可能導致資料不完整，確定要離開嗎？';
        return e.returnValue;
    }
};

import '../utils/js/uiBlocker.js';

// === Tab Navigation Logic ===
const tabBtns = document.querySelectorAll('.tab-btn');

function setupTabNavigation() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (isAppBusy) {
                e.preventDefault();
                e.stopPropagation();
                const detailEl = document.getElementById('app-busy-detail');
                if (detailEl) {
                    const oldText = detailEl.textContent;
                    detailEl.innerHTML = `<span class="text-amber-600 font-semibold">⚠️ 資料庫正在大量處理中，請等待完成後再切換分頁！</span>`;
                    setTimeout(() => {
                        if (isAppBusy && detailEl) detailEl.textContent = oldText;
                    }, 2500);
                }
                return;
            }

            const targetId = btn.getAttribute('data-target');

            // Update UI styles
            tabBtns.forEach(b => {
                b.classList.remove('text-blue-700', 'bg-blue-50', 'shadow-sm');
                b.classList.add('text-slate-400', 'hover:bg-slate-50', 'hover:text-slate-600');
                b.querySelector('svg').setAttribute('stroke-width', '1.5');
            });

            btn.classList.remove('text-slate-400', 'hover:bg-slate-50', 'hover:text-slate-600');
            btn.classList.add('text-blue-700', 'bg-blue-50', 'shadow-sm');
            btn.querySelector('svg').setAttribute('stroke-width', '2');

            // Fetch and inject HTML dynamically
            await loadTab(targetId.replace('tab-', ''));
        });
    });
}

// === Dynamic Tab Loading via Fetch ===
const SESSION_CACHE_BUSTER = Date.now(); // 解決 GitHub Pages 快取卡死問題

async function loadTab(tabName) {
    const container = document.getElementById('main-container');

    // Cleanup previous tab if needed
    if (currentTab === 'market' && tabName !== 'market') {
        cleanupMarket();
    }

    try {
        const response = await fetch(`views/${tabName}.html?v=${SESSION_CACHE_BUSTER}`);
        if (!response.ok) throw new Error('找不到頁籤模組 (404)');

        const html = await response.text();
        container.innerHTML = html;

        // Execute tab-specific logic after DOM injection
        if (tabName === 'settings') {
            initSettings();
            renderSettings();
        } else if (tabName === 'market') {
            initMarket();
            renderMarket();
        } else if (tabName === 'trades') {
            initTrades();
            renderTrades();
        } else if (tabName === 'stats') {
            initStats();
            renderStats();
        }

        currentTab = tabName;

    } catch (e) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-red-500">
                <svg class="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <p>載入頁籤失敗: ${e.message}</p>
            </div>`;
    }
}
