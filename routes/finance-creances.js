/**
 * Calcul des creances vis-a-vis du fournisseur viande.
 *
 * Reutilise par:
 *   - GET /api/finance/creances  (UI Finance, cookie auth)
 *   - GET /api/external/creance  (consommateur externe, API key)
 *
 * Periode:
 *   - dateDebut / dateFin (format YYYY-MM-DD ou DD-MM-YYYY ou DD/MM/YYYY).
 *   - Si pas de dates: mois en cours.
 *
 * "Ce que je dois au fournisseur":
 *   Sigma (commission_pct% × prix_vente_fournisseur × quantite)
 *   sur les ventes dont categorie est dans `categories_eligibles`.
 *
 * "Ce qu'il me doit":
 *   Sigma ((mon_prix_vente − prix_achat_fournisseur) × quantite)
 *   sur les ventes dont preparation est dans MATA_DECOUPE_CENTRE
 *   (commandes livrees par le Centre de Decoupe).
 *
 * Paiements faits AU fournisseur sur la periode (table
 * fournisseur_paiements) sont retournes separement; libre au consommateur
 * de les soustraire de "ce que je dois" pour calculer le solde restant.
 */

'use strict';

const { Op } = require('sequelize');
const {
    Vente,
    FournisseurPrix,
    FinanceConfig,
    FournisseurPaiement
} = require('../db/models');
const { parseCentres } = require('./decoupe-helpers');

// Normalise une date en string "DD-MM-YYYY" (format BDD Vente.date)
// pour les comparaisons. Vente.date est stocke comme texte libre dans
// cette app (cf. db/models/Vente.js), donc on compare en chaine.
function toDDMMYYYY(input) {
    if (!input) return null;
    const s = String(input).trim();
    // YYYY-MM-DD
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    // DD-MM-YYYY ou DD/MM/YYYY
    m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
}

// Generer la liste des dates "DD-MM-YYYY" entre debut et fin (inclus).
function generateDateRange(startDDMMYYYY, endDDMMYYYY) {
    const parse = (s) => {
        const [d, m, y] = s.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    };
    const fmt = (date) => {
        const dd = String(date.getUTCDate()).padStart(2, '0');
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = date.getUTCFullYear();
        return `${dd}-${mm}-${yyyy}`;
    };
    const start = parse(startDDMMYYYY);
    const end = parse(endDDMMYYYY);
    const list = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        list.push(fmt(new Date(t)));
    }
    return list;
}

// Defaut: 1er du mois courant -> aujourd'hui.
function defaultPeriode() {
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    return {
        dateDebut: `01-${mm}-${yyyy}`,
        dateFin: `${dd}-${mm}-${yyyy}`
    };
}

/**
 * @param {object} opts
 * @param {string} [opts.dateDebut] - format YYYY-MM-DD / DD-MM-YYYY / DD/MM/YYYY
 * @param {string} [opts.dateFin]
 */
