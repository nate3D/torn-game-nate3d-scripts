// ==UserScript==
// @name         Nate3D-Torn: Item Values & Shop Deltas Everywhere
// @namespace    nate3d.torn.item-values-everywhere
// @version      2.2
// @description  Shows stack market value on stash/inventory rows and Δ vs market value on merchant/shop tiles. Browser + Torn PDA.
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/imarket.php*
// @match        https://www.torn.com/shop.php*
// @match        https://www.torn.com/shops.php*
// @match        https://www.torn.com/page.php*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/nate3D/torn-game-nate3d-scripts
// @updateURL    https://raw.githubusercontent.com/nate3D/torn-game-nate3d-scripts/main/scripts/item_values_everywhere.user.js
// @downloadURL  https://raw.githubusercontent.com/nate3D/torn-game-nate3d-scripts/main/scripts/item_values_everywhere.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const settings = {
        useItemMarketLive: false,
        storageKey: 'nate3d.torn.apiKey',
        addKeyButton: true,
        colors: { stackValue: '#B53471', deltaPos: '#21ba45', deltaNeg: '#ff3b30', deltaZero: '#888' },
        debug: false,
    };

    const marketValueByItemId = new Map();
    let apiKey = null;

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const fmt = n => '$' + (Math.round(Number(n)) || 0).toLocaleString('en-US');
    const log = (...a) => settings.debug && console.log('[N3 Item Values]', ...a);

    function addStyle(css) { const el = document.createElement('style'); el.textContent = css; document.documentElement.appendChild(el); }
    function validKey(k) { return typeof k === 'string' && /^[A-Za-z0-9]{16,64}$/.test(k); }
    function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }

    function ensureApiKey() {
        const u = new URL(location.href);
        const qk = u.searchParams.get('apikey') || u.searchParams.get('key');
        if (validKey(qk)) { localStorage.setItem(settings.storageKey, qk); return (apiKey = qk); }

        const ls = localStorage.getItem(settings.storageKey);
        if (validKey(ls)) return (apiKey = ls);

        try {
            // Torn PDA sometimes exposes helper OR stores JSON blobs
            if (window.TornPDA?.getApiKey) {
                const k = window.TornPDA.getApiKey();
                if (validKey(k)) return (apiKey = k);
            }
            for (const k in localStorage) {
                const v = localStorage.getItem(k);
                if (validKey(v) && /api.?key|key/i.test(k)) return (apiKey = v);
                if (v && v[0] === '{') {
                    const j = safeJSON(v);
                    const cand = j?.apiKey || j?.apikey || j?.key || j?.token;
                    if (validKey(cand)) return (apiKey = cand);
                }
            }
        } catch { }
        if (!apiKey && settings.addKeyButton) addKeyButton();
        return apiKey;
    }

    function addKeyButton() {
        addStyle(`.n3-key-btn{position:fixed;right:14px;bottom:14px;z-index:99999;background:#111;color:#fff;padding:8px 10px;border-radius:10px;font:600 12px/1 Inter,system-ui,sans-serif;opacity:.85;cursor:pointer}.n3-key-btn:hover{opacity:1}`);
        const b = document.createElement('button');
        b.className = 'n3-key-btn';
        b.textContent = 'Set Torn API Key';
        b.onclick = () => { const v = prompt('Enter Torn API Key:', apiKey || ''); if (v && validKey(v)) { localStorage.setItem(settings.storageKey, v); apiKey = v; alert('Saved.'); refresh(); } else if (v) { alert('Invalid key.'); } };
        document.documentElement.appendChild(b);
    }

    async function ensureMarketValue(itemIds) {
        const need = itemIds.filter(id => !marketValueByItemId.has(id));
        if (!need.length) return;
        if (!ensureApiKey()) throw new Error('Missing API key');
        for (let i = 0; i < need.length; i += 90) {
            const chunk = need.slice(i, i + 90);
            const url = `https://api.torn.com/torn/${chunk.join(',')}?selections=items&key=${apiKey}`;
            const res = await fetch(url);
            const json = await res.json();
            if (!json?.items) throw new Error(json?.error?.error || 'Unknown API error');
            for (const [id, data] of Object.entries(json.items)) marketValueByItemId.set(+id, Number(data.market_value) || 0);
        }
    }

    function observe(root, cb) {
        const mo = new MutationObserver(() => { clearTimeout(observe._t); observe._t = setTimeout(cb, 120); });
        mo.observe(root || document.body, { childList: true, subtree: true });
    }

    /* ---------- INVENTORY / STASH (inline, left) ---------- */
    function runInventory() {
        addStyle(`
      li[data-item][data-rowkey]{position:relative!important}
      .n3-stack-inline{display:inline-block;margin-left:.5rem;font-weight:700;color:${settings.colors.stackValue};white-space:nowrap;vertical-align:middle;text-shadow:0 1px 2px rgba(0,0,0,.25)}
    `);

        const render = async () => {
            const rows = $$('li[data-item][data-rowkey]').filter(li => !li.closest('ul.actions-wrap'));
            if (!rows.length) return;

            const info = rows.map(li => {
                const container = li.querySelector('.title-wrap .name-wrap') || li.querySelector('.title-wrap .title') || li;
                container.querySelectorAll('.n3-stack-value,.n3-stack-inline').forEach(n => n.remove());
                const nameEl = container.querySelector('.name') || container;
                return { li, id: +li.getAttribute('data-item'), qty: getQty(li), container, nameEl };
            }).filter(x => x.id);

            try { await ensureMarketValue(info.map(x => x.id)); } catch (e) { log('API error', e); return; }

            for (const r of info) {
                const mv = marketValueByItemId.get(r.id) || 0;
                const total = (r.qty || 1) * mv;
                const tag = document.createElement('span');
                tag.className = 'n3-stack-inline';
                tag.textContent = fmt(total);
                (r.nameEl.nextSibling) ? r.nameEl.parentNode.insertBefore(tag, r.nameEl.nextSibling)
                    : r.nameEl.parentNode.appendChild(tag);
            }
        };

        render();
        observe(document.body, render);
    }

    function getQty(li) {
        const dq = li.getAttribute('data-qty'); if (dq && !isNaN(dq)) return Number(dq);
        const qAttr = li.querySelector('[data-qty]'); if (qAttr && !isNaN(qAttr.getAttribute('data-qty'))) return Number(qAttr.getAttribute('data-qty'));
        const cls = li.querySelector('.qty,.i-amount,.amount,.stack,.count'); if (cls) { const n = cls.textContent.replace(/[^\d]/g, ''); if (n) return Number(n); }
        const nameRegion = li.querySelector('.name-wrap,.name,.title,.label,.text,.desc') || li;
        const m = /x\s*([0-9]{1,6})\b/i.exec(nameRegion.textContent); if (m) return Number(m[1]);
        return 1;
    }

    /* ---------- SHOPS / MERCHANTS (inline after price) ---------- */
    function runShops() {
        addStyle(`
      .n3-delta-inline{display:inline-block;margin-left:.4rem;font-weight:700;padding:2px 6px;border-radius:8px;font-size:11px;vertical-align:middle;white-space:nowrap}
      .n3-delta-inline.pos{background:rgba(33,186,69,.18);color:#21ba45}
      .n3-delta-inline.neg{background:rgba(255,59,48,.18);color:#ff3b30}
      .n3-delta-inline.zero{background:rgba(128,128,128,.18);color:#888}
    `);

        const render = async () => {
            const tiles = findMerchantTiles();
            if (!tiles.length) return;

            const rows = tiles.map(t => {
                const itemId = getMerchantItemId(t);
                const nameEl = t.querySelector('.desc .name');
                const priceEl = t.querySelector('.desc .price');
                const price = priceEl ? parseMoney(priceEl.textContent) : null;
                priceEl?.parentElement?.querySelectorAll('.n3-delta-inline').forEach(n => n.remove());
                return { t, itemId, nameEl, priceEl, price };
            }).filter(r => r.itemId && r.priceEl && r.price != null);

            try { await ensureMarketValue(rows.map(r => r.itemId)); } catch { return; }

            for (const r of rows) {
                const ref = Number(marketValueByItemId.get(r.itemId)) || 0;
                const shop = r.price;
                const delta = ref ? (shop - ref) : 0;
                const p = ref ? (delta / ref) : 0;
                const badge = document.createElement('span');
                badge.className = 'n3-delta-inline ' + (delta > 0 ? 'neg' : delta < 0 ? 'pos' : 'zero');
                badge.title = `Shop: ${fmt(shop)}\nMarket: ${fmt(ref)}\nΔ: ${fmt(delta)} (${(p > 0 ? '+' : '') + (p * 100).toFixed(1)}%)`;
                badge.textContent = `${delta > 0 ? '+' : ''}${fmt(delta)} (${(p > 0 ? '+' : '') + (p * 100).toFixed(1)}%)`;
                r.priceEl.insertAdjacentElement('afterend', badge);
            }
        };

        render();
        observe(document.body, render);
    }

    function findMerchantTiles() {
        // PDA/desktop city shops (your sample): buy-flexslider -> items-list -> li .acc-title
        return Array.from(document.querySelectorAll('ul.buy-flexslider li.slide ul.items-list > li:not(.empty) .acc-title'));
    }
    function getMerchantItemId(tile) {
        const el = tile.querySelector('.item[itemid]');
        const id = el && el.getAttribute('itemid');
        return id ? Number(id) : null;
    }
    function parseMoney(txt) {
        const m = String(txt || '').replace(/[^0-9.-]/g, '');
        return m ? Number(m) : null;
    }

    /* ---------- ROUTING / BOOT (SPA-safe, PDA-safe) ---------- */
    function refresh() {
        const p = location.pathname + location.search;
        if (p.includes('/item.php') || /page\.php.*\bsid=items\b/.test(p)) runInventory();
        if (p.includes('/imarket.php') || p.includes('/shop.php') || p.includes('/shops.php') || /page\.php.*\bsid=shops?\b/.test(p)) runShops();
    }

    // Re-run on SPA navigations too
    const _push = history.pushState;
    history.pushState = function () { const r = _push.apply(this, arguments); setTimeout(refresh, 0); return r; };
    window.addEventListener('popstate', () => setTimeout(refresh, 0));

    // A light retry to handle PDA's late DOM inserts
    function startWhenReady() {
        let tries = 0;
        const tick = setInterval(() => {
            tries++;
            if (document.body && document.querySelector('#body, .content, .container, .items-list, .title-wrap')) {
                clearInterval(tick);
                addStyle(`.n3-hide{display:none!important}`);
                refresh();
                observe(document.body, refresh);
            }
            if (tries > 60) clearInterval(tick); // ~6s safety
        }, 100);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startWhenReady, { once: true });
    } else {
        startWhenReady();
    }
})();
