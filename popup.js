// Popup settings script for Quick Web Translator
// Author: Pheromone

document.addEventListener('DOMContentLoaded', () => {
    const triggerBtnToggle = document.getElementById('triggerBtnToggle');

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get(['showTriggerButton'], (res) => {
            if (res && typeof res.showTriggerButton === 'boolean') {
                triggerBtnToggle.checked = res.showTriggerButton;
            }
        });

        triggerBtnToggle.addEventListener('change', () => {
            chrome.storage.sync.set({ showTriggerButton: triggerBtnToggle.checked });
        });
    }
});
