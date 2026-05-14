/**
 * Fusionne les commandes envoyées au Centre de Découpe (table
 * decoupe_order_logs) avec les ventes locales pour les écrans
 * d'affichage Maas (Tableau des Ventes, Dernières ventes enregistrées).
 *
 * AUCUNE écriture dans `ventes` — c'est une transformation à la lecture.
 * Le dashboard "Montant Total des Ventes" reste inchangé (lit ventes),
 * "Commandes Découpe" reste inchangé (lit decoupe_order_logs), donc
 * pas de double counting dans les KPI existants.
 *
 * Convention demandée par l'utilisateur :
 *   - Point de Vente = log.point_vente (= PV demandeur, ex: "Mbao")
 *   - Préparation    = log.point_vente_executant (= centre de découpe)
 *
 * Inspiration: routes/commandes-decoupe.js + server.js#5040 cote DATA
 * où le même pattern est utilisé pour l'écran "Commandes livraison".
 */

'use strict';

const { Op } = require('sequelize');
const { DecoupeOrderLog } = require('../db/models');

/**
 * Convertit une date YYYY-MM-DD ou DD-MM-YYYY en YYYY-MM-DD ISO.
 */
function toISODate(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

/**
 * Formate une date Date → "DD-MM-YYYY" pour matcher le format
 * historique de Vente.date côté Maas.
 */
function fmtDateDDMMYYYY(d) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy}`;
}

const MOIS_FR = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
                 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

/**
 * Récupère les decoupe_order_logs et les formate comme des ventes.
 *
 * @param {object} [opts]
 * @param {string} [opts.dateDebut]   YYYY-MM-DD ou DD-MM-YYYY (inclus)
 * @param {string} [opts.dateFin]     YYYY-MM-DD ou DD-MM-YYYY (inclus)
 * @param {string|string[]} [opts.pointVente]   filtre par PV demandeur
 * @param {number} [opts.limit]       limiter le nombre de logs (pour dernieresVentes)
 * @returns {Promise<Array>} tableau de ventes formatées (1 par produit dans chaque log)
 */
async function fetchDecoupeAsVentes(opts) {
    opts = opts || {};
    const where = {};

    // Filtre date sur created_at (TIMESTAMPTZ).
    const isoDebut = toISODate(opts.dateDebut);
    const isoFin = toISODate(opts.dateFin || opts.dateDebut);
    if (isoDebut) {
        where.created_at = where.created_at || {};
        where.created_at[Op.gte] = new Date(`${isoDebut}T00:00:00.000Z`);
    }
    if (isoFin) {
        where.created_at = where.created_at || {};
        where.created_at[Op.lte] = new Date(`${isoFin}T23:59:59.999Z`);
    }

    // Filtre point_vente.
    if (opts.pointVente && opts.pointVente !== 'tous') {
        if (Array.isArray(opts.pointVente)) {
            if (!opts.pointVente.includes('tous')) {
                where.point_vente = { [Op.in]: opts.pointVente };
            }
        } else {
            where.point_vente = opts.pointVente;
        }
    }

    const findOpts = {
        where,
        order: [['created_at', 'DESC']]
    };
    if (opts.limit) findOpts.limit = opts.limit;

    const logs = await DecoupeOrderLog.findAll(findOpts);

    // Aplatir: 1 ligne par produit dans chaque log.
    const formatted = [];
    for (const log of logs) {
        // Sequelize underscored:true -> column SQL = created_at mais
        // attribut JS = createdAt. Fallback sur created_at au cas ou.
        const rawCreated = log.createdAt || log.created_at;
        const createdAt = rawCreated instanceof Date
            ? rawCreated
            : new Date(rawCreated);
        if (isNaN(createdAt.getTime())) continue; // skip si date invalide
        const dateDDMMYYYY = fmtDateDDMMYYYY(createdAt);
        const mois = MOIS_FR[createdAt.getUTCMonth()];

        // Semaine ISO 8601
        const tmp = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate()));
        tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const semaine = String(Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7));

        const produits = Array.isArray(log.produits) ? log.produits : [];
        for (let i = 0; i < produits.length; i++) {
            const p = produits[i];
            const prixUnit = Number(p.prixUnit != null ? p.prixUnit : p.price) || 0;
            const nombre = Number(p.nombre != null ? p.nombre : p.quantity) || 0;
            const montant = Number(p.montant != null ? p.montant : (prixUnit * nombre)) || 0;
            formatted.push({
                // ID synthetique: id_log + index produit pour rester unique
                // (loop indexed = O(n) au lieu de produits.indexOf en O(n²)).
                id: `cdc-${log.id}-${i}`,
                Mois: mois,
                Date: dateDDMMYYYY,
                Semaine: semaine,
                'Point de Vente': log.point_vente,
                Preparation: log.point_vente_executant, // = centre de découpe
                'Catégorie': p.categorie || p.category || '',
                Produit: p.produit || p.name || '',
                PU: prixUnit,
                Nombre: nombre,
                Montant: montant,
                nomClient: log.nom_client || null,
                numeroClient: log.numero_client || null,
                adresseClient: log.adresse_client || null,
                creance: false,
                extension: null,
                // Marqueur source pour distinguer côté UI si besoin
                _source: 'decoupe',
                _commandeRef: log.commande_ref || null
            });
        }
    }
    return formatted;
}

module.exports = { fetchDecoupeAsVentes };
