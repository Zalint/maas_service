/**
 * Prix d'achat BŒUF lu dynamiquement depuis le service DATA
 * (`GET /api/external/achats-boeuf`). Sert à rendre le prix achat fournisseur
 * du bœuf dynamique côté Maas (au lieu de la valeur saisie au catalogue Prix
 * fournisseur), quand la case « Prix API (DATA) » est cochée sur la ligne Bœuf.
 *
 * DEUX SOURCES POSSIBLES, choisies par le réglage admin
 * `boeuf_prix_api_source` (Administration > Paramètres) :
 *
 *   'maas' (DÉFAUT) -> data.parDateBoeufMaas[].prix_maas_kg
 *       Le prix réellement FACTURÉ au MaaS : le prix de revient du jour majoré
 *       de la commission, calculé par DATA sur le prix catalogue du bœuf en
 *       vigueur à cette date :
 *           prix_maas_kg = revient_exact + (taux/100) × prix_catalogue_boeuf
 *       LA COMMISSION EST DONC DÉJÀ DEDANS. C'est pour cela que la commission
 *       MaaS n'est plus facturée une seconde fois sur les livraisons de bœuf
 *       dont le prix vient de cette source (cf routes/finance-creances.js) :
 *       la compter deux fois gonflerait la dette fournisseur et le PL.
 *
 *   'revient' -> data.parDateBoeuf[].prix_revient_kg
 *       Le seul coût de revient, HORS commission :
 *           Σ(prix − abats + frais_abattage) / Σ(nbr_kg)
 *       C'est une MOYENNE PONDÉRÉE PAR LES KG, pas la moyenne des prix/kg des
 *       bêtes : une bête plus chère au kg mais plus légère doit peser moins.
 *       La commission MaaS de 3 % reste alors facturée normalement.
 *
 * AUCUN REPLI ENTRE LES DEUX : la source demandée est la seule consultée. Si
 * elle est absente ou vide (DATA plus ancien, catalogue ou commission pas
 * encore configurés côté DATA), on ne se rabat PAS en silence sur l'autre
 * champ — les deux ne veulent pas dire la même chose, et un prix hors
 * commission présenté comme un prix MaaS fausserait la marge sans que personne
 * ne le voie. On renvoie une liste vide AVEC un avertissement, et l'appelant
 * retombe sur le prix du catalogue en l'affichant à l'écran.
 *
 * Attention, valeurs voisines à ne pas confondre :
 *   - la carte « Moyenne » du module Achat Bœuf de DATA affiche la moyenne
 *     SIMPLE des prix/kg — ce n'est aucune des deux valeurs ci-dessus ;
 *   - `prix_achat_kg_sans_abats` (= prix / nbr_kg) ignore abats et frais ;
 *   - `data.totals.avgPrixKgBoeuf` correspond au prix SANS abats.
 *
 * Résolution POINT-IN-TIME : pour une date, on prend le jour d'achat le plus
 * récent <= date demandée.
 *
 * Config via env vars:
 *   - DATA_API_BASE_URL   URL de DATA (ex: http://localhost:3002 / mata-lgzy).
 *   - clé x-api-key = WEB_ORDERS_API_KEY, sinon DATA_API_KEY, sinon
 *     EXTERNAL_API_KEY. Doit égaler EXTERNAL_API_KEY de DATA (validateApiKey).
 *
 * Comportement:
 *   - Cache mémoire (TTL 30 min) PAR SOURCE + dédup des appels concurrents.
 *   - Dégradation gracieuse: liste vide + avertissement si non configuré ou
 *     DATA down (le code appelant retombe sur le prix catalogue).
 */

'use strict';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — les achats bœuf changent rarement
const REQUEST_TIMEOUT_MS = 8000;
const FAILURE_COOLDOWN_MS = 60 * 1000; // 1 min avant de retenter après un échec

const SOURCE_MAAS = 'maas';
const SOURCE_REVIENT = 'revient';
const SOURCE_DEFAUT = SOURCE_MAAS;

