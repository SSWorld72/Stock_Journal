# Stock Journal 股海手札

一個輕量級的台股投資紀錄與分析工具，無需安裝任何後端伺服器，打開瀏覽器就能使用。

- **當前版本**：`v2.0.3` (2026-09-17)
- **線上體驗 (GitHub Pages)**：[https://ssworld72.github.io/Stock_Journal/](https://ssworld72.github.io/Stock_Journal/)

---

## ✨ 主要功能

### 📈 股市行情
- 即時報價：串接證交所與櫃買中心官方 API，即時取得上市櫃個股報價。
- 自選股管理：自訂關注清單，依「完整持股」、「零股持股」等分類檢視。
- 個股展開：點擊個股可查看即時走勢圖、技術 K 線圖與籌碼分析。
- 備援報價系統：當主要報價來源異常時，系統會自動切換至備援來源。

### 📊 籌碼分析
- 三大法人買賣超與融資融券餘額的歷史數據。
- 批次下載指定日期範圍的籌碼資料，並以圖表呈現走勢。
- 智慧快取機制：已下載的資料自動保存於本地端，不重複抓取。
- 缺件自動補齊：若融資融券資料尚未公佈，系統會在下次抓取時自動補上。

### 📋 交易紀錄
- 完整記錄買進、賣出、配息、存入、取出等所有交易操作。
- 支援多券商設定，自訂手續費率、折讓比例與證交稅。
- CSV 匯入/匯出：可批次匯入交易紀錄，或匯出為通用 CSV 格式。

### 📉 統計分析
- 自動計算未實現損益、已實現損益與帳戶總值。
- 各券商的手續費、交易稅與折讓金額獨立統計。
- EPS 與月營收 YoY 整合，自動計算 PEG（本益成長比）。

### ☁️ 備份與還原
- **GAS 私有雲端備份**：透過 Google Apps Script 將資料備份至您自己的 Google 雲端硬碟，完全隱私安全。
- **JSONL 壓縮備份**：一鍵匯出含所有交易紀錄、設定與快取資料的壓縮備份檔。
- **自動同步**：可設定自動備份頻率，確保資料安全。

### ⚙️ 系統設定
- 雙代理模式：可選擇「Google Apps Script (Serverless)」或「本地伺服器」取得報價。
- 休市日行事曆：自動從證交所取得最新休市日資料。
- 國家稅制設定：統一管理二代健保與證交稅率。

---

## 🏗️ 技術架構

| 項目 | 說明 |
|---|---|
| 前端框架 | Vanilla JavaScript (ES Module) + Tailwind CSS |
| 本地儲存 | IndexedDB + LocalStorage |
| 圖表引擎 | Lightweight Charts (TradingView) |
| 報價來源 | 台灣證券交易所 MIS、櫃買中心、Yahoo Finance |
| 跨域代理 | Google Apps Script (GAS) / 本地 Node.js Server |
| 部署方式 | GitHub Pages (靜態網頁) 或本地瀏覽器直接開啟 |

---

## 📂 檔案清單與架構 (Directory Structure)

本專案採用純前端 (Vanilla JavaScript) 架構，所有模組化程式碼皆可於瀏覽器直接執行，無需經過打包 (No Build Process)。

```text
Stock_Journal/
├── .gitignore                   # Git 忽略清單
├── CHANGELOG.md                 # 版本更新紀錄
├── index.html                   # 系統進入點主畫面
├── README.md                    # 專案說明文件
├── server.js                    # 本地開發用跨域代理伺服器 (Node.js)
├── views/                       # 各頁籤的 HTML 模板檔案
│   ├── market.html              # 股市行情畫面
│   ├── settings.html            # 系統設定畫面
│   ├── stats.html               # 統計分析畫面
│   └── trades.html              # 交易紀錄畫面
├── js/                          # 核心 JavaScript 邏輯
│   ├── app.js                   # 主程式 (處理頁籤切換與初始化)
│   ├── dataStorage.js           # 資料庫存取層與邏輯封裝
│   ├── db.js                    # IndexedDB 本地資料庫核心
│   ├── store.js                 # 全域狀態管理與共用變數
│   ├── api/                     # 外部 API 串接模組
│   │   ├── fugle.js             # 富果 (Fugle) API 串接
│   │   └── twstock.js           # 證交所/櫃買中心 API 串接
│   ├── components/              # UI 共用元件
│   │   ├── charts.js            # 圖表繪製元件 (依賴 Lightweight Charts)
│   │   └── chips-ui.js          # 籌碼分析卡片 UI 渲染
│   ├── tabs/                    # 各分頁專屬的邏輯控制
│   │   ├── market.js            # 股市行情邏輯
│   │   ├── settings.js          # 系統設定邏輯
│   │   ├── stats.js             # 統計分析邏輯
│   │   └── trades.js            # 交易紀錄邏輯
│   └── utils/                   # 專案專屬工具
│       └── holiday.js           # 台股休市日運算邏輯
├── utils/                       # 跨專案共用核心庫 (透過 Junction 連結)
│   ├── README.md                # utils 說明文件
│   ├── auto_backup.cmd          # 批次自動備份啟動腳本
│   ├── auto_backup.py           # 自動備份 Python 邏輯
│   ├── create_link.py           # 建立 Junction 連結腳本
│   ├── custom_server.py         # 跨域代理測試伺服器 (Python)
│   ├── fix_markdown_bom.py      # 修正 BOM 檔頭問題腳本
│   ├── Start_Server.cmd         # 啟動 Node.js 伺服器腳本
│   ├── Start_Server.ps1         # 啟動 Node.js 伺服器 (PowerShell)
│   ├── Sync_GitHub.cmd          # 批次部署至 GitHub 腳本
│   ├── Sync_GitHub.ps1          # 部署至 GitHub (PowerShell)
│   ├── gas/                     # GAS 私有雲端代理與備份程式碼
│   │   ├── gas_private_backup.js       # 私有雲端備份後端腳本
│   │   └── gas_proxy_with_logging.js   # 報價代理伺服器後端腳本
│   ├── i18n/                    # 多語系設定檔
│   │   ├── de-DE.js             # 德文
│   │   ├── en-US.js             # 英文
│   │   ├── fr-FR.js             # 法文
│   │   ├── hi-IN.js             # 印地文
│   │   ├── ja-JP.js             # 日文
│   │   ├── ko-KR.js             # 韓文
│   │   ├── th-TH.js             # 泰文
│   │   ├── zh-CN.js             # 簡體中文
│   │   └── zh-TW.js             # 繁體中文
│   └── js/                      # 共用工具腳本
│       ├── backupManager.js     # JSONL 匯出入備份管理
│       ├── charts.js            # 圖表設定工具
│       ├── dangerZone.js        # 危險操作確認對話框
│       ├── dataMerger.js        # 資料合併邏輯
│       ├── deviceDetection.js   # 裝置檢測 (Mobile/Desktop)
│       ├── errorHandler.js      # 全域錯誤處理
│       ├── gasBackupModule.js   # 雲端備份前端模組
│       ├── gasProxy.js          # 報價代理前端模組
│       ├── globalFooter.js      # 全域頁尾元件
│       ├── i18nEngine.js        # 多語系核心引擎
│       ├── logger.js            # 自訂日誌輸出
│       ├── shared-i18n.js       # 跨專案共用語系補丁
│       ├── tipBox.js            # 提示區塊元件
│       ├── uiBlocker.js         # UI 畫面鎖定工具
│       ├── uiDialogs.js         # 彈出對話框管理
│       └── zipBackupHelper.js   # ZIP 壓縮備份輔助工具
└── libs/                        # 外部第三方函式庫
    ├── fonts/                   # 字體庫
    │   └── Inter/               # Inter 字體家族
    │       ├── inter.css        # Inter 字體 CSS 定義
    │       ├── Inter-400.ttf    # 一般粗細
    │       ├── Inter-500.ttf    # 中等粗細
    │       ├── Inter-600.ttf    # 半粗
    │       ├── Inter-700.ttf    # 粗體
    │       └── README.md        # 字體授權說明
    ├── jszip/                   # JSZip 壓縮套件
    │   ├── jszip.min.js         # 壓縮套件主程式
    │   └── README.md            # JSZip 說明文件
    └── tailwindcss/             # Tailwind CSS 框架
        ├── tailwindcss.js       # Tailwind CSS 瀏覽器版 (CDN)
        └── README.md            # Tailwind CSS 說明文件
```

---

## 🚀 快速開始

### 方式一：線上使用 (推薦)
直接前往 [GitHub Pages](https://ssworld72.github.io/Stock_Journal/)，無需安裝任何軟體。

### 方式二：本地執行
1. Clone 本專案：
   ```bash
   git clone https://github.com/SSWorld72/Stock_Journal.git
   ```
2. 用瀏覽器直接開啟 `index.html` 即可使用（預設為 Serverless 模式，所有請求皆由 Google Apps Script 代理）。

---

## ☁️ 設定私有雲端備份 (GAS Backend)

本系統支援將您的帳本資料加密備份至您私人的 Google 雲端硬碟，達到 100% 的隱私與跨裝置同步。

---

## 💡 常見問題 (FAQ)

### Q: 既然是 Serverless，為什麼還要自己設定「API 報價代理 GAS 網址」？不能直接抓股票資料嗎？

這是一個非常好的問題！原因出在現代瀏覽器的 **CORS（跨來源資源共用限制）** 安全機制：

1. **瀏覽器的鐵血保全**：當您在 `github.io` 打開本系統時，如果網頁試圖用 JavaScript 直接連線去抓 `twse.com.tw` (證交所) 的資料，瀏覽器基於資安考量會強制阻擋這個「跨網站」的請求，這就是鼎鼎大名的 CORS Error。
2. **GAS 扮演專屬跑腿小弟**：因為「後端伺服器」互相連線是不受 CORS 限制的，所以我們借用 Google 的免費雲端主機（GAS）。瀏覽器先把請求發給您的 GAS，GAS 出面去證交所拿資料，最後再雙手奉上把資料還給瀏覽器。
3. **為什麼不能內建公用的給所有人用？**：如果系統寫死一個公用的 GAS 網址，當所有使用者的請求都擠向同一個端點時，Google 會判定為流量異常的惡意攻擊並永久封鎖該網址。

**總結**：Serverless 讓您不需要花錢租主機，但為了合法突破瀏覽器的跨域限制，每個人花一分鐘部署自己專屬的 Google 代理伺服器，是目前最完美且安全的解法！

### Q: 如果我不想部署 GAS，也沒有啟動本地伺服器，這個系統還能用嗎？

**完全可以！**
即使沒有任何報價代理伺服器，本系統仍會自動降級為一個**「純離線的專業股票記帳本」**。
在這種模式下，您無法取得「即時股價」與「籌碼分析」，但您依然可以：
- 完整使用「交易紀錄」功能，新增、編輯、刪除您的買賣紀錄。
- 查看您的「統計分析」圖表與過往的已實現損益。
- 透過「匯出/匯入 JSON」功能備份您的帳本資料。
- **將帳本資料備份至個人雲端**：透過另外部署「專屬備份 GAS」（設定頁面內有完整圖文教學），將資料安全加密儲存在您自己的 Google 雲端硬碟。
這意味著，它隨時都能作為您最可靠的私密投資帳本！

---

## 📝 更新紀錄

完整更新紀錄請參閱 [CHANGELOG.md](CHANGELOG.md)。

---

## 📄 授權

本專案僅供個人學習與研究使用。
