/**
 * Prix de VENTE fournisseur lus dynamiquement depuis le service DATA
 * (`GET /api/external/prix-vente-maas`). Sert a verrouiller, cote ecran
 * Prix fournisseur, la cellule Prix vente de tout produit que DATA connait -
 * sans reglage admin: c'est la presence du produit dans la reponse de DATA
 * qui decide, pas une case a cocher persistee (contrairement au prix ACHAT
 * du bœuf, cf lib/achats-boeuf-client.js).
 *
 * Config via env vars (memes que le client bœuf - meme service DATA):
 *   - DATA_API_BASE_URL   URL de DATA (ex: http://localhost:3007).
 *   - clé x-api-key = WEB_ORDERS_API_KEY, sinon DATA_API_KEY, sinon
 *     EXTERNAL_API_KEY.
 *
 * Comportement:
 *   - Cache memoire (TTL 10 min - plus court que les 30 min du bœuf: un prix
 *     de vente peut etre ajuste en cours de journee, contrairement aux
 *     achats), PAR DATE demandee (l'ecran "Voir les prix a une date" peut
 *     interroger plusieurs dates dans une meme session). Borne a
 *     MAX_DATES_CACHE entrees, purge FIFO - un admin qui scrute un an
 *     d'historique ne doit pas faire grossir le cache sans limite.
 *   - Dedup des appels concurrents PAR DATE.
 *   - Degradation gracieuse: renvoie { disponible: false, parNom: Map vide }
 *     si non configure ou DATA down (l'ecran laisse alors la cellule
 *     editable avec la valeur stockee).
 */

'use strict';

const { normaliserNom } = require('./parage');

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const REQUEST_TIMEOUT_MS = 8000;
const FAILURE_COOLDOWN_MS = 60 * 1000;
const MAX_DATES_CACHE = 30;

const _cacheParDate = new Map(); // dateISO -> { parNom, fetchedAt }
const _inflightParDate = new Map(); // dateISO -> Promise
const _retryAfterParDate = new Map(); // dateISO -> timestamp

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

/** {nom, prix} bruts -> Map<normaliserNom(nom), prix>, entrees invalides ecartees. */
function _parNomDepuisCatalogue(catalogue) {
    const parNom = new Map();
    for (const p of catalogue || []) {
        if (!p) continue;
        const cle = normaliserNom(p.nom);
        const prix = parseFloat(p.prix);
        if (!cle || !Number.isFinite(prix) || prix <= 0) continue;
        parNom.set(cle, prix);
    }
    return parNom;
}

/**
 * Charge (cache 10 min, par date) le catalogue prix-vente-maas de DATA.
 * @param {string} dateISO 'AAAA-MM-JJ'
 * @returns {Promise<{disponible: boolean, parNom: Map<string, number>}>}
 */
async function getPrixVenteMaasParNom(dateISO) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) return { disponible: false, parNom: new Map() };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || ''))) return { disponible: false, parNom: new Map() };

    const now = Date.now();
    const cached = _cacheParDate.get(dateISO);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
        return { disponible: true, parNom: cached.parNom };
    }
    // Cooldown apres echec, meme raison que le client bœuf: sans lui, un
    // DATA indisponible ferait attendre REQUEST_TIMEOUT_MS a CHAQUE
    // chargement de l'ecran tant qu'il reste down.
    const retryAfter = _retryAfterParDate.get(dateISO) || 0;
    if (now < retryAfter) return { disponible: !!cached, parNom: cached ? cached.parNom : new Map() };
    if (_inflightParDate.has(dateISO)) return _inflightParDate.get(dateISO);

    const dateCompacte = dateISO.replace(/-/g, ''); // DATA attend AAAAMMJJ, sans tirets
    const url = baseUrl + '/api/external/prix-vente-maas?date=' + encodeURIComponent(dateCompacte);
    const promise = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
                signal: controller.signal
            });
            if (!res.ok) {
                console.warn(`⚠️  DATA prix-vente-maas HTTP ${res.status} (${url})`);
                _retryAfterParDate.set(dateISO, Date.now() + FAILURE_COOLDOWN_MS);
                return { disponible: !!cached, parNom: cached ? cached.parNom : new Map() };
            }
            const json = await res.json();
            const catalogue = (json && json.success === true && Array.isArray(json.catalogue))
                ? json.catalogue : [];
            const parNom = _parNomDepuisCatalogue(catalogue);

            if (_cacheParDate.size >= MAX_DATES_CACHE && !_cacheParDate.has(dateISO)) {
                _cacheParDate.delete(_cacheParDate.keys().next().value);
            }
            _cacheParDate.set(dateISO, { parNom, fetchedAt: Date.now() });
            _retryAfterParDate.delete(dateISO);
            return { disponible: true, parNom };
        } catch (e) {
            console.warn('⚠️  DATA prix-vente-maas fetch échoué:', e.message);
            _retryAfterParDate.set(dateISO, Date.now() + FAILURE_COOLDOWN_MS);
            return { disponible: !!cached, parNom: cached ? cached.parNom : new Map() };
        } finally {
            clearTimeout(timeoutId);
            _inflightParDate.delete(dateISO);
        }
    })();
    _inflightParDate.set(dateISO, promise);
    return promise;
}

module.exports = {
    getPrixVenteMaasParNom,
    _internals: { _parNomDepuisCatalogue }
};
