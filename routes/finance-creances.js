/**
 * Calcul LOCAL des creances vis-a-vis du fournisseur viande.
 *
 * Note: c'est un calcul "indicateur" Maas-side. La creance officielle
 * (solde, avances, remboursements) vient de mata-depenses-management
 * (cf lib/depenses-creance-client.js). Les deux sont affiches cote a
 * cote dans l'UI Finance pour reconciliation.
 *
 * Reutilise par:
 *   - GET /api/finance/creances  (UI Finance, cookie auth)
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

// Normalise une date en string "YYYY-MM-DD" (format BDD Vente.date).
// Vente.date est stocke comme texte libre (cf db/models/Vente.js) mais
// les enregistrements existants utilisent YYYY-MM-DD (ex: "2026-05-12"),
// donc on compare en chaine sur ce format.
function toISO(input) {
    if (!input) return null;
    const s = String(input).trim();
    // YYYY-MM-DD (deja bon)
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return s;
    // DD-MM-YYYY ou DD/MM/YYYY -> YYYY-MM-DD
    m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

// Alias retro-compatible: anciens callers attendaient DD-MM-YYYY. On
// retourne maintenant YYYY-MM-DD (format BDD). Tests + UI affichent
// formattent eux-memes si besoin.
function toDDMMYYYY(input) {
    return toISO(input);
}

// Generer la liste des dates "YYYY-MM-DD" entre debut et fin (inclus).
function generateDateRange(startISO, endISO) {
    const parse = (s) => {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d));
    };
    const fmt = (date) => {
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(date.getUTCDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };
    const start = parse(startISO);
    const end = parse(endISO);
    const list = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        list.push(fmt(new Date(t)));
    }
    return list;
}

// Defaut: 1er du mois courant -> aujourd'hui. Format YYYY-MM-DD.
function defaultPeriode() {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return {
        dateDebut: `${yyyy}-${mm}-01`,
        dateFin: `${yyyy}-${mm}-${dd}`
    };
}

/**
 * @param {object} opts
 * @param {string} [opts.dateDebut] - format YYYY-MM-DD / DD-MM-YYYY / DD/MM/YYYY
 * @param {string} [opts.dateFin]
 */
