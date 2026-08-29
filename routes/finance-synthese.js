/**
 * SYNTHESE FINANCIERE pour l'API externe - GET /api/external/finance/synthese.
 *
 * Une date, cinq blocs: le PL cumule du mois, la serie des PL journaliers,
 * l'explication de la journee, la Valeur cash et stock, et la projection de
 * fin de mois. Chaque bloc vient du MEME calcul que l'ecran correspondant -
 * computePl, computeEcartJour, computeCashStock, computeSimulation, tous
 * exportes par routes/finance.js - jamais d'une seconde formule.
 *
 * CHAQUE BLOC EST ISOLE: un echec y inscrit { erreur } sans emporter les
 * autres. Un consommateur externe qui veut la Valeur du jour n'a pas a payer
 * une projection qui tombe, et inversement - il voit ou ca a casse, et le
 * reste reste exploitable.
 *
 * FIABILITE DITE PARTOUT: avances provisoires, points de vente sans saisie,
 * date de stock repliee, trous non recalcules de la serie journaliere. Un
 * lecteur externe (DATA, un LLM) doit savoir si un chiffre est ferme AVANT
 * de s'en servir - c'est la regle de tous les exports de ce depot.
 */

'use strict';

const financeRouter = require('./finance');
const { calculerProjection } = require('../lib/synthese-projection');
const { PlSnapshot, sequelize } = require('../db/models');
const { Op } = require('sequelize');

const BLOCS_VALIDES = ['pl', 'pl_journalier', 'journee', 'cash_et_stock', 'projection'];

// La serie journaliere recalcule les TROUS (jours sans PL fige), mais pas a
// n'importe quel prix: chaque recalcul rejoue computePl. Un mois entierement
// vide en couterait trente sur une seule requete - au-dela de ce plafond, les
// trous restants sont rendus comme 'absent', et la sortie le compte.
const RECALCULS_MAX = 10;

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(n) {
    return Math.round(nb(n) * 100) / 100;
}

/** Les dates ISO d'un mois, du 1er a `fin` incluse. Arithmetique pure. */
function joursDuMois(debut, fin) {
    const jours = [];
    let d = new Date(debut + 'T00:00:00Z');
    const borne = new Date(fin + 'T00:00:00Z');
    while (d <= borne) {
        jours.push(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86400000);
    }
    return jours;
}

/** La veille d'une date ISO. */
function veilleDe(iso) {
    return new Date(new Date(iso + 'T00:00:00Z').getTime() - 86400000)
        .toISOString().slice(0, 10);
}

/** Le top 3 des commandes du jour, produits condenses en une ligne lisible. */
function topCommandes(cj) {
    return ((cj && cj.commandes) || []).slice(0, 3).map((c) => ({
        client: c.client || c.commande_id || 'comptoir',
        ca: c.ca,
        marge: c.marge,
        taux_pct: c.taux_pct,
        produits: (c.produits || []).map((x) =>
            x.produit + ' ' + x.quantite + ' ' + (x.unite === 'kg' ? 'kg' : 'pc')).join(', ')
    }));
}

/**
 * Bloc PL: le cumul du 1er du mois a la date, reshape comme l'export JSON de
 * l'ecran (js/finance.js, construirePayloadPl) - memes noms, memes signaux.
 */