/** Normalise une valeur de reglage en source connue (defaut: maas). */
function normaliserSource(brut) {
    return String(brut || '').trim().toLowerCase() === SOURCE_REVIENT
        ? SOURCE_REVIENT
        : SOURCE_DEFAUT;
}

// Cache/dedup/cooldown PAR SOURCE: les deux sources ne rendent pas les memes
// prix, une entree partagee servirait des prix MaaS a qui demande du revient.
const _parSource = new Map(); // source -> { cache, inflight, retryAfter }

function _etat(source) {
    if (!_parSource.has(source)) {
        _parSource.set(source, { cache: null, inflight: null, retryAfter: 0 });
    }
    return _parSource.get(source);
}

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

/**
 * Une liste DATA (parDateBoeuf ou parDateBoeufMaas) -> la forme attendue par
 * _atDate ({date, prix, n}), triee croissant.
 *
 * `champPrix` designe la valeur a lire, et c'est tout ce qui distingue les
 * deux sources: la structure des deux tableaux est identique.
 *
 * L'arrondi au multiple de 5 superieur est reapplique ici plutot que de faire
 * confiance a DATA: c'est l'invariant historique du prix bœuf cote Maas, et il
 * doit tenir meme si DATA change un jour sa convention d'arrondi. Un arrondi
 * deja fait cote DATA est idempotent (4475 -> 4475), l'appliquer deux fois ne
 * coute rien.
 *
 * Une entree sans prix exploitable (null quand DATA n'a ni catalogue ni
 * commission pour cette date - il renvoie alors `motif`) est simplement
 * ecartee: la journee n'a pas de prix, elle ne doit pas en inventer un a 0.
 */
