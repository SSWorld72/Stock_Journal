export class I18nEngine {
    constructor(dict = {}) {
        this.dict = dict;
        this.currentLang = localStorage.getItem('tinyledger_lang') || 'en-US';
        this.debugMode = false;
        this.onLanguageChanged = null;
    }

    async loadLanguage(langCode) {
        try {
            // Check manifest first (optional, assumes it's available or passes through)
            const v = Date.now(); // Cache buster for development
            const sharedMod = await import(`../i18n/${langCode}.js?v=${v}`);
            const appMod = await import(`../../i18n/${langCode}.js?v=${v}`);
            
            this.dict = { ...sharedMod.default, ...appMod.default };
            this.currentLang = langCode;
            localStorage.setItem('tinyledger_lang', langCode);
            document.documentElement.lang = langCode;
            
            this.bindDOM();
            if (this.onLanguageChanged) {
                this.onLanguageChanged(langCode);
            }
            
            // Dispatch global event for other components (like charts, re-renders)
            window.dispatchEvent(new Event('i18n-changed'));
            return true;
        } catch (e) {
            console.error('[i18n] Failed to load language:', langCode, e);
            return false;
        }
    }

    t(key, params = {}) {
        if (!key) return '';

        const keys = key.split('.');
        let val = this.dict;
        for (const k of keys) {
            if (val === undefined || val === null) break;
            val = val[k];
        }

        let result = val !== undefined ? val : key;

        // Dynamic Variable Injection
        if (typeof result === 'string') {
            for (const [k, v] of Object.entries(params)) {
                result = result.replace(new RegExp(`{${k}}`, 'g'), v);
            }
        }

        // Pseudo-Localization Debug Mode
        if (this.debugMode) {
            result = `[ ${result} ]`;
        }
        return result;
    }

    setDebugMode(enabled) {
        this.debugMode = enabled;
        console.log(this.t('logs.i18n.debugMode', { state: enabled ? 'ON' : 'OFF' }));
        this.bindDOM(); // Re-render DOM
    }

    bindDOM(root = document) {
        // Handle standard text (textContent) and inputs (value / placeholder)
        const elements = root.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    if (el.type === 'button' || el.type === 'submit') {
                        el.value = this.t(key);
                    } else {
                        el.placeholder = this.t(key);
                    }
                } else {
                    el.textContent = this.t(key);
                }
            }
        });

        // Handle HTML content (innerHTML)
        const htmlElements = root.querySelectorAll('[data-i18n-html]');
        htmlElements.forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            if (key) el.innerHTML = this.t(key);
        });

        // Handle title attributes
        const titleElements = root.querySelectorAll('[data-i18n-title]');
        titleElements.forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) el.title = this.t(key);
        });

        // Handle placeholder attributes explicitly
        const placeholderElements = root.querySelectorAll('[data-i18n-placeholder]');
        placeholderElements.forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) el.placeholder = this.t(key);
        });
    }

    async mountLanguageSelectorUI({ containerId }) {
        const container = document.getElementById(containerId);
        if (!container) return;

        try {
            // Load manifest to get supported languages
            const manifestMod = await import('../../i18n/manifest.js?v=2');
            const supportedLanguages = manifestMod.supportedLanguages || [
                { code: 'zh-TW', nativeName: '繁體中文' },
                { code: 'zh-CN', nativeName: '简体中文' },
                { code: 'en-US', nativeName: 'English (US)' },
                { code: 'ja-JP', nativeName: '日本語' },
                { code: 'ko-KR', nativeName: '한국어' },
                { code: 'th-TH', nativeName: 'ไทย' },
                { code: 'hi-IN', nativeName: 'हिन्दी' },
                { code: 'fr-FR', nativeName: 'Français' },
                { code: 'de-DE', nativeName: 'Deutsch' }
            ];

            container.innerHTML = '';
            
            const select = document.createElement('select');
            select.className = 'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500';
            select.style.cursor = 'pointer';

            supportedLanguages.forEach(lang => {
                const option = document.createElement('option');
                option.value = lang.code;
                option.textContent = lang.nativeName;
                if (lang.code === this.currentLang) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            select.addEventListener('change', async (e) => {
                const newLang = e.target.value;
                if (newLang !== this.currentLang) {
                    localStorage.setItem('tinyledger_lang', newLang);
                    window.location.reload();
                }
            });

            container.appendChild(select);
        } catch (e) {
            console.error('[i18n] Failed to mount language selector:', e);
        }
    }
}
