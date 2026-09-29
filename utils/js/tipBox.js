/**
 * Semantic Tip Box Module for Cross-Project Use
 * 
 * Provides a standardized semantic tip box HTML generator supporting 5 types:
 * - info    (Blue) — General information, operation tips
 * - success (Green) — Success, completion, positive confirmation
 * - warning (Orange) — Warnings, suggestions, notices
 * - danger  (Red) — Dangerous operations, irreversible actions, errors
 * - note    (Purple) — Notes, supplementary information, memos
 * 
 * Uses fixed semantic colors (independent of the theme engine) to ensure clarity under any custom theme.
 * Uses inline styles, zero CSS dependency, ready for cross-project copy-paste usage.
 * 
 * @module tipBox
 * @example
 * import { createTipBox } from '../utils/js/tipBox.js';
 * 
 * // Generate HTML string
 * const html = createTipBox({
 *     type: 'warning',
 *     html: '💡 <strong>Recommendation:</strong> Minimum setting is 480x480.'
 * });
 * 
 * // Insert into DOM
 * container.innerHTML = html;
 * 
 * // Or use the DOM element version
 * const element = createTipBoxElement({
 *     type: 'success',
 *     html: '✅ <strong>Backup Complete:</strong> All data is safely stored.'
 * });
 * container.appendChild(element);
 */

/**
 * Color definitions for the five semantic types.
 * Each type includes: background color, border color, left border accent, text color.
 * @readonly
 */
const TIP_STYLES = {
    info: {
        bg: '#eff6ff',        // blue-50
        border: '#bfdbfe',    // blue-200
        accent: '#3b82f6',    // blue-500
        text: '#1e40af',      // blue-800
        darkBg: 'rgba(59, 130, 246, 0.1)',
        darkBorder: 'rgba(59, 130, 246, 0.2)',
        darkText: '#93c5fd'   // blue-300
    },
    success: {
        bg: '#ecfdf5',        // emerald-50
        border: '#a7f3d0',    // emerald-200
        accent: '#10b981',    // emerald-500
        text: '#065f46',      // emerald-800
        darkBg: 'rgba(16, 185, 129, 0.1)',
        darkBorder: 'rgba(16, 185, 129, 0.2)',
        darkText: '#6ee7b7'   // emerald-300
    },
    warning: {
        bg: '#fff7ed',        // orange-50
        border: '#fed7aa',    // orange-200
        accent: '#f97316',    // orange-500
        text: '#9a3412',      // orange-800
        darkBg: 'rgba(249, 115, 22, 0.1)',
        darkBorder: 'rgba(249, 115, 22, 0.2)',
        darkText: '#fdba74'   // orange-300
    },
    danger: {
        bg: '#fef2f2',        // red-50
        border: '#fecaca',    // red-200
        accent: '#ef4444',    // red-500
        text: '#991b1b',      // red-800
        darkBg: 'rgba(239, 68, 68, 0.1)',
        darkBorder: 'rgba(239, 68, 68, 0.2)',
        darkText: '#fca5a5'   // red-300
    },
    note: {
        bg: '#faf5ff',        // purple-50
        border: '#e9d5ff',    // purple-200
        accent: '#a855f7',    // purple-500
        text: '#6b21a8',      // purple-800
        darkBg: 'rgba(168, 85, 247, 0.1)',
        darkBorder: 'rgba(168, 85, 247, 0.2)',
        darkText: '#d8b4fe'   // purple-300
    }
};

/**
 * Generate semantic tip box HTML string.
 * 
 * @param {Object} options - Configuration options
 * @param {'info'|'success'|'warning'|'danger'|'note'} options.type - Semantic type
 * @param {string} options.html - Tip box content (HTML supported)
 * @param {string} [options.fontSize='0.85rem'] - Font size
 * @returns {string} Complete tip box HTML string
 */
export function createTipBox({ type = 'info', html = '', fontSize = '0.85rem' } = {}) {
    const style = TIP_STYLES[type];
    if (!style) {
        console.warn(`[TipBox] Unknown tip type: ${type}, using info`);
        return createTipBox({ type: 'info', html, fontSize });
    }

    return `<div class="tip-box tip-box-${type}" style="
        font-size: ${fontSize};
        line-height: 1.6;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid ${style.border};
        border-left: 4px solid ${style.accent};
        background: ${style.bg};
        color: ${style.text};
    ">${html}</div>`;
}

/**
 * Generate semantic tip box DOM element.
 * 
 * @param {Object} options - Configuration options (same as createTipBox)
 * @param {'info'|'success'|'warning'|'danger'|'note'} options.type - Semantic type
 * @param {string} options.html - Tip box content (HTML supported)
 * @param {string} [options.fontSize='0.85rem'] - Font size
 * @returns {HTMLDivElement} Tip box DOM element
 */
export function createTipBoxElement({ type = 'info', html = '', fontSize = '0.85rem' } = {}) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = createTipBox({ type, html, fontSize });
    return wrapper.firstElementChild;
}

/**
 * Get semantic color definition (for advanced custom usage).
 * 
 * @param {'info'|'success'|'warning'|'danger'|'note'} type - Semantic type
 * @returns {Object|null} Color definition object, or null if type does not exist
 */
export function getTipStyle(type) {
    return TIP_STYLES[type] || null;
}
