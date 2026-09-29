# 設定編碼，避免中文字元亂碼
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host '=========================================' -ForegroundColor Cyan
Write-Host '通用本地開發伺服器 (Auto Server)' -ForegroundColor Green

# 專案名稱推導 (從絕對路徑中擷取 Browser 底下的專案根目錄名稱，防止在 VS Code 子目錄執行時誤判)
$currentPath = (Get-Location).Path
if ($currentPath -match 'Browser\\([^\\]+)') {
    $folderName = $matches[1]
} else {
    $folderName = (Get-Item .).Name
}

$projectName = $folderName
if ($folderName -match "^([A-Za-z0-9\s\-]+)") {
    $projectName = $matches[1].Trim()
}
Write-Host "  專案名稱: $projectName" -ForegroundColor DarkGray
Write-Host '=========================================' -ForegroundColor Cyan

# 根據專案名稱計算固定的 Port (範圍 8000~8999)，避免 LocalStorage 資料因 Port 變動遺失
$hash = 0
foreach ($char in $projectName.ToCharArray()) {
    $hash = ($hash * 31 + [int]$char) % 1000
}
$hash = [Math]::Abs($hash)
$stablePort = 8000 + $hash

# 特例處理：找回「股海手札」舊有的 LocalStorage 資料 (8081)
if ($projectName -match "Stock Journal") {
    $stablePort = 8081
}

# 自動清理指定 Port 的程序函式
function Clear-Port {
    param([int]$portToClear)
    $connections = Get-NetTCPConnection -LocalPort $portToClear -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($processId in $pids) {
            Write-Host "  [清理] 正在關閉佔用 Port $portToClear 的舊程序 (PID: $processId)..." -ForegroundColor Yellow
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
    }
}

if (Test-Path "server.js") {
    Write-Host "  [檢查] 發現 server.js，將同時啟動代理伺服器與靜態網頁伺服器..." -ForegroundColor Yellow
    
    # 關閉可能卡死的舊程序 (通常 Node 預設用 8080)
    Clear-Port -portToClear 8080
    
    Write-Host "  [啟動] 開啟 Node.js 後台伺服器 (Port: 8080) 於新視窗..." -ForegroundColor Green
    Start-Process -FilePath "node" -ArgumentList "server.js"
    
    Start-Sleep -Seconds 1
    
    # 前端使用固定的 Stable Port，避免 LocalStorage 流失
    Clear-Port -portToClear $stablePort
    Write-Host "  [啟動] 啟動 Python 前端網頁伺服器 (Port: $stablePort)..." -ForegroundColor Green
    
    Start-Process "http://127.0.0.1:$stablePort"
    python utils\custom_server.py $stablePort
} else {
    Write-Host "  [檢查] 無特定伺服器腳本，啟動 Python 靜態網頁伺服器..." -ForegroundColor Yellow
    
    Clear-Port -portToClear $stablePort
    Write-Host "  [啟動] 使用專屬固定通訊埠: $stablePort" -ForegroundColor Green
    
    Start-Process "http://127.0.0.1:$stablePort"
    python utils\custom_server.py $stablePort
}
