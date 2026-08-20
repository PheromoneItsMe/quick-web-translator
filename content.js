// Quick Web Translator - Content Script
// Author: Pheromone

(function () {
    'use strict';

    // Default configuration
    const CONFIG = {
        targetLang: 'ru',
        sourceLang: 'auto',
        showTriggerButton: false // false = instant auto-translate, true = floating trigger icon
    };

    // Load persisted settings from chrome.storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['showTriggerButton', 'targetLang', 'sourceLang'], (res) => {
            if (res) {
                if (typeof res.showTriggerButton === 'boolean') CONFIG.showTriggerButton = res.showTriggerButton;
                if (res.targetLang) CONFIG.targetLang = res.targetLang;
                if (res.sourceLang) CONFIG.sourceLang = res.sourceLang;
            }
        });
    }

    let hostElement = null;
    let shadowRoot = null;
    let popupElement = null;
    let triggerBtnElement = null;

    let isPinned = false;
    let activeSelectionText = '';
    let latestTranslationText = '';

    let lastPointerPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let isAudioPlaying = false;
    let activeUtterance = null;
    let activeAudioObj = null;

    let lastHandledText = '';
    let selectionTimeout = null;
    let popupOpenedTimestamp = 0;

    // Ensure isolated Shadow DOM host container is mounted directly in document.body
    function ensureShadowHost() {
        if (!hostElement || !hostElement.isConnected || !document.contains(hostElement)) {
            if (hostElement) {
                try { hostElement.remove(); } catch (e) {}
            }

            hostElement = document.createElement('div');
            hostElement.id = 'qwt-translator-host';
            hostElement.style.cssText = 'all: initial !important; display: block !important; position: static !important; width: 0 !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: none !important; z-index: 2147483647 !important; pointer-events: none !important;';

            const root = document.body || document.documentElement;
            if (root) {
                root.appendChild(hostElement);
            }

            try {
                shadowRoot = hostElement.attachShadow({ mode: 'open' });
            } catch (e) {
                shadowRoot = hostElement.shadowRoot;
            }

            injectStyles(shadowRoot);
        }
        return shadowRoot;
    }

    // Inject isolated CSS styles into Shadow DOM
    function injectStyles(root) {
        if (!root) return;
        const style = document.createElement('style');
        style.textContent = `
            :host {
                all: initial;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
            }

            *, *::before, *::after {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            .qwt-popup {
                position: fixed !important;
                pointer-events: auto !important;
                background: rgba(24, 28, 38, 0.96);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.09);
                border-radius: 12px;
                box-shadow: 0 14px 34px rgba(0, 0, 0, 0.48), 0 2px 6px rgba(0, 0, 0, 0.2);
                padding: 10px 14px 12px;
                min-width: 260px;
                min-height: 80px;
                max-width: 90vw;
                max-height: 85vh;
                width: 320px;
                height: auto;
                z-index: 2147483647 !important;
                display: flex;
                flex-direction: column;
                gap: 7px;
                overflow: hidden;
                animation: qwtFadeIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
                transition: opacity 0.15s ease;
                user-select: text;
                box-sizing: border-box;
            }

            /* Resizer handles for 8-direction Windows-like resizing */
            .qwt-resizer {
                position: absolute;
                z-index: 50;
                user-select: none;
                touch-action: none;
            }

            /* Edges */
            .qwt-resizer-t {
                top: 0;
                left: 0;
                right: 0;
                height: 6px;
                cursor: ns-resize;
            }
            .qwt-resizer-b {
                bottom: 0;
                left: 0;
                right: 0;
                height: 6px;
                cursor: ns-resize;
            }
            .qwt-resizer-l {
                top: 0;
                bottom: 0;
                left: 0;
                width: 6px;
                cursor: ew-resize;
            }
            .qwt-resizer-r {
                top: 0;
                bottom: 0;
                right: 0;
                width: 6px;
                cursor: ew-resize;
            }

            /* Corners */
            .qwt-resizer-tl {
                top: 0;
                left: 0;
                width: 12px;
                height: 12px;
                cursor: nwse-resize;
            }
            .qwt-resizer-tr {
                top: 0;
                right: 0;
                width: 12px;
                height: 12px;
                cursor: nesw-resize;
            }
            .qwt-resizer-bl {
                bottom: 0;
                left: 0;
                width: 12px;
                height: 12px;
                cursor: nesw-resize;
            }
            .qwt-resizer-br {
                bottom: 0;
                right: 0;
                width: 12px;
                height: 12px;
                cursor: nwse-resize;
            }

            @keyframes qwtFadeIn {
                from {
                    opacity: 0;
                    transform: translateY(5px) scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }

            .qwt-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                padding-bottom: 6px;
                gap: 8px;
                user-select: none;
                cursor: grab;
                flex-shrink: 0;
                position: relative;
                z-index: 60;
                min-width: 0;
            }

            .qwt-header:active {
                cursor: grabbing;
            }

            .qwt-badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-size: 11px;
                font-weight: 500;
                color: #94a3b8;
                letter-spacing: 0.3px;
                pointer-events: none;
                position: relative;
                z-index: 60;
                flex-shrink: 0;
            }

            .qwt-badge svg {
                width: 13px;
                height: 13px;
                fill: #818cf8;
            }

            .qwt-actions {
                display: flex;
                align-items: center;
                gap: 3px;
                cursor: default;
                position: relative;
                z-index: 70;
                flex-shrink: 0;
            }

            .qwt-btn-wrap {
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            .qwt-btn {
                background: transparent;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                border-radius: 6px;
                padding: 4px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
            }

            .qwt-btn:hover {
                background: rgba(255, 255, 255, 0.08);
                color: #f1f5f9;
            }

            .qwt-btn:active {
                transform: scale(0.93);
            }

            .qwt-btn svg {
                width: 14px;
                height: 14px;
                stroke: currentColor;
                stroke-width: 2;
                fill: none;
            }

            /* Pin Button Styles & State */
            .qwt-pin-btn {
                transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
            }

            .qwt-pin-btn svg {
                transform: rotate(45deg);
                transform-origin: center center;
            }

            .qwt-pin-btn.pinned {
                color: #818cf8 !important;
                background: rgba(129, 140, 248, 0.14) !important;
            }

            .qwt-pin-btn.pinned svg path {
                fill: currentColor;
            }

            /* Speaker / Playback states */
            .qwt-btn.playing {
                color: #f43f5e !important;
                background: rgba(244, 63, 94, 0.14) !important;
            }

            .qwt-btn.playing svg {
                fill: currentColor;
                stroke: none;
            }

            /* Copy Button Styles & Micro-Animation */
            .qwt-copy-svg {
                width: 14px;
                height: 14px;
                overflow: visible;
            }

            .qwt-copy-front, .qwt-copy-back {
                transform-origin: center center;
            }

            .qwt-copy-btn.copied {
                color: #818cf8 !important;
                background: rgba(129, 140, 248, 0.14) !important;
            }

            .qwt-copy-btn.copied .qwt-copy-front {
                animation: qwtCopyFrontSwap 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }

            .qwt-copy-btn.copied .qwt-copy-back {
                animation: qwtCopyBackSwap 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
            }

            @keyframes qwtCopyFrontSwap {
                0% {
                    transform: translate(0, 0) scale(1);
                }
                45% {
                    transform: translate(-5px, -5px) scale(0.88);
                }
                75% {
                    transform: translate(1px, 1px) scale(1.06);
                }
                100% {
                    transform: translate(0, 0) scale(1);
                }
            }

            @keyframes qwtCopyBackSwap {
                0% {
                    transform: translate(0, 0) scale(1);
                }
                45% {
                    transform: translate(5px, 5px) scale(1.12);
                }
                75% {
                    transform: translate(-1px, -1px) scale(0.94);
                }
                100% {
                    transform: translate(0, 0) scale(1);
                }
            }

            /* Settings / Mode Gear Animation (Smooth 45deg rotation strictly around center) */
            .qwt-mode-btn svg {
                transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease;
                transform-origin: center center;
            }

            .qwt-mode-btn.active {
                color: #818cf8 !important;
                background: rgba(129, 140, 248, 0.14) !important;
            }

            .qwt-mode-btn.active svg {
                transform: rotate(45deg);
            }

            .qwt-mode-btn:not(.active) svg {
                transform: rotate(0deg);
            }

            /* Tooltip Pill directly below action buttons inside popup boundaries */
            .qwt-btn-tooltip {
                position: absolute;
                top: calc(100% + 7px);
                right: -2px;
                left: auto;
                transform: translateY(-4px) scale(0.9);
                background: #1e1b4b;
                border: 1px solid rgba(129, 140, 248, 0.55);
                color: #e0e7ff;
                font-size: 10.5px;
                font-weight: 600;
                letter-spacing: 0.25px;
                padding: 3px 8px;
                border-radius: 6px;
                white-space: nowrap;
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.7), 0 0 12px rgba(129, 140, 248, 0.35);
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
                z-index: 10000;
            }

            .qwt-btn-tooltip::after {
                content: '';
                position: absolute;
                bottom: 100%;
                right: 9px;
                border-width: 4px;
                border-style: solid;
                border-color: transparent transparent #1e1b4b transparent;
            }

            .qwt-btn-tooltip.visible {
                opacity: 1;
                transform: translateY(0) scale(1);
            }

            .qwt-body {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-height: 0;
            }

            .qwt-translation {
                font-size: 14px;
                font-weight: 400;
                color: #f1f5f9;
                line-height: 1.55;
                letter-spacing: 0.1px;
                word-break: break-word;
                overflow-y: auto;
                flex: 1;
                min-height: 0;
                padding-right: 2px;
            }

            .qwt-loading {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #94a3b8;
                font-size: 12.5px;
                padding: 4px 0;
            }

            .qwt-spinner {
                width: 13px;
                height: 13px;
                border: 2px solid rgba(255, 255, 255, 0.12);
                border-top-color: #818cf8;
                border-radius: 50%;
                animation: qwtSpin 0.6s linear infinite;
            }

            @keyframes qwtSpin {
                to { transform: rotate(360deg); }
            }

            .qwt-error {
                color: #f87171;
                font-size: 12.5px;
                line-height: 1.4;
            }

            .qwt-trigger-btn {
                position: fixed !important;
                pointer-events: auto !important;
                width: 26px;
                height: 26px;
                background: #4f46e5;
                color: white;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
                border: 1px solid rgba(255, 255, 255, 0.15);
                z-index: 2147483647 !important;
                transition: transform 0.15s ease, background 0.15s ease;
                animation: qwtPop 0.15s ease;
            }

            .qwt-trigger-btn:hover {
                background: #4338ca;
                transform: scale(1.08);
            }

            .qwt-trigger-btn svg {
                width: 14px;
                height: 14px;
                fill: currentColor;
            }

            @keyframes qwtPop {
                from { transform: scale(0.6); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }

            .qwt-popup *::-webkit-scrollbar {
                width: 4px;
            }
            .qwt-popup *::-webkit-scrollbar-track {
                background: transparent;
            }
            .qwt-popup *::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 4px;
            }
        `;
        root.appendChild(style);
    }

    const ICONS = {
        pin: `<svg viewBox="0 0 24 24"><path d="M16 3l1 6 2 2v1H5v-1l2-2 1-6h8z"></path><line x1="12" y1="12" x2="12" y2="21"></line><line x1="8" y1="3" x2="16" y2="3"></line></svg>`,
        translate: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
        speaker: `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        stop: `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"></rect></svg>`,
        copy: `<svg viewBox="0 0 24 24" class="qwt-copy-svg"><rect class="qwt-copy-back" x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" fill="none"></rect><rect class="qwt-copy-front" x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" fill="none"></rect></svg>`,
        close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
    };

    function updateSpeakButtonUI(playing) {
        if (!popupElement) return;
        const btn = popupElement.querySelector('.qwt-speak-btn');
        if (!btn) return;

        if (playing) {
            btn.innerHTML = ICONS.stop;
            btn.classList.add('playing');
            btn.title = 'Stop playback';
        } else {
            btn.innerHTML = ICONS.speaker;
            btn.classList.remove('playing');
            btn.title = 'Listen to pronunciation';
        }
    }

    function stopAudio() {
        isAudioPlaying = false;
        updateSpeakButtonUI(false);

        if (activeAudioObj) {
            try {
                activeAudioObj.pause();
                activeAudioObj.currentTime = 0;
            } catch (e) {}
            activeAudioObj = null;
        }

        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            try {
                if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
                    window.speechSynthesis.cancel();
                }
            } catch (e) {}
        }
        activeUtterance = null;
    }

    function playGoogleTTS(text, lang = 'en') {
        try {
            const shortLang = lang.split('-')[0] || 'en';
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(shortLang)}&client=tw-ob&q=${encodeURIComponent(text.substring(0, 200))}`;
            const audio = new Audio(url);
            activeAudioObj = audio;

            audio.onended = () => {
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
                activeAudioObj = null;
            };

            audio.onerror = () => {
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
                activeAudioObj = null;
            };

            audio.play().catch((err) => {
                console.warn('Google TTS audio playback failed:', err);
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
                activeAudioObj = null;
            });
        } catch (e) {
            isAudioPlaying = false;
            updateSpeakButtonUI(false);
        }
    }

    function playSpeech(text, lang = 'en-US') {
        if (!text || typeof text !== 'string') return;
        const cleanText = text.trim();
        if (!cleanText) return;

        stopAudio();

        // 40ms delay allows Chromium's audio thread to clear previous cancel() state
        setTimeout(() => {
            isAudioPlaying = true;
            updateSpeakButtonUI(true);

            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                try {
                    if (window.speechSynthesis.paused) {
                        window.speechSynthesis.resume();
                    }

                    const utterance = new SpeechSynthesisUtterance(cleanText);
                    utterance.lang = lang;
                    utterance.rate = 0.95;

                    const shortLang = lang.split('-')[0] || 'en';
                    const voices = window.speechSynthesis.getVoices();
                    if (voices && voices.length > 0) {
                        const voice = voices.find(v => v.lang.startsWith(shortLang) || v.lang.includes('en'));
                        if (voice) utterance.voice = voice;
                    }

                    utterance.onend = () => {
                        isAudioPlaying = false;
                        updateSpeakButtonUI(false);
                        activeUtterance = null;
                    };

                    utterance.onerror = (e) => {
                        if (e.error === 'canceled' || e.error === 'interrupted') {
                            return;
                        }
                        console.warn('SpeechSynthesis error, falling back to Google TTS:', e.error);
                        playGoogleTTS(cleanText, shortLang);
                    };

                    activeUtterance = utterance; // Prevent garbage collection in Chromium
                    window.speechSynthesis.speak(utterance);
                    return;
                } catch (err) {
                    console.warn('SpeechSynthesis failed, using Google TTS fallback', err);
                }
            }

            playGoogleTTS(cleanText, lang);
        }, 45);
    }

    function toggleSpeech(text, lang = 'en-US') {
        if (isAudioPlaying) {
            stopAudio();
        } else {
            playSpeech(text, lang);
        }
    }

    // Request translation via background service worker (100% bypasses CORS & CSP)
    function requestTranslation(text) {
        return new Promise((resolve, reject) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({
                    action: 'translate',
                    text: text,
                    sl: CONFIG.sourceLang,
                    tl: CONFIG.targetLang
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || 'Extension runtime error'));
                        return;
                    }

                    if (response && response.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response ? response.error : 'Translation failed'));
                    }
                });
            } else {
                reject(new Error('Extension runtime not available'));
            }
        });
    }

    function calculatePopupPosition(rect) {
        const padding = 14;
        const estimatedWidth = 320;
        const estimatedHeight = 105;

        let left = lastPointerPos.x;
        let top = lastPointerPos.y + 14;

        if (rect && typeof rect.left === 'number' && (rect.width > 0 || rect.height > 0)) {
            left = rect.left;
            top = rect.bottom + 8;

            if (top + estimatedHeight > window.innerHeight - padding) {
                if (rect.top - estimatedHeight - 8 > padding) {
                    top = rect.top - estimatedHeight - 8;
                } else {
                    top = Math.max(padding, window.innerHeight - estimatedHeight - padding);
                }
            }
        } else {
            if (top + estimatedHeight > window.innerHeight - padding) {
                top = Math.max(padding, lastPointerPos.y - estimatedHeight - 14);
            }
        }

        if (left + estimatedWidth > window.innerWidth - padding) {
            left = window.innerWidth - estimatedWidth - padding;
        }
        if (left < padding) left = padding;
        if (top < 28) top = 28;

        return { left: Math.round(left), top: Math.round(top) };
    }

    function setupResizable(popupEl) {
        const resizers = popupEl.querySelectorAll('.qwt-resizer');
        const minWidth = 260;
        const minHeight = 80;

        resizers.forEach(resizer => {
            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const dir = resizer.getAttribute('data-dir');
                const startX = e.clientX;
                const startY = e.clientY;
                const startRect = popupEl.getBoundingClientRect();
                const startLeft = startRect.left;
                const startTop = startRect.top;
                const startWidth = startRect.width;
                const startHeight = startRect.height;

                popupEl.style.width = `${startWidth}px`;
                popupEl.style.height = `${startHeight}px`;
                popupEl.style.left = `${startLeft}px`;
                popupEl.style.top = `${startTop}px`;
                popupEl.style.right = 'auto';
                popupEl.style.bottom = 'auto';

                const originalUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';

                const onMouseMove = (moveEvent) => {
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;

                    let newWidth = startWidth;
                    let newHeight = startHeight;
                    let newLeft = startLeft;
                    let newTop = startTop;

                    // Horizontal resizing
                    if (dir.includes('r')) {
                        const maxWidth = window.innerWidth - startLeft - 4;
                        newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx));
                    } else if (dir.includes('l')) {
                        const rightEdge = startLeft + startWidth;
                        const maxPossibleWidth = rightEdge - 4;
                        const rawWidth = startWidth - dx;
                        newWidth = Math.max(minWidth, Math.min(maxPossibleWidth, rawWidth));
                        newLeft = rightEdge - newWidth;
                    }

                    // Vertical resizing
                    if (dir.includes('b')) {
                        const maxHeight = window.innerHeight - startTop - 4;
                        newHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + dy));
                    } else if (dir.includes('t')) {
                        const bottomEdge = startTop + startHeight;
                        const maxPossibleHeight = bottomEdge - 4;
                        const rawHeight = startHeight - dy;
                        newHeight = Math.max(minHeight, Math.min(maxPossibleHeight, rawHeight));
                        newTop = bottomEdge - newHeight;
                    }

                    popupEl.style.width = `${Math.round(newWidth)}px`;
                    popupEl.style.height = `${Math.round(newHeight)}px`;
                    popupEl.style.left = `${Math.round(newLeft)}px`;
                    popupEl.style.top = `${Math.round(newTop)}px`;
                };

                const onMouseUp = () => {
                    document.body.style.userSelect = originalUserSelect;
                    window.removeEventListener('mousemove', onMouseMove, { capture: true });
                    window.removeEventListener('mouseup', onMouseUp, { capture: true });
                };

                window.addEventListener('mousemove', onMouseMove, { capture: true });
                window.addEventListener('mouseup', onMouseUp, { capture: true });
            });
        });
    }

    function setupDraggable(popupEl, headerEl) {
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        headerEl.addEventListener('mousedown', (e) => {
            if (e.target.closest('.qwt-actions') || e.target.closest('.qwt-btn') || e.target.closest('.qwt-btn-wrap') || e.target.closest('.qwt-resizer')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = popupEl.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            e.preventDefault();

            const onMouseMove = (moveEvent) => {
                if (!isDragging) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;

                const maxLeft = window.innerWidth - popupEl.offsetWidth;
                const maxTop = window.innerHeight - popupEl.offsetHeight;

                const newLeft = Math.max(4, Math.min(maxLeft - 4, initialLeft + dx));
                const newTop = Math.max(4, Math.min(maxTop - 4, initialTop + dy));

                popupEl.style.left = `${Math.round(newLeft)}px`;
                popupEl.style.top = `${Math.round(newTop)}px`;
                popupEl.style.right = 'auto';
                popupEl.style.bottom = 'auto';
            };

            const onMouseUp = () => {
                isDragging = false;
                window.removeEventListener('mousemove', onMouseMove, { capture: true });
                window.removeEventListener('mouseup', onMouseUp, { capture: true });
            };

            window.addEventListener('mousemove', onMouseMove, { capture: true });
            window.addEventListener('mouseup', onMouseUp, { capture: true });
        }, { capture: true });
    }

    function updatePinnedPopupContent(text) {
        if (!popupElement || !text) return;
        activeSelectionText = text;
        stopAudio();

        const body = popupElement.querySelector('.qwt-body');
        if (body) {
            body.innerHTML = `
                <div class="qwt-loading">
                    <div class="qwt-spinner"></div>
                    <span>Translating...</span>
                </div>
            `;
        }

        requestTranslation(text)
            .then(result => {
                if (!popupElement || activeSelectionText !== text) return;
                latestTranslationText = (result && result.translation) ? result.translation : '';
                renderTranslationResult(result);
            })
            .catch(err => {
                if (!popupElement || activeSelectionText !== text) return;
                if (body) {
                    body.innerHTML = `<div class="qwt-error">Translation error: ${escapeHtml(err.message)}</div>`;
                }
            });
    }

    function showPopup(rect, text) {
        const root = ensureShadowHost();
        hideTriggerButton();
        stopAudio();

        if (popupElement) popupElement.remove();

        popupElement = document.createElement('div');
        popupElement.className = 'qwt-popup';
        popupOpenedTimestamp = Date.now();

        activeSelectionText = text;
        latestTranslationText = '';
        let copyTimeout = null;
        let modeTimeout = null;
        let pinTimeout = null;

        const liveData = extractSelectionData();
        const effectiveRect = (liveData && liveData.rect) ? liveData.rect : (triggerBtnElement ? triggerBtnElement.getBoundingClientRect() : rect);
        const coords = calculatePopupPosition(effectiveRect);
        popupElement.style.left = `${coords.left}px`;
        popupElement.style.top = `${coords.top}px`;

        popupElement.innerHTML = `
            <div class="qwt-resizer qwt-resizer-t" data-dir="t"></div>
            <div class="qwt-resizer qwt-resizer-r" data-dir="r"></div>
            <div class="qwt-resizer qwt-resizer-b" data-dir="b"></div>
            <div class="qwt-resizer qwt-resizer-l" data-dir="l"></div>
            <div class="qwt-resizer qwt-resizer-tl" data-dir="tl"></div>
            <div class="qwt-resizer qwt-resizer-tr" data-dir="tr"></div>
            <div class="qwt-resizer qwt-resizer-bl" data-dir="bl"></div>
            <div class="qwt-resizer qwt-resizer-br" data-dir="br"></div>
            <div class="qwt-header">
                <div class="qwt-badge">
                    ${ICONS.translate}
                    <span>Translation</span>
                </div>
                <div class="qwt-actions">
                    <div class="qwt-btn-wrap">
                        <button class="qwt-btn qwt-pin-btn ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin window' : 'Pin window'}">${ICONS.pin}</button>
                        <span class="qwt-btn-tooltip qwt-pin-tooltip">${isPinned ? 'Pinned' : 'Pin window'}</span>
                    </div>
                    <div class="qwt-btn-wrap">
                        <button class="qwt-btn qwt-speak-btn" title="Listen to pronunciation">${ICONS.speaker}</button>
                    </div>
                    <div class="qwt-btn-wrap">
                        <button class="qwt-btn qwt-copy-btn" title="Copy translation">${ICONS.copy}</button>
                        <span class="qwt-btn-tooltip qwt-copy-tooltip">Copied!</span>
                    </div>
                    <div class="qwt-btn-wrap">
                        <button class="qwt-btn qwt-mode-btn ${CONFIG.showTriggerButton ? 'active' : ''}" title="${CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate'}">${ICONS.settings}</button>
                        <span class="qwt-btn-tooltip qwt-mode-tooltip">${CONFIG.showTriggerButton ? 'Trigger button' : 'Auto-translate'}</span>
                    </div>
                    <div class="qwt-btn-wrap">
                        <button class="qwt-btn qwt-close-btn" title="Close">${ICONS.close}</button>
                    </div>
                </div>
            </div>
            <div class="qwt-body">
                <div class="qwt-loading">
                    <div class="qwt-spinner"></div>
                    <span>Translating...</span>
                </div>
            </div>
        `;

        root.appendChild(popupElement);

        const headerEl = popupElement.querySelector('.qwt-header');
        setupResizable(popupElement);
        setupDraggable(popupElement, headerEl);

        const pinBtn = popupElement.querySelector('.qwt-pin-btn');
        const pinTooltip = popupElement.querySelector('.qwt-pin-tooltip');
        const speakBtn = popupElement.querySelector('.qwt-speak-btn');
        const copyBtn = popupElement.querySelector('.qwt-copy-btn');
        const copyTooltip = popupElement.querySelector('.qwt-copy-tooltip');
        const closeBtn = popupElement.querySelector('.qwt-close-btn');
        const modeBtn = popupElement.querySelector('.qwt-mode-btn');
        const modeTooltip = popupElement.querySelector('.qwt-mode-tooltip');

        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isPinned = !isPinned;
            pinBtn.classList.toggle('pinned', isPinned);
            pinBtn.title = isPinned ? 'Unpin window' : 'Pin window';

            if (pinTooltip) {
                pinTooltip.textContent = isPinned ? 'Pinned' : 'Unpinned';
                if (pinTimeout) clearTimeout(pinTimeout);
                pinTooltip.classList.add('visible');
                pinTimeout = setTimeout(() => {
                    pinTooltip.classList.remove('visible');
                }, 1200);
            }
        });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isPinned = false;
            hidePopup();
        });

        speakBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSpeech(activeSelectionText || text);
        });

        // Copy button with interactive swap animation and "Copied!" tooltip
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const textToCopy = latestTranslationText || activeSelectionText || text;
            if (!textToCopy) return;

            navigator.clipboard.writeText(textToCopy).then(() => {
                copyBtn.classList.remove('copied');
                // Trigger reflow to restart CSS animation cleanly if clicked repeatedly
                void copyBtn.offsetWidth;
                copyBtn.classList.add('copied');

                if (copyTooltip) {
                    copyTooltip.textContent = 'Copied!';
                    if (copyTimeout) clearTimeout(copyTimeout);
                    copyTooltip.classList.add('visible');
                    copyTimeout = setTimeout(() => {
                        copyTooltip.classList.remove('visible');
                        copyBtn.classList.remove('copied');
                    }, 1300);
                }
            }).catch(() => {
                if (copyTooltip) {
                    copyTooltip.textContent = 'Copy failed';
                    if (copyTimeout) clearTimeout(copyTimeout);
                    copyTooltip.classList.add('visible');
                    copyTimeout = setTimeout(() => {
                        copyTooltip.classList.remove('visible');
                    }, 1300);
                }
            });
        });

        // Mode switch (Settings Gear) with smooth 90° rotation and status tooltip
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            CONFIG.showTriggerButton = !CONFIG.showTriggerButton;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ showTriggerButton: CONFIG.showTriggerButton });
            }
            modeBtn.classList.toggle('active', CONFIG.showTriggerButton);
            const titleStr = CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate';
            modeBtn.title = titleStr;

            if (modeTooltip) {
                modeTooltip.textContent = CONFIG.showTriggerButton ? 'Trigger button' : 'Auto-translate';
                if (modeTimeout) clearTimeout(modeTimeout);
                modeTooltip.classList.add('visible');
                modeTimeout = setTimeout(() => {
                    modeTooltip.classList.remove('visible');
                }, 1300);
            }
        });

        requestTranslation(text)
            .then(result => {
                if (!popupElement || activeSelectionText !== text) return;
                latestTranslationText = (result && result.translation) ? result.translation : '';
                renderTranslationResult(result);
            })
            .catch(err => {
                if (!popupElement || activeSelectionText !== text) return;
                const body = popupElement.querySelector('.qwt-body');
                if (body) {
                    body.innerHTML = `<div class="qwt-error">Translation error: ${escapeHtml(err.message)}</div>`;
                }
            });
    }

    function renderTranslationResult(result) {
        if (!popupElement) return;
        const body = popupElement.querySelector('.qwt-body');
        if (!body) return;

        body.innerHTML = `
            <div class="qwt-translation">${escapeHtml(result.translation || '—')}</div>
        `;
    }

    function isOurElement(el) {
        if (!el) return false;
        if (el === hostElement || el === shadowRoot || el === popupElement || el === triggerBtnElement) return true;
        if (hostElement && hostElement.contains(el)) return true;
        if (shadowRoot && shadowRoot.contains(el)) return true;
        return false;
    }

    function isElementOccluding(el, container) {
        if (!el || isOurElement(el)) return false;
        if (container && (el === container || container.contains(el) || el.contains(container))) {
            return false;
        }

        // Walk up from el to see if it is inside a truly occluding layer (e.g. fixed/sticky header, modal, dialog)
        let current = el;
        while (current && current !== document.body && current !== document.documentElement) {
            if (container && (current === container || container.contains(current))) {
                return false;
            }

            try {
                const style = window.getComputedStyle(current);
                const pos = style.position;
                if (pos === 'fixed' || pos === 'sticky') {
                    return true;
                }
                if (current.tagName === 'DIALOG' || current.getAttribute('role') === 'dialog' || current.getAttribute('aria-modal') === 'true') {
                    return true;
                }
                if (pos === 'absolute' && parseInt(style.zIndex, 10) >= 1000) {
                    return true;
                }
            } catch (e) {}

            current = current.parentElement;
        }

        return false;
    }

    function isPointOccluded(x, y, container) {
        if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
            return true;
        }

        let elements = [];
        try {
            elements = document.elementsFromPoint(x, y);
        } catch (e) {
            return false;
        }

        if (!elements || elements.length === 0) return false;

        for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (isOurElement(el)) continue;

            if (isElementOccluding(el, container)) {
                return true;
            }
        }

        return false;
    }

    function isSelectionOccluded(range, container, rect) {
        if (!rect) return true;

        // 1. Basic viewport bounds check
        if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
            return true;
        }

        // 2. Check clipping bounds of all parent scrollable containers (overflow: hidden/auto/scroll/clip)
        if (container) {
            let current = container.parentElement;
            while (current && current !== document.body && current !== document.documentElement) {
                try {
                    const style = window.getComputedStyle(current);
                    const overflowY = style.overflowY;
                    const overflowX = style.overflowX;
                    if (overflowY === 'hidden' || overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'clip' ||
                        overflowX === 'hidden' || overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'clip') {
                        const parentRect = current.getBoundingClientRect();
                        // If selection is fully scrolled out of this scrollable parent container:
                        if (rect.bottom <= parentRect.top + 1 || rect.top >= parentRect.bottom - 1 ||
                            rect.right <= parentRect.left + 1 || rect.left >= parentRect.right - 1) {
                            return true;
                        }
                    }
                } catch (e) {}
                current = current.parentElement;
            }
        }

        // 3. Hit-test sampling across the selection range using elementsFromPoint
        if (range && container) {
            const clientRects = range.getClientRects();
            if (clientRects.length > 0) {
                let anySampleVisible = false;
                for (let i = 0; i < clientRects.length; i++) {
                    const r = clientRects[i];
                    if (r.width === 0 || r.height === 0) continue;

                    const samplePoints = [
                        { x: r.left + Math.min(10, r.width / 2), y: r.top + r.height / 2 },
                        { x: (r.left + r.right) / 2, y: r.top + r.height / 2 },
                        { x: r.right - Math.min(10, r.width / 2), y: r.top + r.height / 2 }
                    ];

                    for (const pt of samplePoints) {
                        if (pt.x >= 0 && pt.x <= window.innerWidth && pt.y >= 0 && pt.y <= window.innerHeight) {
                            if (!isPointOccluded(pt.x, pt.y, container)) {
                                anySampleVisible = true;
                                break;
                            }
                        }
                    }
                    if (anySampleVisible) break;
                }

                if (!anySampleVisible) {
                    return true;
                }
            } else {
                const cx = (rect.left + rect.right) / 2;
                const cy = (rect.top + rect.bottom) / 2;
                if (isPointOccluded(cx, cy, container)) {
                    return true;
                }
            }
        }

        return false;
    }

    function updateTriggerButtonPosition(passedRect) {
        if (!triggerBtnElement) return;

        const data = extractSelectionData();
        if (!data || !data.text) {
            triggerBtnElement.style.display = 'none';
            return;
        }

        const rect = data.rect;
        const container = data.container;
        const range = data.range;

        // Check if the selected text is occluded by sticky/fixed headers, bottom bars (e.g. Gemini input, YouTube masthead), or scroll container bounds
        if (isSelectionOccluded(range, container, rect)) {
            triggerBtnElement.style.display = 'none';
            return;
        }

        // Determine the best anchor rect: use the last line's clientRect if multi-line
        let anchorRect = rect;
        if (range) {
            try {
                const rects = range.getClientRects();
                if (rects && rects.length > 0) {
                    for (let i = rects.length - 1; i >= 0; i--) {
                        if (rects[i].width > 0 && rects[i].height > 0) {
                            anchorRect = rects[i];
                            break;
                        }
                    }
                }
            } catch (e) {}
        }

        const btnWidth = 26;
        const btnHeight = 26;

        // Calculate preferred position: to the right and slightly below the end of the selection
        let left = (typeof anchorRect.right === 'number') ? anchorRect.right + 4 : lastPointerPos.x + 8;
        let top = (typeof anchorRect.bottom === 'number') ? anchorRect.bottom + 4 : lastPointerPos.y + 12;

        // If placing below exceeds the bottom of the viewport or is occluded by a fixed bottom bar, place above
        if (top + btnHeight > window.innerHeight - 6 || isPointOccluded(left + btnWidth / 2, top + btnHeight / 2, container)) {
            const aboveTop = (typeof anchorRect.top === 'number') ? anchorRect.top - btnHeight - 4 : lastPointerPos.y - btnHeight - 8;
            if (aboveTop >= 6 && !isPointOccluded(left + btnWidth / 2, aboveTop + btnHeight / 2, container)) {
                top = aboveTop;
            } else if (top + btnHeight > window.innerHeight - 6) {
                top = Math.max(6, window.innerHeight - btnHeight - 6);
            }
        }

        // Clamp button within viewport screen margins
        left = Math.max(6, Math.min(window.innerWidth - btnWidth - 6, left));
        top = Math.max(6, Math.min(window.innerHeight - btnHeight - 6, top));

        triggerBtnElement.style.display = 'flex';
        triggerBtnElement.style.left = `${Math.round(left)}px`;
        triggerBtnElement.style.top = `${Math.round(top)}px`;
    }

    function showTriggerButton(rect, text) {
        const root = ensureShadowHost();
        hidePopup();
        if (triggerBtnElement) triggerBtnElement.remove();

        triggerBtnElement = document.createElement('div');
        triggerBtnElement.className = 'qwt-trigger-btn';
        triggerBtnElement.title = 'Translate selected text';
        triggerBtnElement.innerHTML = ICONS.translate;

        updateTriggerButtonPosition(rect);

        triggerBtnElement.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        triggerBtnElement.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        triggerBtnElement.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showPopup(rect, text);
        });

        root.appendChild(triggerBtnElement);
    }

    function hidePopup() {
        stopAudio();
        isPinned = false;
        if (popupElement) {
            popupElement.remove();
            popupElement = null;
        }
    }

    function hideTriggerButton() {
        if (triggerBtnElement) {
            triggerBtnElement.remove();
            triggerBtnElement = null;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function isValidTranslatableText(text) {
        if (!text || typeof text !== 'string') return false;
        const cleaned = text.replace(/[\u200B-\u200D\uFEFF\s]/g, '');
        if (cleaned.length === 0 || cleaned.length > 5000) return false;
        return /[a-zA-Z\u00C0-\u024F\u0400-\u04FF]/.test(cleaned);
    }

    function extractSelectionData() {
        let text = '';
        let rect = null;
        let range = null;
        let container = null;

        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
            text = sel.toString().trim();
            if (text && sel.rangeCount > 0) {
                try {
                    range = sel.getRangeAt(0);
                    rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) {
                        const rects = range.getClientRects();
                        if (rects.length > 0) rect = rects[0];
                    }
                    if (range.commonAncestorContainer) {
                        container = range.commonAncestorContainer.nodeType === 1
                            ? range.commonAncestorContainer
                            : range.commonAncestorContainer.parentElement;
                    }
                } catch (e) {}
            }
        }

        if (!text || !isValidTranslatableText(text)) {
            return null;
        }

        if (!rect || (rect.width === 0 && rect.height === 0)) {
            rect = {
                left: lastPointerPos.x,
                right: lastPointerPos.x,
                top: lastPointerPos.y,
                bottom: lastPointerPos.y,
                width: 1,
                height: 1
            };
        }

        return { text, rect, range, container };
    }

    function handleSelection() {
        const data = extractSelectionData();
        if (!data || !data.text) {
            // When text is deselected / selection is collapsed, remove the trigger button immediately
            if (!popupElement) {
                hideTriggerButton();
                lastHandledText = '';
            }
            return;
        }

        if (data.text === lastHandledText && (popupElement || triggerBtnElement)) return;
        lastHandledText = data.text;

        // If the popup is pinned, update its translation in-place without moving its viewport position
        if (isPinned && popupElement) {
            hideTriggerButton();
            updatePinnedPopupContent(data.text);
            return;
        }

        if (CONFIG.showTriggerButton) {
            showTriggerButton(data.rect, data.text);
        } else {
            showPopup(data.rect, data.text);
        }
    }

    function queueSelectionCheck(delay = 40) {
        if (selectionTimeout) clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
            handleSelection();
        }, delay);
    }

    const updatePointerPos = (e) => {
        if (e && typeof e.clientX === 'number') {
            lastPointerPos.x = e.clientX;
            lastPointerPos.y = e.clientY;
        }
    };

    document.addEventListener('pointermove', updatePointerPos, { capture: true, passive: true });
    document.addEventListener('mousemove', updatePointerPos, { capture: true, passive: true });
    document.addEventListener('pointerdown', updatePointerPos, { capture: true, passive: true });
    document.addEventListener('mousedown', updatePointerPos, { capture: true, passive: true });

    document.addEventListener('mouseup', (e) => {
        updatePointerPos(e);
        if (shadowRoot && e.composedPath && e.composedPath().some(el => el === shadowRoot || el === hostElement)) {
            return;
        }
        queueSelectionCheck(20);
    }, { capture: true, passive: true });

    document.addEventListener('pointerup', (e) => {
        updatePointerPos(e);
        if (shadowRoot && e.composedPath && e.composedPath().some(el => el === shadowRoot || el === hostElement)) {
            return;
        }
        queueSelectionCheck(20);
    }, { capture: true, passive: true });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift' || e.key.startsWith('Arrow') || (e.ctrlKey && e.key.toLowerCase() === 'a')) {
            queueSelectionCheck(40);
        }
    }, { capture: true, passive: true });

    document.addEventListener('selectionchange', () => {
        queueSelectionCheck(40);
    }, { capture: true, passive: true });

    // Dismiss popup and floating trigger button on outside click
    document.addEventListener('mousedown', (e) => {
        updatePointerPos(e);
        const path = (e.composedPath && e.composedPath()) || [];
        const isInsideOurUi = path.some(el => el === popupElement || el === triggerBtnElement || el === shadowRoot || el === hostElement);

        if (isInsideOurUi) return;

        // Dismiss floating trigger button when clicking anywhere outside
        if (triggerBtnElement) {
            hideTriggerButton();
            lastHandledText = '';
        }

        // Dismiss popup when clicking outside (unless pinned)
        if (popupElement) {
            if (isPinned) {
                return;
            }
            if (Date.now() - popupOpenedTimestamp < 250) {
                return;
            }
            hidePopup();
            lastHandledText = '';
        }
    }, { capture: true, passive: true });

    // Dismiss popup on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            isPinned = false;
            hidePopup();
            hideTriggerButton();
            lastHandledText = '';
        }
    }, { capture: true, passive: true });

    // Track scroll and resize in real-time across ALL scrollable elements on the page
    let scrollRaf = null;
    const handleScrollOrResize = () => {
        if (!triggerBtnElement) return;
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => {
            updateTriggerButtonPosition();
        });
    };

    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', handleScrollOrResize, { capture: true, passive: true });

})();