async function blocPl(debut, fin) {
    const d = await financeRouter.computePlMemoise(debut, fin);
    // Les clients de la periode sont un COMPLEMENT: leur echec ne doit pas
    // emporter le PL - meme regle que la route /pl.
    let clients = null;
    try {
        clients = await financeRouter.clientsPeriodeMemoise(debut, fin);
    } catch (e) {
        console.warn('[synthese] clients de la periode indisponibles:', e.message);
    }
    const sortie = {
        pl: d.pl,
        postes: {
            total_ventes: d.total_ventes,
            ventes_boucherie: d.ventes_boucherie,
            ventes_hors_boucherie: d.ventes_hors_boucherie,
            total_avances: d.total_avances,
            commission_maas: d.commission_maas,
            marge_cdc: d.marge_cdc,
            charges_proratisees: (d.charges || {}).total_prorata,
            depenses_periode: d.depenses_periode,
            paiements_fournisseur: d.paiements_fournisseur,
            variation_stock_nette: (d.stock || {}).variation_nette
        },
        marge_des_ventes: {
            montant: d.marge_des_ventes,
            taux_pct: d.taux_marge,
            cout_des_ventes: d.cout_des_ventes
        },
        charges: d.charges,
        stock: d.stock,
        volumes: d.volumes,
        sources: d.sources,
        fiabilite: {
            // true = des avances du mois sont encore provisoires: le PL peut
            // bouger. Un lecteur qui l'ignore prend un provisoire pour un final.
            avances_provisoires: d.avances_provisoires || false,
            avances_provisoires_detail: d.avances_provisoires_detail || null,
            ventes_date_fin: d.ventes_date_fin === undefined ? null : d.ventes_date_fin
        }
    };
    if (clients) {
        sortie.clients_periode = {
            nb_clients: clients.nb_clients,
            total_ca: clients.total_ca,
            total_marge: clients.total_marge,
            total_commandes: clients.total_commandes,
            ca_sans_cout: clients.ca_sans_cout,
            top_clients: (clients.clients || []).slice(0, 5).map((c) => ({
                client: c.client, ca: c.ca, marge: c.marge, taux_pct: c.taux_pct
            })),
            comptoir: clients.comptoir ? {
                nb_commandes: clients.comptoir.nb_commandes,
                total_ca: clients.comptoir.total_ca,
                total_marge: clients.comptoir.total_marge
            } : null,
            produits_en_perte_ou_sans_cout: (clients.produits_periode || [])
                .filter((x) => (x.marge !== null && x.marge < 0) || x.marge === null)
                .slice(0, 10)
        };
    }
    // La note du mois: le contexte qu'un humain a juge bon d'ecrire. Best
    // effort, comme partout.
    try {
        const rows = await sequelize.query(
            'SELECT texte FROM finance_notes_mois WHERE mois = :mois AND ecran = :ecran',
            {
                type: sequelize.QueryTypes.SELECT,
                replacements: { mois: fin.slice(0, 7), ecran: 'pl' }
            }
        );
        if (rows[0] && rows[0].texte) sortie.note_du_mois = rows[0].texte;
    } catch (e) { /* la note est un bonus, pas une condition */ }
    return sortie;
}

/**
 * Bloc PL JOURNALIER: un point par jour du mois, servi des PL figes
 * (pl_snapshots), les trous recalcules - les plus recents d'abord, plafond
 * RECALCULS_MAX - et le reste rendu 'absent' plutot que tu.
 */
