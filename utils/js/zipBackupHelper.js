/**
 * ZIP Backup and Restore Helper Module (zipBackupHelper.js)
 * Handles packaging JSON data into ZIP, extracting photos, and supports yearly splitting.
 */

import { t } from './shared-i18n.js';

export class ZipBackupHelper {
    /**
     * Create ZIP backup file
     * @param {Object} data Contains transactions, fixedRecords, categories, targets, preferences
     * @param {Object} options { mode: 'daily' | 'yearly', includePhotos: true | false }
     * @returns {Promise<Blob>} ZIP file Blob
     */
    static async createBackupZip(data, options = { mode: 'daily', includePhotos: true }) {
        if (typeof window.JSZip === 'undefined') {
            throw new Error(t('utils.zipBackup.jszipMissing'));
        }

        const zip = new window.JSZip();
        const dataFolder = zip.folder("data");
        const photosFolder = zip.folder("photos");

        const txs = data.transactions || [];
        
        // Process photo extraction
        const processedTxs = txs.map(tx => {
            const newTx = { ...tx };
            if (newTx.attachment) {
                if (options.includePhotos) {
                    try {
                        const match = newTx.attachment.match(/^data:(image\/(jpeg|png|webp|gif));base64,(.*)$/);
                        if (match) {
                            const ext = match[2];
                            const base64Data = match[3];
                            // If newTx.id does not exist, generate a random string as fallback
                            const safeId = newTx.id || ('gen_' + Math.random().toString(36).substring(2, 8));
                            const fileName = `tx_${safeId}.${ext}`;
                            photosFolder.file(fileName, base64Data, { base64: true });
                            newTx.photo_ref = `photos/${fileName}`;
                        }
                    } catch (e) {
                        console.warn(`[Backup] Failed to process photo (ID: ${newTx.id || 'Unknown'}):`, e);
                    }
                }
                // Always remove the original base64 to save space, regardless of whether photo backup is enabled
                delete newTx.attachment;
            }
            return newTx;
        });

        // Process yearly split (only for transactions)
        if (options.mode === 'yearly') {
            const yearlyData = {};
            processedTxs.forEach(tx => {
                const year = tx.date ? tx.date.substring(0, 4) : 'unknown';
                if (!yearlyData[year]) yearlyData[year] = [];
                yearlyData[year].push(tx);
            });

            for (const [year, yearTxs] of Object.entries(yearlyData)) {
                dataFolder.file(`transactions_${year}.json`, '\uFEFF' + JSON.stringify(yearTxs, null, 2));
            }
        } else {
            // Daily backup: write everything together
            dataFolder.file('transactions.json', '\uFEFF' + JSON.stringify(processedTxs, null, 2));
        }

        // Write global data
        const globalData = {
            fixedRecords: data.fixedRecords || [],
            categories: data.categories || [],
            targets: data.targets || [],
            preferences: data.preferences || {}
        };
        dataFolder.file('global.json', '\uFEFF' + JSON.stringify(globalData, null, 2));

        // Generate ZIP Blob
        const zipBlob = await zip.generateAsync({ 
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: {
                level: 6 // Moderate compression rate
            }
        });
        return zipBlob;
    }

    /**
     * Parse ZIP backup file and restore to data object
     * @param {Blob|ArrayBuffer} fileBuffer ZIP file data
     * @returns {Promise<Object>} Restored data object
     */
    static async extractBackupZip(fileBuffer) {
        if (typeof window.JSZip === 'undefined') {
            throw new Error(t('utils.zipBackup.jszipMissing'));
        }

        const zip = new window.JSZip();
        await zip.loadAsync(fileBuffer);

        const restoredData = {
            transactions: [],
            fixedRecords: [],
            categories: [],
            targets: [],
            preferences: {}
        };

        // Read all JSONs in the data folder
        const dataFolder = zip.folder("data");
        if (!dataFolder) {
            throw new Error(t('utils.zipBackup.dataFolderMissing'));
        }

        // JSZip.folder returns all files within this folder (including subdirectories)
        // To avoid issues, we can traverse using zip.files
        const jsonFiles = Object.keys(zip.files).filter(name => name.startsWith('data/') && name.endsWith('.json'));
        
        for (const relativePath of jsonFiles) {
            const file = zip.file(relativePath);
            if (!file) continue;
            
            let content = await file.async("string");
            if (content.charCodeAt(0) === 0xFEFF) {
                content = content.substring(1);
            }
            const parsed = JSON.parse(content);
            
            // Determine data type by filename
            const fileName = relativePath.split('/').pop(); // data/transactions_2024.json -> transactions_2024.json
            
            if (fileName === 'global.json') {
                restoredData.fixedRecords = parsed.fixedRecords || [];
                restoredData.categories = parsed.categories || [];
                restoredData.targets = parsed.targets || [];
                restoredData.preferences = parsed.preferences || {};
            } else if (fileName.startsWith('transactions')) {
                restoredData.transactions = restoredData.transactions.concat(parsed);
            }
        }

        // Process photo restoration
        for (const tx of restoredData.transactions) {
            if (tx.photo_ref) {
                const photoFile = zip.file(tx.photo_ref);
                if (photoFile) {
                    try {
                        const base64Data = await photoFile.async("base64");
                        const ext = tx.photo_ref.split('.').pop().toLowerCase();
                        let mimeType = `image/${ext}`;
                        if (ext === 'svg') mimeType = 'image/svg+xml';
                        else if (ext === 'jpg') mimeType = 'image/jpeg';
                        tx.attachment = `data:${mimeType};base64,${base64Data}`;
                    } catch (e) {
                        console.warn(`[Restore] Failed to read photo (${tx.photo_ref}):`, e);
                    }
                }
                delete tx.photo_ref;
            }
        }

        return restoredData;
    }
}
