/**
 * Projection de fin de mois COTE SERVEUR, pour l'API externe de synthese.
 *
 * Ce module est le miroir de la couche calcul de l'ecran Simulation 2.0
 * (js/simulation-v2.js, projectionCorps): memes modules purs, memes appels,
 * dans le meme ordre. Il n'ecrit AUCUNE formule lui-meme: tout le calcul
 * vient de js/simulation-v2-projection.js et js/simulation-v2-moteur.js,
 * partages tels quels entre le navigateur et Node par leur enveloppe UMD.
 * Une divergence entre l'ecran et l'API supposerait donc une divergence de
 * ce fichier avec l'orchestration de l'ecran - pas une seconde formule.
 *
 * HYPOTHESES FIGEES aux valeurs par defaut de l'ecran au chargement:
 * ponderation 70 % reel / 30 % historique, minimum 5 jours mesures,
 * dimanches exclus, CA projete « volumes x derniers prix », variation de
 * stock conservee, depenses realisees a date, cible = equilibre (0), aucune
 * saisie manuelle. Elles sont toutes REDITES dans `hypotheses` de la sortie:
 * un lecteur de l'API doit savoir sous quelles regles le chiffre est sorti.
 *
 * Entrees: les payloads DEJA calcules par routes/finance.js -
 * computeSimulation (sim) et computePl (pl) - plus le taux de commission.
 * Le module reste pur: pas de base, pas de reseau, donc testable seul.
 */

'use strict';

const PJ = require('../js/simulation-v2-projection.js');
const M = require('../js/simulation-v2-moteur.js');

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

// ASSISE MINIMALE d'un parage mesure - meme seuil et meme raison que
// l'ecran (js/simulation-v2.js, MIN_JOURS_PARAGE): sous cinq journees
// mesurables, la moyenne tient a une seule observation et le parametre
// reprend la main.
const MIN_JOURS_PARAGE = 5;

/** Le taux de parage RETENU pour une espece: le mesure, ou le parametre. */
function parageRetenu(mesure, base, mini, espece) {
    const v = mesure ? mesure[espece] : null;
    if (v === null || v === undefined) return nb(base);
    const n = (mesure.jours_mesures) ? nb(mesure.jours_mesures[espece]) : 0;
    return n < nb(mini) ? nb(base) : nb(v);
}

/**
 * Quantite de carcasse bovine d'une borne de stock. Seules les lignes
 * valorisees AU PRIX D'ACHAT comptent, et la famille est bovine (le Veau y
 * entre), pas la seule graphie 'boeuf'. Copie conforme de qBoeuf de l'ecran.
 */
function qBoeuf(detail) {
    let t = 0;
    (detail || []).forEach((l) => {
        if (l.base === 'achat' && /^(boeuf|veau)/.test(M.normaliserNom(l.produit))) {
            t += nb(l.quantite);
        }
    });
    return t;
}

/**
 * Le contexte du moteur, tel que preparer() de l'ecran le construit -
 * parages retenus par espece, commission, prix catalogue.
 */
function construireContexte(sim, pl, commissionPct) {
    const stock = pl.stock || {};
    const parageBase = nb(stock.pertes_decoupe_pct);
    const pm = sim.parage_mesure || null;
    const parageDe = (espece) => parageRetenu(pm, parageBase, MIN_JOURS_PARAGE, espece);
    return {
        varBovin: nb(stock.variation_bovin),
        varOvin: nb(stock.variation_ovin),
        varAutre: nb(stock.variation_autre_boucherie),
        coeff: nb(stock.coeff),
        parageBase: parageBase,
        parageBovin: parageDe('bovin'),
        parageOvin: parageDe('ovin'),
        parageMesure: pm,
        parageMinJours: MIN_JOURS_PARAGE,
        boeuf: { matin: qBoeuf(stock.matin_detail), soir: qBoeuf(stock.soir_detail) },
        commission: nb(pl.commission_maas),
        // nb(v) || 3 traiterait un taux configure a 0 comme absent (0 est
        // faux en JS) et le remplacerait par le defaut 3 - un admin qui
        // configure explicitement 0% verrait son reglage ignore en silence.
        commissionPct: Number.isFinite(parseFloat(commissionPct)) ? nb(commissionPct) : 3,
        pv: {
            bovin: sim.catalogue ? sim.catalogue.pv_boeuf : null,
            ovin: sim.catalogue ? sim.catalogue.pv_agneau : null,
            volaille: sim.catalogue ? sim.catalogue.pv_poulet : null,
            par_produit: (sim.catalogue && sim.catalogue.par_produit) || {}
        }
    };
}