async function blocPlJournalier(debut, fin) {
    const rows = await PlSnapshot.findAll({
        where: { date: { [Op.between]: [debut, fin] } },
        attributes: ['date', 'pl', 'source'],
        order: [['date', 'ASC']],
        raw: true
    });
    const parDate = new Map(rows.map((r) => [String(r.date).slice(0, 10), r]));
    const jours = joursDuMois(debut, fin);

    // Les trous, combles du plus RECENT au plus ancien: la fin du mois est ce
    // qu'un consommateur regarde d'abord, et la date demandee est deja dans
    // la memoisation du bloc PL - son recalcul est gratuit.
    const trous = jours.filter((j) => !parDate.has(j)).reverse();
    const recalcules = new Map();
    let recalculsEchoues = 0;
    for (const j of trous.slice(0, RECALCULS_MAX)) {
        try {
            const d = await financeRouter.computePlMemoise(debut, j);
            recalcules.set(j, nb(d.pl));
        } catch (e) {
            recalculsEchoues += 1;
            console.warn('[synthese] recalcul PL du ' + j + ' echoue:', e.message);
        }
    }

    const cumulDe = (j) => {
        if (parDate.has(j)) return nb(parDate.get(j).pl);
        if (recalcules.has(j)) return recalcules.get(j);
        return null;
    };
    const serie = jours.map((j, i) => {
        const cumul = cumulDe(j);
        const source = parDate.has(j) ? parDate.get(j).source
            : (recalcules.has(j) ? 'recalcul' : 'absent');
        // La contribution de la journee = cumul(J) - cumul(J-1), les deux
        // partant du meme 1er du mois. Au 1er, la veille est un cumul vide.
        let plDuJour = null;
        if (cumul !== null) {
            if (i === 0) plDuJour = cumul;
            else {
                const veille = cumulDe(jours[i - 1]);
                if (veille !== null) plDuJour = round2(cumul - veille);
            }
        }
        return {
            date: j,
            pl_cumul: cumul === null ? null : round2(cumul),
            pl_du_jour: plDuJour,
            source: source
        };
    });
    const absents = serie.filter((l) => l.source === 'absent').length;
    return {
        jours: serie,
        fiabilite: {
            nb_figes: rows.length,
            nb_recalcules: recalcules.size,
            // Non nul = la serie est incomplete par construction (plafond de
            // recalculs atteint ou recalculs echoues), pas par oubli.
            nb_absents: absents,
            recalculs_echoues: recalculsEchoues
        }
    };
}

/**
 * Bloc JOURNEE: l'ecart poste a poste entre la date et sa veille - le meme
 * panneau « D'ou vient cet ecart ? » que le PL, en JSON.
 */
async function blocJournee(debut, fin) {
    const r = await financeRouter.computeEcartJour({
        dateISO: fin,
        veilleISO: veilleDe(fin),
        mode: 'auto',
        debut: debut
    });
    if (!r || r.ok !== true) {
        return {
            date: fin,
            ok: false,
            raison: (r && r.raison) || 'ecart_non_calculable',
            message: (r && r.message) || 'ecart non calculable'
        };
    }
    const cj = r.commandes_jour || null;
    return {
        date: r.date_jour,
        ok: true,
        pl_du_jour: (r.pl || {}).ecart,
        pl_cumul: { veille: (r.pl || {}).veille, jour: (r.pl || {}).jour },
        // La contribution de chaque poste, sommant a pl_du_jour - le bouclage
        // en fait foi, residu compris.
        ecart_postes: Object.fromEntries((r.postes || [])
            .map((p) => [p.cle, p.contribution])),
        bouclage: r.bouclage,
        // Marchandise seule (ventes + stock - avances - paiements), avant
        // commission, charges et depenses.
        marge_marchandise: r.marge_jour,
        drapeaux: (r.drapeaux || []).map((f) => f.texte),
        commandes: cj ? {
            nb: (cj.commandes || []).length,
            total_ca: cj.total_ca,
            total_marge: cj.total_marge,
            top: topCommandes(cj)
        } : null,
        sources: {
            jour: r.source_jour,
            veille: r.source_veille,
            jour_recalcule: !!r.jour_recalcule,
            veille_recalculee: !!r.veille_recalculee
        }
    };
}

/** Bloc CASH ET STOCK: la Valeur du jour et sa decomposition. */
async function blocCashStock(fin, todayISO) {
    const d = await financeRouter.computeCashStock(fin, todayISO);
    const stock = d.stock || {};
    const cash = d.cash || {};
    return {
        date: d.date,
        valeur: d.valeur,
        decomposition: {
            stock_soir_brut: stock.soir_brut,
            stock_boucherie: stock.soir_boucherie,
            coefficient_decoupe: stock.coeff,
            pertes_decoupe_pct: stock.pertes_decoupe_pct,
            stock_hors_boucherie: stock.soir_hors_boucherie,
            stock_soir_net: stock.soir_net,
            cash_total_caisse: cash.total,
            depot_mata: d.depot_mata,
            solde_du_fournisseur: d.solde_du_fournisseur
        },
        solde_periode: d.solde_periode,
        cash_par_point_de_vente: cash.par_pv || [],
        cash_theorique: d.cash_theorique,
        fiabilite: {
            pv_renseignes: cash.nb_pv_renseigne,
            pv_avec_cloture: cash.nb_pv_avec_cloture,
            pv_sans_saisie: cash.pv_sans_saisie || [],
            // Differente de la date demandee = repli sur le dernier snapshot
            // de stock disponible.
            stock_date_utilisee: stock.soir_date_utilisee,
            produits_au_prix_de_vente: stock.produits_au_prix_de_vente || [],
            aucune_donnee: !!d.aucune_donnee
        }
    };
}

