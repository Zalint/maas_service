'use strict';

/**
 * Taux de parage MESURE par categorie sur un mois, a date.
 *
 * C'est la chaine complete jour -> mois, jusqu'ici INLINEE dans le handler
 * GET /api/external/parage (server.js). Le PL en a besoin pour estimer le stock
 * du soir tant qu'il n'est pas compte, et reconstruire le cumul dans
 * routes/finance.js en aurait fait une quatrieme definition du taux - le
 * depot en a deja purge cinq (cf le JSDoc de tauxDePerte dans lib/parage.js).
 *
 * Convention identique aux cartes "Parage Boeuf (Mois)": cumul A DATE (du 1er
 * du mois au jour demande inclus), kilos sommes et non pourcentages moyennes,
 * et seules les journees MESURABLES entrent au cumul (ratio non null).
 */

const { calculerParage } = require('./parage');
const {
    datesJusquA, formesDeDate, grouperParDate,
    agregerPointsDeVente, cumulerMois
} = require('./parage-periode');

/**
 * Le detail JOUR PAR JOUR, partage par tauxParageMois (qui le cumule) et par
 * le rapport de parage (qui garde le detail, cf lib/parage-rapport.js). Une
 * seule boucle de requetes: la dupliquer aurait fini par diverger, comme le
 * taux lui-meme avant sa consolidation dans lib/parage.js.
 *
 * @returns {Promise<{jours: string[], parageParJour: object[], parJourTransferts: object}>}
 *   `parageParJour[i]` correspond a `jours[i]`, deja agrege par point de vente.
 *   `parJourTransferts` est BRUT (non classe par categorie) - fourni pour que
 *   l'appelant puisse decider lui-meme ce qu'est un "jour avec livraison".
 */
async function detailParageParJour(sequelize, dateIso, contexte, packs, filtrePv) {
    const { Stock, Transfert, Vente } = require('../db/models');
    const { Op } = require('sequelize');

    const jours = datesJusquA(dateIso);
    const toutesFormes = [];
    // Les trois graphies sont indispensables: les ventes sont en ISO, les
    // stocks et transferts en JJ-MM-AAAA. N'en interroger qu'une viderait le
    // numerateur en gardant le denominateur, soit 100% de parage affiche.
    for (const j of jours) toutesFormes.push(...formesDeDate(j));
    const filtreDate = { date: { [Op.in]: toutesFormes } };

    const [stocksMatin, stocksSoir, transferts, ventes] = await Promise.all([
        Stock.findAll({ where: { ...filtreDate, typeStock: 'matin' }, raw: true }),
        Stock.findAll({ where: { ...filtreDate, typeStock: 'soir' }, raw: true }),
        Transfert.findAll({ where: filtreDate, raw: true }),
        Vente.findAll({ where: filtreDate, raw: true })
    ]);

    const parJourMatin = grouperParDate(stocksMatin);
    const parJourSoir = grouperParDate(stocksSoir);
    const parJourTransferts = grouperParDate(transferts);
    const parJourVentes = grouperParDate(ventes);

    const parageParJour = jours.map((iso) => {
        const parPv = calculerParage({
            stocksMatin: (parJourMatin[iso] || []).map((s) => ({ pointVente: s.pointVente, produit: s.produit, quantite: s.quantite })),
            stocksSoir: (parJourSoir[iso] || []).map((s) => ({ pointVente: s.pointVente, produit: s.produit, quantite: s.quantite })),
            // extension porte le drapeau dechet_jete: sans lui, une pesee de
            // jete redeviendrait un transfert de marchandise.
            transferts: (parJourTransferts[iso] || []).map((t) => ({ pointVente: t.pointVente, produit: t.produit, quantite: t.quantite, impact: t.impact, extension: t.extension })),
            ventes: (parJourVentes[iso] || []).map((v) => ({ pointVente: v.pointVente, produit: v.produit, nombre: v.nombre, extension: v.extension })),
            categorieDe: contexte.categorieDe,
            exclusions: contexte.exclusions,
            stockDerive: contexte.stockDerive,
            familleDechet: contexte.familleDechet,
            packs
        });
        return agregerPointsDeVente(parPv, filtrePv);
    });

    return { jours, parageParJour, parJourTransferts };
}

/**
 * @param {object} sequelize
 * @param {string} dateIso        'AAAA-MM-JJ', dernier jour cumule (inclus)
 * @param {object} contexte       retour de chargerContexteParage (reutilise
 *                                celui de l'appelant: 5 requetes economisees)
 * @param {object} packs          table { pack: [composants] }
 * @param {string} [filtrePv]     limite a un point de vente; sinon tous
 * @returns {Promise<{bovin: object, ovin: object}>} blocs cumules du mois,
 *   dont { theorique, vendu, ratio, perte, joursMesures }. ratio et perte
 *   valent null quand rien n'est mesurable - jamais 0.
 */
async function tauxParageMois(sequelize, dateIso, contexte, packs, filtrePv) {
    const { parageParJour } = await detailParageParJour(sequelize, dateIso, contexte, packs, filtrePv);
    return cumulerMois(parageParJour);
}

module.exports = { tauxParageMois, detailParageParJour };
