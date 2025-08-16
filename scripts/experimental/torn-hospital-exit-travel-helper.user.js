// ==UserScript==
// @name         Torn Hospital-Exit Travel Helper (PDA + Tampermonkey) — Auto-Redirect + Preselect + Hospital Badge
// @namespace    nate3d.torn.hospital-travel-helper
// @version      1.5
// @description  Near-instant Travel page redirect when you leave Hospital (timer or meds). Adds a hospital "Monitoring: ON" badge, preselects your default destination, and focuses the Travel button. Compliant: read-only API + DOM only; no auto-clicks or action POSTs.
// @match        https://www.torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_info
// ==/UserScript==

(function () {
    'use strict';

    // ---------- CONFIG ----------
    const CFG = {
        preWatchSeconds: 30,    // start fast checks this many seconds before predicted release
        fastIntervalSec: 2,     // fast polling interval when close to release
        slowPollSec: 30,        // slow polling when hospitalized w/o valid 'until'
        idlePollSec: 60,        // polling when not hospitalized / after release
        hiddenIdleSec: 120,     // polling when tab/app is hidden
        visibleFastSec: 1,      // tighten fast checks to 1s when visible
        autoRedirect: true,     // navigate to /travelagency.php when out
        showBanner: true
    };

    // Known destinations (names as displayed in UI; you still click Travel)
    const DESTS = [
        'Mexico', 'Cayman Islands', 'Canada', 'Hawaii', 'United Kingdom', 'Argentina',
        'Switzerland', 'Japan', 'China', 'South Africa', 'United Arab Emirates'
    ];

    // ---------- ENV / STORAGE ----------
    const isTamper = typeof GM_info !== 'undefined';
    const getVal = (k, d) => { try { return isTamper ? GM_getValue(k, d) : JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
    const setVal = (k, v) => { try { isTamper ? GM_setValue(k, v) : localStorage.setItem(k, JSON.stringify(v)); } catch { } };

    let apiKey = getVal('torn_api_key', '');
    let defaultDest = getVal('torn_default_dest', 'Mexico'); // change in Settings

    // ---------- STYLES ----------
    GM_addStyle(`
    #thx-banner{position:fixed;z-index:999999;left:50%;transform:translateX(-50%);bottom:16px;background:#131820;color:#fff;border:1px solid #3a7;border-radius:10px;padding:8px 12px;box-shadow:0 6px 14px rgba(0,0,0,.5);font:13px/1.4 system-ui,sans-serif;display:none}
    #thx-banner button{margin-left:8px;padding:6px 10px;border:0;border-radius:6px;cursor:pointer}
    #thx-open{background:#2ea043;color:#fff}
    #thx-close{background:#8b949e;color:#111}
    #thx-gear{background:#30363d;color:#ddd}

    /* Hospital badge */
    #thx-hosp-badge{position:fixed;right:12px;top:72px;z-index:999998;background:#0b1d14;color:#d6ffe7;border:1px solid #2ea043;border-radius:8px;padding:6px 8px;font:12px/1.3 system-ui,sans-serif;display:none}
    #thx-hosp-badge b{color:#8fffb9}
  `);

    // ---------- BANNER ----------
    const banner = document.createElement('div');
    banner.id = 'thx-banner';
    banner.innerHTML = `
    <span id="thx-msg">Hospital release soon — will open Travel. Default: ${defaultDest}</span>
    <button id="thx-open">Open now</button>
    <button id="thx-gear">Settings</button>
    <button id="thx-close">Dismiss</button>`;
    document.body.appendChild(banner);

    const showBanner = (msg) => { if (!CFG.showBanner) return; document.getElementById('thx-msg').textContent = msg; banner.style.display = 'block'; };
    const hideBanner = () => { banner.style.display = 'none'; };
    document.getElementById('thx-open').onclick = () => goTravel();
    document.getElementById('thx-close').onclick = hideBanner;
    document.getElementById('thx-gear').onclick = () => {
        if (!apiKey) {
            const k = prompt('Enter Torn API key (needs user→profile):', '');
            if (k) { apiKey = k.trim(); setVal('torn_api_key', apiKey); }
        }
        const choice = prompt(`Default destination (exact name). Known: ${DESTS.join(', ')}`, defaultDest);
        if (choice) { defaultDest = choice.trim(); setVal('torn_default_dest', defaultDest); }
        alert(`Saved. Default destination: ${defaultDest}`);
    };

    // ---------- HOSPITAL BADGE ----------
    const hospBadge = document.createElement('div');
    hospBadge.id = 'thx-hosp-badge';
    hospBadge.innerHTML = `<b>Monitoring:</b> ON<span id="thx-hosp-eta"></span>`;
    document.body.appendChild(hospBadge);

    function showHospBadge(secsLeft) {
        const etaSpan = hospBadge.querySelector('#thx-hosp-eta');
        if (Number.isFinite(secsLeft) && secsLeft >= 0) {
            etaSpan.textContent = ` • ETA: ${fmtEta(secsLeft)}`;
        } else {
            etaSpan.textContent = ` • ETA: unknown`;
        }
        hospBadge.style.display = 'block';
    }
    function hideHospBadge() { hospBadge.style.display = 'none'; }
    function fmtEta(s) {
        const m = Math.floor(s / 60), ss = s % 60;
        return m > 0 ? `${m}m ${ss}s` : `${ss}s`;
    }

    // ---------- NOTIFY ----------
    const notify = (title, text) => {
        try { isTamper && typeof GM_notification === 'function' && GM_notification({ title, text, timeout: 4000 }); } catch { }
        try {
            const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(); const g = c.createGain();
            o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 150);
        } catch { }
        try { navigator.vibrate && navigator.vibrate(200); } catch { }
    };

    // ---------- API ----------
    const apiBase = 'https://api.torn.com';
    async function getStatus(apiKey) {
        const url = `${apiBase}/user/?selections=profile&key=${encodeURIComponent(apiKey)}`;
        const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (j.error) throw new Error(`API error: ${j.error.error} (${j.error.code})`);
        return j.status || {}; // { state, description, until, ... }
    }

    // ---------- HELPERS ----------
    function isHospitalText(txt) { return /\bhospital\b/i.test(txt || ''); }
    function goTravel() { window.location.href = 'https://www.torn.com/travelagency.php'; }

    // Preselect default destination + focus Travel button on the travel page
    function prepTravelPagePreselect() {
        const want = (defaultDest || '').toLowerCase();
        if (!want) return;

        // Try to set a radio associated with destination text
        const nodes = Array.from(document.querySelectorAll('input[type="radio"], button, div, a, label'))
            .filter(el => {
                const t = (el.textContent || '').trim().toLowerCase();
                const aria = (el.getAttribute?.('aria-label') || '').toLowerCase?.() || '';
                return (t && t.includes(want)) || (aria && aria.includes(want));
            });

        if (nodes.length) {
            const label = nodes.find(n => n.tagName === 'LABEL');
            if (label) {
                const forId = label.getAttribute('for');
                const inp = forId ? document.getElementById(forId) : label.querySelector('input[type="radio"]');
                if (inp) {
                    try {
                        inp.checked = true;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                    } catch { }
                }
            } else {
                const inp = nodes.find(n => n.tagName === 'INPUT' && n.type === 'radio');
                if (inp) {
                    try {
                        inp.checked = true;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                    } catch { }
                }
            }
        }

        // Focus the main Travel button (don't click)
        const travelBtn = Array.from(document.querySelectorAll('button, input[type="submit"], a'))
            .find(b => /travel|fly|purchase/i.test((b.textContent || b.value || '').trim()));
        if (travelBtn) {
            travelBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            try { travelBtn.focus({ preventScroll: true }); } catch { travelBtn.focus(); }
        }
    }

    // Watch the DOM for Hospital -> Okay change (near-instant med-outs)
    function watchDomForRelease() {
        const candidates = ['#header', '.header', '#barContent', 'body'];
        let attached = false;

        for (const sel of candidates) {
            const root = document.querySelector(sel);
            if (!root) continue;

            const obs = new MutationObserver(() => {
                // If hospital text disappears anywhere in visible text, consider released
                const text = (document.body.textContent || '').toLowerCase();
                if (!isHospitalText(text)) {
                    onReleased('dom-observer');
                }
            });
            obs.observe(root, { subtree: true, childList: true, characterData: true });
            attached = true;
            break;
        }
        if (!attached) setTimeout(watchDomForRelease, 1500);
    }

    // ---------- MAIN WATCH LOOP ----------
    let fastTimer = null, nextTimer = null, lastState = null;

    function clearTimers() { if (fastTimer) { clearInterval(fastTimer); fastTimer = null; } if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; } }

    function start() {
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tick('visibility'); });
        window.addEventListener('focus', () => tick('focus'));
        tick('init');

        // Instant med-out detection via DOM
        watchDomForRelease();

        // If we land on the travel page any time, try to preselect UI
        if (location.pathname.includes('/travelagency.php')) {
            prepTravelPagePreselect();
            new MutationObserver(prepTravelPagePreselect).observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    async function tick(reason) {
        clearTimers();

        if (!apiKey) {
            setTimeout(() => {
                const k = prompt('Enter Torn API key (needs user→profile):', '');
                if (k) { apiKey = k.trim(); setVal('torn_api_key', apiKey); start(); }
            }, 600);
            return;
        }

        try {
            const s = await getStatus(apiKey);
            const now = Math.floor(Date.now() / 1000);
            const state = (s.state || s.description || '').toLowerCase();
            const inHosp = /hospital/.test(state);

            // Hospital badge visibility + ETA
            if (inHosp) {
                const until = Number(s.until || 0);
                const secsLeft = (until && until > now) ? (until - now) : NaN;
                showHospBadge(Number.isFinite(secsLeft) ? secsLeft : NaN);
            } else {
                hideHospBadge();
            }

            // Transition detection
            if (lastState && /hospital/.test(lastState) && !inHosp) {
                onReleased('transition');
                return;
            }
            lastState = state;

            if (inHosp) {
                const until = Number(s.until || 0);
                if (until && until > now) {
                    const secsLeft = until - now;
                    showBanner(`Hospital ends in ~${secsLeft}s — opening Travel. Default: ${defaultDest}`);

                    // Start fast watchdog shortly before predicted release
                    const pre = Math.max(secsLeft - CFG.preWatchSeconds, 1);
                    nextTimer = setTimeout(() => {
                        const visible = !document.hidden;
                        const fast = visible ? CFG.visibleFastSec : CFG.fastIntervalSec;
                        fastTimer = setInterval(async () => {
                            try {
                                const s2 = await getStatus(apiKey);
                                const st2 = (s2.state || s2.description || '').toLowerCase();
                                if (!/hospital/.test(st2)) onReleased('watchdog');
                                else {
                                    // Update badge ETA during fast loop
                                    const now2 = Math.floor(Date.now() / 1000);
                                    const until2 = Number(s2.until || 0);
                                    const left = (until2 && until2 > now2) ? (until2 - now2) : NaN;
                                    showHospBadge(Number.isFinite(left) ? left : NaN);
                                }
                            } catch { }
                        }, fast * 1000);
                    }, pre * 1000);

                    // Safety post-check
                    nextTimer = setTimeout(async () => {
                        try {
                            const s3 = await getStatus(apiKey);
                            const st3 = (s3.state || s3.description || '').toLowerCase();
                            if (!/hospital/.test(st3)) onReleased('post');
                            else scheduleNext('still', CFG.slowPollSec);
                        } catch { scheduleNext('err', CFG.idlePollSec); }
                    }, (secsLeft + 10) * 1000);

                } else {
                    showBanner('Hospitalized — monitoring…');
                    scheduleNext('no-until', CFG.slowPollSec);
                }
            } else {
                hideBanner();
                scheduleNext('idle', document.hidden ? CFG.hiddenIdleSec : CFG.idlePollSec);
            }
        } catch {
            scheduleNext('api-backoff', document.hidden ? CFG.hiddenIdleSec : CFG.idlePollSec);
        }
    }

    function scheduleNext(tag, sec) { clearTimers(); nextTimer = setTimeout(() => tick(`sched:${tag}`), sec * 1000); }

    function onReleased(src) {
        clearTimers();
        hideBanner();
        hideHospBadge();
        notify('Torn: You are out of Hospital', 'Opening Travel Agency now.');
        if (CFG.autoRedirect) goTravel();
        scheduleNext('released', document.hidden ? CFG.hiddenIdleSec : CFG.idlePollSec);
    }

    // ---------- BOOT ----------
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

})();