/** Bloc PROJECTION: la fin de mois estimee, hypotheses par defaut de l'ecran. */
async function blocProjection(debut, fin) {
    const [sim, pl, cfg] = await Promise.all([
        financeRouter.computeSimulation(debut, fin),
        financeRouter.computePlMemoise(debut, fin),
        financeRouter.lireConfigPublique()
    ]);
    return calculerProjection({ sim, pl, commissionPct: cfg.commission_pct });
}

/**
 * La synthese complete. `date` est une ISO deja validee; `blocs` la liste
 * demandee (defaut: tous).
 *
 * @returns {Object} { date, periode, a_propos, <blocs>... }
 */
async function construireSynthese({ date, blocs, todayISO }) {
    const debut = date.slice(0, 8) + '01';
    const demandes = (blocs && blocs.length) ? blocs : BLOCS_VALIDES;
    const sortie = {
        date: date,
        periode: { debut: debut, fin: date },
        a_propos: {
            pl: 'Cumul du 1er du mois a la date. Formule: ventes - avances - '
                + 'commission MaaS + marge CDC - charges proratisees - depenses - '
                + 'paiements fournisseur + variation de stock nette.',
            pl_journalier: 'Serie des PL figes du mois, un point par jour; les '
                + 'trous sont recalcules (source: recalcul) dans la limite de '
                + RECALCULS_MAX + ' par requete, sinon rendus absents.',
            journee: 'Ecart poste par poste entre le PL de la date et celui de '
                + 'la veille. Les deux cumuls partent du meme 1er du mois: leur '
                + 'difference est la contribution de la journee.',
            cash_et_stock: 'Valeur = stock soir x coefficient de decoupe + cash '
                + 'en caisse - depot Mata - solde du fournisseur (commission '
                + 'MaaS du mois en cours).',
            projection: 'Fin de mois estimee par la methode de l\'ecran '
                + 'Simulation 2.0, aux hypotheses par defaut - toutes redites '
                + 'dans projection.hypotheses.'
        }
    };

    // LE PL D'ABORD, SEUL: quatre des cinq blocs relisent computePlMemoise,
    // et la memoisation stocke le RESULTAT, pas la promesse - lances de
    // front, chacun aurait recalcule le PL de son cote. Une fois le memo
    // chaud, le reste part en parallele.
    if (demandes.includes('pl') || demandes.includes('projection')
        || demandes.includes('pl_journalier') || demandes.includes('journee')) {
        try {
            await financeRouter.computePlMemoise(debut, date);
        } catch (e) {
            // Chaque bloc redira l'echec dans son propre champ { erreur }.
            console.warn('[synthese] prechauffage PL echoue:', e.message);
        }
    }

    const fabriques = {
        pl: () => blocPl(debut, date),
        pl_journalier: () => blocPlJournalier(debut, date),
        journee: () => blocJournee(debut, date),
        cash_et_stock: () => blocCashStock(date, todayISO),
        projection: () => blocProjection(debut, date)
    };
    await Promise.all(demandes.map(async (nom) => {
        try {
            sortie[nom] = await fabriques[nom]();
        } catch (e) {
            console.error('[synthese] bloc ' + nom + ' en echec:', e.message);
            sortie[nom] = { erreur: e.message };
        }
    }));
    return sortie;
}

module.exports = { construireSynthese, BLOCS_VALIDES, RECALCULS_MAX };
