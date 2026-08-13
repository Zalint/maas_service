'use strict';

/**
 * Table { pack: [composants] } lue depuis la base.
 *
 * Extrait de server.js, ou la fonction etait PRIVEE: le PL en a besoin pour
 * eclater les ventes de pack en kilos de composants, et une seconde copie
 * aurait diverge de celle du parage - ce module a deja paye cinq copies de la
 * formule du taux (cf lib/parage.js).
 */
async function lirePackCompositions() {
    const { PackComposition } = require('../db/models');
    const lignes = await PackComposition.findAll({
        order: [['pack', 'ASC'], ['ordre', 'ASC']],
        raw: true
    });
    const table = {};
    for (const l of lignes) {
        if (!table[l.pack]) table[l.pack] = [];
        const composant = {
            produit: l.produit,
            quantite: parseFloat(l.quantite),
            unite: l.unite
        };
        if (l.poids_unitaire != null) composant.poids_unitaire = parseFloat(l.poids_unitaire);
        table[l.pack].push(composant);
    }
    return table;
}

module.exports = { lirePackCompositions };
