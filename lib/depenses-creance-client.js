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

const CACHE_TTL_MS = 60 * 1000; // 60s — creances peuvent changer dans la journee
const REQUEST_TIMEOUT_MS = 8000;

const _cache = new Map(); // key -> { data, fetchedAt }
const _inflight = new Map(); // key -> Promise

function cacheKey(dateDebut, dateFin, label) {
    return `${label}::${dateDebut || ''}::${dateFin || ''}`;
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

    // Cache hit ?
    const now = Date.now();
    if (!opts.bypassCache) {
        const cached = _cache.get(key);
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
            _cache.set(key, { data: json, fetchedAt: Date.now() });
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
    REQUEST_TIMEOUT_MS
};