async function computeCreances(opts = {}) {
    const dateDebut = toDDMMYYYY(opts.dateDebut) || defaultPeriode().dateDebut;
    const dateFin = toDDMMYYYY(opts.dateFin) || defaultPeriode().dateFin;
    const dateList = generateDateRange(dateDebut, dateFin);

    // 1. Lire la config (commission_pct, categories_eligibles).
    const cfgRows = await FinanceConfig.findAll();
    const cfg = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
    const commissionPct = parseFloat(cfg.commission_pct) || 3.0;
    const categoriesEligibles = (cfg.categories_eligibles || 'Bovin,Ovin,Caprin,Volaille,Poisson')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    // 2. Lire le catalogue de prix fournisseur (Map produit -> {vente, achat}).
    const prixRows = await FournisseurPrix.findAll();
    const prixByProduit = new Map();
    for (const r of prixRows) {
        prixByProduit.set(r.produit.toLowerCase(), {
            prix_vente: parseFloat(r.prix_vente) || 0,
            prix_achat: r.prix_achat == null ? null : parseFloat(r.prix_achat)
        });
    }

    // Helper: lookup case/accent-insensitive sur le nom du produit. On
    // tolere les variations "Boeuf en gros" / "Boeuf En Gros" / "boeuf"
    // en cherchant une cle dont le nom commence par le mot d'animal.
    const lookupPrix = (produitNom) => {
        const lower = (produitNom || '').toLowerCase();
        if (prixByProduit.has(lower)) return prixByProduit.get(lower);
        // Heuristique: cle si lower commence par le nom de la cle.
        // Ex: "boeuf en detail" -> match cle "boeuf".
        for (const [key, value] of prixByProduit) {
            if (lower.startsWith(key)) return value;
        }
        return null;
    };

    // 3. Charger toutes les ventes de la periode.
    const ventes = await Vente.findAll({
        where: {
            date: { [Op.in]: dateList },
            categorie: { [Op.in]: categoriesEligibles }
        },
        attributes: ['produit', 'categorie', 'preparation', 'nombre', 'prixUnit']
    });

    // 4. Filtrer les ventes "Centre de Decoupe" pour le calcul "ce qu'il me doit".
    const centresDecoupe = parseCentres().map((s) => s.toLowerCase());
    const isVenteCentreDecoupe = (v) => {
        const p = (v.preparation || '').toLowerCase();
        return centresDecoupe.includes(p);
    };

    // 5. Calculer.
    const detail = new Map(); // produit -> { qte, dette, recevable }
    let totalDette = 0;        // ce que je dois (3% × prix fournisseur × qte)
    let totalRecevable = 0;    // ce qu'il me doit (margin × qte sur ventes Centre)

    for (const v of ventes) {
        const qte = parseFloat(v.nombre) || 0;
        if (qte <= 0) continue;
        const prix = lookupPrix(v.produit);
        if (!prix) continue; // produit non present dans le catalogue fournisseur

        // Commission 3% sur prix de vente du fournisseur (toutes ventes elligibles)
        const detteLigne = (commissionPct / 100) * prix.prix_vente * qte;
        totalDette += detteLigne;

        // Recevable: uniquement si vente passee par le Centre de Decoupe
        // ET si le fournisseur a un prix_achat connu.
        let recevableLigne = 0;
        if (isVenteCentreDecoupe(v) && prix.prix_achat != null) {
            const monPrix = parseFloat(v.prixUnit) || 0;
            recevableLigne = (monPrix - prix.prix_achat) * qte;
            totalRecevable += recevableLigne;
        }

        // Agreger par produit pour le detail.
        const key = v.produit;
        const agg = detail.get(key) || { produit: key, quantite: 0, dette: 0, recevable: 0 };
        agg.quantite += qte;
        agg.dette += detteLigne;
        agg.recevable += recevableLigne;
        detail.set(key, agg);
    }

    // 6. Paiements faits AU fournisseur sur la periode (info brute, pas deduits).
    const paiements = await FournisseurPaiement.findAll({
        where: {
            date: {
                [Op.gte]: opts.dateDebut ? toISODate(dateDebut) : toISODate(defaultPeriode().dateDebut),
                [Op.lte]: opts.dateFin ? toISODate(dateFin) : toISODate(defaultPeriode().dateFin)
            }
        },
        order: [['date', 'ASC']]
    });
    const totalPaiements = paiements.reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);

    return {
        periode: { dateDebut, dateFin },
        commission_pct: commissionPct,
        categories_eligibles: categoriesEligibles,
        // Cote A: ce que je dois au fournisseur (commission sur ventes elligibles)
        ce_que_je_dois: round2(totalDette),
        // Cote B: ce qu'il me doit (margin sur ventes Centre de Decoupe)
        ce_qu_il_me_doit: round2(totalRecevable),
        // Solde net (positif = je dois encore, negatif = il me doit)
        solde_net: round2(totalDette - totalRecevable),
        // Paiements deja faits AU fournisseur sur la periode
        paiements_effectues: round2(totalPaiements),
        // Solde restant a payer apres paiements
        reste_a_payer: round2(totalDette - totalRecevable - totalPaiements),
        // Detail par produit
        detail: Array.from(detail.values())
            .map((d) => ({
                produit: d.produit,
                quantite: round2(d.quantite),
                dette: round2(d.dette),
                recevable: round2(d.recevable)
            }))
            .sort((a, b) => b.dette - a.dette),
        // Liste des paiements de la periode
        paiements: paiements.map((p) => ({
            id: p.id,
            date: p.date,
            montant: parseFloat(p.montant) || 0,
            mode: p.mode,
            reference: p.reference,
            commentaire: p.commentaire
        }))
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// "DD-MM-YYYY" -> "YYYY-MM-DD" pour les colonnes DATEONLY/DATE Postgres
function toISODate(ddmmyyyy) {
    const m = ddmmyyyy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : ddmmyyyy;
}

module.exports = {
    computeCreances,
    toDDMMYYYY,
    defaultPeriode
};