function _rowsDepuisListe(liste, champPrix) {
    return (liste || [])
        .map((r) => ({
            date: String((r && r.date) || ''),
            prix: _roundUp5(parseFloat(r && r[champPrix]) || 0),
            n: (r && r.nb_betes) || 0
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.prix > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Le champ DATA qui porte le prix, pour chaque source. */
const CHAMP_PAR_SOURCE = {
    [SOURCE_MAAS]: { liste: 'parDateBoeufMaas', prix: 'prix_maas_kg' },
    [SOURCE_REVIENT]: { liste: 'parDateBoeuf', prix: 'prix_revient_kg' }
};

/** L'avertissement montre a l'ecran quand la source demandee n'a rien donne. */
function _avertIndisponible(source, cause) {
    return `Prix d'achat du bœuf : ${cause} — le prix du catalogue Prix `
        + `fournisseur est utilisé à la place.`
        + (source === SOURCE_MAAS
            ? ' La commission MaaS reste donc facturée sur les livraisons de bœuf.'
            : '');
}

/**
 * Charge (cache 30 min, par source) les prix bœuf par date, tries croissant.
 *
 * Ne lit QUE le champ de la source demandee - aucun repli sur l'autre champ ni
 * sur un recalcul local: cf l'en-tete du module. Une indisponibilite se dit,
 * elle ne se rattrape pas en silence.
 *
 * @returns {Promise<{rows: Array, avertissements: string[]}>}
 */
async function _loadRows(bypassCache, source) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) {
        return { rows: [], avertissements: [_avertIndisponible(source, "l'API DATA n'est pas configurée")] };
    }

    const etat = _etat(source);
    const now = Date.now();
    if (!bypassCache && etat.cache && (now - etat.cache.fetchedAt) < CACHE_TTL_MS) {
        return { rows: etat.cache.rows, avertissements: etat.cache.avertissements };
    }
    // Cooldown apres echec: un echec ne rafraichit pas le cache, donc sans ce
    // garde-fou le TTL reste expire et CHAQUE calcul de creances relancerait un
    // appel — soit jusqu'a 8s d'attente par requete tant que DATA est down.
    // bypassCache (rafraichissement explicite) passe outre.
    if (!bypassCache && now < etat.retryAfter) {
        return etat.cache
            ? { rows: etat.cache.rows, avertissements: etat.cache.avertissements }
            : { rows: [], avertissements: [_avertIndisponible(source, 'API DATA injoignable')] };
    }
    if (etat.inflight) return etat.inflight;

    const champs = CHAMP_PAR_SOURCE[source];
    const url = baseUrl + '/api/external/achats-boeuf';
    etat.inflight = (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const echec = (cause) => {
            etat.retryAfter = Date.now() + FAILURE_COOLDOWN_MS;
            return etat.cache
                ? { rows: etat.cache.rows, avertissements: etat.cache.avertissements }
                : { rows: [], avertissements: [_avertIndisponible(source, cause)] };
        };
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { 'x-api-key': apiKey, 'Accept': 'application/json' },
                signal: controller.signal
            });
            if (!res.ok) {
                console.warn(`⚠️  DATA achats-boeuf HTTP ${res.status} (${url})`);
                return echec(`API DATA en erreur (HTTP ${res.status})`);
            }
            const json = await res.json();
            const liste = (json && json.success === true && json.data && Array.isArray(json.data[champs.liste]))
                ? json.data[champs.liste] : null;
            const rows = _rowsDepuisListe(liste, champs.prix);

            const avertissements = rows.length ? [] : [_avertIndisponible(
                source,
                liste
                    // Le champ existe mais ne porte aucun prix exploitable: cote
                    // DATA, prix_maas_kg est null tant que le prix catalogue du
                    // bœuf ou le taux de commission manquent a cette date.
                    ? `l'API DATA ne renvoie aucun prix exploitable dans « ${champs.liste} »`
                    : `l'API DATA ne renvoie pas « ${champs.liste} »`
            )];
            // Meme un resultat vide est mis en cache: sans cela, une source non
            // peuplee cote DATA relancerait un appel a chaque chargement.
            etat.cache = { rows, avertissements, fetchedAt: Date.now() };
            etat.retryAfter = 0; // succes -> on leve un eventuel cooldown
            return { rows, avertissements };
        } catch (e) {
            console.warn('⚠️  DATA achats-boeuf fetch échoué:', e.message);
            return echec(`API DATA injoignable (${e.message})`);
        } finally {
            clearTimeout(timeoutId);
            etat.inflight = null;
        }
    })();
    return etat.inflight;
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
 *
 * @param {{bypassCache?: boolean, source?: string}} [opts]
 *   source: 'maas' (defaut) ou 'revient' - cf l'en-tete du module.
 * @returns {Promise<{
 *   atDate: (dateISO:string)=>number|null,
 *   count: number,
 *   source: string,
 *   commissionIncluseAuPrix: (dateISO:string)=>boolean,
 *   avertissements: string[]
 * }>}
 *   atDate(dateISO) -> prix achat bœuf du jour d'achat le plus récent <= date,
 *   ou null. Toujours sûr (null si indisponible -> l'appelant retombe sur le
 *   catalogue).
 *
 *   commissionIncluseAuPrix(dateISO) -> true seulement si le prix rendu pour
 *   CETTE date vient bien de la source 'maas', qui porte deja la commission.
 *   La question est posee par date et non une fois pour toutes: DATA peut
 *   n'avoir de prix MaaS que sur une partie de la periode, et une journee
 *   valorisee au prix du CATALOGUE doit continuer de payer sa commission.
 */
async function getBoeufPrixAchatResolver(opts) {
    opts = opts || {};
    const source = normaliserSource(opts.source);
    const { rows, avertissements } = await _loadRows(!!opts.bypassCache, source);
    const atDate = (dateISO) => _atDate(rows, dateISO);
    return {
        atDate,
        count: rows.length,
        source,
        commissionIncluseAuPrix: (dateISO) =>
            source === SOURCE_MAAS && atDate(dateISO) != null,
        avertissements
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
    normaliserSource,
    SOURCE_MAAS,
    SOURCE_REVIENT,
    SOURCE_DEFAUT,
    _internals: { _atDate, _rowsDepuisListe, CHAMP_PAR_SOURCE }
};
