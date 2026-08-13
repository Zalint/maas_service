'use strict';

/**
 * Estimation du stock du soir tant qu'il n'a pas ete compte.
 *
 * Le PL a besoin d'un stock de fin de periode. Quand personne n'a encore
 * compte le soir de la date demandee, il repliait EN SILENCE sur le dernier
 * comptage - parfois vieux de plusieurs jours - en comparant donc deux
 * instants non adjacents, sans le dire. On estime desormais, et on le dit.
 *
 * FORMULE (inversion exacte de l'identite du parage):
 *   parage:   theorique = matin + transferts - soir  et  ratio = vendu / theorique
 *   donc:     soir = matin + transferts - vendu / ratio
 * ou `ratio` est le rendement MESURE du mois pour la categorie (lib/parage-mois).
 * Ecrit autrement: on retranche non pas les kilos vendus, mais les kilos qu'il
 * a fallu SORTIR du stock pour les vendre - parage compris.
 *
 * PERIMETRE, tel que decide par le proprietaire du produit:
 *   - famille Boucherie AVEC categorie de parage (bovin / ovin): division par
 *     le ratio mesure du mois;
 *   - tout le reste (epicerie, volaille, produits exclus, famille dechet):
 *     pas de parage du tout, soit soir = ancre + transferts - ventes.
 *
 * GRANULARITE. Le parage se calcule par CATEGORIE, jamais par produit, et ce
 * n'est pas un detail d'implementation: le stock est tenu sous "Boeuf" alors
 * que les ventes sortent sous "Boeuf en detail", "Boeuf en gros", "Yell",
 * "Jarret" - des produits qui n'ont aucune ligne de stock. Une estimation
 * produit par produit ne decrementerait donc jamais la carcasse et fabriquerait
 * autant de lignes negatives fantomes. On estime la categorie, puis on la
 * repartit sur les produits du dernier comptage au prorata: la valorisation au
 * prix d'achat et le detail par produit continuent alors de fonctionner.
 *
 * Ce module ne touche ni la base ni le reseau: l'appelant fournit les lignes.
 * Rien de ce qu'il produit n'est destine a etre ECRIT dans la table stocks -
 * une ligne derivee y serait reprise le lendemain matin par le cron de copie,
 * qui la marquerait comme comptee.
 */

const { compositionDuPack, quantiteEnKg, normaliserNom, SEUIL_KG } = require('./parage');

/**
 * Somme signee des transferts d'un jeu de lignes.
 *
 * @param {Array} transferts
 * @param {boolean} [compterJete] Le jete est la pesee d'un dechet mis a la
 *   poubelle. Pour la VIANDE ce n'est pas un mouvement de marchandise et le
 *   compter fabriquerait du stock; pour le stock DECHET lui-meme, c'en est au
 *   contraire une sortie bien reelle.
 */
function mouvementTransferts(transferts, compterJete) {
    let total = 0;
    for (const t of transferts || []) {
        const jete = !!(t && t.extension && t.extension.dechet_jete);
        if (jete && !compterJete) continue;
        const q = Math.abs(parseFloat(t.quantite) || 0);
        const signe = String(t.impact) === '-1' ? -1 : 1;
        total += signe * q;
    }
    return total;
}

// Le stock dechet forme son PROPRE pool, pour la meme raison que la viande:
// il est tenu sous "Déchet 400" / "Déchet 2000" et se vend sous "Dechet".
const POOL_DECHET = 'dechet';

/**
 * @param {object} args
 * @param {Array}  args.lignesAncre  lignes du dernier comptage retenu:
 *                                   [{ produit, quantite, total, prix_unitaire }]
 * @param {Array}  args.transferts   transferts de la fenetre (ancre, dateFin]
 * @param {Array}  args.ventes       ventes de la meme fenetre
 * @param {object} args.ratios       { bovin: number|null, ovin: number|null }
 *                                   rendement mesure du mois (vendu / theorique)
 * @param {number} args.ratioRepli   rendement de repli quand le mois n'est pas
 *                                   mesurable (issu de stock_pertes_decoupe_pct)
 * @param {Function} args.categorieDe   (produit) => 'bovin' | 'ovin' | null
 * @param {Function} args.estBoucherie  (produit) => boolean
 * @param {Set}    [args.exclusions]    produits exclus du parage
 * @param {Set}    [args.familleDechet] produits de la famille dechet
 * @param {object} [args.packs]         table { pack: [composants] }
 * @returns {{lignes: Array, parCategorie: object, avertissements: string[],
 *            nb_lignes_parage: number, nb_lignes_sans_parage: number}}
 */
