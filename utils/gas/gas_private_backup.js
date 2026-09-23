/**
 * 專屬私有雲端備份 - 通用版 (Universal Private Cloud Backup)
 * ==========================================
 * 
 * [功能說明]
 * 這個 GAS 腳本是一個「通用版」備份後端。
 * 它會根據前端傳來的 `appName` (專案名稱)，自動在您的 Google 雲端硬碟建立對應的備份檔。
 * 例如：專案 A 會存成 ProjectA_PrivateBackup.json，專案 B 會存成 ProjectB_PrivateBackup.json。
 * 只要部署這「一個」網址，就能給您所有開發的專案共用！
 * 
 * [更新紀錄]
 * - 2026-08-25: 升級為 ZIP 格式及分割上傳 (Chunked Upload) Google Cloud，並保留對舊版 JSON 的向下相容。
 *
 * [使用方式]
 * 1. 建立一個新的 Google Apps Script 專案 (建議命名為: 通用_專屬雲端備份)
 * 2. 將此程式碼全部貼上並覆蓋預設的 myFunction。
 * 3. 點擊右上角「部署 (Deploy)」 -> 「新增部署作業 (New deployment)」。
 * 4. 類型選擇「網頁應用程式 (Web app)」。
 * 5. 執行身分選擇：「我 (Me)」。
 * 6. 誰可以存取選擇：「所有人 (Anyone)」。
 * 7. 點擊部署，並授權 DriveApp 存取你的雲端硬碟。
 * 8. 複製「網頁應用程式網址 (Web app URL)」，可以貼給任何支援此模組的專案共用。
 */

// 根據專案名稱產生基礎檔名
function getBackupFilePrefix(appName) {
  const safeName = (appName || 'UnknownApp').replace(/[^a-zA-Z0-9_-]/g, '');
  return `${safeName}_PrivateBackup`;
}

// 取得或建立專屬的備份資料夾 (置於 Google_Cloud_Backup_Data 主目錄下)
function getOrCreateAppFolder(appName) {
  const cacheKey = 'folder_id_' + (appName || 'UnknownApp');
  const cachedId = CacheService.getScriptCache().get(cacheKey);
  
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch(e) {
      // 快取的資料夾可能已被刪除，忽略錯誤並重新搜尋
    }
  }

  const mainFolderName = 'Google_Cloud_Backup_Data';
  let mainFolder;
  const mainFolders = DriveApp.getFoldersByName(mainFolderName);
  if (mainFolders.hasNext()) {
    mainFolder = mainFolders.next();
  } else {
    mainFolder = DriveApp.createFolder(mainFolderName);
  }

  const subFolderName = `${appName || 'UnknownApp'}_Backups`;
  const subFolders = mainFolder.getFoldersByName(subFolderName);
  let resultFolder;
  
  if (subFolders.hasNext()) {
    resultFolder = subFolders.next();
  } else {
    resultFolder = mainFolder.createFolder(subFolderName);
  }
  
  // 將資料夾 ID 快取 6 小時 (21600 秒) 以大幅提升效能
  CacheService.getScriptCache().put(cacheKey, resultFolder.getId(), 21600);
  
  return resultFolder;
}

