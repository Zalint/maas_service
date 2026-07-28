/**
 * Client HTTP pour le pool GLOBAL de commandes web exposé par le service
 * C:\Mata\DATA via /api/external/weborders* (x-api-key). Maas ne stocke rien
 * localement (les schémas Postgres sont isolés par tenant) : le pool est lu
 * en direct depuis DATA et l'état (assigné/converti) y reste central, ce qui
 * garantit "premier arrivé premier servi" entre le POS DATA et les POS Maas.
 *
 * Voir le sibling lib/data-tracabilite-client.js (même squelette).
 *
 * Config via env vars:
 *   - DATA_API_BASE_URL   ex: http://localhost:3002 (dev) / https://mata-lgzy.onrender.com (prod)
 *   - clé x-api-key = WEB_ORDERS_API_KEY, sinon EXTERNAL_API_KEY, sinon DATA_API_KEY.
 *     Elle DOIT être égale à EXTERNAL_API_KEY de DATA (celle que valident les
 *     routes /api/external/weborders*, la même que n8n).
 *
 * Comportement:
 *   - Lecture (list): cache mémoire court (TTL 20s) + stale-while-revalidate.
 *     Retourne [] si non configuré / erreur sans cache (dégradation gracieuse).
 *   - Écriture (assign/unassign/convert/archive): PAS de cache; relaie le
 *     status HTTP + le JSON de DATA pour que la route Maas les retransmette.
 */

'use strict';

const LIST_CACHE_TTL_MS = 20 * 1000; // 20s — le POS rafraîchit souvent
const REQUEST_TIMEOUT_MS = 8000;
const ALLOWED_ACTIONS = ['assign', 'unassign', 'convert', 'archive'];

const _listCache = new Map(); // cacheKey -> { data, fetchedAt }
const _inflight = new Map();  // cacheKey -> Promise

function getConfig() {
    const baseUrl = (process.env.DATA_API_BASE_URL || '').trim().replace(/\/+$/, '');
    const apiKey = (
        process.env.WEB_ORDERS_API_KEY ||
        process.env.EXTERNAL_API_KEY ||
        process.env.DATA_API_KEY ||
        ''
    ).trim();
    return { baseUrl, apiKey };
}

function isConfigured() {
    const { baseUrl, apiKey } = getConfig();
    return !!(baseUrl && apiKey);
}

/**
 * Liste les commandes web (pool global). Cache court + SWR.
 * @param {object} [opts]
 * @param {string} [opts.date] - 'YYYY-MM-DD' (sinon: 7 derniers jours côté DATA)
 * @param {boolean} [opts.bypassCache=false]
 * @returns {Promise<Array>} liste (jamais null; [] si indisponible)
 */
async function listCommandesWeb(opts) {
    opts = opts || {};
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) return [];

    const date = (typeof opts.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.date))
        ? opts.date : '';
    const cacheKey = date || '_recent';
    const now = Date.now();

    if (!opts.bypassCache) {
        const c = _listCache.get(cacheKey);
        if (c && (now - c.fetchedAt) < LIST_CACHE_TTL_MS) return c.data;
    }
    if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);

    const url = baseUrl + '/api/external/weborders' + (date ? ('?date=' + encodeURIComponent(date)) : '');
    const p = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
                signal: controller.signal
            });
            if (!res.ok) {
                console.warn(`⚠️  DATA weborders HTTP ${res.status} (${url})`);
                const stale = _listCache.get(cacheKey);
                return stale ? stale.data : [];
            }
            const json = await res.json();
            const orders = (json && json.success === true && Array.isArray(json.orders)) ? json.orders : [];
            _listCache.set(cacheKey, { data: orders, fetchedAt: Date.now() });
            return orders;
        } catch (e) {
            console.warn('⚠️  DATA weborders fetch échoué:', e.message);
            const stale = _listCache.get(cacheKey);
            return stale ? stale.data : [];
        } finally {
            clearTimeout(timeoutId);
            _inflight.delete(cacheKey);
        }
    })();

    _inflight.set(cacheKey, p);
    return p;
}

/**
 * Exécute une action d'état sur une commande web (assign/unassign/convert/archive).
 * Relaie le status HTTP + le corps JSON de DATA (pour retransmission).
 * @param {string|number} id
 * @param {string} action
 * @param {object} body - doit contenir { actor }, + { posVenteId? } pour convert
 * @returns {Promise<{status:number, data:object}>}
 * @throws {Error} err.code = 'NOT_CONFIGURED' | 'BAD_ACTION' | 'UPSTREAM_DOWN'
 */
async function postCommandeWebAction(id, action, body) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) {
        const e = new Error('API commandes web non configurée (DATA_API_BASE_URL / clé)');
        e.code = 'NOT_CONFIGURED';
        throw e;
    }
    if (!ALLOWED_ACTIONS.includes(action)) {
        const e = new Error('action invalide: ' + action);
        e.code = 'BAD_ACTION';
        throw e;
    }
    // L'état change côté central -> invalider le cache liste local.
    _listCache.clear();

    const url = baseUrl + '/api/external/weborders/' + encodeURIComponent(id) + '/' + action;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body || {}),
            signal: controller.signal
        });
        let data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        return { status: res.status, data: data || {} };
    } catch (e) {
        const err = new Error('DATA weborders injoignable: ' + e.message);
        err.code = 'UPSTREAM_DOWN';
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

module.exports = { listCommandesWeb, postCommandeWebAction, isConfigured };
