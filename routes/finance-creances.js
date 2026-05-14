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
    FinanceConfig,
    FournisseurPaiement,
    DecoupeOrderLog,
    PrixVenteCdcHistory
} = require('../db/models');
const { parseCentres } = require('./decoupe-helpers');
const { resolveProduit, buildResolverMaps } = require('../lib/produit-resolver');
const financeCache = require('../lib/finance-cache');

/**
 * Construit un lookup point-in-time du prix_vente_cdc effectif pour
 * chaque produit a une date donnee.
 *
 * @param {Array} historyRows - PrixVenteCdcHistory.findAll() ordered ASC
 * @returns {(produitNomLower: string, dateISO: string) => number|null}
 *   Fonction qui retourne le prix effectif (en regardant la derniere
 *   entree avec created_at <= fin de la dateISO), ou null si aucune.
 */
function buildPrixCdcResolver(historyRows) {
    // Pre-grouper par produit (lowercase), tries ASC sur created_at.
    const byProduit = new Map();
    for (const h of historyRows) {
        const key = h.produit.toLowerCase();
        if (!byProduit.has(key)) byProduit.set(key, []);
        byProduit.get(key).push({
            ts: new Date(h.created_at),
            prix: parseFloat(h.prix_vente_cdc)
        });
    }
    // Trier par ts ASC pour chaque produit (le find iterant retournera
    // la derniere entree <= cutoff).
    for (const arr of byProduit.values()) {
        arr.sort((a, b) => a.ts - b.ts);
    }
    return function getPrixAtDate(produitNomLower, dateISO) {
        const arr = byProduit.get(produitNomLower);
        if (!arr || arr.length === 0) return null;
        // dateISO = "YYYY-MM-DD" -> on prend fin de journee pour inclure
        // toute la journee de la vente.
        const cutoff = new Date(dateISO + 'T23:59:59.999Z');
        let effective = null;
        for (const entry of arr) {
            if (entry.ts <= cutoff) effective = entry.prix;
            else break; // sorted ASC, no point continuing
        }
        return effective;
    };
}

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
    // Parse via ISO timestamp Z (UTC explicite) plutot que Date.UTC(y,m-1,d):
    // moins de risque de transposition d'arguments et plus lisible.
    const parse = (s) => new Date(`${s}T00:00:00Z`);
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

    // 2. Lire catalogue + aliases depuis le cache memoire (TTL 60s).
    //    Invalidation automatique sur toute mutation cote routes/finance.js.
    const { catalog: prixRows, aliases: aliasRows } = await financeCache.getCatalogAndAliases();

    // Helper partage avec routes/finance.js (UI Mapping) pour eviter la
    // divergence statut affiche / calcul. Cf lib/produit-resolver.js.
    const resolverMaps = buildResolverMaps(prixRows, aliasRows);
    const lookupPrix = (produitNom) => {
        const r = resolveProduit(produitNom, resolverMaps);
        return r.value; // {prix_vente, prix_achat, prix_vente_cdc (courant)} ou null
    };

    // 2bis. Lookup point-in-time du prix_vente_cdc. Permet d'utiliser la
    // valeur effective AU MOMENT DE LA VENTE, pas la valeur courante.
    // Le resolverMaps fournit le nom canonique (via alias) qu'on utilise
    // comme cle dans l'history.
    const historyRows = await PrixVenteCdcHistory.findAll({
        order: [['created_at', 'ASC']]
    });
    const prixCdcAtDate = buildPrixCdcResolver(historyRows);
    /** Resout le prix_vente_cdc effectif pour (produit_vente, vente_date). */
    const lookupPrixCdcAtDate = (produitVenteNom, venteDateISO) => {
        // Trouver le nom canonique du catalogue via le resolver.
        const r = resolveProduit(produitVenteNom, resolverMaps);
        if (!r.resolved) return null;
        const fromHistory = prixCdcAtDate(r.resolved.toLowerCase(), venteDateISO);
        if (fromHistory != null) return fromHistory;
        // Fallback: valeur courante du catalogue (cas pas de genesis).
        return r.value && r.value.prix_vente_cdc != null
            ? r.value.prix_vente_cdc
            : (r.value ? r.value.prix_vente : null);
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
    // Garde defensif: dans le setup actuel, aucun PV ne s'appelle "Centre
    // de Decoupe X". Mais si un futur tenant ouvre une boutique a cet
    // emplacement (PV nomme comme un centre), pos.js:1730 met
    // preparation=pointVente par defaut, et on classerait a tort cette
    // vente locale comme une livraison CDC. Regle: une vente CDC doit
    // avoir preparation DIFFERENTE du pointVente — sinon vente locale.
    // No-op aujourd'hui, defensive pour demain.
    const getVenteCentre = (v) => {
        const prep = (v.preparation || '').trim().toLowerCase();
        const pv = (v.pointVente || '').trim().toLowerCase();
        if (!prep || prep === pv) return null;
        return centreLowerToOriginal.get(prep) || null;
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
        // Point-in-time: utilise le prix_vente_cdc effectif a la date de
        // la vente (cf prix_vente_cdc_history). Changer le prix
        // aujourd'hui n'impacte pas les ventes passees.
        const centre = getVenteCentre(v);
        let recevableLigne = 0;
        const monPrix = parseFloat(v.prixUnit) || 0;
        const prixVenteCdc = lookupPrixCdcAtDate(v.produit, v.date) || 0;
        if (centre && prix.prix_achat != null) {
            recevableLigne = (prixVenteCdc - prix.prix_achat) * qte;
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
                prix_vente_cdc_courant: prix.prix_vente_cdc, // valeur catalogue actuelle (info edition)
                prix_vente_cdc_x_qte: 0, // somme(prix_vente_cdc_effectif × qte) pour moyenne ponderee
                prix_vente_x_qte: 0, // somme(mon_prix POS * qte) - garde pour info debug
                recevable: 0,
                ventes: []
            };
            cAgg.quantite_cdc += qte;
            cAgg.prix_vente_cdc_x_qte += prixVenteCdc * qte;
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
                prix_vente_cdc_effectif: prixVenteCdc, // prix point-in-time pour cette vente
                marge_unitaire: prixVenteCdc - prix.prix_achat,
                recevable_ligne: round2(recevableLigne),
                nom_client: v.nomClient || null,
                numero_client: v.numeroClient || null,
                commande_id: v.commandeId || null,
                source: 'vente'
            });
            parProd.set(key, cAgg);
        }
    }

    // 5bis. Charger les commandes envoyees au Centre de Decoupe.
    // Ces commandes vivent dans decoupe_order_logs (PAS dans ventes) et
    // doivent etre traitees comme des ventes CDC pour le calcul de la
    // marge "Il me doit". On NE LES INSERE PAS dans ventes (eviterait le
    // double counting cote "Montant Total des Ventes" du dashboard).
    // Filtre par created_at sur la periode + centre dans la liste autorisee.
    // Bornes: [dateDebut 00:00:00Z, dateFin+1J 00:00:00Z) pour inclure
    // toutes les ms de dateFin (T23:59:59Z manquerait les .500/.999ms).
    const nextDay = new Date(`${dateFin}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const decoupeLogs = await DecoupeOrderLog.findAll({
        where: {
            created_at: {
                [Op.gte]: `${dateDebut}T00:00:00Z`,
                [Op.lt]: nextDay.toISOString()
            }
        }
    });

    for (const log of decoupeLogs) {
        // Normaliser: trim + lowercase. Les valeurs peuvent avoir des
        // espaces de bord ("Centre de Découpe Banlieue ") qui rateraient
        // le match strict toLowerCase.
        const rawCentre = log.point_vente_executant;
        const normalizedCentre = rawCentre ? String(rawCentre).trim().toLowerCase() : '';
        if (!normalizedCentre || !centreLowerToOriginal.has(normalizedCentre)) continue;
        const centreOriginal = centreLowerToOriginal.get(normalizedCentre);

        const produits = Array.isArray(log.produits) ? log.produits : [];
        for (const p of produits) {
            const qte = parseFloat(p.nombre != null ? p.nombre : p.quantity) || 0;
            if (qte <= 0) continue;
            const categorie = p.categorie || p.category || '';
            // Verifier eligibilite categorie (meme regle que les ventes).
            if (!categoriesEligibles.includes(categorie)) continue;
            const produitNom = p.produit || p.name || '';
            const prix = lookupPrix(produitNom);
            if (!prix) continue;

            const monPrix = parseFloat(p.prixUnit != null ? p.prixUnit : p.price) || 0;
            // Point-in-time: date du log = la date a laquelle la commande
            // a ete envoyee au centre (created_at du log).
            const logDateISO = log.createdAt
                ? new Date(log.createdAt).toISOString().slice(0, 10)
                : (log.created_at ? new Date(log.created_at).toISOString().slice(0, 10) : null);
            const prixVenteCdc = logDateISO ? (lookupPrixCdcAtDate(produitNom, logDateISO) || 0) : 0;

            // Commission 3% (dette envers le fournisseur)
            const detteLigne = (commissionPct / 100) * prix.prix_vente * qte;
            totalDette += detteLigne;

            // Recevable: par definition les commandes decoupe SONT des
            // ventes CDC, donc on accumule directement (pas besoin du
            // check getVenteCentre comme pour les Ventes locales).
            // Utilise prix_vente_cdc point-in-time effectif a la date du log.
            let recevableLigne = 0;
            if (prix.prix_achat != null) {
                recevableLigne = (prixVenteCdc - prix.prix_achat) * qte;
                totalRecevable += recevableLigne;
            }

            // Agregat global par produit
            const key = produitNom;
            const agg = detail.get(key) || {
                produit: key,
                quantite: 0,
                quantite_cdc: 0,
                prix_achat: prix.prix_achat,
                dette: 0,
                recevable: 0
            };
            agg.quantite += qte;
            if (prix.prix_achat != null) agg.quantite_cdc += qte;
            agg.dette += detteLigne;
            agg.recevable += recevableLigne;
            detail.set(key, agg);

            // Agregat par (centre, produit)
            if (prix.prix_achat != null) {
                if (!detailParCentre.has(centreOriginal)) {
                    detailParCentre.set(centreOriginal, new Map());
                }
                const parProd = detailParCentre.get(centreOriginal);
                const cAgg = parProd.get(key) || {
                    produit: key,
                    quantite_cdc: 0,
                    prix_achat: prix.prix_achat,
                    prix_vente_cdc_courant: prix.prix_vente_cdc,
                    prix_vente_cdc_x_qte: 0,
                    prix_vente_x_qte: 0,
                    recevable: 0,
                    ventes: []
                };
                cAgg.quantite_cdc += qte;
                cAgg.prix_vente_cdc_x_qte += prixVenteCdc * qte;
                cAgg.prix_vente_x_qte += monPrix * qte;
                cAgg.recevable += recevableLigne;
                cAgg.ventes.push({
                    date: logDateISO,
                    produit_brut: produitNom,
                    categorie,
                    preparation: centreOriginal,
                    point_vente: log.point_vente || null,
                    nombre: qte,
                    prix_unit: monPrix,
                    prix_achat: prix.prix_achat,
                    prix_vente_cdc_effectif: prixVenteCdc,
                    marge_unitaire: prixVenteCdc - prix.prix_achat,
                    recevable_ligne: round2(recevableLigne),
                    nom_client: log.nom_client || null,
                    numero_client: log.numero_client || null,
                    commande_id: log.commande_ref || null,
                    source: 'decoupe'
                });
                parProd.set(key, cAgg);
            }
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
        //                              prix_vente_cdc, marge_unitaire,
        //                              mon_prix_moyen (info debug),
        //                              recevable }, ...] }
        // Trie par recevable decroissant.
        detail_cdc_par_centre: Array.from(detailParCentre.entries())
            .map(([centre, parProd]) => {
                const lignes = Array.from(parProd.values()).map((d) => {
                    // Prix POS moyen pondere (info debug, pas dans le calcul).
                    const monPrixMoyen = d.quantite_cdc > 0
                        ? d.prix_vente_x_qte / d.quantite_cdc
                        : 0;
                    // Prix vente CDC moyen pondere (point-in-time): si les
                    // ventes du produit couvrent une periode ou le prix a
                    // change, on affiche la moyenne effective.
                    const prixCdcMoyen = d.quantite_cdc > 0
                        ? d.prix_vente_cdc_x_qte / d.quantite_cdc
                        : 0;
                    // Marge moyenne ponderee (recevable / qte).
                    const margeUnit = d.quantite_cdc > 0
                        ? d.recevable / d.quantite_cdc
                        : 0;
                    return {
                        produit: d.produit,
                        quantite_cdc: round2(d.quantite_cdc),
                        prix_achat: d.prix_achat == null ? null : round2(d.prix_achat),
                        // Prix CDC moyen ponderé point-in-time (peut differer
                        // de prix_vente_cdc_courant si une vente est anterieure
                        // au dernier changement de prix).
                        prix_vente_cdc: round2(prixCdcMoyen),
                        // Valeur courante du catalogue (= ce qu'on edite via UI).
                        prix_vente_cdc_courant: d.prix_vente_cdc_courant == null
                            ? null
                            : round2(d.prix_vente_cdc_courant),
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