/**
 * Le prix de vente retenu pour les jours qui restent: le majoritaire du
 * dernier jour vendu (prix_retenu du serveur), sinon le prix moyen. Pas de
 * saisie manuelle cote API - c'est le defaut de l'ecran au chargement.
 */
function prixSuiteDe(p) {
    const pr = p.prix_retenu;
    if (pr && nb(pr.prix) > 0) return nb(pr.prix);
    return (p.prix_moyen === null || p.prix_moyen === undefined) ? null : nb(p.prix_moyen);
}

/** Le produit vu aux prix de la SUITE du mois - vente ET achat. */
function auPrixDeLaSuite(p) {
    const px = prixSuiteDe(p);
    const pa = (p.prix_achat_fin === null || p.prix_achat_fin === undefined)
        ? null : nb(p.prix_achat_fin);
    if (px === null && pa === null) return p;
    const copie = Object.assign({}, p);
    if (px !== null) copie.prix_moyen = px;
    // Un prix de fin nul ou absent laisse la moyenne en place: mieux vaut un
    // cout approche qu'aucun cout, et prix_achat_origine dit d'ou il vient.
    if (pa !== null && pa > 0) copie.prix_achat = pa;
    return copie;
}

/**
 * L'assiette de la commission pour un produit: son propre prix catalogue
 * d'abord, la carcasse de son espece ensuite, rien du tout en dernier.
 */
function prixCatalogueDe(p, contexte) {
    const pv = contexte.pv || {};
    const propre = (pv.par_produit || {})[M.normaliserNom(p && p.nom)];
    if (nb(propre) > 0) return nb(propre);
    if (M.estBoeuf(p)) return pv.bovin;
    if (M.estOvin(p)) return pv.ovin;
    if (M.estVolaille(p)) return pv.volaille;
    return null;
}

/**
 * Constats de parage suspect, textes SANS HTML - la version API des alertes
 * rouges de l'ecran. Suspect: le taux applique vient de la mesure, et il
 * vaut au moins le double du parametre avec 5 points d'ecart.
 */
function alertesParage(contexte) {
    const alertes = [];
    const pm = contexte.parageMesure || {};
    [['bovin', 'parageBovin', 'boeuf'], ['ovin', 'parageOvin', 'agneau']].forEach((e) => {
        const applique = nb(contexte[e[1]]);
        const base = nb(contexte.parageBase);
        const mesure = pm[e[0]];
        if (mesure === null || mesure === undefined) return;
        if (nb(mesure) !== applique) return;
        if (!(applique >= 2 * base && applique - base >= 5)) return;
        alertes.push(
            'Parage ' + e[2] + ' mesure ' + applique.toFixed(2) + ' % contre '
            + base.toFixed(2) + ' % de parametre. Une journee dont le stock du soir '
            + 'n\'est pas encore saisi (ou enregistre a zero) gonfle la mesure : '
            + 'verifier le comptage du soir jusqu\'au ' + (pm.jusquau || '—') + '. '
            + 'A ce taux, la marge de la carcasse peut changer de signe - tout le '
            + 'PL projete en herite.'
        );
    });
    return alertes;
}

/**
 * La projection de fin de mois, calculee comme l'ecran la calcule.
 *
 * @param {Object} args
 * @param {Object} args.sim  payload de computeSimulation (routes/finance.js)
 * @param {Object} args.pl   payload de computePl (routes/finance.js)
 * @param {number} args.commissionPct  taux de commission MaaS (config)
 * @returns {Object} le bloc projection de la synthese, ou { indisponible }
 */
