// ==UserScript==
// @name         Nate3D-Torn: Item Values & Shop Deltas Everywhere
// @namespace    nate3d.torn.item-values-everywhere
// @version      2.0
// @description  Shows stack market value on item rows and Δ vs market value on merchant/shop tiles. Browser + Torn PDA.
// @author       nate3D
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/imarket.php*
// @match        https://www.torn.com/shop.php*
// @match        https://www.torn.com/shops.php*
// @grant        none
// @run-at       document-start
// @homepageURL  https://github.com/nate3D/torn-game-nate3d-scripts
// @updateURL    https://raw.githubusercontent.com/nate3D/torn-game-nate3d-scripts/main/scripts/item_values_everywhere.user.js
// @downloadURL  https://raw.githubusercontent.com/nate3D/torn-game-nate3d-scripts/main/scripts/item_values_everywhere.user.js
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /** ======================== SETTINGS ======================== **/
    const settings = {
        // Set to true to attempt scraping live Item Market lowest price (disabled by default; uses market_value instead)
        useItemMarketLive: false,
        // Where to store our key
        storageKey: 'nate3d.torn.apiKey',
        // UI: where to pin the key button in case of missing key
        addKeyButton: true,
        // Color/style knobs
        colors: {
            stackValue: '#B53471',   // item page stack value
            deltaPos: '#21ba45',     // green
            deltaNeg: '#ff3b30',     // red
            deltaZero: '#888'        // neutral
        }
    };

    /** ======================== STATE ======================== **/
    const marketValueByItemId = new Map();   // itemId -> market_value
    const XHR_OPEN = window.XMLHttpRequest.prototype.open;
    let apiKey = null;

    /** ======================== UTILITIES ======================== **/
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const fmtMoney = n => '$' + (Math.round(Number(n)) || 0).toLocaleString('en-US');
    const pct = (num) => (num > 0 ? '+' : '') + (num * 100).toFixed(1) + '%';
    const isPDA = () => /tornpda/i.test(navigator.userAgent) || !!window.TornPDA;

    function tryGetApiKey() {
        // URL param takes precedence
        const url = new URL(location.href);
        const fromQuery = url.searchParams.get('apikey') || url.searchParams.get('key');
        if (isValidKey(fromQuery)) return fromQuery;

        // Our own storage
        const fromLocal = localStorage.getItem(settings.storageKey);
        if (isValidKey(fromLocal)) return fromLocal;

        // Torn PDA — try common places
        try {
            // 1) some builds expose a global
            if (window.TornPDA?.getApiKey) {
                const k = window.TornPDA.getApiKey();
                if (isValidKey(k)) return k;
            }
            // 2) localStorage probes
            for (const k in localStorage) {
                const val = localStorage.getItem(k);
                if (isValidKey(val) && /api.?key|key/i.test(k)) return val;
                if (looksLikeJSON(val)) {
                    const obj = safeJSON(val);
                    const maybe = obj?.apiKey || obj?.apikey || obj?.key;
                    if (isValidKey(maybe)) return maybe;
                }
            }
        } catch { /* ignore */ }

        return null;
    }

    function isValidKey(k) {
        return typeof k === 'string' && /^[A-Za-z0-9]{16,64}$/.test(k);
    }
    function looksLikeJSON(s) { return typeof s === 'string' && s.startsWith('{') && s.endsWith('}'); }
    function safeJSON(s) { try { return JSON.parse(s); } catch { return null; } }

    function ensureApiKey() {
        apiKey = tryGetApiKey();
        if (!apiKey && settings.addKeyButton) injectApiKeyButton();
        return apiKey;
    }

    function injectApiKeyButton() {
        const css = `
      .n3-key-btn { position: fixed; z-index: 99999; right: 14px; bottom: 14px;
        background: #111; color: #fff; padding: 8px 10px; border-radius: 10px;
        font: 600 12px/1.2 Inter, system-ui, sans-serif; opacity:.8; cursor: pointer; }
      .n3-key-btn:hover { opacity:1; }
    `;
        addStyle(css);
        const btn = document.createElement('button');
        btn.className = 'n3-key-btn';
        btn.textContent = 'Set Torn API Key';
        btn.addEventListener('click', () => {
            const v = prompt('Enter your Torn API Key (stored locally and used by this userscript only):', apiKey || '');
            if (isValidKey(v)) {
                localStorage.setItem(settings.storageKey, v);
                apiKey = v;
                alert('API key saved. Reloading values…');
                refreshAll();
            } else if (v !== null) {
                alert('That key does not look valid.');
            }
        });
        document.documentElement.appendChild(btn);
    }

    function addStyle(css) {
        const el = document.createElement('style');
        el.textContent = css;
        document.documentElement.appendChild(el);
    }

    /** ======================== TORN API ======================== **/
    async function ensureMarketValueIsLoadedForItems(itemIds) {
        const need = itemIds.filter(id => !marketValueByItemId.has(id));
        if (need.length === 0) return;

        if (!ensureApiKey()) throw new Error('Missing API key');

        // chunk to keep URL sane
        const chunks = [];
        const size = 90;
        for (let i = 0; i < need.length; i += size) chunks.push(need.slice(i, i + size));

        for (const c of chunks) {
            const url = `https://api.torn.com/torn/${c.join(',')}?selections=items&key=${apiKey}`;
            const res = await fetch(url);
            const json = await res.json();
            if (!json?.items) throw new Error(json?.error?.error || 'Unknown API error');
            Object.entries(json.items).forEach(([itemId, data]) => {
                marketValueByItemId.set(Number(itemId), Number(data.market_value) || 0);
            });
        }
    }

    // Optional live IMarket (disabled by default)
    async function fetchLiveItemMarketPrice(_itemId, _name) {
        // TODO: Implement a light-weight fetch of lowest live price if desired.
        // For now return null to signal “use market_value”.
        return null;
    }

    /** ======================== ITEM PAGE (inventory) ======================== **/
    function enhanceItemPage() {
        // Styling so the value never hides behind bubbles
        addStyle(`
      .n3-stack-value {
        position: absolute; right: .5rem; top: 50%; transform: translateY(-50%);
        color: ${settings.colors.stackValue}; font-weight: 600; z-index: 5; pointer-events: none;
        text-shadow: 0 1px 2px rgba(0,0,0,.35);
      }
      .items-cont .name-wrap { position: relative !important; padding-right: 9.5rem !important; }
    `);

        const render = async () => {
            const container = getVisibleCategory();
            if (!container) return;
            const rows = Array.from(container.children).filter(li => li.hasAttribute('data-item'));
            const ids = rows.map(r => Number(r.dataset.item)).filter(Boolean);
            try {
                await ensureMarketValueIsLoadedForItems(ids);
            } catch (e) {
                console.warn('[N3 Item Values] API error:', e);
                return;
            }

            for (const li of rows) {
                if (li.dataset.n3ValueInserted === '1') continue;
                const itemId = Number(li.dataset.item);
                const nameWrap = li.querySelector('.name-wrap');
                if (!nameWrap) continue;
                const qtySpan = nameWrap.querySelector('.qty');
                const qty = qtySpan ? parseInt(qtySpan.textContent.replace('x', '').trim(), 10) || 1 : 1;
                const mv = marketValueByItemId.get(itemId) || 0;
                const total = qty * mv;

                const label = document.createElement('span');
                label.className = 'n3-stack-value';
                label.textContent = fmtMoney(total);
                nameWrap.appendChild(label);
                li.dataset.n3ValueInserted = '1';
            }
        };

        // initial + subsequent loads
        render();
        hookItemsXHR(render);
        observe(containerRoot(), render);
    }

    function getVisibleCategory() {
        const wrap = document.getElementById('category-wrap');
        if (!wrap) return null;
        return Array.from(wrap.children).find(c => c.classList.contains('items-cont') && c.style.display !== 'none');
    }

    function hookItemsXHR(handler) {
        window.XMLHttpRequest.prototype.open = function (method, url) {
            if (method?.toUpperCase() === 'POST' && typeof url === 'string' && url.startsWith('item.php?rfcv=')) {
                this.addEventListener('load', () => setTimeout(handler, 0));
            }
            return XHR_OPEN.apply(this, arguments);
        };
    }

    /** ======================== SHOP / MERCHANT TILES ======================== **/
    function enhanceShopTiles() {
        // CSS badge for deltas
        addStyle(`
      .n3-delta-badge {
        position: absolute; top: 8px; right: 8px; z-index: 5;
        font-weight: 700; padding: 2px 6px; border-radius: 8px; font-size: 11px;
        backdrop-filter: blur(2px); background: rgba(0,0,0,.55); color: #fff;
        box-shadow: 0 1px 2px rgba(0,0,0,.4);
      }
      .n3-delta-badge.pos { background: ${hexWithAlpha(settings.colors.deltaPos, .18)}; color: ${settings.colors.deltaPos}; }
      .n3-delta-badge.neg { background: ${hexWithAlpha(settings.colors.deltaNeg, .18)}; color: ${settings.colors.deltaNeg}; }
      .n3-delta-badge.zero { background: rgba(128,128,128,.18); color: ${settings.colors.deltaZero}; }
      .n3-tile-wrap { position: relative !important; }
    `);

        const render = async () => {
            const tiles = findShopTiles();
            if (!tiles.length) return;

            // Collect item ids/names & prices
            const info = tiles.map(tile => {
                const itemId = parseItemIdFromTile(tile);
                const name = parseItemNameFromTile(tile);
                const price = parseItemPriceFromTile(tile);
                return { tile, itemId, name, price };
            }).filter(x => x.itemId && x.price);

            const ids = info.map(x => x.itemId);
            try {
                await ensureMarketValueIsLoadedForItems(ids);
            } catch (e) {
                console.warn('[N3 Shop Deltas] API error:', e);
                return;
            }

            for (const itm of info) {
                if (itm.tile.dataset.n3DeltaInserted === '1') continue;

                const mvFallback = marketValueByItemId.get(itm.itemId) || 0;
                const live = settings.useItemMarketLive ? (await fetchLiveItemMarketPrice(itm.itemId, itm.name)) : null;
                const ref = Number(live || mvFallback) || 0;

                const delta = ref ? (itm.price - ref) : 0;
                const pctNum = ref ? (delta / ref) : 0;

                const badge = document.createElement('div');
                badge.className = 'n3-delta-badge ' + (delta > 0 ? 'neg' : delta < 0 ? 'pos' : 'zero');
                badge.title = `Shop: ${fmtMoney(itm.price)}\nMarket: ${fmtMoney(ref)}\nΔ: ${fmtMoney(delta)} (${pct(pctNum)})`;
                badge.textContent = `${delta > 0 ? '+' : ''}${fmtMoney(delta)}  (${pct(pctNum)})`;

                (itm.tile.classList.contains('n3-tile-wrap') ? itm.tile : itm.tile.classList.add('n3-tile-wrap'), itm.tile).appendChild(badge);
                itm.tile.dataset.n3DeltaInserted = '1';
            }
        };

        render();
        observe(document.body, render);
    }

    // Helpers to find/parse various shop UIs Torn uses
    function findShopTiles() {
        // 1) City shops / merchant cards
        let tiles = $$('.city-shop, .shop, .items .item, .shop-list .item, .imarket-list .item, li[data-item]');
        if (tiles.length) return tiles;

        // 2) Fallback: look for anything with a price and data-item
        tiles = $$('li[data-item], div[data-item]');
        return tiles;
    }

    function parseItemIdFromTile(tile) {
        const d = tile.getAttribute('data-item');
        if (d) return Number(d);
        const btn = tile.querySelector('button[data-item]');
        if (btn) return Number(btn.getAttribute('data-item'));
        // fallback: many tiles keep an anchor with href including XID=
        const a = tile.querySelector('a[href*="XID="], a[href*="xid="]');
        if (a) {
            const u = new URL(a.href, location.origin);
            const xid = u.searchParams.get('XID') || u.searchParams.get('xid');
            if (xid) return Number(xid);
        }
        return null;
    }

    function parseItemNameFromTile(tile) {
        const n = tile.querySelector('.name, .title, .name-wrap .name, .info .name, .c-name, .desc .name');
        return n ? n.textContent.trim() : null;
    }

    function parseItemPriceFromTile(tile) {
        // Common price selectors (strip $ and commas)
        const priceEl = tile.querySelector('.price, .cost, .value, .buyPrice, .sellPrice, .right .number, .details .right, .rt .price, .rt .number');
        if (!priceEl) return null;
        const m = priceEl.textContent.replace(/[^\d]/g, '');
        return m ? Number(m) : null;
    }

    /** ======================== OBSERVERS / HELPERS ======================== **/
    function containerRoot() { return document.getElementById('category-wrap') || document.body; }

    function observe(root, cb) {
        const mo = new MutationObserver(() => {
            // debounce a bit for large reflows
            clearTimeout(observe._t);
            observe._t = setTimeout(cb, 80);
        });
        mo.observe(root || document.body, { childList: true, subtree: true });
    }

    function refreshAll() {
        if (/\/item\.php/.test(location.pathname)) enhanceItemPage();
        if (/\/(imarket|shop|shops)\.php/.test(location.pathname)) enhanceShopTiles();
    }

    function hexWithAlpha(hex, alpha) {
        // allow named colors; just fallback black bg
        if (!/^#([0-9a-f]{3}){1,2}$/i.test(hex)) return `rgba(0,0,0,${alpha})`;
        const c = hex.slice(1);
        const vals = c.length === 3 ? c.split('').map(x => parseInt(x + x, 16)) :
            [c.slice(0, 2), c.slice(2, 4), c.slice(4, 6)].map(h => parseInt(h, 16));
        return `rgba(${vals[0]},${vals[1]},${vals[2]},${alpha})`;
    }

    /** ======================== BOOT ======================== **/
    // Start once DOM is ready enough
    const start = () => {
        // Add minimal global CSS once
        addStyle(`.n3-hide{display:none!important}`);

        if (/\/item\.php/.test(location.pathname)) {
            enhanceItemPage();
        } else if (/\/(imarket|shop|shops)\.php/.test(location.pathname)) {
            enhanceShopTiles();
        }

        // Safety: if Torn navigates SPA-style, re-run
        observe(document.body, refreshAll);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
