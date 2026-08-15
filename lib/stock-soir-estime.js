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
 * @param {Function} [args.cibleDe]     (libelle de vente) => { cible, coefficient }
 *   La LIGNE DE STOCK qu'une vente consomme, et dans quelle proportion. Vient
 *   du Mapping produits: « Boeuf en gros » -> { Boeuf, 1 }, « Jarret » ->
 *   { Boeuf, 0.5 }. Absent, chaque libelle se consomme lui-meme.
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
        categorieDe, estBoucherie, cibleDe,
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

    // LES VENTES SONT ATTRIBUEES A LA LIGNE DE STOCK QU'ELLES CONSOMMENT.
    //
    // « Boeuf en gros » et « Boeuf en détail » n'ont pas de ligne de stock:
    // c'est « Boeuf » qui se vide quand ils se vendent. Le Mapping produits le
    // dit desormais, avec son coefficient - un Jarret consomme 0,5 kg de
    // carcasse par piece. On peut donc soustraire produit par produit, la ou il
    // fallait naguere passer par un pool et redistribuer au prorata.
    //
    // Sans cibleDe - appelant qui ne le fournit pas - chaque libelle se
    // consomme lui-meme: c'est le comportement d'avant pour les produits dont
    // le nom de vente EST le nom d'inventaire.
    const ventesParProduit = new Map();
    const ventesParPool = new Map();
    const ajouterVente = (produit, quantite) => {
        const q = parseFloat(quantite) || 0;
        if (!q) return;
        const dest = typeof cibleDe === 'function' ? cibleDe(produit) : null;
        const cible = (dest && dest.cible) || produit;
        const coef = (dest && dest.coefficient > 0) ? dest.coefficient : 1;
        // La quantite est convertie dans l'unite de la LIGNE DE STOCK.
        const consomme = q * coef;
        const cle = normaliserNom(cible);
        ventesParProduit.set(cle, (ventesParProduit.get(cle) || 0) + consomme);
        const pool = poolDe(cible);
        if (pool) ventesParPool.set(pool, (ventesParPool.get(pool) || 0) + consomme);
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
    // Diviseur de parage par pool: 1 - taux. Commun a l'espece.
    const diviseurParPool = new Map();
    const kgAncreParPool = new Map();
    // Les PRODUITS de chaque pool, pour que l'ecran puisse les nommer. Une
    // banniere qui annonce « bovin : 71,05 kg » a cote d'un tableau qui
    // affiche « Boeuf : 88,17 » ne se rapproche pas: le pool bovin vaut
    // Boeuf + Viande Hachee, et rien ne le disait.
    const produitsParPool = new Map();
    for (const l of lignesAncre) {
        const pool = poolDe(l.produit);
        if (!pool) continue;
        kgAncreParPool.set(pool, (kgAncreParPool.get(pool) || 0) + (parseFloat(l.quantite) || 0));
        if (Math.abs(parseFloat(l.quantite) || 0) > 0) {
            if (!produitsParPool.has(pool)) produitsParPool.set(pool, []);
            const liste = produitsParPool.get(pool);
            if (liste.indexOf(l.produit) < 0) liste.push(l.produit);
        }
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
            // Les produits reellement comptes dans ce pool: l'ecran les nomme
            // au lieu d'annoncer une espece que le tableau n'affiche jamais.
            produits: (produitsParPool.get(pool) || []).slice(),
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

        // Le DIVISEUR de parage du pool, retenu pour les lignes.
        //
        // Le prorata a disparu: chaque ligne se calcule seule depuis que le
        // Mapping produits dit quelle vente la consomme. Le pool ne sert plus
        // qu'a deux choses - porter le taux de parage de l'espece, et rendre
        // le detail par categorie que l'ecran affiche.
        diviseurParPool.set(pool, diviseur);
        if (kgAncre + kgTransferts <= SEUIL_KG && kgVendus > 0) {
            avertissements.push(
                `${pool} : aucun stock disponible au dernier comptage, alors que `
                + `${arrondi(kgVendus)} kg y ont ete vendus.`
            );
        }
    }

    // UNE VENTE QUI NE TROUVE AUCUNE LIGNE DE STOCK EST SIGNALEE.
    //
    // Depuis qu'on soustrait produit par produit, une vente dont la cible n'a
    // pas de ligne au comptage ne decremente RIEN: le stock resterait au
    // niveau de l'ancre, et l'ecran afficherait une journee sans consommation.
    // C'est le repli le plus dangereux du module - il ne casse pas, il ment.
    // Le pool le masquait naguere en rattrapant par categorie.
    const lignesConnues = new Set(lignesAncre.map((l) => normaliserNom(l.produit)));
    const orphelines = [];
    for (const [cle, q] of ventesParProduit) {
        if (q > SEUIL_KG && !lignesConnues.has(cle)) orphelines.push(`${cle} (${arrondi(q)})`);
    }
    if (orphelines.length) {
        avertissements.push(
            `Ventes sans ligne de stock a decrementer : ${orphelines.join(', ')}. `
            + `Leur consommation n'est retranchee de rien - verifiez la colonne `
            + `« Mappe vers » du Mapping produits.`
        );
    }

    // --- Lignes estimees ----------------------------------------------------
    let nbParage = 0;
    let nbSansParage = 0;
    const lignes = lignesAncre.map((l) => {
        const quantiteAncre = parseFloat(l.quantite) || 0;
        const prixUnitaire = parseFloat(l.prix_unitaire) || 0;
        const pool = poolDe(l.produit);
        let quantite;

        // CHAQUE LIGNE SE CALCULE SEULE, plus aucun prorata.
        //
        //   soir = ancre + transferts entrants - transferts sortants
        //          - ventes qui la consomment / (1 - parage)
        //
        // Le prorata n'existait que parce qu'on ne savait pas quelle vente
        // consommait quelle ligne. Le Mapping produits le dit: on soustrait
        // directement. « Boeuf » perd ses ventes en gros, en detail et la
        // moitie de chaque Jarret; « Viande Hachée », qui a son propre stock,
        // ne perd que les siennes - elle ne partage plus le sort du boeuf.
        const cleP = normaliserNom(l.produit);
        const kgVendusLigne = ventesParProduit.get(cleP) || 0;
        // Le parage de SA categorie. Hors boucherie, volaille, produit exclu,
        // famille dechet: pas de parage, on retranche les kilos tels quels.
        const ratioLigne = (pool && pool !== POOL_DECHET && diviseurParPool.get(pool)) || 1;
        quantite = quantiteAncre
            + mouvementTransferts(transfertsParProduit.get(cleP), pool === POOL_DECHET)
            - (ratioLigne > 0 ? kgVendusLigne / ratioLigne : kgVendusLigne);
        if (pool && pool !== POOL_DECHET) nbParage++; else nbSansParage++;

        // `total` DOIT etre recalcule: valoriserLignes le conserve tel quel
        // pour les produits sans prix d'achat connu, et garder celui de l'ancre
        // associerait une vieille valeur a une nouvelle quantite, en silence.
        return {
            produit: l.produit,
            quantite: arrondi(quantite),
            prix_unitaire: prixUnitaire,
            total: arrondi(quantite * prixUnitaire),
            quantite_ancre: arrondi(quantiteAncre),
            // LE CALCUL, terme a terme, pour que l'ecran puisse le montrer.
            //
            //   estime = ancre + transferts - vendus / diviseur
            //
            // Un chiffre estime qu'on ne peut pas decomposer ne se verifie
            // pas: on le croit ou on ne le croit pas. Les quatre termes
            // permettent de le refaire a la main.
            calcul: {
                ancre: arrondi(quantiteAncre),
                transferts: arrondi(mouvementTransferts(transfertsParProduit.get(cleP), pool === POOL_DECHET)),
                vendus: arrondi(kgVendusLigne),
                diviseur: Math.round(ratioLigne * 10000) / 10000,
                taux_parage: ratioLigne < 1 ? Math.round((1 - ratioLigne) * 1000) / 10 : null,
                sortis: arrondi(ratioLigne > 0 ? kgVendusLigne / ratioLigne : kgVendusLigne),
                pool: pool || null
            }
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
