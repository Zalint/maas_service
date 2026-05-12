/**
 * Client HTTP pour appeler l'endpoint /api/external/lot-actuel exposé par
 * le service C:\Mata\DATA. Maas App lit le lot et l'origine depuis DATA
 * plutot que de maintenir son propre cycle d'achats boeuf.
 *
 * Configuration via env vars:
 *   - DATA_API_BASE_URL  ex: http://localhost:3001  (dev)
 *                            https://mata-data.onrender.com  (prod)
 *   - DATA_API_KEY       le token partage avec DATA (header x-api-key)
 *
 * Comportement:
 *   - Cache en memoire (TTL 30 min) pour eviter de marteler DATA.
 *   - Echec gracieux: si l'env n'est pas configure ou si DATA repond mal,
 *     retourne null. Le code appelant doit gerer ce cas (= pas d'affichage
 *     de la section tracabilite).
 *   - Cache "stale-while-revalidate": en cas d'erreur reseau, on prefere
 *     servir l'ancien cache (meme expire) plutot qu'echouer.
 */

'use strict';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
let _cache = null; // { data, fetchedAt }
let _inflight = null; // Promise en cours, pour dedupliquer les appels concurrents

/**
 * Renvoie { origine, dateAbattage, lot } ou null si DATA n'est pas
 * configure / si DATA n'a pas de donnees / si erreur reseau sans cache.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.bypassCache=false] - forcer un fresh fetch
 * @returns {Promise<{origine:string, dateAbattage:string, lot:string} | null>}
 */
async function getLotActuel(opts) {
    opts = opts || {};
    const baseUrl = (process.env.DATA_API_BASE_URL || '').trim();
    const apiKey = (process.env.DATA_API_KEY || '').trim();

    if (!baseUrl || !apiKey) {
        // Pas de configuration: feature desactivee silencieusement.
        return null;
    }

    // Cache hit ?
    const now = Date.now();
    if (!opts.bypassCache && _cache && (now - _cache.fetchedAt) < CACHE_TTL_MS) {
        return _cache.data;
    }

    // Si un fetch est deja en cours, attendre son resultat (dedup).
    if (_inflight) {
        return _inflight;
    }

    const url = baseUrl.replace(/\/+$/, '') + '/api/external/lot-actuel';
    _inflight = (async () => {
        try {
            // Node 18+ a fetch global. On utilise un timeout via AbortController.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                console.warn(`⚠️  DATA lot-actuel HTTP ${res.status} (${url})`);
                // Stale-while-revalidate: retourner l'ancien cache si dispo.
                return _cache ? _cache.data : null;
            }

            const json = await res.json();
            if (!json || json.success !== true) {
                console.warn('⚠️  DATA lot-actuel reponse non success:', json);
                return _cache ? _cache.data : null;
            }

            const data = json.data || null;
            _cache = { data, fetchedAt: now };
            return data;
        } catch (err) {
            console.warn('⚠️  DATA lot-actuel fetch echoue:', err.message);
            return _cache ? _cache.data : null;
        } finally {
            _inflight = null;
        }
    })();

    return _inflight;
}

/**
 * Reset cache (test only / admin endpoint si besoin).
 */
function clearCache() {
    _cache = null;
    _inflight = null;
}

module.exports = {
    getLotActuel,
    clearCache,
    CACHE_TTL_MS
};