function estimerStockSoir(args) {
    const {
        lignesAncre = [], transferts = [], ventes = [],
        ratios = {}, ratioRepli,
        categorieDe, estBoucherie,
        exclusions = new Set(), familleDechet = new Set(),
        packs = {}
    } = args || {};

    const avertissements = [];
    const normSet = (s) => new Set(Array.from(s || []).map(normaliserNom));
    const exclusN = normSet(exclusions);
    const dechetN = normSet(familleDechet);
    const estExclu = (p) => exclusN.has(normaliserNom(p));
    const estDechet = (p) => dechetN.has(normaliserNom(p));

    // Une ligne suit le parage de sa categorie seulement si elle appartient au
    // flux principal de la viande. Un produit exclu ne doit pas se voir
    // appliquer un taux calcule sans lui.
    const suitLeParage = (produit) => {
        if (!estBoucherie(produit)) return false;
        if (estExclu(produit) || estDechet(produit)) return false;
        return categorieDe(produit) !== null && categorieDe(produit) !== undefined;
    };
    // A quel POOL appartient un produit: une categorie de parage, le livre du
    // dechet, ou aucun - auquel cas il s'estime seul, sous son propre nom.
    const poolDe = (produit) => {
        if (estDechet(produit)) return POOL_DECHET;
        return suitLeParage(produit) ? categorieDe(produit) : null;
    };

    // --- Mouvements de la fenetre, par produit ET par pool -------------------
    const transfertsParProduit = new Map();
    const transfertsParPool = new Map();
    for (const t of transferts || []) {
        const cle = normaliserNom(t.produit);
        if (!transfertsParProduit.has(cle)) transfertsParProduit.set(cle, []);
        transfertsParProduit.get(cle).push(t);
        const pool = poolDe(t.produit);
        if (pool) {
            if (!transfertsParPool.has(pool)) transfertsParPool.set(pool, []);
            transfertsParPool.get(pool).push(t);
        }
    }

    const ventesParProduit = new Map();
    const ventesParPool = new Map();
    const ajouterVente = (produit, quantite) => {
        const q = parseFloat(quantite) || 0;
        if (!q) return;
        const cle = normaliserNom(produit);
        ventesParProduit.set(cle, (ventesParProduit.get(cle) || 0) + q);
        const pool = poolDe(produit);
        if (pool) ventesParPool.set(pool, (ventesParPool.get(pool) || 0) + q);
    };
    for (const v of ventes || []) {
        const nombre = parseFloat(v.nombre) || 0;
        // Une vente de pack porte le NOMBRE DE PACKS: sans eclatement, les
        // kilos de viande qu'il contient ne seraient soustraits de rien.
        const composition = compositionDuPack(v, packs);
        if (!composition) { ajouterVente(v.produit, nombre); continue; }
        for (const composant of composition) {
            const kg = quantiteEnKg(composant);
            if (kg > 0) ajouterVente(composant.produit, kg * nombre);
        }
    }

    // --- Pools: estimation globale, puis prorata sur les produits -----------
    const parCategorie = {};
    const facteurParPool = new Map();
    const kgAncreParPool = new Map();
    for (const l of lignesAncre) {
        const pool = poolDe(l.produit);
        if (!pool) continue;
        kgAncreParPool.set(pool, (kgAncreParPool.get(pool) || 0) + (parseFloat(l.quantite) || 0));
    }
    // Un pool peut n'avoir aucune ligne d'ancre et pourtant des ventes: on le
    // traite quand meme, pour que son deficit soit visible.
    const pools = new Set([
        ...kgAncreParPool.keys(),
        ...ventesParPool.keys(),
        ...transfertsParPool.keys()
    ]);

    for (const pool of pools) {
        const estPoolDechet = pool === POOL_DECHET;
        const kgAncre = kgAncreParPool.get(pool) || 0;
        // Pour le stock dechet, un jete EST une sortie; pour la viande, non.
        const kgTransferts = mouvementTransferts(transfertsParPool.get(pool), estPoolDechet);
        const kgVendus = ventesParPool.get(pool) || 0;

        // Le dechet ne subit aucun parage: on ne pare pas du dechet.
        const ratioMesure = estPoolDechet ? 1 : ratios[pool];
        const mesure = Number.isFinite(ratioMesure) && ratioMesure > 0;
        const ratio = mesure ? ratioMesure : ratioRepli;
        if (!mesure && kgVendus > 0) {
            avertissements.push(
                `${pool} : aucun parage mesurable ce mois-ci, repli sur le taux de pertes `
                + `configure (${Math.round((1 - ratioRepli) * 1000) / 10} %).`
            );
        }
        // Sans ratio exploitable des deux cotes, on ne divise pas: retrancher
        // les kilos vendus tels quels vaut mieux qu'une division par zero.
        const diviseur = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
        const kgSortis = kgVendus / diviseur;
        const kgEstime = kgAncre + kgTransferts - kgSortis;

        parCategorie[pool] = {
            kg_ancre: arrondi(kgAncre),
            kg_transferts: arrondi(kgTransferts),
            kg_vendus: arrondi(kgVendus),
            // Ce qu'il a fallu SORTIR du stock pour vendre ces kilos.
            kg_sortis: arrondi(kgSortis),
            kg_estime: arrondi(kgEstime),
            ratio: Number.isFinite(ratio) ? Math.round(ratio * 10000) / 10000 : null,
            taux_parage: estPoolDechet
                ? 0
                : (Number.isFinite(ratio) ? Math.round((1 - ratio) * 1000) / 10 : null),
            taux_mesure: estPoolDechet ? true : mesure
        };

        // Prorata: le facteur ramene le pool a son estimation en conservant la
        // repartition du dernier comptage.
        if (kgAncre > SEUIL_KG) {
            facteurParPool.set(pool, kgEstime / kgAncre);
        } else if (kgVendus > 0 || kgTransferts !== 0) {
            avertissements.push(
                `${pool} : aucun stock au dernier comptage, la sortie de `
                + `${arrondi(kgSortis)} kg ne peut pas etre repartie.`
            );
        }
    }

    // --- Lignes estimees ----------------------------------------------------
    let nbParage = 0;
    let nbSansParage = 0;
    const lignes = lignesAncre.map((l) => {
        const quantiteAncre = parseFloat(l.quantite) || 0;
        const prixUnitaire = parseFloat(l.prix_unitaire) || 0;
        const pool = poolDe(l.produit);
        let quantite;

        if (pool) {
            const facteur = facteurParPool.get(pool);
            quantite = Number.isFinite(facteur) ? quantiteAncre * facteur : quantiteAncre;
            if (pool === POOL_DECHET) nbSansParage++; else nbParage++;
        } else {
            // Hors pool: le produit se vend sous le nom ou il est stocke, la
            // soustraction directe a donc un sens.
            const cle = normaliserNom(l.produit);
            quantite = quantiteAncre
                + mouvementTransferts(transfertsParProduit.get(cle))
                - (ventesParProduit.get(cle) || 0);
            nbSansParage++;
        }

        // `total` DOIT etre recalcule: valoriserLignes le conserve tel quel
        // pour les produits sans prix d'achat connu, et garder celui de l'ancre
        // associerait une vieille valeur a une nouvelle quantite, en silence.
        return {
            produit: l.produit,
            quantite: arrondi(quantite),
            prix_unitaire: prixUnitaire,
            total: arrondi(quantite * prixUnitaire),
            quantite_ancre: arrondi(quantiteAncre)
        };
    });

    return {
        lignes,
        parCategorie,
        avertissements,
        nb_lignes_parage: nbParage,
        nb_lignes_sans_parage: nbSansParage
    };
}

function arrondi(n) {
    const v = parseFloat(n) || 0;
    return Math.round(v * 1000) / 1000;
}

module.exports = { estimerStockSoir, mouvementTransferts };
