/**
 * Client HTTP pour appeler l'endpoint
 *   GET /external/api/creance?dateDebut=&dateFin=&label=
 * expose par mata-depenses-management (l'app MataBanq).
 *
 * Cet endpoint est la SOURCE DE VERITE pour:
 *   - le solde de la creance que Maas doit au fournisseur viande (CDB)
 *   - la liste des avances et remboursements deja enregistres
 *
 * Le calcul "indicateur" local Maas (commission 3% + marge Centre de
 * Decoupe) est complementaire mais ne remplace pas cette source.
 *
 * Configuration via env vars:
 *   - DEPENSES_API_BASE_URL  ex: https://mata-depenses-management.onrender.com
 *   - DEPENSES_API_KEY       token partage (header x-api-key)
 *
 * Le `label` ("Maas Mbao" / "Maas Keur Massar" / "Maas Sacre Coeur")
 * est derive du brand-config.json local: priorite au champ explicite
 * `finance_label`, sinon `Maas <nom_complet>`.
 *
 * Comportement:
 *   - Cache en memoire (TTL 60s) par cle {dateDebut, dateFin}.
 *   - Stale-while-revalidate: si l'API down, on sert l'ancien cache.
 *   - Echec gracieux: retourne null si pas configure ou erreur reseau
 *     sans cache. L'UI Finance affiche alors juste le bloc local.
 *   - Timeout 8s (Render free tier peut etre lent).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 60 * 1000;       // 60s — creances peuvent changer dans la journee
const MAX_CACHE_AGE_MS = 5 * 60 * 1000; // 5 min — au-dela on considere stale absolu, on evict
const MAX_CACHE_ENTRIES = 50;         // borne memoire (cle = label::dateDebut::dateFin, ~50 combos sains)
const REQUEST_TIMEOUT_MS = 8000;

// Map JS preserve l'ordre d'insertion -> on s'en sert pour la LRU
// (delete + set sur acces pour re-insertion en queue).
const _cache = new Map(); // key -> { data, fetchedAt }
const _inflight = new Map(); // key -> Promise

function cacheKey(dateDebut, dateFin, label) {
    return `${label}::${dateDebut || ''}::${dateFin || ''}`;
}

// Lit le cache en respectant la limite d'age absolue + met a jour
// l'ordre LRU (re-insertion en queue) si l'entree est valide.
// @returns {entry|null} entree fraiche (TTL ok) ou stale (TTL expire mais
//   age < MAX_CACHE_AGE_MS), ou null si absent ou trop vieille.
function readCacheLRU(key, now) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if ((now - entry.fetchedAt) > MAX_CACHE_AGE_MS) {
        _cache.delete(key); // expire absolument: drop
        return null;
    }
    // Touch LRU: re-insertion en queue
    _cache.delete(key);
    _cache.set(key, entry);
    return entry;
}

// Ecrit dans le cache + evicte le LRU si depasse MAX_CACHE_ENTRIES.
function writeCacheLRU(key, value) {
    _cache.set(key, value);
    while (_cache.size > MAX_CACHE_ENTRIES) {
        // Map.keys().next().value = la cle la plus ancienne (FIFO)
        const oldest = _cache.keys().next().value;
        if (oldest === undefined) break;
        _cache.delete(oldest);
    }
}

/**
 * Lit le label tenant depuis brand-config.json.
 * Priorite: brand.finance_label, sinon "Maas <brand.nom_complet>".
 * @returns {string | null}
 */
function readFinanceLabel() {
    try {
        const cfgPath = path.join(__dirname, '..', 'brand-config.json');
        if (!fs.existsSync(cfgPath)) return null;
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const first = Object.values(cfg)[0];
        if (!first) return null;
        if (first.finance_label && typeof first.finance_label === 'string') {
            return first.finance_label.trim();
        }
        if (first.nom_complet) return `Maas ${first.nom_complet}`;
        return null;
    } catch (e) {
        console.warn('⚠️  readFinanceLabel: lecture brand-config echouee:', e.message);
        return null;
    }
}

/**
 * Appelle l'API depenses externe pour recuperer la creance CDB.
 *
 * @param {object} [opts]
 * @param {string} [opts.dateDebut]  format DD-MM-YYYY ou YYYY-MM-DD
 * @param {string} [opts.dateFin]    idem
 * @param {boolean} [opts.bypassCache=false]
 * @returns {Promise<object | null>}  payload MataBanq, ou null si non
 *   configure / erreur reseau sans cache disponible.
 */
async function fetchCreanceCdb(opts) {
    opts = opts || {};
    const baseUrl = (process.env.DEPENSES_API_BASE_URL || '').trim();
    const apiKey = (process.env.DEPENSES_API_KEY || '').trim();

    if (!baseUrl || !apiKey) {
        // Feature desactivee silencieusement (env non configure).
        return null;
    }

    const label = readFinanceLabel();
    if (!label) {
        console.warn('⚠️  fetchCreanceCdb: brand-config.json sans finance_label / nom_complet');
        return null;
    }

    const key = cacheKey(opts.dateDebut, opts.dateFin, label);

    // Cache hit ? Lecture LRU: re-classe l'entree en queue et drop si age > MAX_CACHE_AGE_MS.
    const now = Date.now();
    if (!opts.bypassCache) {
        const cached = readCacheLRU(key, now);
        if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
            return cached.data;
        }
    }

    // Dedup concurrent fetches.
    if (_inflight.has(key)) {
        return _inflight.get(key);
    }

    const qs = new URLSearchParams();
    if (opts.dateDebut) qs.set('dateDebut', opts.dateDebut);
    if (opts.dateFin) qs.set('dateFin', opts.dateFin);
    qs.set('label', label);

    const url = baseUrl.replace(/\/+$/, '') + '/external/api/creance?' + qs.toString();

    const promise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });

            if (!res.ok) {
                console.warn(`⚠️  depenses creance HTTP ${res.status} (${url})`);
                const stale = _cache.get(key);
                return stale ? stale.data : null;
            }

            const json = await res.json();
            // L'API MataBanq retourne directement la structure (pas de wrapper
            // {success, data}), donc on stocke tel quel.
            if (!json || typeof json !== 'object') {
                console.warn('⚠️  depenses creance reponse invalide');
                const stale = _cache.get(key);
                return stale ? stale.data : null;
            }

            // fetchedAt au WRITE time (cf rationale data-tracabilite-client.js).
            // writeCacheLRU evicte la cle la plus ancienne si > MAX_CACHE_ENTRIES.
            writeCacheLRU(key, { data: json, fetchedAt: Date.now() });
            return json;
        } catch (err) {
            console.warn('⚠️  depenses creance fetch echoue:', err.message);
            const stale = _cache.get(key);
            return stale ? stale.data : null;
        } finally {
            clearTimeout(timeoutId);
            _inflight.delete(key);
        }
    })();

    _inflight.set(key, promise);
    return promise;
}

/** Reset cache (test only / admin). */
function clearCache() {
    _cache.clear();
    _inflight.clear();
}

module.exports = {
    fetchCreanceCdb,
    readFinanceLabel,
    clearCache,
    CACHE_TTL_MS,
    MAX_CACHE_AGE_MS,
    MAX_CACHE_ENTRIES,
    REQUEST_TIMEOUT_MS,
    // Exposes internes pour tests unitaires (cache LRU)
    _internals: { readCacheLRU, writeCacheLRU, _cache }
};
