/**
 * Prix d'achat BŒUF « avec abats et frais » lu dynamiquement depuis le service
 * DATA (`GET /api/external/achats-boeuf`). Sert à rendre le prix achat
 * fournisseur du bœuf dynamique côté Maas (au lieu de la valeur saisie au
 * catalogue Prix fournisseur).
 *
 * FORMULE — prix de revient réel du lot du jour, « avec abats et frais » :
 *
 *     prix/kg = Σ(prix − abats + frais_abattage) / Σ(nbr_kg)
 *               = coût total du lot / poids total du lot
 *     puis ARRONDI PAR EXCÈS au multiple de 5 F supérieur (4430.12 -> 4435).
 *
 * C'est une MOYENNE PONDÉRÉE PAR LES KG, et non la moyenne des prix/kg des
 * bêtes : une bête plus chère au kg mais plus légère doit peser moins dans le
 * prix de revient.
 *   Ex. 2026-07-24, 6 bêtes : 5 × (637000 − 35000 + 10000, 140 kg) et
 *   1 × (637000 − 30000 + 10000, 130 kg) -> 3 677 000 / 830 = 4430.12,
 *   arrondi à 4435 F/kg.
 *   La moyenne SIMPLE des 6 prix/kg donnerait 4433.88 (écart 3.76 F/kg).
 *
 * Attention, deux valeurs voisines à ne pas confondre :
 *   - la carte « Moyenne » du module Achat Bœuf de DATA affiche la moyenne
 *     SIMPLE (4433.88 sur cet exemple) — ce n'est pas ce qu'on calcule ici ;
 *   - `prix_achat_kg_sans_abats` (= prix / nbr_kg) ignore abats et frais ;
 *   - `data.totals.avgPrixKgBoeuf` renvoyé par l'API correspond au prix SANS
 *     abats, il n'est donc pas utilisé non plus.
 *
 * Résolution POINT-IN-TIME : pour une date, on prend la moyenne du jour d'achat
 * le plus récent <= date demandée.
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
const FAILURE_COOLDOWN_MS = 60 * 1000; // 1 min avant de retenter après un échec

let _cache = null;    // { rows: [{date, prix, n}], fetchedAt }
let _inflight = null; // Promise en cours (dédup)
let _retryAfter = 0;  // timestamp: pas de nouvel appel avant (cf cooldown)

/**
 * Arrondi PAR EXCÈS au multiple de 5 F supérieur: 4430.12 -> 4435.
 * Un montant déjà multiple de 5 reste inchangé (4430.00 -> 4430); l'epsilon
 * évite qu'une imprécision flottante (4435.0000000001) ne saute à 4440.
 */
function _roundUp5(n) {
    return Math.ceil((n / 5) - 1e-9) * 5;
}

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

/** DATA a deja fait le calcul (prix_revient_kg, deja pondere) - on ne fait
 *  que reformer la forme attendue par _atDate ({date, prix, n}). L'arrondi
 *  au multiple de 5 superieur est reapplique ici (au lieu de faire confiance
 *  a DATA) pour garder la MEME invariant que le repli _rowsDepuisAchatsBruts,
 *  meme si DATA change un jour sa convention d'arrondi. */
