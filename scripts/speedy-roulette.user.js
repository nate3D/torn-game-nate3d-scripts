// ==UserScript==
// @name         Torn: Skip Roulette Animation (TornPDA compatible)
// @namespace    nate3d.torn.speedy-roulette
// @version      1.2
// @description  Skip the roulette spin and instantly reload so you can bet again (works in TornPDA & desktop)
// @match        https://www.torn.com/page.php?sid=roulette
// @match        https://www.torn.com/loader.php?sid=roulette
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ---- DOM helpers (no jQuery) ----
    const el = (sel) => document.querySelector(sel);
    function displayInfo(message, color) {
        const infoText = el('#infoSpotText');
        const info = el('#infoSpot');
        if (infoText) infoText.textContent = message;
        if (info) {
            info.classList.remove('red', 'green');
            if (color) info.classList.add(color);
        }
    }

    // Hide the canvas if it's already in the DOM (desktop or TornPDA)
    function hideCanvasIfPresent() {
        const canvas = el('#rouletteCanvas');
        if (canvas) canvas.style.display = 'none';
    }

    // Wrap getAction when it becomes available (TornPDA may load it late)
    function hookGetActionOnce() {
        if (window.__tornRouletteHooked) return true;
        const ga = window.getAction;
        if (typeof ga !== 'function') return false;

        window.__tornRouletteHooked = true;

        window.getAction = function (options) {
            try {
                const data = options && options.data;
                if (data && data.sid === 'rouletteData' && data.step === 'processStakes') {
                    // Skip the animation by hiding the canvas immediately
                    hideCanvasIfPresent();

                    // Preserve any caller's success but override to short-circuit animation + reload
                    const originalSuccess = options.success;
                    options.success = function (resp) {
                        try {
                            const response = (typeof resp === 'string') ? JSON.parse(resp) : resp || {};
                            const won = Number(response.won || 0);
                            const title = won > 0 ? `You won $${won}!` : 'You lost...';
                            const message = ' The ball landed on ' + (response.number ?? '?');

                            displayInfo(title + message, won > 0 ? 'green' : 'red');
                            // Small delay so the user can read the result, then hard reload
                            setTimeout(() => location.reload(), 200);
                        } catch (e) {
                            // If anything goes wrong, still reload quickly to keep the flow
                            setTimeout(() => location.reload(), 100);
                        }

                        // Call the original success in case upstream logic depends on it
                        if (typeof originalSuccess === 'function') {
                            try { originalSuccess(resp); } catch (_) { }
                        }
                    };
                }
            } catch (e) {
                // No-op; fall through to original getAction
            }
            return ga.apply(this, arguments);
        };

        return true;
    }

    // Repeatedly attempt to hook early (document-start) and also on SPA/nav changes
    const tryHook = () => {
        if (hookGetActionOnce()) clearInterval(timer);
    };
    const timer = setInterval(tryHook, 100);
    // Also try on ready states and common SPA events Torn/TornPDA may emit
    document.addEventListener('readystatechange', tryHook, { once: false });
    window.addEventListener('popstate', tryHook);
    window.addEventListener('hashchange', tryHook);
    // In case Torn emits custom events on load (defensive)
    window.addEventListener('load', () => { tryHook(); hideCanvasIfPresent(); });

})();