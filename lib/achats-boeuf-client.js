/**
 * Prix d'achat BŒUF « sans abats » lu dynamiquement depuis le service DATA
 * (`GET /api/external/achats-boeuf`). Sert à rendre le prix achat fournisseur
 * du bœuf dynamique côté Maas (au lieu de la valeur saisie au catalogue).
 *
 * « sans abats » = `prix_achat_kg_sans_abats` (= prix brut payé / nbr_kg, sans
 * déduire la valeur des abats). Résolution POINT-IN-TIME : pour une date, on
 * prend le prix de l'achat bœuf de la date la plus récente <= date demandée.
 *
 * Config via env vars:
 *   - DATA_API_BASE_URL   URL de DATA (ex: http://localhost:3002 / mata-lgzy).
 *   - clé x-api-key = WEB_ORDERS_API_KEY, sinon DATA_API_KEY, sinon
 *     EXTERNAL_API_KEY. Doit égaler EXTERNAL_API_KEY de DATA (validateApiKey).
 *
 * Comportement:
 *   - Cache mémoire (TTL 30 min) de la liste agrégée par date + dédup des
 *     appels concurrents.
 *   - Dégradation gracieuse: renvoie [] / null si non configuré ou DATA down
 *     (le code appelant retombe alors sur le prix catalogue).
 */

'use strict';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — les achats bœuf changent rarement
const REQUEST_TIMEOUT_MS = 8000;

let _cache = null;    // { rows: [{date, prix}], fetchedAt }
let _inflight = null; // Promise en cours (dédup)

function getConfig() {
    const baseUrl = (process.env.DATA_API_BASE_URL || '').trim().replace(/\/+$/, '');
    const apiKey = (
        process.env.WEB_ORDERS_API_KEY ||
        process.env.DATA_API_KEY ||
        process.env.EXTERNAL_API_KEY ||
        ''
    ).trim();
    return { baseUrl, apiKey };
}

/**
 * Charge (cache 30 min) la liste des prix bœuf sans-abats par date, triée
 * croissant. Chaque date = moyenne pondérée Σ(sans_abats × kg) / Σ(kg) sur les
 * achats bœuf du jour. Renvoie [] si non configuré / erreur sans cache.
 */
async function _loadRows(bypassCache) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) return [];

    const now = Date.now();
    if (!bypassCache && _cache && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.rows;
    if (_inflight) return _inflight;

    const url = baseUrl + '/api/external/achats-boeuf';
    _inflight = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
                signal: controller.signal
            });
            if (!res.ok) {
                console.warn(`⚠️  DATA achats-boeuf HTTP ${res.status} (${url})`);
                return _cache ? _cache.rows : [];
            }
            const json = await res.json();
            const achats = (json && json.success === true && json.data && Array.isArray(json.data.achats))
                ? json.data.achats : [];

            // Agréger par date, bœuf uniquement, moyenne pondérée sans-abats.
            const byDate = new Map(); // date -> { sum, kg }
            for (const a of achats) {
                if (!a || !a.bete || String(a.bete).toLowerCase() !== 'boeuf') continue;
                const d = String(a.date || '');
                if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
                const kg = parseFloat(a.nbr_kg) || 0;
                const pxa = parseFloat(a.prix_achat_kg_sans_abats) || 0;
                if (kg <= 0 || pxa <= 0) continue;
                const cur = byDate.get(d) || { sum: 0, kg: 0 };
                cur.sum += pxa * kg;
                cur.kg += kg;
                byDate.set(d, cur);
            }
            const rows = Array.from(byDate.entries())
                .map(([date, v]) => ({ date, prix: v.kg > 0 ? v.sum / v.kg : 0 }))
                .filter(r => r.prix > 0)
                .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

            _cache = { rows, fetchedAt: Date.now() };
            return rows;
        } catch (e) {
            console.warn('⚠️  DATA achats-boeuf fetch échoué:', e.message);
            return _cache ? _cache.rows : [];
        } finally {
            clearTimeout(timeoutId);
            _inflight = null;
        }
    })();
    return _inflight;
}

/** Prix bœuf sans-abats le plus RÉCENT <= dateISO dans `rows` (triées asc). null si aucun. */
function _atDate(rows, dateISO) {
    if (!Array.isArray(rows) || !rows.length) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || ''))) return null;
    let best = null;
    for (const r of rows) {
        if (r.date <= dateISO) best = r.prix;
        else break; // triées croissant -> on peut s'arrêter
    }
    return best;
}

/**
 * Charge (cache) et renvoie un résolveur point-in-time.
 * @returns {Promise<{atDate: (dateISO:string)=>number|null, count:number}>}
 *   atDate(dateISO) -> prix bœuf sans-abats le plus récent <= date, ou null.
 *   Toujours sûr (null si indisponible -> l'appelant retombe sur le catalogue).
 */
async function getBoeufSansAbatsResolver(opts) {
    opts = opts || {};
    const rows = await _loadRows(!!opts.bypassCache);
    return {
        atDate: (dateISO) => _atDate(rows, dateISO),
        count: rows.length
    };
}

/** Raccourci: prix bœuf sans-abats pour une seule date (null si indisponible). */
async function getPrixBoeufSansAbatsAtDate(dateISO, opts) {
    const r = await getBoeufSansAbatsResolver(opts);
    return r.atDate(dateISO);
}

module.exports = {
    getBoeufSansAbatsResolver,
    getPrixBoeufSansAbatsAtDate,
    _internals: { _atDate }
};
