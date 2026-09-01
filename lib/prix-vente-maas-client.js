/**
 * Prix de VENTE fournisseur lus dynamiquement depuis le service DATA
 * (`GET /api/external/prix-vente-maas`). Sert a verrouiller, cote ecran
 * Prix fournisseur, la cellule Prix vente de tout produit que DATA connait -
 * sans reglage admin: c'est la presence du produit dans la reponse de DATA
 * qui decide, pas une case a cocher persistee (contrairement au prix ACHAT
 * du bœuf, cf lib/achats-boeuf-client.js).
 *
 * ON LIT LE CHAMP `prixMaas`, PAS `prix`. DATA rend les deux:
 *   prix     = le prix catalogue nu, HORS commission ;
 *   prixMaas = ce que le fournisseur FACTURE reellement, commission comprise
 *              (prix x (1 + taux/100), arrondi une fois au multiple de 5 sup).
 * C'est prixMaas qui a un sens dans la colonne « Prix vente fournisseur »:
 * afficher `prix` sous-estimerait la facture du montant de la commission.
 *
 * COROLLAIRE, et c'est le point a ne pas perdre de vue: le prix affiche ici
 * PORTE DEJA la commission. La refacturer par-dessus la compterait deux fois
 * - c'est precisement ce que regle « commission integree »
 * (cf lib/commission-integree.js), coche par defaut pour tous les produits.
 *
 * Cas particulier assume cote DATA: pour le BŒUF, prixMaas vaut `prix` tel
 * quel, parce que son prix facture ne se derive pas du catalogue mais du prix
 * de revient de l'achat du jour (parDateBoeufMaas de /api/external/achats-boeuf,
 * cf lib/achats-boeuf-client.js). DATA refuse deliberement de produire ici un
 * second chiffre concurrent pour le meme produit.
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

/**
 * Le catalogue DATA -> Map<normaliserNom(nom), prix facture>.
 *
 * ON LIT `prixMaas`, PAS `prix`: c'est le prix reellement FACTURE au MaaS,
 * c'est-a-dire le prix catalogue deja majore de la commission (et arrondi une
 * seule fois au multiple de 5 superieur). `prix` est le prix catalogue nu,
 * hors commission - l'afficher dans la colonne Prix vente fournisseur
 * sous-estimerait ce que le fournisseur facture.
 *
 * Cas particulier assume par DATA (cf routes/prix-vente-maas.js de DATA):
 * pour le BŒUF, prixMaas vaut prix tel quel - son prix facture ne se calcule
 * pas depuis le catalogue mais depuis le prix de revient de l'achat, et vit
 * dans parDateBoeufMaas de /api/external/achats-boeuf (cf
 * lib/achats-boeuf-client.js). Rien de special a faire ici: on prend ce que
 * DATA donne, c'est lui qui arbitre.
 *
 * Une entree dont le prix n'est pas exploitable est ECARTEE plutot que repliee
 * sur `prix`: un prix hors commission presente comme un prix facture fausserait
 * la marge en silence. Le produit reste alors modifiable a la main, avec sa
 * valeur stockee - et `sansPrixMaas` compte ces cas pour que l'appelant puisse
 * le signaler a l'ecran.
 *
 * `commissionParNom` porte le booleen `commissionAppliquee` que DATA rend pour
 * chaque ligne: il dit AVEC AUTORITE si la majoration a reellement eu lieu,
 * plutot que de le deduire en comparant prix et prixMaas (deux valeurs egales
 * ne disent pas si le taux etait nul ou absent). C'est lui qui decide si la
 * commission doit encore etre facturee - cf lib/commission-integree.js.
 *
 * @returns {{parNom: Map<string, number>, commissionParNom: Map<string, boolean>, sansPrixMaas: number}}
 */
/**
 * La date a partir de laquelle prixMaas d'une ligne est valable, ou null si
 * DATA ne la donne pas. La PLUS TARDIVE des deux composantes: une valeur
 * derivee ne vaut qu'a partir du moment ou ses deux ingredients existent.
 */
function _depuisEffective(ligne) {
    const dates = [ligne.depuisAchat, ligne.depuis]
        .map((d) => String(d || ''))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!dates.length) return null;
    // Comparaison lexicographique: sur des ISO AAAA-MM-JJ elle vaut l'ordre
    // chronologique, sans passer par Date ni par un fuseau.
    return dates.reduce((a, b) => (a > b ? a : b));
}

