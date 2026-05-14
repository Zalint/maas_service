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
 */

/**
 * Résout un nom de produit vente vers une entrée catalogue.
 *
 * @param {string} produitNom - nom du produit tel que saisi en vente
 * @param {object} maps
 * @param {Map<string, *>} maps.catalogMap - clé = nom catalog en lowercase, valeur = donnée arbitraire
 * @param {Map<string, string>} maps.catalogKeyToOriginal - clé = lowercase, valeur = nom original casse préservée
 * @param {Map<string, string>} maps.aliasMap - clé = alias en lowercase, valeur = produit_catalog (casse d'origine)
 * @returns {ResolveResult}
 */
function resolveProduit(produitNom, { catalogMap, catalogKeyToOriginal, aliasMap }) {
    const lower = (produitNom || '').toLowerCase();

    // 1. Match exact dans le catalogue
    if (catalogMap.has(lower)) {
        return {
            statut: 'exact',
            resolved: catalogKeyToOriginal.get(lower) || produitNom,
            value: catalogMap.get(lower)
        };
    }

    // 2. Alias explicite
    const aliasCible = aliasMap.get(lower);
    if (aliasCible) {
        const aliasCibleLower = aliasCible.toLowerCase();
        if (catalogMap.has(aliasCibleLower)) {
            return {
                statut: 'alias',
                resolved: catalogKeyToOriginal.get(aliasCibleLower) || aliasCible,
                value: catalogMap.get(aliasCibleLower)
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
                value: catalogMap.get(key)
            };
        }
    }

    // 4. Aucune résolution
    return { statut: 'unmapped', resolved: null, value: null };
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
                : parseFloat(r.prix_vente_cdc)
        });
        catalogKeyToOriginal.set(key, r.produit);
    }
    const aliasMap = new Map();
    for (const a of aliasRows) {
        aliasMap.set(a.alias_produit.toLowerCase(), a.produit_catalog);
    }
    return { catalogMap, catalogKeyToOriginal, aliasMap };
}

module.exports = { resolveProduit, buildResolverMaps };