// 產生帶有時間戳記的檔名
function generateTimestampedFileName(appName) {
  const prefix = getBackupFilePrefix(appName);
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : n);
  const timeStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}_${timeStr}.json`;
}

// 取得同專案的所有備份檔案，並依建立時間由新到舊排序
function getSortedBackupFiles(appName) {
  const folder = getOrCreateAppFolder(appName);
  const prefix = getBackupFilePrefix(appName);
  const filesIter = folder.getFiles();
  const files = [];
  
  while (filesIter.hasNext()) {
    const file = filesIter.next();
    const name = file.getName();
    // 過濾：未刪除、檔名包含前綴、且不是暫存切塊檔案
    if (!file.isTrashed() && name.indexOf(prefix) !== -1) {
      if (name.indexOf('.txt') === -1 && name.indexOf('.chunk') === -1) {
        files.push(file);
      }
    }
  }
  
  // 依建立時間遞減排序 (最新最上面)
  files.sort((a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime());
  return files;
}

// 尋找最新的備份檔案，找不到則建立一個新的
function getLatestBackupFile(appName) {
  const sortedFiles = getSortedBackupFiles(appName);
  if (sortedFiles.length > 0) {
    return sortedFiles[0];
  } else {
    return getOrCreateAppFolder(appName).createFile(`${getBackupFilePrefix(appName)}.json`, '{}', MimeType.PLAIN_TEXT);
  }
}

// 清理過舊的版本
function cleanupOldVersions(appName, maxVersions) {
  if (!maxVersions || maxVersions < 1) maxVersions = 1;
  const sortedFiles = getSortedBackupFiles(appName);
  if (sortedFiles.length > maxVersions) {
    for (let i = maxVersions; i < sortedFiles.length; i++) {
      try {
        sortedFiles[i].setTrashed(true);
      } catch (e) {
        console.error("無法刪除舊備份檔: " + e.message);
      }
    }
  }
}

// 處理網頁端送來的 GET 請求 (從雲端還原)
function doGet(e) {
  try {
    // 從 URL 參數取得專案名稱 (預設為 UnknownApp)
    const appName = (e.parameter && e.parameter.appName) ? e.parameter.appName : 'UnknownApp';
    const action = (e.parameter && e.parameter.action) ? e.parameter.action : 'restore';
    
    if (action === 'list') {
      const sortedFiles = getSortedBackupFiles(appName);
      const list = [];
      sortedFiles.forEach(file => {
        list.push({
          id: file.getId(),
          fileId: file.getId(), // 相容舊版前端
          name: file.getName(),
          fileName: file.getName(),
          dateCreated: file.getDateCreated().getTime(),
          size: file.getSize()
        });
      });
      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        data: list
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'download' || action === 'restore') {
      // 預設為還原特定版本或最新版本
      let file = null;
      if (e.parameter && e.parameter.fileId) {
        file = DriveApp.getFileById(e.parameter.fileId);
      } else {
        file = getLatestBackupFile(appName);
      }
      
      const fileName = file.getName();
      const isZip = fileName.endsWith('.zip');
      
      if (isZip || action === 'download') {
        // 回傳 Base64 編碼
        const bytes = file.getBlob().getBytes();
        const base64 = Utilities.base64Encode(bytes);
        return ContentService.createTextOutput(JSON.stringify({ 
          status: 'success', 
          data: base64, 
          fileName: fileName,
          isZip: isZip
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        // 相容舊版，直接回傳 JSON 物件
        const content = file.getBlob().getDataAsString();
        const jsonContent = content ? JSON.parse(content) : {};
        return ContentService.createTextOutput(JSON.stringify({
          status: 'success',
          message: 'SUCCESS_READ_BACKUP',
          data: jsonContent
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'ERROR_INVALID_GET_REQUEST' })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 處理網頁端送來的 POST 請求 (備份至雲端)
function doPost(e) {
  try {
    // 從 POST body 中取得 JSON 字串
    if (!e.postData || !e.postData.contents) {
      throw new Error('ERROR_NO_PAYLOAD_CONTENT');
    }
    
    const payloadStr = e.postData.contents;
    const payload = JSON.parse(payloadStr);

    // 支援 ZIP 切割上傳
    if (payload.action === 'backup_chunk') {
      return handleChunkedUpload(payload);
    }
    
    // 從 JSON 內容取得專案名稱與設定
    const appName = (payload.config && payload.config.appName) ? payload.config.appName : 'UnknownApp';
    const isOverwrite = (payload.config && payload.config.overwrite !== undefined) ? payload.config.overwrite : true;
    const maxVersions = (payload.config && payload.config.versions) ? parseInt(payload.config.versions, 10) : 1;
    
    let file;
    if (isOverwrite) {
      // 覆寫模式：找最新的檔案覆寫，如果沒有就建立預設檔名
      const sortedFiles = getSortedBackupFiles(appName);
      if (sortedFiles.length > 0) {
        file = sortedFiles[0];
      } else {
        file = getOrCreateAppFolder(appName).createFile(`${getBackupFilePrefix(appName)}.json`, '', MimeType.PLAIN_TEXT);
      }
      file.setContent(payloadStr);
      cleanupOldVersions(appName, 1);
    } else {
      const newFileName = generateTimestampedFileName(appName);
      file = getOrCreateAppFolder(appName).createFile(newFileName, payloadStr, MimeType.PLAIN_TEXT);
      cleanupOldVersions(appName, maxVersions);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      message: 'SUCCESS_BACKUP_COMPLETED',
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 支援 OPTIONS 請求 (CORS)
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * 處理切割上傳 (Chunked Upload)
 */
function handleChunkedUpload(payload) {
  const sessionId = payload.uploadSessionId;
  const chunkIndex = payload.chunkIndex;
  const totalChunks = payload.totalChunks;
  const dataStr = payload.data; 
  const appName = payload.appName || 'UnknownApp';
  const fileName = payload.fileName || (getBackupFilePrefix(appName) + '_Backup.zip');
  const backupVersions = payload.backupVersions || 10;

  const folder = getOrCreateAppFolder(appName);
  const tempFileName = sessionId + '_chunk_' + chunkIndex + '.txt';
  
  // 儲存此片段
  const chunkFile = folder.createFile(tempFileName, dataStr, MimeType.PLAIN_TEXT);
  
  // 將 chunk 的檔案 ID 記錄在 PropertiesService，避免依賴 searchFiles 的延遲
  PropertiesService.getScriptProperties().setProperty(sessionId + '_chunk_' + chunkIndex, chunkFile.getId());

  // 如果這是最後一個片段，開始組裝
  if (chunkIndex === totalChunks - 1) {
    let fullBase64 = '';
    let allChunksValid = true;
    
    for (let i = 0; i < totalChunks; i++) {
      const propKey = sessionId + '_chunk_' + i;
      const fileId = PropertiesService.getScriptProperties().getProperty(propKey);
      
      if (fileId) {
        try {
          const cFile = DriveApp.getFileById(fileId);
          fullBase64 += cFile.getBlob().getDataAsString();
          cFile.setTrashed(true); // 組合完立即刪除碎片
          PropertiesService.getScriptProperties().deleteProperty(propKey);
        } catch(e) {
          throw new Error('ERROR_CHUNK_READ_FAILED: ' + fileId + ' | ' + e.message);
        }
      } else {
        // 退回方案：如果在 PropertiesService 找不到，才使用 getFilesByName 搜尋
        const cName = sessionId + '_chunk_' + i + '.txt';
        const chunkFiles = folder.getFilesByName(cName);
        if (chunkFiles.hasNext()) {
          const cFile = chunkFiles.next();
          fullBase64 += cFile.getBlob().getDataAsString();
          cFile.setTrashed(true); // 組合完立即刪除碎片
        } else {
          throw new Error('ERROR_CHUNK_NOT_FOUND: ' + cName);
        }
      }
    }
    
    // 將合併後的 Base64 轉換為二進位檔案
    const decoded = Utilities.base64Decode(fullBase64);
    const blob = Utilities.newBlob(decoded, 'application/zip', fileName);
    
    // 儲存最終檔案
    const finalFile = folder.createFile(blob);
    
    // 清理舊版本
    cleanupOldVersions(appName, backupVersions);
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: 'success', 
      message: 'SUCCESS_CHUNK_ASSEMBLED',
      fileId: finalFile.getId()
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ 
    status: 'success', 
    message: 'Chunk ' + chunkIndex + ' received.' 
  })).setMimeType(ContentService.MimeType.JSON);
}
