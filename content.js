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
                min-width: 210px;
                min-height: 78px;
                max-width: 90vw;
                max-height: 85vh;
                width: 320px;
                height: auto;
                z-index: 2147483647 !important;
                display: flex;
                flex-direction: column;
                gap: 7px;
                resize: both;
                overflow: hidden;
                animation: qwtFadeIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
                transition: opacity 0.15s ease;
                user-select: text;
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
                transition: all 0.15s ease;
            }

            .qwt-btn:hover {
                background: rgba(255, 255, 255, 0.08);
                color: #f1f5f9;
            }

            .qwt-btn svg {
                width: 14px;
                height: 14px;
                stroke: currentColor;
                stroke-width: 2;
                fill: none;
            }

            .qwt-btn.active {
                color: #818cf8;
            }

            .qwt-btn.playing {
                color: #f43f5e;
                background: rgba(244, 63, 94, 0.12);
            }

            .qwt-btn.playing svg {
                fill: currentColor;
                stroke: none;
            }

            .qwt-body {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-height: 28px;
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

            .qwt-toast {
                position: absolute;
                bottom: -22px;
                right: 4px;
                background: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #38bdf8;
                font-size: 10.5px;
                font-weight: 500;
                padding: 2px 8px;
                border-radius: 6px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3);
                animation: qwtFadeIn 0.12s ease;
                pointer-events: none;
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
        translate: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
        speaker: `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        stop: `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"></rect></svg>`,
        copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
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

        return { left: Math.round(left), top: Math.round(top) };
    }

    function setupDraggable(popupEl, headerEl) {
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        headerEl.addEventListener('mousedown', (e) => {
            if (e.target.closest('.qwt-actions') || e.target.closest('.qwt-btn')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = popupEl.offsetLeft;
            initialTop = popupEl.offsetTop;

            e.preventDefault();

            const onMouseMove = (moveEvent) => {
                if (!isDragging) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;

                const maxLeft = window.innerWidth - popupEl.offsetWidth;
                const maxTop = window.innerHeight - popupEl.offsetHeight;

                const newLeft = Math.max(4, Math.min(maxLeft - 4, initialLeft + dx));
                const newTop = Math.max(4, Math.min(maxTop - 4, initialTop + dy));

                popupEl.style.left = `${newLeft}px`;
                popupEl.style.top = `${newTop}px`;
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

    function showPopup(rect, text) {
        const root = ensureShadowHost();
        hideTriggerButton();
        stopAudio();

        if (popupElement) popupElement.remove();

        popupElement = document.createElement('div');
        popupElement.className = 'qwt-popup';
        popupOpenedTimestamp = Date.now();

        const coords = calculatePopupPosition(rect);
        popupElement.style.left = `${coords.left}px`;
        popupElement.style.top = `${coords.top}px`;

        popupElement.innerHTML = `
            <div class="qwt-header">
                <div class="qwt-badge">
                    ${ICONS.translate}
                    <span>Translation</span>
                </div>
                <div class="qwt-actions">
                    <button class="qwt-btn qwt-speak-btn" title="Listen to pronunciation">${ICONS.speaker}</button>
                    <button class="qwt-btn qwt-copy-btn" title="Copy translation">${ICONS.copy}</button>
                    <button class="qwt-btn qwt-mode-btn ${CONFIG.showTriggerButton ? 'active' : ''}" title="${CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate'}">${ICONS.settings}</button>
                    <button class="qwt-btn qwt-close-btn" title="Close">${ICONS.close}</button>
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
        setupDraggable(popupElement, headerEl);

        const speakBtn = popupElement.querySelector('.qwt-speak-btn');
        const copyBtn = popupElement.querySelector('.qwt-copy-btn');
        const closeBtn = popupElement.querySelector('.qwt-close-btn');
        const modeBtn = popupElement.querySelector('.qwt-mode-btn');

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hidePopup();
        });

        speakBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSpeech(text);
        });

        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            CONFIG.showTriggerButton = !CONFIG.showTriggerButton;
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.set({ showTriggerButton: CONFIG.showTriggerButton });
            }
            modeBtn.classList.toggle('active', CONFIG.showTriggerButton);
            modeBtn.title = CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate';
            showToast(CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate');
        });

        requestTranslation(text)
            .then(result => {
                if (!popupElement) return;
                renderTranslationResult(result);
            })
            .catch(err => {
                if (!popupElement) return;
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

        const copyBtn = popupElement.querySelector('.qwt-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(result.translation).then(() => {
                    showToast('Copied!');
                }).catch(() => {
                    showToast('Copy failed');
                });
            });
        }
    }

    function showToast(msg) {
        if (!popupElement) return;
        const oldToast = popupElement.querySelector('.qwt-toast');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'qwt-toast';
        toast.textContent = msg;
        popupElement.appendChild(toast);

        setTimeout(() => toast.remove(), 1600);
    }

    function showTriggerButton(rect, text) {
        const root = ensureShadowHost();
        hidePopup();
        if (triggerBtnElement) triggerBtnElement.remove();

        triggerBtnElement = document.createElement('div');
        triggerBtnElement.className = 'qwt-trigger-btn';
        triggerBtnElement.title = 'Translate selected text';
        triggerBtnElement.innerHTML = ICONS.translate;

        let left = (rect && typeof rect.right === 'number') ? rect.right + 4 : lastPointerPos.x + 8;
        let top = (rect && typeof rect.top === 'number') ? rect.top - 28 : lastPointerPos.y - 28;

        if (top < 10) top = (rect && typeof rect.bottom === 'number') ? rect.bottom + 6 : lastPointerPos.y + 12;
        if (left + 30 > window.innerWidth) left = window.innerWidth - 34;

        triggerBtnElement.style.left = `${left}px`;
        triggerBtnElement.style.top = `${top}px`;

        triggerBtnElement.addEventListener('click', (e) => {
            e.stopPropagation();
            showPopup(rect, text);
        });

        root.appendChild(triggerBtnElement);
    }

    function hidePopup() {
        stopAudio();
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

        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) {
            text = sel.toString().trim();
            if (text && sel.rangeCount > 0) {
                try {
                    const range = sel.getRangeAt(0);
                    rect = range.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) {
                        const rects = range.getClientRects();
                        if (rects.length > 0) rect = rects[0];
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

        return { text, rect };
    }

    function handleSelection() {
        const data = extractSelectionData();
        if (!data || !data.text) return;

        if (data.text === lastHandledText && popupElement) return;
        lastHandledText = data.text;

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
        queueSelectionCheck(30);
    }, { capture: true, passive: true });

    document.addEventListener('pointerup', (e) => {
        updatePointerPos(e);
        if (shadowRoot && e.composedPath && e.composedPath().some(el => el === shadowRoot || el === hostElement)) {
            return;
        }
        queueSelectionCheck(30);
    }, { capture: true, passive: true });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift' || e.key.startsWith('Arrow') || (e.ctrlKey && e.key.toLowerCase() === 'a')) {
            queueSelectionCheck(50);
        }
    }, { capture: true, passive: true });

    document.addEventListener('selectionchange', () => {
        queueSelectionCheck(80);
    }, { capture: true, passive: true });

    // Dismiss popup on outside click
    document.addEventListener('mousedown', (e) => {
        updatePointerPos(e);
        if (shadowRoot && popupElement) {
            if (Date.now() - popupOpenedTimestamp < 250) {
                return;
            }

            const path = e.composedPath ? e.composedPath() : [];
            const isInsideOurUi = path.some(el => el === popupElement || el === triggerBtnElement || el === shadowRoot || el === hostElement);
            if (!isInsideOurUi) {
                hidePopup();
                hideTriggerButton();
                lastHandledText = '';
            }
        }
    }, { capture: true, passive: true });

    // Dismiss popup on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hidePopup();
            hideTriggerButton();
            lastHandledText = '';
        }
    }, { capture: true, passive: true });

})();
