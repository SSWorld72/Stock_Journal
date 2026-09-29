/**
 * ============================================================================
 * Device Detection Module (deviceDetection.js)
 * ============================================================================
 * Provides utility functions to determine whether the current user is on a mobile or desktop view.
 * 
 * @example
 * import { isMobile, isDesktop, onDeviceChange } from '../../utils/js/deviceDetection.js';
 * 
 * if (isMobile()) {
 *     console.log('Currently in mobile view');
 * }
 * 
 * const unlisten = onDeviceChange((mobile) => {
 *     console.log(mobile ? 'Switched to mobile view' : 'Switched to desktop view');
 * });
 */

/**
 * Checks if the view is in mobile mode (screen width less than 768px or userAgent contains mobile device signatures)
 * @returns {boolean}
 */
export function isMobile() {
    // 1. Prioritize CSS Media Query logic (consistent with Tailwind's md: breakpoint at 768px)
    if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia("(max-width: 767px)").matches;
    }
    
    // 2. Fallback: Use userAgent detection
    if (typeof navigator !== 'undefined') {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    
    return false; // Default to desktop view
}

/**
 * Checks if the view is in desktop mode
 * @returns {boolean}
 */
export function isDesktop() {
    return !isMobile();
}

/**
 * Registers a listener for device changes (triggered when window resizes across the breakpoint)
 * @param {Function} callback - Callback function, parameter is isMobile (boolean)
 * @returns {Function} - Returns a function to unregister the listener
 */
export function onDeviceChange(callback) {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const handler = (e) => callback(e.matches);
    
    if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    } else {
        mediaQuery.addListener(handler);
        return () => mediaQuery.removeListener(handler);
    }
}
