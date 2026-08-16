// Background service worker for Quick Web Translator
// Author: Pheromone

function fetchTranslation(text, sl, tl) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;

    return fetch(url)
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            let translation = '';
            if (data && Array.isArray(data[0])) {
                data[0].forEach(item => {
                    if (item && item[0]) {
                        translation += item[0];
                    }
                });
            }

            const detectedLang = (data && data[2]) ? data[2] : sl;
            return {
                translation: translation.trim(),
                detectedLang: detectedLang
            };
        });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
        const text = request.text;
        const sl = request.sl || 'auto';
        const tl = request.tl || 'ru';

        if (!text || typeof text !== 'string' || !text.trim()) {
            sendResponse({ success: false, error: 'Empty text' });
            return true;
        }

        const trimmedText = text.trim();

        fetchTranslation(trimmedText, sl, tl)
            .then(result => {
                // Smart Mixed-Language Detection:
                // When selecting mixed text (e.g. English heading with Russian citation/source like 'Источник: Reddit'),
                // Google Translate's auto-detector may detect 'ru' and return the English text untranslated.
                // If text contains English words and Google returned untranslated text or detected 'ru',
                // automatically retry with sl='en' to properly translate the English portion into Russian.
                const hasEnglishWords = /[a-zA-Z]{2,}/.test(trimmedText);
                const isUntranslated = (result.translation === trimmedText) || (result.detectedLang === tl);

                if (sl === 'auto' && tl === 'ru' && hasEnglishWords && isUntranslated) {
                    return fetchTranslation(trimmedText, 'en', tl)
                        .then(enResult => {
                            if (enResult.translation && enResult.translation !== trimmedText) {
                                return enResult;
                            }
                            return result;
                        })
                        .catch(() => result);
                }

                return result;
            })
            .then(result => {
                if (!result || !result.translation) {
                    throw new Error('Empty translation received');
                }

                sendResponse({
                    success: true,
                    original: text,
                    translation: result.translation,
                    srcLang: result.detectedLang || sl
                });
            })
            .catch(err => {
                console.error('Translation error in background:', err);
                sendResponse({
                    success: false,
                    error: err.message || 'Network error'
                });
            });

        return true; // Keep channel open for async response
    }
});
