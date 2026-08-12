/**
 * Volumes vendus par produit, sur une periode.
 *
 * UN SEUL endroit agrege les ventes par produit. Avant ce module il y en
 * avait deux: un GROUP BY SQL dans GET /api/finance/simulation et une boucle
 * sur les lignes deja chargees dans computePl. Les deux repondaient a la meme
 * question, donc les deux finissaient par rendre deux chiffres differents - ce
 * depot l'a deja paye sur le filtre de dates (277 924 F d'ecart mesures sur
 * mai 2026, cf routes/finance.js#graphiesDeDatesPourPeriode).
 *
 * Le module est PUR: aucune requete, aucun require de sequelize ni de
 * db/models. L'appelant charge les lignes, ce module les agrege. C'est la
 * convention des autres modules lib/ du projet (lib/valorisation-stock.js,
 * lib/marge-parage.js), et c'est ce qui les rend testables sans base.
 *
 * Consequence voulue: computePl expose desormais ces volumes dans son
 * resultat, donc ils sont GRAVES dans pl_snapshots.payload sans une ligne de
 * code de plus. Une simulation rejouee sur un PL fige lit alors les volumes
 * de ce jour-la, et non ceux d'aujourd'hui.
 */

const { normaliserNom } = require('./parage');

/**
 * Agrege des lignes de vente BRUTES par produit normalise.
 *
 * PERIMETRE: tous les produits presents dans les lignes, sans filtre. Le
 * filtrage au perimetre voulu (les cinq produits suivis de la simulation, une
 * famille, une categorie) appartient a l'appelant. Agreger large et filtrer
 * ensuite est ce qui permet a un PL fige de repondre plus tard a une question
 * de perimetre qui n'avait pas ete posee le jour du figeage.
 *
 * @param {Array<{produit: string, nombre: *, montant: *}>} lignes
 *        Lignes telles qu'elles sortent de la table ventes. `nombre` et
 *        `montant` peuvent etre des chaines: Sequelize rend les NUMERIC en
 *        texte, et parseFloat est fait ici.
 * @returns {{produits: Array, total_ca: number, total_quantite: number, total_lignes: number}}
 *        `produits` est trie par chiffre d'affaires decroissant, ordre stable
 *        d'un appel a l'autre - une sortie qui change d'ordre sans raison ne
 *        se compare pas d'un jour sur l'autre.
 */
function agregerVolumes(lignes) {
    const parCle = new Map();
    let totalCa = 0;
    let totalQuantite = 0;
    let totalLignes = 0;
    let lignesSansProduit = 0;

    for (const l of (lignes || [])) {
        const nomBrut = l.produit;
        // Une ligne sans produit n'est pas rattachable: elle compte dans le
        // total du chiffre d'affaires, comme le fait le PL, mais elle ne peut
        // pas entrer dans une ligne de produit. La signaler plutot que de la
        // ranger sous une cle vide qui se ferait passer pour un produit.
        const quantite = parseFloat(l.nombre) || 0;
        const montant = parseFloat(l.montant) || 0;
        totalCa += montant;
        totalQuantite += quantite;
        totalLignes += 1;
        if (nomBrut === null || nomBrut === undefined || String(nomBrut).trim() === '') {
            lignesSansProduit += 1;
            continue;
        }

        const cle = normaliserNom(nomBrut);
        if (!parCle.has(cle)) {
            parCle.set(cle, { cle, graphies: [], quantite: 0, ca: 0, nb_lignes: 0 });
        }
        const agg = parCle.get(cle);
        agg.quantite += quantite;
        agg.ca += montant;
        agg.nb_lignes += 1;
        // Les graphies servent a l'ecran: "Poulet en détail" et
        // "Poulet En Détail" sont le meme produit, et l'utilisateur doit
        // pouvoir voir que deux libelles ont ete additionnes.
        if (!agg.graphies.includes(nomBrut)) agg.graphies.push(nomBrut);
    }

    // VALEURS EXACTES, jamais arrondies ici. L'arrondi appartient a la SORTIE,
    // pas a l'agregat.
    //
    // Arrondir quantite et ca a 2 decimales avant que l'appelant ne les divise
    // faussait le prix moyen, et les quantites se saisissent au MILLIEME
    // (index.html, step="0.001"). Deux ventes de 0,125 et 0,126 kg a 5 000 F
    // font 0,251 kg exactement; arrondies a 0,25 elles rendaient un prix moyen
    // de 5 020 F au lieu de 5 000, soit 0,4 % d'erreur reportee sur la marge
    // unitaire et sur le prix d'equilibre. Pire, une quantite nette de 0,004
    // tombait a 0 et l'ecran declarait le produit NON VENDU alors qu'il avait
    // deux lignes.
    //
    // La consequence etait durable: ces valeurs partent dans computePl, donc
    // dans pl_snapshots.payload.volumes, donc l'imprecision se gravait dans
    // l'historique.
    const produits = Array.from(parCle.values()).map((a) => ({
        cle: a.cle,
        graphies: a.graphies.slice().sort((x, y) => String(x).localeCompare(String(y), 'fr')),
        quantite: a.quantite,
        ca: a.ca,
        nb_lignes: a.nb_lignes,
        // Prix MOYEN constate, pas prix de catalogue: c'est celui-la qui
        // explique le chiffre d'affaires de la periode. Calcule sur les
        // valeurs exactes, comme le faisait le SUM() de Postgres.
        prix_moyen: a.quantite > 0 ? a.ca / a.quantite : null
    }));

    // Tri par chiffre d'affaires decroissant, puis par cle a egalite pour que
    // deux produits au meme montant ne permutent pas d'un appel a l'autre.
    produits.sort((a, b) => (b.ca - a.ca) || a.cle.localeCompare(b.cle, 'fr'));

    return {
        produits,
        total_ca: totalCa,
        total_quantite: totalQuantite,
        total_lignes: totalLignes,
        // Lignes de vente dont le produit est vide ou absent. Elles comptent
        // dans total_ca - comme le faisait le groupe NULL de l'ancien GROUP BY,
        // et comme le fait total_ventes du PL - mais elles n'appartiennent a
        // aucun produit. Sans ce compteur, la difference entre le total et la
        // somme des produits n'avait aucune explication a l'ecran.
        lignes_sans_produit: lignesSansProduit
    };
}

/**
 * Index par cle normalisee, pour les appelants qui cherchent un produit par
 * son nom. Volontairement separe d'agregerVolumes: le resultat de celle-ci
 * part en JSON dans pl_snapshots.payload, et une Map ne se serialise pas.
 */
function indexerParCle(produits) {
    const m = new Map();
    for (const p of (produits || [])) m.set(p.cle, p);
    return m;
}

/** Retrouve un produit agrege par son nom, quelle qu'en soit la graphie. */
function trouverProduit(produits, nom) {
    const cle = normaliserNom(nom);
    return (produits || []).find((p) => p.cle === cle) || null;
}

module.exports = { agregerVolumes, indexerParCle, trouverProduit };
