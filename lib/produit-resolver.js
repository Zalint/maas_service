/**
 * Résolveur de nom de produit (libellé vente -> entrée catalogue prix).
 *
 * Logique partagée entre :
 *   - routes/finance-creances.js#computeCreances (calcul des créances)
 *   - routes/finance.js#GET /alias (affichage du statut côté UI Mapping)
 *
 * Une seule source de vérité évite la divergence entre le statut affiché
 * et le calcul réel.
 *
 * Priorité de résolution :
 *   1. Match exact sur le nom dans le catalogue (fournisseur_prix)
 *   2. Alias explicite (produit_alias) -> resolve to catalog
 *   3. Fallback prefix (déprécié, conservé pour les ventes pas encore
 *      mappées manuellement)
 *   4. Unmapped : aucun match trouvé
 */

'use strict';

/**
 * @typedef {Object} ResolveResult
 * @property {'exact'|'alias'|'prefix'|'unmapped'} statut
 * @property {string|null} resolved - nom du catalogue résolu (casse d'origine), null si unmapped
 * @property {*} [value] - valeur associée dans le catalogue (ex: {prix_vente, prix_achat})
 * @property {number} coefficient - combien d'unités de l'entrée catalogue vaut
 *   UNE unité du libellé. 1 partout sauf alias explicite : une résolution
 *   exacte ou par préfixe désigne le même produit, donc la même unité.
 */

/** La cible d'un alias, que la Map porte une chaine ou un objet. */
function cibleDe(aliasMap, cle) {
    const v = aliasMap.get(cle);
    if (!v) return null;
    return typeof v === 'string' ? v : v.cible;
}

/**
 * Le coefficient d'un alias, 1 par defaut.
 *
 * Combien d'unites de l'entree catalogue vaut UNE unite du libelle. C'est une
 * CONVERSION D'UNITE, pas une imputation de cout: la carcasse est achetee une
 * seule fois, sous « Boeuf », et sa commission avec elle. Le Jarret vaut 0,5
 * parce qu'il se vend a la PIECE et qu'une piece pese environ 500 g.
 */
function coefDe(aliasMap, cle) {
    const v = aliasMap.get(cle);
    if (!v || typeof v === 'string') return 1;
    const c = parseFloat(v.coefficient);
    return Number.isFinite(c) && c > 0 ? c : 1;
}

/**
 * Résout un nom de produit vente vers une entrée catalogue.
 *
 * @param {string} produitNom - nom du produit tel que saisi en vente
 * @param {object} maps
 * @param {Map<string, *>} maps.catalogMap - clé = nom catalog en lowercase
 * @param {Map<string, string>} maps.catalogKeyToOriginal - clé = lowercase, valeur = casse d'origine
 * @param {Map<string, string|{cible: string, coefficient: number}>} maps.aliasMap
 * @returns {ResolveResult}
 */
function resolveProduit(produitNom, { catalogMap, catalogKeyToOriginal, aliasMap }) {
    const lower = (produitNom || '').toLowerCase();

    // 1. Match exact dans le catalogue
    if (catalogMap.has(lower)) {
        return {
            statut: 'exact',
            resolved: catalogKeyToOriginal.get(lower) || produitNom,
            value: catalogMap.get(lower),
            coefficient: 1
        };
    }

    // 2. Alias explicite
    const aliasCible = cibleDe(aliasMap, lower);
    if (aliasCible) {
        const aliasCibleLower = aliasCible.toLowerCase();
        if (catalogMap.has(aliasCibleLower)) {
            return {
                statut: 'alias',
                resolved: catalogKeyToOriginal.get(aliasCibleLower) || aliasCible,
                value: catalogMap.get(aliasCibleLower),
                // Le coefficient de CET alias. Absent - une ligne posee
                // avant la colonne - vaut 1: le comportement d'avant.
                coefficient: coefDe(aliasMap, lower)
            };
        }
    }

    // 3. Fallback prefix (deprecated). On itère sur les clés du catalogue
    //    par longueur DESCENDANTE pour qu'un préfixe plus spécifique
    //    ("Boeuf en gros") gagne sur un préfixe plus court ("Boeuf").
    //    Évite aussi le faux match "Boeufalo" -> "Boeuf" si "Boeufalo"
    //    existe comme produit catalogue.
    const keysByLengthDesc = Array.from(catalogMap.keys()).sort((a, b) => b.length - a.length);
    for (const key of keysByLengthDesc) {
        if (lower.startsWith(key)) {
            return {
                statut: 'prefix',
                resolved: catalogKeyToOriginal.get(key) || key,
                value: catalogMap.get(key),
                // Le prefixe ne dit RIEN de l'unite: « Boeuf en detail »
                // commence par « Boeuf » et se compte au kilo comme lui,
                // mais « Jarret » ne commence par rien. Un coefficient
                // autre que 1 exige donc un alias EXPLICITE - le prix a
                // payer pour ne pas deviner une conversion.
                coefficient: 1
            };
        }
    }

    // 4. Aucune résolution
    return { statut: 'unmapped', resolved: null, value: null, coefficient: 1 };
}

/**
 * Helper : construit les Maps attendues par resolveProduit() à partir
 * des rows Sequelize.
 *
 * @param {Array} catalogRows - FournisseurPrix.findAll()
 * @param {Array} aliasRows   - ProduitAlias.findAll()
 * @returns {{catalogMap: Map, catalogKeyToOriginal: Map, aliasMap: Map}}
 */
function buildResolverMaps(catalogRows, aliasRows) {
    const catalogMap = new Map();
    const catalogKeyToOriginal = new Map();
    for (const r of catalogRows) {
        const key = r.produit.toLowerCase();
        catalogMap.set(key, {
            prix_vente: parseFloat(r.prix_vente) || 0,
            prix_achat: r.prix_achat == null ? null : parseFloat(r.prix_achat),
            // prix_vente_cdc fallback sur prix_vente si non configure (cas
            // upgrade BDD avant la migration update-schema). Le calcul de
            // marge CDC utilise ce champ; il differe de prix_vente lorsque
            // le prix negocie avec le Centre de Decoupe est different.
            prix_vente_cdc: r.prix_vente_cdc == null
                ? (parseFloat(r.prix_vente) || 0)
                : parseFloat(r.prix_vente_cdc),
            // Produit achete hors circuit Mata: exclu de la commission
            // fournisseur, mais son prix d'achat valorise toujours le stock.
            hors_mata: r.hors_mata === true
        });
        catalogKeyToOriginal.set(key, r.produit);
    }
    // La Map porte la cible ET le coefficient. Une CHAINE reste acceptee en
    // lecture (cf cibleDe / coefDe): des appelants et des tests construisent
    // encore leur map a la main, et les casser tous pour ajouter un champ
    // optionnel serait un mauvais echange.
    const aliasMap = new Map();
    for (const a of aliasRows) {
        const c = parseFloat(a.coefficient);
        aliasMap.set(a.alias_produit.toLowerCase(), {
            cible: a.produit_catalog,
            coefficient: Number.isFinite(c) && c > 0 ? c : 1
        });
    }
    return { catalogMap, catalogKeyToOriginal, aliasMap };
}

module.exports = { resolveProduit, buildResolverMaps, cibleDe, coefDe };