function _parNomDepuisCatalogue(catalogue) {
    const parNom = new Map();
    const commissionParNom = new Map();
    // La date a partir de laquelle prixMaas s'applique. Le catalogue est un
    // INSTANTANE a une date: sans elle, rien ne dit si le prix rendu valait
    // deja pour les journees anterieures de la periode, et une valorisation
    // pourrait appliquer au 3 du mois un tarif entre en vigueur le 28.
    //
    // C'est la PLUS TARDIVE des deux dates d'entree en vigueur, parce que
    // prixMaas se derive de DEUX valeurs datees separement:
    //     prixMaas = prixAchat (depuisAchat) + taux% x prix (depuis)
    // Ne retenir que depuisAchat laisserait passer le cas reel de l'Agneau -
    // prixAchat 4500 depuis le 01/08, prix 5500 depuis le 01/09, prixMaas 4665
    // - et valoriserait tout le mois d'aout avec la commission de septembre.
    //
    // Une entree vaut explicitement `null` quand AUCUNE des deux dates n'est
    // exploitable (version de DATA anterieure a ces champs). null n'est pas
    // undefined: undefined dit « ce produit n'est pas au catalogue », null dit
    // « il y est mais on ignore depuis quand », et l'appelant doit refuser le
    // prix dans ce second cas plutot que de l'appliquer a l'aveugle.
    const depuisParNom = new Map();
    let sansPrixMaas = 0;
    for (const p of catalogue || []) {
        if (!p) continue;
        const cle = normaliserNom(p.nom);
        if (!cle) continue;
        const prixMaas = parseFloat(p.prixMaas);
        if (!Number.isFinite(prixMaas) || prixMaas <= 0) {
            // Un DATA plus ancien, qui n'expose pas encore prixMaas, a bien un
            // `prix`: c'est ce cas-la qu'on veut distinguer d'un produit
            // simplement pas encore tarife (ni l'un ni l'autre).
            if (Number.isFinite(parseFloat(p.prix))) sansPrixMaas += 1;
            continue;
        }
        parNom.set(cle, prixMaas);
        depuisParNom.set(cle, _depuisEffective(p));
        // === strictement: un DATA qui n'expose pas le champ laisse undefined,
        // et « je ne sais pas » ne doit pas passer pour « oui » - sinon une
        // commission bien due serait annulee en silence.
        commissionParNom.set(cle, p.commissionAppliquee === true);
    }
    return { parNom, commissionParNom, depuisParNom, sansPrixMaas };
}

/**
 * Charge (cache 10 min, par date) le catalogue prix-vente-maas de DATA.
 * @param {string} dateISO 'AAAA-MM-JJ'
 * @returns {Promise<{disponible: boolean, parNom: Map<string, number>}>}
 */
async function getPrixVenteMaasParNom(dateISO) {
    const { baseUrl, apiKey } = getConfig();
    if (!baseUrl || !apiKey) return { disponible: false, parNom: new Map(), commissionParNom: new Map(), depuisParNom: new Map() };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || ''))) return { disponible: false, parNom: new Map(), commissionParNom: new Map(), depuisParNom: new Map() };

    const now = Date.now();
    const cached = _cacheParDate.get(dateISO);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
        return { disponible: true, parNom: cached.parNom,
            commissionParNom: cached.commissionParNom, depuisParNom: cached.depuisParNom };
    }
    // Cooldown apres echec, meme raison que le client bœuf: sans lui, un
    // DATA indisponible ferait attendre REQUEST_TIMEOUT_MS a CHAQUE
    // chargement de l'ecran tant qu'il reste down.
    const retryAfter = _retryAfterParDate.get(dateISO) || 0;
    if (now < retryAfter) return { disponible: !!cached, parNom: cached ? cached.parNom : new Map(),
                commissionParNom: cached ? cached.commissionParNom : new Map(),
                depuisParNom: cached ? cached.depuisParNom : new Map() };
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
                return { disponible: !!cached, parNom: cached ? cached.parNom : new Map(),
                commissionParNom: cached ? cached.commissionParNom : new Map(),
                depuisParNom: cached ? cached.depuisParNom : new Map() };
            }
            const json = await res.json();
            const catalogue = (json && json.success === true && Array.isArray(json.catalogue))
                ? json.catalogue : [];
            const { parNom, commissionParNom, depuisParNom, sansPrixMaas } = _parNomDepuisCatalogue(catalogue);
            // Des produits tarifes mais sans prixMaas = un DATA anterieur a ce
            // champ. On ne se replie pas sur `prix` (hors commission), on le
            // DIT: ces lignes restent modifiables a la main, et l'ecran doit
            // pouvoir expliquer pourquoi elles ne sont pas verrouillees.
            if (sansPrixMaas > 0) {
                console.warn(`⚠️  DATA prix-vente-maas: ${sansPrixMaas} produit(s) sans prixMaas `
                    + '(version de DATA anterieure au prix facture) — ces lignes restent manuelles.');
            }

            if (_cacheParDate.size >= MAX_DATES_CACHE && !_cacheParDate.has(dateISO)) {
                _cacheParDate.delete(_cacheParDate.keys().next().value);
            }
            _cacheParDate.set(dateISO, { parNom, commissionParNom, depuisParNom, sansPrixMaas, fetchedAt: Date.now() });
            _retryAfterParDate.delete(dateISO);
            return { disponible: true, parNom, commissionParNom, depuisParNom, sansPrixMaas };
        } catch (e) {
            console.warn('⚠️  DATA prix-vente-maas fetch échoué:', e.message);
            _retryAfterParDate.set(dateISO, Date.now() + FAILURE_COOLDOWN_MS);
            return { disponible: !!cached, parNom: cached ? cached.parNom : new Map(),
                commissionParNom: cached ? cached.commissionParNom : new Map(),
                depuisParNom: cached ? cached.depuisParNom : new Map() };
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