function calculerProjection({ sim, pl, commissionPct }) {
    if (!sim || !pl) return { indisponible: 'donnees_manquantes' };
    const pj = sim.projection;
    if (!pj) {
        // La projection n'existe qu'avec le socle Simulation 2.0 actif sur le
        // tenant: hors v2, computeSimulation rend projection: null.
        return { indisponible: 'simulation_v2_inactive' };
    }
    const periode = pl.periode || {};
    const debut = periode.dateDebut || '';
    const fin = periode.dateFin || '';
    if (!/^\d{4}-\d{2}-01$/.test(debut) || fin.slice(0, 7) !== debut.slice(0, 7)) {
        // Meme regle que l'ecran: la projection ne se calcule que du 1er du
        // mois au jour d'analyse.
        return { indisponible: 'periode_hors_mois' };
    }

    const contexte = construireContexte(sim, pl, commissionPct);
    const margeBase = (p) => M.margeAvec(p, { leviers: {}, globaux: {} }, contexte);
    const margeApresCommission = (p) => {
        const m = margeBase(p);
        if (m === null) return null;
        const taux = nb(contexte.commissionPct) / 100;
        if (!taux) return m;
        const prixCatalogue = prixCatalogueDe(p, contexte);
        // Prix catalogue inconnu: marge BRUTE de parage plutot qu'un cout
        // invente - la regle de l'ecran, qui signale cette part non chiffree.
        if (!prixCatalogue) return m;
        const parage = M.estBoeuf(p) ? nb(contexte.parageBovin)
            : (M.estOvin(p) ? nb(contexte.parageOvin) : 0);
        const d = 1 - parage / 100;
        if (!(d > 0)) return m;
        return m - taux * nb(prixCatalogue) / d;
    };

    const sansDim = true;
    const calibre = PJ.calibrerCoeff(pj.historique, sansDim);

    // ORDRE DE PRIORITE du coefficient, comme a l'ecran mais sans le cran
    // « ajuste a la main » (il n'y a pas de main ici): la calibration
    // ENREGISTREE par un administrateur, puis le calcul en direct, puis la
    // reference du document.
    const enr = (pj.coeff_enregistre && isFinite(parseFloat(pj.coeff_enregistre.valeur)))
        ? pj.coeff_enregistre : null;
    let coeff, origineCoeff;
    if (enr) {
        coeff = nb(enr.valeur);
        origineCoeff = 'calibration enregistree'
            + (enr.le ? ' le ' + enr.le : '')
            + (enr.par ? ' par ' + enr.par : '');
    } else if (calibre !== null) {
        coeff = calibre;
        origineCoeff = 'calibre en direct sur les 3 derniers mois';
    } else {
        coeff = nb(pj.coeff_defaut);
        origineCoeff = 'reference du document';
    }

    const POIDS_REEL = 0.7;
    const MIN_JOURS = 5;
    const ca = PJ.projeterCA({
        caParJour: pj.ca_par_jour, debutMois: debut, dateAnalyse: fin,
        histo: pj.historique, coeff: coeff,
        poidsReel: POIDS_REEL, minJours: MIN_JOURS,
        exclureDimanche: sansDim
    });
    if (ca.restants.P1 === 0 && ca.restants.P2 === 0) {
        return {
            indisponible: 'mois_complet',
            detail: 'plus aucun jour d\'ouverture a projeter (dimanches exclus)',
            ca_realise: ca.caRealise
        };
    }

    const postes = {
        total_avances: pl.total_avances, commission_maas: pl.commission_maas,
        marge_cdc: pl.marge_cdc, depenses_periode: pl.depenses_periode,
        paiements_fournisseur: pl.paiements_fournisseur,
        stock_variation_nette: (pl.stock || {}).variation_nette
    };
    const chargesMensuel = (pl.charges || {}).total_mensuel;
    const jours = {
        ecoules: Math.max(1, PJ.joursOuvres(debut, fin, sansDim).length),
        mois: PJ.joursOuvres(debut, ca.finMois, sansDim).length
    };

    // L'univers des produits aux prix de la suite - produits_vendus (v2)
    // d'abord, la liste suivie sinon. Pas de mode fige cote API: la synthese
    // calcule toujours sur la periode vivante.
    const univSens = ((sim.produits_vendus && sim.produits_vendus.length)
        ? sim.produits_vendus : (sim.produits || [])).map(auPrixDeLaSuite);

    const tauxCourant = PJ.tauxMargeCourant({ produits: univSens, margeDe: margeBase });
    const caPlein = PJ.caAuxDerniersPrix(univSens);
    const ventes = nb(pl.total_ventes);
    const propVol = (ventes > 0 && ca.caProjete !== null)
        ? Math.max(0, (ca.caProjete - ventes) / ventes) : 0;
    // Methode « derniers » (le defaut de l'ecran): CA realise + proportion de
    // volume x Sigma(quantite x dernier prix de vente).
    let caRetenu = ca.caProjete;
    if (ca.caProjete !== null && caPlein > 0) {
        caRetenu = ventes + propVol * caPlein;
    }

    const scen = (caRetenu === null) ? null : PJ.scenarios({
        postes: postes, caRealise: ventes, caProjete: caRetenu,
        // Aucune quantite saisie a la main cote API: la marge des restes
        // retombe sur proportion x marge totale, comme l'ecran sans saisie.
        margeRestanteDe: null,
        chargesMensuel: chargesMensuel, stockOption: 'garder',
        depensesOption: 'realise', jours: jours,
        tauxCourant: tauxCourant,
        caPleinDerniersPrix: caPlein > 0 ? caPlein : null
    });
    const conf = PJ.confiance({
        rythmes: ca.rythmes, restants: ca.restants,
        sourcesFiables: !(pl.sources && pl.sources.fiable === false),
        histoDisponible: calibre !== null
    });

    const propSuite = ventes > 0 ? (ca.caProjete - ventes) / ventes : 0;
    const bovinsVol = univSens.filter((p) => M.estBoeuf(p));
    const bovinsMuets = bovinsVol.filter((p) => !(nb(p.quantite) > 0))
        .map((p) => p.nom);
    const bovinsActifs = bovinsVol.filter((p) => nb(p.quantite) > 0);
    const plCentral = (scen && scen.central
        && scen.central.pl !== null && scen.central.pl !== undefined)
        ? nb(scen.central.pl) : null;
    const vp = PJ.volumesProjetes({
        produits: bovinsActifs,
        proportion: propSuite,
        restes: {},
        cleDe: M.normaliserNom,
        margeDe: margeApresCommission,
        plCentral: plCentral,
        cible: 0
    });

    let eq = null;
    let recos = null;
    if (scen && scen.central) {
        eq = PJ.planEquilibre({
            plCentral: scen.central.pl, produits: univSens,
            margeDe: margeApresCommission,
            caRealise: ventes, caProjete: caRetenu,
            joursRestants: ca.restants.P1 + ca.restants.P2,
            jours: jours, facteurMax: 3,
            principal: 'Boeuf en détail', nbProduits: 5,
            cible: 0
        });
        recos = PJ.recommandations({
            plCentral: scen.central.pl,
            cible: 0,
            produits: univSens,
            margeDe: margeApresCommission,
            proportion: propSuite,
            topClients: sim.top_clients || [],
            clientsHistorique: (sim.clients_historique || {}).clients || [],
            dateAnalyse: fin
        });
    }

    // MEME FORME que l'export JSON de l'ecran (construirePayloadProjection):
    // un lecteur - humain ou LLM - qui connait l'un lit l'autre.
    return {
        hypotheses: {
            ca_methode: 'derniers',
            ca_plein_derniers_prix: caPlein > 0 ? caPlein : null,
            ca_projete_retenu: caRetenu,
            ponderation_reel: POIDS_REEL,
            min_jours_mesures: MIN_JOURS,
            exclure_dimanches: sansDim,
            coefficient_p1_p2: coeff,
            origine_coefficient: origineCoeff,
            pl_cible: 0,
            option_stock: 'garder',
            option_depenses: 'realise',
            facteur_max_plafond: 3,
            parage_bovin_pct: contexte.parageBovin,
            parage_ovin_pct: contexte.parageOvin,
            parage_base_pct: contexte.parageBase,
            commission_pct: contexte.commissionPct,
            prix_boeuf_teste: null,
            parage_boeuf_teste: null,
            ecart_parage_scenarios_pts: 3
        },
        periode: { debut: debut, fin: fin },
        jours: jours,
        ca: ca,
        confiance: conf,
        taux_marge_courant: tauxCourant,
        taux_marge_constate_pct: pl.taux_marge,
        scenarios: scen,
        volumes_et_prix: vp,
        plan_equilibre: eq,
        recommandations: recos,
        alertes: alertesParage(contexte),
        // Sans vente depuis le debut du mois, donc hors tableau des volumes -
        // nommes plutot qu'escamotes, comme a l'ecran.
        produits_sans_vente_hors_tableau: bovinsMuets,
        // Regle du document, redite ici: sans realise exploitable, seule la
        // projection de CA est rendue.
        pl_projete_disponible: !!(scen && scen.central)
    };
}

module.exports = {
    calculerProjection,
    // Exposes pour les tests: la regle de repli du parage et le contexte
    // doivent pouvoir se verifier sans monter toute la projection.
    construireContexte,
    parageRetenu,
    auPrixDeLaSuite
};
