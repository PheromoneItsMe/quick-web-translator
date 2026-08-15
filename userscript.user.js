// ==UserScript==
// @name         Quick Web Translator (En -> Ru)
// @namespace    https://github.com/PheromoneItsMe/quick-web-translator
// @version      1.1.0
// @description  Instant and accurate English-to-Russian translation of selected text in a draggable and resizable popup for Brave and Chromium browsers.
// @author       Pheromone
// @match        *://*/*
// @match        file:///*
// @include      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      translate.googleapis.com
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Configuration
    const CONFIG = {
        targetLang: 'ru',
        sourceLang: 'auto',
        showTriggerButton: false, // true = show trigger button icon, false = instant auto-translate
        apiUrl: 'https://translate.googleapis.com/translate_a/single'
    };

    // Load persisted settings
    try {
        if (typeof GM_getValue === 'function') {
            CONFIG.showTriggerButton = GM_getValue('showTriggerButton', false);
        }
    } catch (e) {
        console.warn('GM_getValue not available, using default config');
    }

    let popupElement = null;
    let triggerBtnElement = null;
    let shadowRoot = null;

    // Audio playback state
    let isAudioPlaying = false;
    let currentUtterance = null;
    let currentAudioObj = null;

    // Initialize isolated Shadow DOM host container
    function initShadowHost() {
        if (shadowRoot) return;

        const host = document.createElement('div');
        host.id = 'qwt-translator-host';
        host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647; pointer-events: none;';
        document.documentElement.appendChild(host);

        shadowRoot = host.attachShadow({ mode: 'open' });

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
                position: fixed;
                pointer-events: auto;
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
                z-index: 2147483647;
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

            /* Floating trigger button near selection */
            .qwt-trigger-btn {
                position: fixed;
                pointer-events: auto;
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
                z-index: 2147483647;
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

            /* Custom scrollbar */
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

        shadowRoot.appendChild(style);
    }

    // SVG Icons
    const ICONS = {
        translate: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
        speaker: `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
        stop: `<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"></rect></svg>`,
        copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
        close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`
    };

    // Update speech button icon and state
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

    // Stop all active audio playback
    function stopAudio() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        if (currentAudioObj) {
            currentAudioObj.pause();
            currentAudioObj.currentTime = 0;
            currentAudioObj = null;
        }
        isAudioPlaying = false;
        updateSpeakButtonUI(false);
    }

    // Play / Stop speech synthesis
    function toggleSpeech(text, lang = 'en-US') {
        if (isAudioPlaying) {
            stopAudio();
            return;
        }

        stopAudio();
        isAudioPlaying = true;
        updateSpeakButtonUI(true);

        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            utterance.rate = 0.95;

            utterance.onend = () => {
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
            };

            utterance.onerror = () => {
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
            };

            currentUtterance = utterance;
            window.speechSynthesis.speak(utterance);
        } else {
            const audio = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang.split('-')[0]}&client=tw-ob&q=${encodeURIComponent(text)}`);
            currentAudioObj = audio;

            audio.onended = () => {
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
            };

            audio.onerror = () => {
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
            };

            audio.play().catch(e => {
                console.error('Audio playback error:', e);
                isAudioPlaying = false;
                updateSpeakButtonUI(false);
            });
        }
    }

    // Query translation from Google Translate API
    function requestTranslation(text) {
        return new Promise((resolve, reject) => {
            const url = `${CONFIG.apiUrl}?client=gtx&sl=${CONFIG.sourceLang}&tl=${CONFIG.targetLang}&dt=t&q=${encodeURIComponent(text)}`;

            const handleSuccess = (responseText) => {
                try {
                    const data = JSON.parse(responseText);
                    let translation = '';

                    if (data[0] && Array.isArray(data[0])) {
                        data[0].forEach(item => {
                            if (item && item[0]) translation += item[0];
                        });
                    }

                    resolve({
                        original: text,
                        translation: translation.trim(),
                        srcLang: data[2] || 'en'
                    });
                } catch (err) {
                    reject(new Error('Failed to parse translation response'));
                }
            };

            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 8000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            handleSuccess(res.responseText);
                        } else {
                            reject(new Error(`HTTP ${res.status}`));
                        }
                    },
                    ontimeout: () => reject(new Error('Request timed out')),
                    onerror: () => reject(new Error('Network error'))
                });
            } else {
                fetch(url)
                    .then(res => {
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        return res.text();
                    })
                    .then(handleSuccess)
                    .catch(reject);
            }
        });
    }

    // Calculate optimal popup position relative to text selection
    function calculatePopupPosition(rect) {
        const padding = 12;
        const estimatedWidth = 320;
        const estimatedHeight = 95;

        let left = rect.left;
        let top = rect.bottom + 8;

        if (left + estimatedWidth > window.innerWidth - padding) {
            left = window.innerWidth - estimatedWidth - padding;
        }
        if (left < padding) left = padding;

        if (top + estimatedHeight > window.innerHeight - padding) {
            top = Math.max(padding, rect.top - estimatedHeight - 8);
        }

        return { left, top };
    }

    // Initialize dragging logic for popup window
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
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // Create and display translation popup
    function showPopup(rect, text) {
        initShadowHost();
        hideTriggerButton();
        stopAudio();

        if (popupElement) popupElement.remove();

        popupElement = document.createElement('div');
        popupElement.className = 'qwt-popup';

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

        shadowRoot.appendChild(popupElement);

        const headerEl = popupElement.querySelector('.qwt-header');
        setupDraggable(popupElement, headerEl);

        // Button event listeners
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
            if (typeof GM_setValue === 'function') {
                GM_setValue('showTriggerButton', CONFIG.showTriggerButton);
            }
            modeBtn.classList.toggle('active', CONFIG.showTriggerButton);
            modeBtn.title = CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate';
            showToast(CONFIG.showTriggerButton ? 'Mode: Trigger button' : 'Mode: Auto-translate');
        });

        // Execute translation request
        requestTranslation(text)
            .then(result => {
                if (!popupElement) return;
                renderTranslationResult(result);
            })
            .catch(err => {
                if (!popupElement) return;
                const body = popupElement.querySelector('.qwt-body');
                if (body) {
                    body.innerHTML = `<div class="qwt-error">Translation failed: ${escapeHtml(err.message)}</div>`;
                }
            });
    }

    // Render received translation in popup body
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

    // Display temporary toast message
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

    // Display floating trigger button near selected text
    function showTriggerButton(rect, text) {
        initShadowHost();
        hidePopup();
        if (triggerBtnElement) triggerBtnElement.remove();

        triggerBtnElement = document.createElement('div');
        triggerBtnElement.className = 'qwt-trigger-btn';
        triggerBtnElement.title = 'Translate selected text';
        triggerBtnElement.innerHTML = ICONS.translate;

        let left = rect.right + 4;
        let top = rect.top - 28;

        if (top < 10) top = rect.bottom + 6;
        if (left + 30 > window.innerWidth) left = window.innerWidth - 34;

        triggerBtnElement.style.left = `${left}px`;
        triggerBtnElement.style.top = `${top}px`;

        triggerBtnElement.addEventListener('click', (e) => {
            e.stopPropagation();
            showPopup(rect, text);
        });

        shadowRoot.appendChild(triggerBtnElement);
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

    // Validate if text is suitable for translation
    function isValidTranslatableText(text) {
        if (!text || typeof text !== 'string') return false;
        const trimmed = text.trim();
        if (trimmed.length === 0 || trimmed.length > 4000) return false;
        return /[a-zA-Z\u00C0-\u024F]/.test(trimmed);
    }

    // Handle user text selection
    function handleSelection() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;

        const text = selection.toString().trim();
        if (!isValidTranslatableText(text)) return;

        try {
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;

            if (CONFIG.showTriggerButton) {
                showTriggerButton(rect, text);
            } else {
                showPopup(rect, text);
            }
        } catch (e) {
            console.error('Error handling selection:', e);
        }
    }

    // Global event listeners
    document.addEventListener('mouseup', (e) => {
        if (e.composedPath && shadowRoot && e.composedPath().some(el => el === shadowRoot || (el.shadowRoot && el.shadowRoot === shadowRoot))) {
            return;
        }

        setTimeout(() => {
            handleSelection();
        }, 30);
    });

    // Dismiss popup on outside click
    document.addEventListener('mousedown', (e) => {
        if (shadowRoot) {
            const path = e.composedPath ? e.composedPath() : [];
            const isInsideOurUi = path.some(el => el === popupElement || el === triggerBtnElement || el === shadowRoot);
            if (!isInsideOurUi) {
                hidePopup();
                hideTriggerButton();
            }
        }
    });

    // Dismiss popup on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hidePopup();
            hideTriggerButton();
        }
    });

})();