function _rowsDepuisParDate(parDateBoeuf) {
    return parDateBoeuf
        .map((r) => ({
            date: String((r && r.date) || ''),
            prix: _roundUp5(parseFloat(r && r.prix_revient_kg) || 0),
            n: (r && r.nb_betes) || 0
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.prix > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Repli: agrege nous-memes depuis les achats bruts, pour un DATA qui
 * n'exposerait pas encore data.parDateBoeuf. Bœuf uniquement, coût total /
 * poids total par date (moyenne pondérée par les kg) - la MEME formule que
 * DATA applique desormais de son cote (cf server.js DATA, endpoint
 * /api/external/achats-boeuf), reproduite ici pour ne pas dependre d'un
 * DATA a jour.
 *
 * Le coût est recalculé depuis prix/abats/frais_abattage (definition du prix
 * de revient). Une bete sans poids ou sans cout exploitable est ignoree:
 * l'API renvoie `parseFloat(x) || 0`, donc une valeur manquante arrive en 0
 * et fausserait le prix de revient du lot.
 */
function _rowsDepuisAchatsBruts(achats) {
    const byDate = new Map(); // date -> { cost, kg, n }
    for (const a of achats) {
        if (!a || !a.bete || String(a.bete).toLowerCase() !== 'boeuf') continue;
        const d = String(a.date || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const kg = parseFloat(a.nbr_kg);
        // Le prix d'achat doit etre renseigne: une bete pas encore
        // valorisee arrive avec prix=0 mais peut porter des frais
        // d'abattage, d'ou un cost > 0 qui passerait le garde-fou
        // ci-dessous et ferait BAISSER le prix de revient du lot.
        const prix = parseFloat(a.prix);
        if (!isFinite(prix) || prix <= 0) continue;
        const cost = prix
            - (parseFloat(a.abats) || 0)
            + (parseFloat(a.frais_abattage) || 0);
        if (!isFinite(kg) || kg <= 0 || !isFinite(cost) || cost <= 0) continue;
        const cur = byDate.get(d) || { cost: 0, kg: 0, n: 0 };
        cur.cost += cost;
        cur.kg += kg;
        cur.n += 1;
        byDate.set(d, cur);
    }
    return Array.from(byDate.entries())
        .map(([date, v]) => ({ date, prix: _roundUp5(v.cost / v.kg), n: v.n }))
        .filter((r) => r.prix > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Charge (cache 30 min) la liste des prix bœuf par date, triée croissant.
 * Prefere data.parDateBoeuf (calcule cote DATA); repli sur un calcul local
 * depuis data.achats si DATA ne l'expose pas encore.
 * Renvoie [] si non configuré / erreur sans cache.
 */
async function _loadRows(bypassCache) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) return [];

    const now = Date.now();
    if (!bypassCache && _cache && (now - _cache.fetchedAt) < CACHE_TTL_MS) return _cache.rows;
    // Cooldown apres echec: un echec ne rafraichit pas _cache, donc sans ce
    // garde-fou le TTL reste expire et CHAQUE calcul de creances relancerait un
    // appel — soit jusqu'a 8s d'attente par requete tant que DATA est down.
    // bypassCache (rafraichissement explicite) passe outre.
    if (!bypassCache && now < _retryAfter) return _cache ? _cache.rows : [];
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
                _retryAfter = Date.now() + FAILURE_COOLDOWN_MS;
                return _cache ? _cache.rows : [];
            }
            const json = await res.json();
            // DATA calcule desormais lui-meme le prix de revient pondere par
            // date (data.parDateBoeuf) - meme formule que celle qu'on
            // refaisait ici, donc plus besoin de la reproduire quand ce
            // champ est present ET NON VIDE. Un tableau vide (DATA n'a pas
            // encore de donnees pour la fenetre demandee, ou un deploiement
            // partiel qui renvoie le champ sans le peupler) ne doit PAS
            // etre traite comme "pas de prix bœuf": on retombe alors sur
            // l'agregation manuelle depuis les achats bruts, qui elle a de
            // bonnes chances d'avoir des donnees exploitables.
            const parDateBoeuf = (json && json.success === true && json.data && Array.isArray(json.data.parDateBoeuf))
                ? json.data.parDateBoeuf : null;
            const achats = (json && json.success === true && json.data && Array.isArray(json.data.achats))
                ? json.data.achats : [];
            const rows = (parDateBoeuf && parDateBoeuf.length > 0)
                ? _rowsDepuisParDate(parDateBoeuf)
                : _rowsDepuisAchatsBruts(achats);

            _cache = { rows, fetchedAt: Date.now() };
            _retryAfter = 0; // succes -> on leve un eventuel cooldown
            return rows;
        } catch (e) {
            console.warn('⚠️  DATA achats-boeuf fetch échoué:', e.message);
            _retryAfter = Date.now() + FAILURE_COOLDOWN_MS;
            return _cache ? _cache.rows : [];
        } finally {
            clearTimeout(timeoutId);
            _inflight = null;
        }
    })();
    return _inflight;
}

/** Prix bœuf du jour d'achat le plus RÉCENT <= dateISO dans `rows` (triées asc). null si aucun. */
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
 *   atDate(dateISO) -> prix achat bœuf (avec abats et frais) du jour d'achat le
 *   plus récent <= date, ou null.
 *   Toujours sûr (null si indisponible -> l'appelant retombe sur le catalogue).
 */
async function getBoeufPrixAchatResolver(opts) {
    opts = opts || {};
    const rows = await _loadRows(!!opts.bypassCache);
    return {
        atDate: (dateISO) => _atDate(rows, dateISO),
        count: rows.length
    };
}

/** Raccourci: prix achat bœuf pour une seule date (null si indisponible). */
async function getPrixBoeufAchatAtDate(dateISO, opts) {
    const r = await getBoeufPrixAchatResolver(opts);
    return r.atDate(dateISO);
}

module.exports = {
    getBoeufPrixAchatResolver,
    getPrixBoeufAchatAtDate,
    _internals: { _atDate, _rowsDepuisParDate, _rowsDepuisAchatsBruts }
};