async function computeCreances(opts = {}) {
    const dateDebut = toISO(opts.dateDebut) || defaultPeriode().dateDebut;
    const dateFin = toISO(opts.dateFin) || defaultPeriode().dateFin;
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
    // commandeId + numeroClient sont ajoutes au drill-down pour tracer
    // la marge encaissable a la commande client qui l'a generee.
    const ventes = await Vente.findAll({
        where: {
            date: { [Op.in]: dateList },
            categorie: { [Op.in]: categoriesEligibles }
        },
        attributes: [
            'date', 'produit', 'categorie', 'preparation', 'nombre', 'prixUnit',
            'nomClient', 'numeroClient', 'commandeId', 'pointVente'
        ]
    });

    // 4. Filtrer les ventes "Centre de Decoupe" pour le calcul "ce qu'il me doit".
    // Map du nom de centre en minuscules -> nom original (preserve la casse
    // de MATA_DECOUPE_CENTRE pour l'affichage UI).
    const centresOriginaux = parseCentres();
    const centreLowerToOriginal = new Map(centresOriginaux.map((c) => [c.toLowerCase(), c]));
    const getVenteCentre = (v) => {
        const p = (v.preparation || '').trim().toLowerCase();
        return centreLowerToOriginal.get(p) || null;
    };
    const isVenteCentreDecoupe = (v) => getVenteCentre(v) !== null;

    // 5. Calculer.
    const detail = new Map(); // produit -> agg global
    // Detail par centre: centre -> Map<produit, { quantite_cdc, recevable, prix_achat, prix_vente_pondere }>
    const detailParCentre = new Map();
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
        const centre = getVenteCentre(v);
        let recevableLigne = 0;
        const monPrix = parseFloat(v.prixUnit) || 0;
        if (centre && prix.prix_achat != null) {
            recevableLigne = (monPrix - prix.prix_achat) * qte;
            totalRecevable += recevableLigne;
        }

        // Agreger par produit (vue globale) pour l'onglet "Creances".
        const key = v.produit;
        const agg = detail.get(key) || {
            produit: key,
            quantite: 0,
            quantite_cdc: 0,
            prix_achat: prix.prix_achat,
            dette: 0,
            recevable: 0
        };
        agg.quantite += qte;
        if (centre && prix.prix_achat != null) {
            agg.quantite_cdc += qte;
        }
        agg.dette += detteLigne;
        agg.recevable += recevableLigne;
        detail.set(key, agg);

        // Agreger par (centre, produit) pour l'onglet "Centre de Decoupe".
        // On accumule aussi mon_prix * qte pour calculer le prix moyen
        // pondere par produit dans ce centre, et on conserve la liste
        // des ventes individuelles pour le drill-down "Details" cote UI.
        if (centre && prix.prix_achat != null) {
            if (!detailParCentre.has(centre)) {
                detailParCentre.set(centre, new Map());
            }
            const parProd = detailParCentre.get(centre);
            const cAgg = parProd.get(key) || {
                produit: key,
                quantite_cdc: 0,
                prix_achat: prix.prix_achat,
                prix_vente_x_qte: 0, // somme(mon_prix * qte) pour calculer la moyenne ponderee
                recevable: 0,
                ventes: []
            };
            cAgg.quantite_cdc += qte;
            cAgg.prix_vente_x_qte += monPrix * qte;
            cAgg.recevable += recevableLigne;
            cAgg.ventes.push({
                date: v.date,
                produit_brut: v.produit,
                categorie: v.categorie,
                preparation: v.preparation,
                point_vente: v.pointVente || null,
                nombre: qte,
                prix_unit: monPrix,
                prix_achat: prix.prix_achat,
                marge_unitaire: monPrix - prix.prix_achat,
                recevable_ligne: round2(recevableLigne),
                nom_client: v.nomClient || null,
                numero_client: v.numeroClient || null,
                commande_id: v.commandeId || null
            });
            parProd.set(key, cAgg);
        }
    }

    // 6. Paiements faits AU fournisseur sur la periode (info brute, pas deduits).
    // dateDebut/dateFin sont deja en YYYY-MM-DD (format DATEONLY Postgres).
    const paiements = await FournisseurPaiement.findAll({
        where: {
            date: {
                [Op.gte]: dateDebut,
                [Op.lte]: dateFin
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
        // Detail par produit (vue globale - utilise par "Creances fournisseur")
        detail: Array.from(detail.values())
            .map((d) => ({
                produit: d.produit,
                quantite: round2(d.quantite),
                quantite_cdc: round2(d.quantite_cdc),
                prix_achat: d.prix_achat == null ? null : round2(d.prix_achat),
                dette: round2(d.dette),
                recevable: round2(d.recevable)
            }))
            .sort((a, b) => b.dette - a.dette),
        // Detail par (centre, produit) pour l'onglet "Centre de Decoupe".
        // Chaque entree: { centre, total_recevable, total_quantite,
        //                   detail: [{ produit, quantite_cdc, prix_achat,
        //                              mon_prix_moyen, marge_unitaire,
        //                              recevable }, ...] }
        // Trie par recevable decroissant.
        detail_cdc_par_centre: Array.from(detailParCentre.entries())
            .map(([centre, parProd]) => {
                const lignes = Array.from(parProd.values()).map((d) => {
                    const monPrixMoyen = d.quantite_cdc > 0
                        ? d.prix_vente_x_qte / d.quantite_cdc
                        : 0;
                    const margeUnit = d.quantite_cdc > 0
                        ? d.recevable / d.quantite_cdc
                        : 0;
                    return {
                        produit: d.produit,
                        quantite_cdc: round2(d.quantite_cdc),
                        prix_achat: d.prix_achat == null ? null : round2(d.prix_achat),
                        mon_prix_moyen: round2(monPrixMoyen),
                        marge_unitaire: round2(margeUnit),
                        recevable: round2(d.recevable),
                        ventes: d.ventes // ventes individuelles pour drill-down UI
                    };
                }).sort((a, b) => b.recevable - a.recevable);
                const totalRec = lignes.reduce((s, l) => s + l.recevable, 0);
                const totalQte = lignes.reduce((s, l) => s + l.quantite_cdc, 0);
                return {
                    centre,
                    total_recevable: round2(totalRec),
                    total_quantite: round2(totalQte),
                    detail: lignes
                };
            })
            .sort((a, b) => b.total_recevable - a.total_recevable),
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

module.exports = {
    computeCreances,
    toDDMMYYYY,
    defaultPeriode
};
