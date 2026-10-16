/**
 * ============================================================================
 * Universal Data Merger & Validation Module (DataMerger)
 * ============================================================================
 * Provides a two-stage database import operation to support preview functionality.
 * 
 * @example
 * import { DataMerger } from '../../utils/js/dataMerger.js';
 * 
 * const getFingerprint = (item) => `${item.date}_${item.amount}_${item.note}`;
 * 
 * // 1. Preview analysis
 * const analysis = DataMerger.analyze(importedData, existingData, getFingerprint);
 * console.log(`Ready to add ${analysis.pendingItems.length} items, skipped ${analysis.skipCount} duplicates`);
 * 
 * // 2. Write after confirmation
 * if (confirm('Are you sure you want to write?')) {
 *     const savedItems = await DataMerger.execute(analysis.pendingItems, db.saveItem);
 * }
 */
export const DataMerger = {
    /**
     * Stage 1: Analyze and filter data to be added (Preview)
     * @param {Array} incoming - Array of incoming data to import
     * @param {Array} existing - Array of existing data
     * @param {Function} fingerprintFn - Function to generate a unique fingerprint (item => string)
     * @param {Set} [sharedFingerprints] - (Optional) Shared fingerprint set for cross-step lookup
     * @returns {Object} { pendingItems, skipCount, fingerprints }
     */
    analyze(incoming, existing, fingerprintFn, sharedFingerprints = null) {
        if (!incoming || !Array.isArray(incoming)) {
            return { pendingItems: [], skipCount: 0, fingerprints: sharedFingerprints || new Set() };
        }
        
        const fingerprints = sharedFingerprints || new Set(existing.map(fingerprintFn));
        const pendingItems = [];
        let skipCount = 0;

        for (const item of incoming) {
            // Failsafe check
            if (!item) continue;
            
            const fp = fingerprintFn(item);
            if (fingerprints.has(fp)) {
                skipCount++;
                continue;
            }
            
            // Clone and remove the original ID so IndexedDB can assign a new one
            const itemToSave = { ...item };
            delete itemToSave.id;
            
            fingerprints.add(fp);
            pendingItems.push(itemToSave);
        }

        return { pendingItems, skipCount, fingerprints };
    },

    /**
     * Stage 2: Actual write execution (Execute)
     * @param {Array} pendingItems - Array of pending data from Stage 1 analysis
     * @param {Function} saveFn - Asynchronous write function (item => Promise<id>)
     * @returns {Promise<Array>} Array of objects with newly assigned IDs
     */
    async execute(pendingItems, saveFn) {
        const savedItems = [];
        if (!pendingItems || !Array.isArray(pendingItems)) return savedItems;

        for (const item of pendingItems) {
            const savedId = await saveFn(item);
            item.id = savedId;
            savedItems.push(item);
        }
        return savedItems;
    },

    /**
     * Stage 2 (Batch): Actual batch write execution
     * @param {Array} pendingItems - Array of pending data from Stage 1 analysis
     * @param {Function} batchSaveFn - Batch write function (items => Promise<items>)
     * @returns {Promise<Array>} Array of objects with newly assigned IDs
     */
    async executeBatch(pendingItems, batchSaveFn, progressCallback = null) {
        if (!pendingItems || !Array.isArray(pendingItems) || pendingItems.length === 0) return [];
        return await batchSaveFn(pendingItems, progressCallback);
    }
};
