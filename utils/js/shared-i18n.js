/**
 * ============================================================================
 * Shared i18n Wrapper (shared-i18n.js)
 * ============================================================================
 * This is an i18n wrapper specifically designed for shared modules under utils/.
 * 
 * Mechanism:
 * 1. If global `window.t` is defined (meaning the host project implements i18n), it delegates the translation.
 * 2. If `window.t` is missing (host project lacks i18n), it loads `utils/i18n/zh-TW.js` as a default fallback.
 * 
 * This ensures that all shared modules can safely use `t('key')` purely in English,
 * while maintaining backward compatibility with legacy projects that don't have i18n implemented.
 */

import fallbackDict from '../i18n/zh-TW.js';

/**
 * Translation function for shared modules
 * @param {string} key Translation key (e.g., 'utils.dangerZone.confirmMessage')
 * @param {Object} params Variable replacements (optional)
 * @returns {string} Translated string or fallback string
 */
export function t(key, params = {}) {
    // 1. Delegate to the global i18n engine if it exists
    if (typeof window !== 'undefined' && typeof window.t === 'function') {
        const result = window.t(key, params);
        // If the global engine returns something other than the key itself, it means it found a translation
        if (result !== key) {
            return result;
        }
    }
    
    // 2. Fallback: Parse the local default Chinese dictionary
    let value = key.split('.').reduce((obj, k) => (obj || {})[k], fallbackDict);
    
    // If key is not found, return the key itself and warn in console
    if (value === undefined || value === null) {
        console.warn(`[shared-i18n] Fallback warning: Translation key not found: ${key}`);
        return key;
    }
    
    // Handle variable replacements (e.g., {count})
    if (typeof value === 'string' && params && typeof params === 'object') {
        Object.keys(params).forEach(paramKey => {
            const regex = new RegExp(`{${paramKey}}`, 'g');
            value = value.replace(regex, params[paramKey]);
        });
    }
    
    return value;
}
