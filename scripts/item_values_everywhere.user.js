// ==UserScript==
// @name         Nate3D-Torn: Item Values & Shop Deltas Everywhere
// @namespace    nate3d.torn.item-values-everywhere
// @version      2.3
// @description  Shows stack market value on stash/inventory rows and Δ vs market value on merchant/shop tiles. Browser + Torn PDA.
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-end
// @homepageURL  https://github.com/nate3D/torn-game-nate3d-scripts
// @updateURL    https://raw.githubusercontent.com/nate3D/torn-game-nate3d-scripts/main/scripts/item_values_everywhere.user.js
// @downloadURL  https://raw.githubusercontent.com/nate3D/torn-game-nate3d-scripts/main/scripts/item_values_everywhere.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const cfg = {
        storageKey: 'nate3d.torn.apiKey',
        colors: { stack: '#B53471', pos: '#21ba45', neg: '#ff3b30', zero: '#888' },
        debug: false,
    };

    // --- state ---
    const mvById = new Map(); // itemId -> market_value
    let apiKey = null;
    let started = { inv: false, shop: false };
    let catalogError = null; // last API error string

    // --- utils ---
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const fmt = n => '$' + (Math.round(Number(n)) || 0).toLocaleString('en-US');
    const log = (...a) => cfg.debug && console.log('[N3 Item Values]', ...a);

    function addStyle(css) { const el = document.createElement('style'); el.textContent = css; document.documentElement.appendChild(el); }
    addStyle(`
    .n3-inline{display:inline-block;margin-left:.5rem;font-weight:700;color:${cfg.colors.stack};white-space:nowrap;vertical-align:middle;text-shadow:0 1px 2px rgba(0,0,0,.25)}
    .n3-delta{display:inline-block;margin-left:.4rem;font-weight:700;padding:2px 6px;border-radius:8px;font-size:11px;vertical-align:middle;white-space:nowrap}
    .n3-delta.pos{background:rgba(33,186,69,.18);color:${cfg.colors.pos}}
    .n3-delta.neg{background:rgba(255,59,48,.18);color:${cfg.colors.neg}}
    .n3-delta.zero{background:rgba(128,128,128,.18);color:${cfg.colors.zero}}
    .n3-key-btn{position:fixed;right:14px;bottom:14px;z-index:99998;background:#111;color:#fff;padding:8px 10px;border-radius:10px;font:600 12px/1 Inter,system-ui,sans-serif;opacity:.85;cursor:pointer}
    .n3-key-btn:hover{opacity:1}
    .n3-err{cursor:pointer;border-bottom:1px dashed currentColor}
    .n3-err:hover{opacity:.9}
  `);

    function validKey(k) { return typeof k === 'string' && /^[A-Za-z0-9]{16,64}$/.test(k); }
    function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }

    function getApiKey() {
        if (apiKey) return apiKey;
        const u = new URL(location.href);
        const qk = u.searchParams.get('apikey') || u.searchParams.get('key');
        if (validKey(qk)) { localStorage.setItem(cfg.storageKey, qk); apiKey = qk; return apiKey; }
        const ls = localStorage.getItem(cfg.storageKey);
        if (validKey(ls)) { apiKey = ls; return apiKey; }
        try {
            if (window.TornPDA?.getApiKey) { const k = window.TornPDA.getApiKey(); if (validKey(k)) { apiKey = k; return apiKey; } }
            for (const k in localStorage) {
                const v = localStorage.getItem(k);
                if (validKey(v) && /api.?key|key/i.test(k)) { apiKey = v; return apiKey; }
                if (v && v[0] === '{') { const j = safeJSON(v); const cand = j?.apiKey || j?.apikey || j?.key || j?.token; if (validKey(cand)) { apiKey = cand; return apiKey; } }
            }
        } catch { }
        return null;
    }

    function promptKey() {
        const v = prompt('Enter Torn API Key:', apiKey || '');
        if (v && validKey(v)) { localStorage.setItem(cfg.storageKey, v); apiKey = v; alert('Saved. Reloading values…'); catalogError = null; mvById.clear(); dropCache(); refresh(); }
        else if (v) alert('Invalid key.');
    }

    // show a floating button if no key anywhere
    function ensureKeyButton() {
        if (document.querySelector('.n3-key-btn')) return;
        if (getApiKey()) return;
        const b = document.createElement('button'); b.className = 'n3-key-btn'; b.textContent = 'Set Torn API Key';
        b.onclick = promptKey;
        document.documentElement.appendChild(b);
    }

    // --- HTTP with GM fallback ---
    function httpGetJSON(url) {
        return new Promise((resolve, reject) => {
            fetch(url, { credentials: 'omit', mode: 'cors' })
                .then(r => r.text().then(t => ({ ok: r.ok, text: t })))
                .then(({ ok, text }) => {
                    let j; try { j = JSON.parse(text); } catch (e) { return reject(new Error(`Bad JSON (${e.message})`)); }
                    if (!ok || j?.error) return reject(new Error(j?.error?.error || `HTTP error`));
                    resolve(j);
                })
                .catch(() => {
                    if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('fetch blocked & no GM'));
                    GM_xmlhttpRequest({
                        method: 'GET', url,
                        onload: (res) => {
                            try {
                                const j = JSON.parse(res.responseText);
                                if (j?.error) return reject(new Error(j.error.error || 'API error'));
                                resolve(j);
                            } catch (e) { reject(e); }
                        },
                        onerror: () => reject(new Error('GM request failed')),
                        ontimeout: () => reject(new Error('GM request timeout')),
                    });
                });
        });
    }

    // --- Items catalog with cache ---
    const CACHE_KEY = 'n3.items.catalog.v1';
    const CACHE_TTL = 12 * 60 * 60 * 1000;

    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !obj.time || !obj.data) return null;
            if (Date.now() - obj.time > CACHE_TTL) return null;
            return obj.data;
        } catch { return null; }
    }
    function writeCache() {
        try {
            const data = {}; for (const [id, v] of mvById.entries()) data[id] = v;
            localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data }));
        } catch { }
    }
    function dropCache() { try { localStorage.removeItem(CACHE_KEY); } catch { } }

    async function ensureCatalog() {
        if (mvById.size) return;
        // cache
        const cached = readCache();
        if (cached) {
            for (const [id, v] of Object.entries(cached)) mvById.set(+id, Number(v) || 0);
            log('loaded catalog from cache', mvById.size);
            return;
        }
        const key = getApiKey();
        ensureKeyButton();
        if (!key) throw new Error('No API key set');

        const url = `https://api.torn.com/torn/?selections=items&key=${key}&comment=n3`;
        log('fetch catalog…');
        const json = await httpGetJSON(url);
        const items = json?.items;
        if (!items) throw new Error('No items in API response');

        mvById.clear();
        for (const [id, data] of Object.entries(items)) mvById.set(+id, Number(data.market_value) || 0);
        writeCache();
        log('catalog loaded', mvById.size);
    }

    // --- detectors ---
    const isItemsView = () => {
        const href = location.pathname + location.search;
        return href.includes('/item.php') || /page\.php.*\bsid=items\b/i.test(href);
    };
    const isShopsView = () => {
        const href = location.pathname + location.search;
        return href.includes('/imarket.php') || href.includes('/shop.php') || href.includes('/shops.php') || /page\.php.*\bsid=shops?\b/i.test(href);
    };

    // --- observers & router ---
    function observe(root, cb, delay = 120) {
        const mo = new MutationObserver(() => { clearTimeout(observe._t); observe._t = setTimeout(cb, delay); });
        mo.observe(root || document.body, { childList: true, subtree: true });
        return mo;
    }

    function refresh() {
        if (isItemsView()) startInventory();
        if (isShopsView()) startShops();
    }

    const _push = history.pushState, _replace = history.replaceState;
    history.pushState = function () { const r = _push.apply(this, arguments); setTimeout(refresh, 0); return r; };
    history.replaceState = function () { const r = _replace.apply(this, arguments); setTimeout(refresh, 0); return r; };
    window.addEventListener('popstate', () => setTimeout(refresh, 0), { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
    function boot() {
        refresh();
        observe(document.body, refresh, 250);
        // small late-load nudge
        let i = 0; const t = setInterval(() => { refresh(); if (++i > 50) clearInterval(t); }, 120);
    }

    // ---------- INVENTORY ----------
    function startInventory() {
        if (started.inv) return; started.inv = true;

        const render = async () => {
            const rows = $$('li[data-item][data-rowkey]').filter(li => !li.closest('ul.actions-wrap'));
            if (!rows.length) return;

            // paint placeholders instantly
            const plan = [];
            for (const li of rows) {
                const id = +li.getAttribute('data-item'); if (!id) continue;
                const container = li.querySelector('.title-wrap .name-wrap') || li.querySelector('.title-wrap .title') || li;
                const nameEl = container.querySelector('.name') || container;

                // clean prior
                container.querySelectorAll('.n3-inline').forEach(n => n.remove());

                const qty = getQty(li);
                const tag = document.createElement('span');
                tag.className = 'n3-inline';
                tag.textContent = '…';
                // click to set key if there’s an error
                tag.addEventListener('click', () => {
                    if (tag.dataset.err === '1') promptKey();
                });
                if (nameEl.nextSibling) nameEl.parentNode.insertBefore(tag, nameEl.nextSibling);
                else nameEl.parentNode.appendChild(tag);

                plan.push({ id, qty, tag });
            }
            if (!plan.length) return;

            try {
                await ensureCatalog();
                catalogError = null;
                for (const p of plan) {
                    const mv = mvById.get(p.id) || 0;
                    p.tag.textContent = fmt((p.qty || 1) * mv);
                    p.tag.classList.remove('n3-err'); p.tag.removeAttribute('data-err');
                }
            } catch (e) {
                catalogError = e.message || 'API error';
                for (const p of plan) {
                    p.tag.textContent = 'API?';
                    p.tag.title = `Click to set/replace API key.\n\nLast error: ${catalogError}`;
                    p.tag.classList.add('n3-err');
                    p.tag.dataset.err = '1';
                }
                log('inventory: catalog error', e);
            }
        };

        observe(document.body, render, 120);
        render();

        // Desktop category reload hook
        const XHR_OPEN = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function (method, url) {
            if (method && url && typeof url === 'string' && method.toUpperCase() === 'POST' && url.startsWith('item.php?rfcv=')) {
                this.addEventListener('load', () => setTimeout(render, 0));
            }
            return XHR_OPEN.apply(this, arguments);
        };

        // late insert nudge
        let tries = 0; const tick = setInterval(() => { render(); if (++tries > 50) clearInterval(tick); }, 120);
    }

    function getQty(li) {
        const dq = li.getAttribute('data-qty'); if (dq && !isNaN(dq)) return Number(dq);
        const qAttr = li.querySelector('[data-qty]'); if (qAttr && !isNaN(qAttr.getAttribute('data-qty'))) return Number(qAttr.getAttribute('data-qty'));
        const cls = li.querySelector('.item-amount.qty, .qty, .i-amount, .amount, .stack, .count'); if (cls) { const n = cls.textContent.replace(/[^\d]/g, ''); if (n) return Number(n); }
        const nameRegion = li.querySelector('.name-wrap,.name,.title,.label,.text,.desc') || li;
        const m = /x\s*([0-9]{1,6})\b/i.exec(nameRegion.textContent); if (m) return Number(m[1]);
        return 1;
    }

    // ---------- SHOPS ----------
    function startShops() {
        if (started.shop) return; started.shop = true;

        const render = async () => {
            const tiles = findTiles();
            if (!tiles.length) return;

            const rows = tiles.map(t => {
                const itemId = parseId(t);
                const priceEl = t.querySelector('.desc .price') || t.querySelector('.price,.cost');
                const price = priceEl ? money(priceEl.textContent) : null;
                priceEl?.parentElement?.querySelectorAll('.n3-delta').forEach(n => n.remove());
                return { itemId, priceEl, price };
            }).filter(r => r.itemId && r.priceEl && r.price != null);

            if (!rows.length) return;

            try {
                await ensureCatalog();
                catalogError = null;
                for (const r of rows) {
                    const ref = Number(mvById.get(r.itemId)) || 0;
                    const shop = r.price;
                    const delta = ref ? (shop - ref) : 0;
                    const p = ref ? (delta / ref) : 0;
                    const b = document.createElement('span');
                    b.className = 'n3-delta ' + (delta > 0 ? 'neg' : delta < 0 ? 'pos' : 'zero');
                    b.title = `Shop: ${fmt(shop)}\nMarket: ${fmt(ref)}\nΔ: ${fmt(delta)} (${(p > 0 ? '+' : '') + (p * 100).toFixed(1)}%)`;
                    b.textContent = `${delta > 0 ? '+' : ''}${fmt(delta)} (${(p > 0 ? '+' : '') + (p * 100).toFixed(1)}%)`;
                    r.priceEl.insertAdjacentElement('afterend', b);
                }
            } catch (e) {
                catalogError = e.message || 'API error';
                // show a small neutral badge to invite fixing key
                for (const r of rows) {
                    const b = document.createElement('span');
                    b.className = 'n3-delta zero n3-err';
                    b.textContent = 'API?';
                    b.title = `Click to set/replace API key.\n\nLast error: ${catalogError}`;
                    b.addEventListener('click', promptKey);
                    r.priceEl.insertAdjacentElement('afterend', b);
                }
                log('shops: catalog error', e);
            }
        };

        observe(document.body, render, 150);
        render();

        // late insert nudge
        let tries = 0; const tick = setInterval(() => { render(); if (++tries > 50) clearInterval(tick); }, 120);
    }

    function findTiles() {
        let els = Array.from(document.querySelectorAll('ul.buy-flexslider li.slide ul.items-list > li:not(.empty) .acc-title'));
        if (els.length) return els;
        els = Array.from(document.querySelectorAll('.shop .item, .items .item, .shop-list .item, .imarket-list .item, li[data-item] .acc-title'));
        if (els.length) return els;
        return Array.from(document.querySelectorAll('.acc-title, .item-desc')).filter(c => c.querySelector('.desc .price, .price, .cost'));
    }
    function parseId(tile) {
        const a = tile.querySelector('.item[itemid]'); if (a) return Number(a.getAttribute('itemid'));
        const li = tile.closest('li[data-item]'); if (li?.getAttribute('data-item')) return Number(li.getAttribute('data-item'));
        const link = tile.querySelector('a[href*="XID="],a[href*="xid="]');
        if (link) { try { const u = new URL(link.href, location.origin); const xid = u.searchParams.get('XID') || u.searchParams.get('xid'); if (xid) return Number(xid); } catch { } }
        return null;
    }
    function money(txt) { const m = String(txt || '').replace(/[^0-9.-]/g, ''); return m ? Number(m) : null; }

    // ensure the key button exists if needed (esp. first run)
    ensureKeyButton();

})();