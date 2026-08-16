// Background service worker for Quick Web Translator
// Author: Pheromone

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
        const text = request.text;
        const sl = request.sl || 'auto';
        const tl = request.tl || 'ru';

        if (!text || typeof text !== 'string') {
            sendResponse({ success: false, error: 'Empty text' });
            return true;
        }

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;

        fetch(url)
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

                if (!translation.trim()) {
                    throw new Error('Empty translation received');
                }

                sendResponse({
                    success: true,
                    original: text,
                    translation: translation.trim(),
                    srcLang: (data && data[2]) ? data[2] : sl
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
