/**
 * Routes de l'onglet Finance.
 *
 * Toutes les routes sont gates par checkAdvancedAccess (admin /
 * superutilisateur / superviseur).
 *
 * La creance officielle vis-a-vis du fournisseur viande est lue
 * depuis l'API externe mata-depenses-management (cf
 * lib/depenses-creance-client.js + route GET /api/finance/creances
 * qui agrege l'appel HTTP + le calcul Maas local).
 *
 * Routes exposees:
 *   GET    /api/finance/prix
 *   PUT    /api/finance/prix
 *   DELETE /api/finance/prix/:produit
 *   PUT    /api/finance/prix-cdc/:produit         (prix vente Centre de Decoupe)
 *   GET    /api/finance/prix-cdc/:produit/history (historique des changements)
 *   PUT    /api/finance/prix-achat/:produit       (prix achat fournisseur)
 *   GET    /api/finance/prix-achat/:produit/history
 *   PUT    /api/finance/prix-vente-fournisseur/:produit  (prix vente catalogue)
 *   GET    /api/finance/prix-vente-fournisseur/:produit/history
 *   GET    /api/finance/alias                  (mapping vente -> catalog)
 *   PUT    /api/finance/alias                  (upsert)
 *   DELETE /api/finance/alias/:alias
 *   POST   /api/finance/alias/bulk-from-prefix (snap tous les prefix en aliases)
 *   GET    /api/finance/charges                    (charges mensuelles fixes)
 *   PUT    /api/finance/charges                    (bulk upsert)
 *   POST   /api/finance/charges                    (ajout)
 *   DELETE /api/finance/charges/:nom
 *   GET    /api/finance/pl?dateDebut=&dateFin=     (Profit/Loss - admin/superviseur only)
 *   GET    /api/finance/config
 *   PUT    /api/finance/config
 *   GET    /api/finance/depenses
 *   POST   /api/finance/depenses                (multipart, fichier optionnel)
 *   DELETE /api/finance/depenses/:id
 *   GET    /api/finance/depenses/:id/justificatif
 *   GET    /api/finance/paiements
 *   POST   /api/finance/paiements
 *   DELETE /api/finance/paiements/:id
 *   GET    /api/finance/creances?dateDebut=&dateFin=
 */

'use strict';

const express = require('express');
const multer = require('multer');
const { Op } = require('sequelize');
const { decouperEnMois } = require('../lib/charges-prorata');

const {
    Depense,
    FournisseurPrix,
    FinanceConfig,
    FournisseurPaiement,
    ProduitAlias,
    PrixVenteCdcHistory,
    PrixAchatHistory,
    PrixVenteHistory,
    FinanceCharge,
    FinanceChargeHistory,
    FinanceChargeMois,
    FinanceConfigMois,
    ClotureCaisse,
    Produit,
    Vente,
    PlSnapshot,
    sequelize
} = require('../db/models');
const { resolveProduit, buildResolverMaps, cibleDe } = require('../lib/produit-resolver');
const financeCache = require('../lib/finance-cache');
const audit = require('../lib/finance-audit');
const { ecartJour, resoudreMode, fenetreEntrees } = require('../lib/pl-ecart-jour');

// Limite cote API pour matcher VARCHAR(150) du PK alias_produit.
const ALIAS_PRODUIT_MAX_LENGTH = 150;

// Regex de filtrage inventaire boucherie. Configurable par env pour
// permettre a un tenant (Keur Massar, Sacre Coeur) d'ajuster sans
// toucher au code. Defaut: mots-cles viande senegalais.
//
// Note: pattern type "tete" matchera aussi des noms d'epicerie type
// "Tetes de violon" si jamais ils existent dans l'inventaire. C'est un
// risque connu de cette heuristique simple. Solution propre future:
// marquer les produits inventaire avec une categorie famille=Boucherie
// explicite.
const BOUCHERIE_INCLUDE_REGEX = process.env.FINANCE_BOUCHERIE_INCLUDE_REGEX
    || '(boeuf|veau|agneau|mouton|chevre|chèvre|poulet|foie|abats|yell|sans os|mergez|merguez|tete|tête|laxass|jarret|peaux?)';
const BOUCHERIE_EXCLUDE_REGEX = process.env.FINANCE_BOUCHERIE_EXCLUDE_REGEX
    || '(en gros|en détail|en detail|en dEtail|corne)';
const { parseCentres } = require('./decoupe-helpers');
const { checkAdvancedAccess } = require('../middlewares/auth');

// Expression SQL Postgres qui convertit stocks.date (texte DD-MM-YYYY)
// vers la forme ISO YYYY-MM-DD pour comparaison lex chronologique.
// IMMUTABLE (pure string manip) -> indexable via idx_stocks_date_iso
// (cf db/update-schema.js). Doit rester strictement identique a
// l'expression utilisee dans la definition de l'index, sinon Postgres
// n'utilisera pas l'index pour les requetes.
// Normalisation partagee des noms de produits: casse et accents ignores.
const { normaliserNom: normaliserNomProduit } = require('../lib/parage');

/**
 * Reglages de Simulation 2.0, lus a chaque appel de GET /simulation.
 *
 * Une lecture en echec ne doit JAMAIS ouvrir la v2: on retombe sur le
 * comportement d'origine, qui est celui d'aujourd'hui et qui ne surprend
 * personne. Sur un drapeau qui change des chiffres a l'ecran, le doute ferme.
 */
async function lireReglagesSimulationV2() {
    try {
        return await require('../lib/simulation-v2/reglages').lireReglages();
    } catch (e) {
        console.warn('[simulation] reglages v2 illisibles, comportement d\'origine:', e.message);
        // Le repli porte TOUTES les cles, pas seulement celles qu'un appelant
        // lisait le jour ou il a ete ecrit: `produitsSuivis` et `coeffP1P2` y
        // manquaient, et seul le garde `v2 &&` du premier evitait un
        // « Cannot read properties of undefined » sur une panne de base.
        return {
            actif: false,
            produitsSuivis: [], coeffP1P2: null, avertissements: []
        };
    }
}

const STOCKS_DATE_AS_ISO_SQL =
    "(substring(date FROM 7 FOR 4) || '-' || " +
    "substring(date FROM 4 FOR 2) || '-' || " +
    "substring(date FROM 1 FOR 2))";

// Filtre "cette ligne porte bien une date DD-MM-YYYY". Constante PARTAGEE, et
// non recopiee dans chaque requete.
//
// Il etait ecrit deux fois, et les deux copies ne disaient pas la meme chose:
// valoriserSnapshotStock avait '^\\d{2}...' (correct), produitsAStockSoirNegatif
// avait '^\d{2}...'. Dans un litteral de gabarit, \d vaut d: la seconde
// envoyait '^d{2}-d{2}-d{4}$' a Postgres, ne correspondait a AUCUNE date, et la
// sous-requete rendait NULL. produitsAStockSoirNegatif retournait donc TOUJOURS
// un ensemble vide, et l'exclusion des produits a stock douteux n'a jamais eu
// lieu - alors qu'un commentaire affirmait "STRICTEMENT le meme filtre".
//
// Une chaine ordinaire, pas un gabarit: aucun echappement a doubler.
const STOCKS_DATE_VALIDE_SQL = "date ~ '^\\d{2}-\\d{2}-\\d{4}$'";

// Valorisation d'un snapshot de stock, au prix d'ACHAT quand il est connu.
//
// Cette fonction remplace trois blocs SQL identiques au parametre pres (stock
// matin du PL, stock soir du PL, stock soir de Cash et Stock). Ils faisaient
// SUM(total), c'est-a-dire la somme d'une valorisation au prix de VENTE figee
// a la saisie. Les garder separes aurait fait diverger deux ecrans qui doivent
// afficher le meme stock - ce depot a deja paye ce prix-la plusieurs fois.
//
// Le snapshot retenu est le plus recent <= dateMax, ce qui permet d'afficher
// une valeur un jour ou la saisie du soir n'a pas encore ete faite.
//
// Le prix d'achat est resolu A LA DATE DU SNAPSHOT et non a la date demandee:
// un stock du 05 se valorise au prix du 05, meme si l'ecran affiche le 06. Le
// resolveur (`pourDate`) est celui de /api/external/parage et des creances - en
// brancher un troisieme ici aurait donne trois verites du prix d'achat pour le
// meme produit le meme jour.
//
// @param {'matin'|'soir'} typeStock
// @param {string} dateMax    ISO YYYY-MM-DD, borne haute du snapshot cherche
// @param {Function} pourDate (isoDate) => { prixAchat, ... }
// @param {Set} [produitsExclus] noms de produits a ecarter ENTIEREMENT du
//   snapshot. Sert a sortir des DEUX bornes un produit dont le stock du soir
//   est negatif: sa donnee de stock n'est pas fiable, et ses achats sont deja
//   passes en charge par ailleurs (onglet Depenses).
async function valoriserSnapshotStock(typeStock, dateMax, pourDate, estBoucherie, produitsExclus, categorieDe) {
    // La date du snapshot vient des lignes elles-memes: toutes celles d'un
    // meme snapshot la partagent, donc une seule requete suffit.
    const lignes = await sequelize.query(
        `SELECT date, produit, quantite, total, prix_unitaire
         FROM stocks
         WHERE type_stock = :typeStock
           AND date = (
             SELECT date FROM stocks
             WHERE type_stock = :typeStock
               AND ${STOCKS_DATE_VALIDE_SQL}
               AND ${STOCKS_DATE_AS_ISO_SQL} <= :dateMax
               -- La date retenue doit porter au moins un COMPTAGE reel. Le
               -- recalcul automatique cree des lignes de stock soir sur des
               -- journees ou personne n'a compte: sans ce filtre, une date qui
               -- ne contient que des lignes derivees - souvent negatives -
               -- supplante le dernier vrai inventaire, et la valeur du point
               -- de vente tombe a zero.
               AND is_auto_calculated IS NOT TRUE
             ORDER BY ${STOCKS_DATE_AS_ISO_SQL} DESC
             LIMIT 1
           )`,
        { type: sequelize.QueryTypes.SELECT, replacements: { typeStock, dateMax } }
    );

    const dateUtilisee = lignes.length ? lignes[0].date : null;
    const m = String(dateUtilisee || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
    const isoSnapshot = m ? `${m[3]}-${m[2]}-${m[1]}` : dateMax;

    const { valoriserLignes } = require('../lib/valorisation-stock');
    const prixAchat = pourDate ? pourDate(isoSnapshot).prixAchat : null;
    const retenues = produitsExclus && produitsExclus.size
        ? lignes.filter((l) => !produitsExclus.has(normaliserNomProduit(l.produit)))
        : lignes;
    const r = valoriserLignes({ lignes: retenues, prixAchat, estBoucherie, categorieDe });
    return { ...r, date_utilisee: dateUtilisee };
}

// Produits dont le stock du soir est NEGATIF a la date consideree.
//
// Un stock negatif est la signature d'entrees non saisies: la marchandise a
// ete achetee - et passee en charge dans l'onglet Depenses - mais jamais
// enregistree en stock. Sa donnee de stock n'est donc pas fiable.
//
// On l'ecarte des DEUX bornes de la variation, pas seulement de celle qui est
// negative. N'en retirer qu'une compare deux perimetres et fabrique une
// consommation: un produit passant de 10 a -15 verrait sa variation ramenee a
// -10, soit le stock du matin entierement consomme. Et le compter tel quel
// (-25) ajouterait au PL un cout deja porte par les Depenses.
async function produitsAStockSoirNegatif(dateMax) {
    const rows = await sequelize.query(
        `SELECT DISTINCT produit FROM stocks
         WHERE type_stock = 'soir'
           AND quantite::numeric < 0
           AND date = (
             SELECT date FROM stocks
             WHERE type_stock = 'soir'
               AND ${STOCKS_DATE_VALIDE_SQL}
               AND ${STOCKS_DATE_AS_ISO_SQL} <= :dateMax
               -- STRICTEMENT le meme filtre que valoriserSnapshotStock, sinon
               -- les deux designent des journees differentes et l'exclusion
               -- porte sur des produits qui ne sont pas dans le snapshot
               -- valorise.
               AND is_auto_calculated IS NOT TRUE
             ORDER BY ${STOCKS_DATE_AS_ISO_SQL} DESC
             LIMIT 1
           )`,
        { type: sequelize.QueryTypes.SELECT, replacements: { dateMax } }
    );
    // Deux vues du meme ensemble, et c'est deliberé. Le FILTRAGE compare des
    // noms normalises - il doit rapprocher "Boeuf en detail" de "Boeuf En
    // Detail". L'AFFICHAGE, lui, doit rendre le nom tel qu'il est ecrit: un
    // avertissement disant "boeuf en detail" envoie l'utilisateur chercher dans
    // son catalogue un produit qui n'y figure pas sous cette forme.
    // La liste d'affichage doit compter comme le Set. Le SELECT DISTINCT
    // distingue les graphies BRUTES la ou le Set les fusionne: sans
    // deduplication, "Poulet en détail" et "Poulet En Détail" s'affichent cote
    // a cote comme deux produits, et le compteur annonce 5 ecartes quand le
    // calcul n'en a ecarte que 4. Cas reel sur 3 des 80 dates de snapshot.
    const set = new Set();
    const parCle = new Map();
    for (const r of rows) {
        const cle = normaliserNomProduit(r.produit);
        set.add(cle);
        if (!parCle.has(cle)) parCle.set(cle, r.produit);   // premiere graphie vue
    }
    set.pourAffichage = [...parCle.values()].sort((a, b) => a.localeCompare(b, 'fr'));
    return set;
}

// Produits suivis par l'onglet Simulation, dans l'ordre d'affichage.
//
// Liste FERMEE et ecrite en dur: la simulation ne repond qu'a une question
// precise - de combien bouge le resultat si on touche au prix de ces
// produits-la. La deduire des ventes ferait apparaitre et disparaitre des
// lignes d'un mois a l'autre, et un tableau dont les lignes changent ne se
// compare pas.
//
// Chaque nom est compare APRES normalisation (casse et accents ignores):
// "Poulet en détail" et "Poulet En Détail" sont deux graphies du meme produit
// dans les ventes de juillet, 77 et 31 unites. Les traiter separement
// sous-estimerait la sensibilite de 29%.
const PRODUITS_SIMULATION = [
    'Boeuf en détail',
    'Boeuf en gros',
    'Poulet en détail',
    'Poulet en gros',
    'Agneau'
];

// Produit dont on cherche le prix d'equilibre (PL = 0). Un seul: faire varier
// plusieurs prix pour annuler le resultat admet une infinite de solutions.
const PRODUIT_EQUILIBRE = 'Boeuf en détail';

/**
 * Normalise une date saisie vers YYYY-MM-DD, ou null si la forme est inconnue.
 * Ecrite UNE fois: elle existait en trois exemplaires identiques dans ce
 * fichier, et trois copies d'une regle de format finissent par accepter trois
 * jeux de formats differents sur la meme page.
 */
function parseDateVersISO(s) {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = String(s).match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Toutes les graphies de date couvrant [dateDebut, dateFin], jour par jour.
 *
 * Vente.date est un TEXTE de format mixte selon l'epoque d'insertion:
 * YYYY-MM-DD pour les lignes recentes, DD-MM-YYYY pour les anciennes. Un
 * BETWEEN sur des bornes ISO compare lexicographiquement et rate en silence
 * toutes les lignes historiques - "13-05-2026" commence par '1', la borne
 * "2026-05-01" par '2'. L'ecart avait ete mesure a 277 924 FCFA sur mai 2026.
 *
 * Les tenants actuels ne portent plus aucune date hors ISO, mais deux routes
 * qui interrogent la meme table par deux chemins differents finiront par rendre
 * deux chiffres differents. Le PL et la simulation partagent donc ce filtre.
 */
function graphiesDeDatesPourPeriode(dateDebut, dateFin) {
    const dates = [];
    const cursor = new Date(dateDebut + 'T00:00:00Z');
    const fin = new Date(dateFin + 'T00:00:00Z');
    while (cursor <= fin) {
        const iso = cursor.toISOString().slice(0, 10);
        dates.push(iso);
        dates.push(`${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

/** 'JJ-MM-AAAA' (format de stocks.date) -> 'AAAA-MM-JJ'. null si illisible. */
function isoDepuisJjmmaaaa(brut) {
    const m = String(brut || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** 'AAAA-MM-JJ' -> 'JJ-MM-AAAA', pour parler la meme langue que l'ecran. */
function jjmmaaaaDepuisIso(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || '');
}

/**
 * Estime la borne du soir quand la date de fin n'a pas ete comptee.
 *
 * Rend null quand il n'y a rien a estimer - soit le comptage existe bien a
 * dateFin, soit il n'existe AUCUN comptage sur lequel s'ancrer.
 *
 * La formule vit dans lib/stock-soir-estime.js (fonction pure, testee); ici on
 * ne fait que rassembler ses entrees et revaloriser sa sortie. La valorisation
 * repasse par valoriserLignes, donc les regles deja etablies continuent de
 * s'appliquer telles quelles: prix d'achat a la date, repli sur le prix de
 * vente, et surtout mise a l'ecart des quantites negatives.
 */
async function estimerBorneSoir(args) {
    const {
        ancre, dateFin, contexte, resolveurPrix,
        estBoucherie, produitsNonFiables, ratioRepli
    } = args;

    const ancreIso = isoDepuisJjmmaaaa(ancre.date_utilisee);
    // Comptage bien present a la date demandee: rien a estimer.
    if (ancreIso === dateFin) return null;
    // Aucun comptage nulle part: il n'y a pas d'ancre, donc pas d'estimation
    // possible. Le PL garde son comportement actuel (valeur nulle).
    if (!ancreIso || ancreIso > dateFin) return null;

    const { Stock, Transfert, Vente } = require('../db/models');
    const { lirePackCompositions } = require('../lib/pack-compositions');
    const { tauxParageMois } = require('../lib/parage-mois');
    const { estimerStockSoir } = require('../lib/stock-soir-estime');
    const { valoriserLignes } = require('../lib/valorisation-stock');

    // Fenetre OUVERTE a gauche: le comptage du soir de l'ancre inclut deja les
    // mouvements de sa propre journee. L'inclure doublerait ses ventes.
    const lendemain = new Date(ancreIso + 'T00:00:00Z');
    lendemain.setUTCDate(lendemain.getUTCDate() + 1);
    const debutFenetre = lendemain.toISOString().slice(0, 10);
    const formes = graphiesDeDatesPourPeriode(debutFenetre, dateFin);

    // LE PARAGE SE MESURE JUSQU'A LA VEILLE, jamais jusqu'au jour estime.
    //
    // On est ici PARCE QUE le stock du soir de dateFin n'a pas ete compte. Or
    // le parage d'une journee vaut vendu / (matin + transferts - soir): sans
    // soir, ce jour-la compte un soir de ZERO, son theorique explose et le
    // ratio s'effondre. Mesure sur le 14-08-2026: 25,88 % de parage en
    // incluant la journee, 3,96 % en s'arretant a la veille - un facteur 6,5
    // qui part directement dans le stock estime, donc dans le PL.
    //
    // Le 1er du mois, il n'y a pas de veille dans le mois: rien n'est
    // mesurable, et le taux de repli configure (stock_pertes_decoupe_pct)
    // prend la main - c'est exactement le cas qu'il couvre.
    const veilleDt = new Date(dateFin + 'T00:00:00Z');
    veilleDt.setUTCDate(veilleDt.getUTCDate() - 1);
    const veille = veilleDt.toISOString().slice(0, 10);
    const mesurable = veille.slice(0, 7) === dateFin.slice(0, 7);

    const packs = await lirePackCompositions();
    const [transferts, ventesFenetre, tauxMois] = await Promise.all([
        Transfert.findAll({ where: { date: { [Op.in]: formes } }, raw: true }),
        Vente.findAll({ where: { date: { [Op.in]: formes } }, raw: true }),
        // Meme definition que les cartes "Parage Boeuf (Mois)" - contexte
        // reutilise, 5 requetes economisees - mais bornee a la veille.
        mesurable ? tauxParageMois(sequelize, veille, contexte, packs) : Promise.resolve(null)
    ]);

    // Lignes de l'ancre telles qu'elles sont en base: l'estimation part du
    // comptage, pas de sa valorisation.
    const lignesAncre = await sequelize.query(
        `SELECT produit, quantite, total, prix_unitaire
         FROM stocks
         WHERE type_stock = 'soir' AND date = :dateAncre`,
        { type: sequelize.QueryTypes.SELECT, replacements: { dateAncre: ancre.date_utilisee } }
    );

    const ratios = {
        bovin: tauxMois && tauxMois.bovin ? tauxMois.bovin.ratio : null,
        ovin: tauxMois && tauxMois.ovin ? tauxMois.ovin.ratio : null
    };

    // La cible d'une vente vient du MEME mapping que le cout: « Boeuf en
    // gros » consomme du « Boeuf », un Jarret en consomme 0,5 kg. Sans elle,
    // l'estimation retomberait sur un pool a repartir au prorata.
    const pourCible = resolveurPrix && typeof resolveurPrix.pourDate === 'function'
        ? resolveurPrix.pourDate(dateFin)
        : null;
    const cibleDe = pourCible && typeof pourCible.cibleDuCout === 'function'
        ? (produit) => pourCible.cibleDuCout(produit)
        : undefined;

    const estimation = estimerStockSoir({
        lignesAncre,
        transferts,
        ventes: ventesFenetre,
        ratios,
        ratioRepli,
        cibleDe,
        categorieDe: contexte.categorieDe,
        estBoucherie,
        exclusions: contexte.exclusions,
        familleDechet: contexte.familleDechet,
        packs
    });

    // Meme mise a l'ecart des produits non fiables que les deux bornes reelles,
    // sinon l'estimation compare un perimetre plus large que le stock du matin.
    const retenues = produitsNonFiables && produitsNonFiables.size
        ? estimation.lignes.filter((l) => !produitsNonFiables.has(normaliserNomProduit(l.produit)))
        : estimation.lignes;
    // categorieDe est OBLIGATOIRE ici: sans lui, valoriserLignes rend
    // valeur_bovin / valeur_ovin / valeur_autre_boucherie a zero, et la
    // ventilation par espece de la variation de stock s'effondrerait
    // silencieusement des qu'une estimation remplace le comptage.
    const valorisation = valoriserLignes({
        lignes: retenues,
        // Le resolveur de la date de fin est deja construit plus haut pour
        // `cibleDe`: le rebatir ici refaisait tout l'index des prix a la meme
        // date. On garde le repli au cas ou pourCible n'ait pas pu l'etre.
        prixAchat: (pourCible || resolveurPrix.pourDate(dateFin)).prixAchat,
        estBoucherie,
        categorieDe: contexte.categorieDe
    });

    const joursEcart = Math.round(
        (new Date(dateFin + 'T00:00:00Z') - new Date(ancreIso + 'T00:00:00Z')) / 86400000
    );

    return {
        valorisation: { ...valorisation, date_utilisee: jjmmaaaaDepuisIso(dateFin) },
        date_demandee_jjmmaaaa: jjmmaaaaDepuisIso(dateFin),
        meta: {
            date_ancre: ancre.date_utilisee,
            date_ancre_iso: ancreIso,
            jours_ecart: joursEcart,
            mois_taux: dateFin.slice(0, 7),
            par_categorie: estimation.parCategorie,
            nb_lignes_parage: estimation.nb_lignes_parage,
            nb_lignes_sans_parage: estimation.nb_lignes_sans_parage,
            valeur_ancre: round2(ancre.valeur),
            valeur_estimee: round2(valorisation.valeur),
            // LE CALCUL LIGNE PAR LIGNE, pour que l'ecran puisse le montrer et
            // laisser l'utilisateur le corriger. `boucherie` est indispensable
            // au recalcul cote client: le coefficient de pertes de decoupe ne
            // s'applique qu'a elle, et l'ignorer ferait diverger le PL simule
            // du PL reel des la premiere modification.
            // `retenues`, PAS estimation.lignes: valoriserLignes n'a compte
            // que celles-la. Exposer les produits non fiables donnait au
            // panneau des lignes absentes de valeur_estimee, et corriger l'une
            // d'elles greffait un delta sur une base qui ne l'avait jamais
            // incluse - le PL simule divergeait du reel sans rien dire.
            lignes: (retenues || []).map((l) => ({
                produit: l.produit,
                quantite: l.quantite,
                prix_unitaire: l.prix_unitaire,
                boucherie: !!estBoucherie(l.produit),
                calcul: l.calcul || null
            })),
            avertissements: estimation.avertissements
        }
    };
}

const router = express.Router();

// ============================================================
// Guards par prefixe: les utilisateurs simples (role 'user' dans le
// RBAC — cf users.js#isUtilisateur) peuvent acceder a Creances /
// Centre de Decoupe / Depenses uniquement. Les routes admin/
// superviseur/superutilisateur ci-dessous sont gardees individuellement
// via checkAdvancedAccess (= canManageAdvanced).
// PL et Cash et Stock font leur propre check (admin OR superviseur)
// dans le handler — on ajoute aussi checkAdvancedAccess en defense en
// profondeur (le superutilisateur passe checkAdvanced mais sera bloque
// par le check inline).
// ============================================================
const ADVANCED_FINANCE_PREFIXES = [
    '/prix',
    '/prix-cdc',
    '/prix-achat',
    '/prix-vente-fournisseur',
    '/alias',
    '/charges',
    '/config',
    '/paiements',
    '/pl',
    '/cash-stock',
    // La simulation expose les memes chiffres que le PL, sous un autre angle:
    // elle merite la meme garde.
    '/simulation'
];
ADVANCED_FINANCE_PREFIXES.forEach((p) => router.use(p, checkAdvancedAccess));
// DELETE /depenses/:id reste admin via inline check (cf le handler).

// Garde PL: admin ou superviseur uniquement, PLUS stricte que
// checkAdvancedAccess ci-dessus (qui laisse aussi passer superutilisateur).
// Etait duplique identique sur GET /pl, POST /pl/snapshot, GET
// /pl/snapshots et GET /pl/snapshots/:date - une seule definition ici.
function checkPlAccess(req, res, next) {
    const role = (req.session && req.session.user && req.session.user.role || '').toLowerCase();
    if (!['admin', 'superviseur'].includes(role)) {
        return res.status(403).json({
            success: false,
            error: 'Accès réservé aux administrateurs et superviseurs'
        });
    }
    next();
}
router.use('/pl', checkPlAccess);

// Upload memoire (la donnee va en BDD, pas sur disque). Limite 5 MB.
// MIME types acceptes: JPEG, PNG, PDF, DOC, DOCX.
const ALLOWED_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file) return cb(null, true);
        if (ALLOWED_MIMES.has(file.mimetype)) return cb(null, true);
        cb(new Error(`Type de fichier non autorise: ${file.mimetype}`));
    }
});

// =====================================================
// PRIX FOURNISSEUR
// =====================================================

router.get('/prix', async (req, res) => {
    try {
        const rows = await FournisseurPrix.findAll({
            order: [['produit', 'ASC']],
            raw: true
        });

        const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';
        // Mode normal (edition): valeurs courantes du catalogue.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
            return res.json({ success: true, data: rows });
        }

        // Mode "as-of": prix effectifs a la date choisie (point-in-time).
        // Fallback = derniere valeur enregistree AVANT/A cette date (meme
        // logique que le calcul de commission). On lit tout l'historique
        // <= fin de journee, trie ASC, et la derniere ecriture par produit
        // gagne (= la plus recente <= date).
        const borne = new Date(dateParam + 'T23:59:59.999Z');
        const [venteHist, achatHist] = await Promise.all([
            PrixVenteHistory.findAll({
                where: { created_at: { [Op.lte]: borne } },
                order: [['created_at', 'ASC']],
                raw: true
            }),
            PrixAchatHistory.findAll({
                where: { created_at: { [Op.lte]: borne } },
                order: [['created_at', 'ASC']],
                raw: true
            })
        ]);
        const lastVente = {};
        const lastAchat = {};
        for (const h of venteHist) lastVente[h.produit] = h.prix_vente;
        for (const h of achatHist) lastAchat[h.produit] = h.prix_achat;

        const data = rows.map((r) => {
            const pv = lastVente[r.produit];
            const pa = lastAchat[r.produit];
            return {
                produit: r.produit,
                prix_vente: pv == null ? null : pv,
                prix_achat: pa == null ? null : pa,
                // Reglages courants (non historises): des interrupteurs de
                // config, pas des prix. Affiches en lecture seule en mode as-of.
                prix_achat_dynamique: r.prix_achat_dynamique === true,
                hors_mata: r.hors_mata === true,
                updated_at: r.updated_at,
                as_of: dateParam,
                // Aucune donnee historique <= date: produit pas encore au
                // catalogue a cette date (rare grace au seed genese).
                no_data: pv == null && pa == null
            };
        });
        res.json({ success: true, data, as_of: dateParam });
    } catch (e) {
        console.error('GET /api/finance/prix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Body: { items: [{ produit, prix_vente, prix_achat? }, ...] }
// Upsert ligne par ligne. Insere dans prix_vente_history /
// prix_achat_history UNIQUEMENT pour les produits dont la valeur a
// effectivement change (evite de polluer l'historique avec des
// non-changements lors d'un save bulk depuis l'editeur catalogue).
router.put('/prix', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!items) {
            return res.status(400).json({ success: false, error: 'items: array requis' });
        }
        const username = req.session && req.session.user
            ? req.session.user.username
            : null;
        const now = new Date();
        for (const item of items) {
            const produit = String(item.produit || '').trim();
            if (!produit) continue;
            const prixVente = parseFloat(item.prix_vente);
            if (!Number.isFinite(prixVente) || prixVente < 0) {
                return res.status(400).json({
                    success: false,
                    error: `prix_vente invalide pour ${produit}`
                });
            }
            const prixAchat = item.prix_achat == null || item.prix_achat === ''
                ? null
                : parseFloat(item.prix_achat);
            if (prixAchat !== null && (!Number.isFinite(prixAchat) || prixAchat < 0)) {
                return res.status(400).json({
                    success: false,
                    error: `prix_achat invalide pour ${produit}`
                });
            }
            // Toggle "Prix API (DATA)": quand TRUE, le calcul lit le prix
            // achat depuis DATA (cf lib/achats-boeuf-client.js) et prix_achat
            // ci-dessus ne sert plus que de repli. Non historise (interrupteur
            // de config). Absent du body -> valeur existante inchangee.
            const rawDyn = item.prix_achat_dynamique;
            const prixAchatDynamique = (rawDyn === undefined || rawDyn === null)
                ? undefined
                : (rawDyn === true || rawDyn === 'true' || rawDyn === 'on' || rawDyn === '1');
            // Toggle "Hors Mata": produit achete hors circuit Mata, exclu de
            // la commission fournisseur (routes/finance-creances.js) mais dont
            // le prix d'achat valorise toujours le stock. Meme statut que le
            // toggle API: interrupteur courant, non historise. Absent du
            // body -> valeur existante inchangee.
            const rawHors = item.hors_mata;
            const horsMata = (rawHors === undefined || rawHors === null)
                ? undefined
                : (rawHors === true || rawHors === 'true' || rawHors === 'on' || rawHors === '1');

            // Transaction atomique: lire l'ancien etat AVEC FOR UPDATE, puis
            // upsert + inserts history conditionnels. Le lock evite que deux
            // saves concurrents sur le meme produit voient tous les deux
            // l'ancienne valeur et inserent un doublon dans l'historique.
            await sequelize.transaction(async (t) => {
                const existing = await FournisseurPrix.findByPk(produit, {
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                const oldPrixVente = existing ? parseFloat(existing.prix_vente) : null;
                const oldPrixAchat = existing && existing.prix_achat != null
                    ? parseFloat(existing.prix_achat)
                    : null;

                const payload = {
                    produit,
                    prix_vente: prixVente,
                    prix_achat: prixAchat,
                    updated_at: now
                };
                if (prixAchatDynamique !== undefined) {
                    payload.prix_achat_dynamique = prixAchatDynamique;
                }
                if (horsMata !== undefined) {
                    payload.hors_mata = horsMata;
                }
                await FournisseurPrix.upsert(payload, { transaction: t });

                // History prix_vente: seulement si change (ou si nouveau produit).
                if (oldPrixVente == null || Math.abs(oldPrixVente - prixVente) > 0.001) {
                    await PrixVenteHistory.create({
                        produit,
                        prix_vente: prixVente,
                        changed_by: username
                    }, { transaction: t });
                }

                // History prix_achat: seulement si change ET prix_achat != null
                // (l'historique ne traite pas les nullifications).
                if (prixAchat !== null) {
                    const changed = oldPrixAchat == null
                        || Math.abs(oldPrixAchat - prixAchat) > 0.001;
                    if (changed) {
                        await PrixAchatHistory.create({
                            produit,
                            prix_achat: prixAchat,
                            changed_by: username
                        }, { transaction: t });
                    }
                }
            });
            audit.log(req, 'prix.upsert', {
                produit,
                prix_vente: prixVente,
                prix_achat: prixAchat,
                prix_achat_dynamique: prixAchatDynamique,
                hors_mata: horsMata
            });
        }
        invalidateFinanceDerivedCaches();
        const rows = await FournisseurPrix.findAll({ order: [['produit', 'ASC']] });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('PUT /api/finance/prix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// PRIX VENTE CDC (negocie avec le Centre de Decoupe)
// =====================================================
// Distinct de prix_vente (= ce que le fournisseur me facture).
// Sert UNIQUEMENT au calcul de marge "Il me doit" cote CDC.
// Chaque save est historise dans prix_vente_cdc_history.

// Body: { prix_vente_cdc: number }
router.put('/prix-cdc/:produit', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const prix = parseFloat(req.body && req.body.prix_vente_cdc);
        if (!Number.isFinite(prix) || prix < 0) {
            return res.status(400).json({
                success: false,
                error: 'prix_vente_cdc doit etre un nombre >= 0'
            });
        }
        const cat = await FournisseurPrix.findByPk(produit);
        if (!cat) {
            return res.status(404).json({
                success: false,
                error: `produit "${produit}" introuvable dans le catalogue`
            });
        }
        const username = req.session && req.session.user
            ? req.session.user.username
            : null;
        // Transaction: update + insert history en atomique.
        await sequelize.transaction(async (t) => {
            await FournisseurPrix.update(
                { prix_vente_cdc: prix, updated_at: new Date() },
                { where: { produit }, transaction: t }
            );
            await PrixVenteCdcHistory.create({
                produit,
                prix_vente_cdc: prix,
                changed_by: username
            }, { transaction: t });
        });
        audit.log(req, 'prix_cdc.upsert', { produit, prix_vente_cdc: prix });
        invalidateFinanceDerivedCaches();
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/finance/prix-cdc/:produit:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Liste les changements historiques de prix_vente_cdc pour un produit.
router.get('/prix-cdc/:produit/history', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const rows = await PrixVenteCdcHistory.findAll({
            where: { produit },
            order: [['created_at', 'DESC']],
            limit: 100
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/prix-cdc/:produit/history:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// PRIX ACHAT (point-in-time, meme pattern que prix_vente_cdc)
// =====================================================
// Le prix achat fournisseur est aussi editable + historise. Sert au
// calcul de marge "Il me doit" = prix_vente_cdc_effectif - prix_achat_effectif.
// Changer le prix achat aujourd'hui n'impacte pas les calculs des
// ventes passees (chaque vente utilise le prix_achat effectif a sa date).

router.put('/prix-achat/:produit', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const prix = parseFloat(req.body && req.body.prix_achat);
        if (!Number.isFinite(prix) || prix < 0) {
            return res.status(400).json({
                success: false,
                error: 'prix_achat doit etre un nombre >= 0'
            });
        }
        const cat = await FournisseurPrix.findByPk(produit);
        if (!cat) {
            return res.status(404).json({
                success: false,
                error: `produit "${produit}" introuvable dans le catalogue`
            });
        }
        const username = req.session && req.session.user
            ? req.session.user.username
            : null;
        await sequelize.transaction(async (t) => {
            await FournisseurPrix.update(
                { prix_achat: prix, updated_at: new Date() },
                { where: { produit }, transaction: t }
            );
            await PrixAchatHistory.create({
                produit,
                prix_achat: prix,
                changed_by: username
            }, { transaction: t });
        });
        audit.log(req, 'prix_achat.upsert', { produit, prix_achat: prix });
        invalidateFinanceDerivedCaches();
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/finance/prix-achat/:produit:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/prix-achat/:produit/history', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const rows = await PrixAchatHistory.findAll({
            where: { produit },
            order: [['created_at', 'DESC']],
            limit: 100
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/prix-achat/:produit/history:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// EDITION DE L'HISTORIQUE DES PRIX — reserve aux administrateurs
// =====================================================
//
// L'historique ne s'ecrivait qu'en AJOUT: on pouvait poser une nouvelle
// valeur, jamais corriger une saisie fautive ni ancrer un prix d'origine.
// Trois anomalies constatees le meme jour, toutes irreparables depuis
// l'application:
//
//   - Laxass portait 200 F d'ACHAT depuis un seed de migration - c'etait son
//     prix de VENTE, le prix d'achat etant inconnu a l'amorcage. Deux unites
//     sur quinze se valorisaient donc a marge nulle;
//   - Viande Hachee portait 5 000 F pendant vingt secondes, entre deux saisies
//     a 3 600: une faute de frappe restee en base pour toujours;
//   - le meme produit n'avait aucune valeur AVANT le 12 aout, donc les ventes
//     anterieures suivaient le catalogue COURANT et auraient change de cout
//     le jour ou ce catalogue bouge.
//
// Corriger cela demandait du SQL a la main. C'est desormais un ecran.
//
// ADMIN STRICT, et non checkAdvancedAccess: reecrire un prix passe change le
// cout de ventes deja enregistrees, donc le PL de journees deja figees. Ce
// n'est pas une operation de supervision.

/** Les trois historiques editables, et la colonne qui porte leur valeur. */
const HISTORIQUES_PRIX = {
    'prix-achat': { modele: () => PrixAchatHistory, champ: 'prix_achat' },
    'prix-vente-fournisseur': { modele: () => PrixVenteHistory, champ: 'prix_vente' },
    'prix-cdc': { modele: () => PrixVenteCdcHistory, champ: 'prix_vente_cdc' }
};

function adminStrictFinance(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Non authentifié' });
    }
    if (String(req.session.user.role || '').toLowerCase() !== 'admin') {
        return res.status(403).json({ success: false, error: 'Accès réservé aux administrateurs' });
    }
    next();
}

/**
 * PUT /api/finance/historique/:type/:id
 * Body: { valeur: number, created_at?: ISO }
 *
 * La DATE est modifiable: c'est elle qui decide a partir de quand le prix
 * s'applique, et une valeur juste posee a la mauvaise date reste fausse. C'est
 * ce qui permet d'ancrer un prix « depuis toujours ».
 */
router.put('/historique/:type/:id', adminStrictFinance, async (req, res) => {
    try {
        const def = HISTORIQUES_PRIX[String(req.params.type || '')];
        if (!def) return res.status(400).json({ success: false, error: 'type d\'historique inconnu' });

        const valeur = parseFloat((req.body || {}).valeur);
        if (!Number.isFinite(valeur) || valeur < 0) {
            return res.status(400).json({ success: false, error: 'valeur attendue: un nombre positif' });
        }
        const ligne = await def.modele().findByPk(req.params.id);
        if (!ligne) return res.status(404).json({ success: false, error: 'entrée introuvable' });

        const maj = { [def.champ]: valeur };
        const brutDate = (req.body || {}).created_at;
        if (brutDate) {
            // UN SEUL format accepte: l'instant UTC complet que rend
            // toISOString(). new Date() avale bien d'autres formes, et deux
            // d'entre elles sont des pieges sur un champ qui decide a partir
            // de QUAND un prix s'applique: '2026-08-13' est lu comme minuit
            // UTC, et '2026-08-13T10:00' comme minuit heure LOCALE DU SERVEUR.
            // Le meme corps donnerait donc deux instants differents selon la
            // machine qui l'execute.
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(brutDate))) {
                return res.status(400).json({
                    success: false,
                    error: 'created_at attendu au format UTC complet (AAAA-MM-JJTHH:mm:ss.sssZ)'
                });
            }
            const d = new Date(brutDate);
            if (isNaN(d.getTime())) {
                return res.status(400).json({ success: false, error: 'date invalide' });
            }
            maj.created_at = d;
        }
        // L'auteur devient celui qui CORRIGE. Laisser le nom d'origine ferait
        // porter la correction a quelqu'un qui ne l'a pas faite.
        maj.changed_by = String(req.session.user.username || 'admin');

        const avant = { valeur: ligne[def.champ], created_at: ligne.created_at };
        await ligne.update(maj);

        try {
            if (typeof audit.log === 'function') {
                audit.log(req, 'finance.historique.modifie', {
                    type: req.params.type, id: req.params.id, produit: ligne.produit, avant, apres: maj
                });
            }
        } catch (e) { /* la trace ne doit jamais faire echouer l'ecriture */ }

        invalidateFinanceDerivedCaches();
        res.json({ success: true, data: ligne });
    } catch (e) {
        console.error('PUT /api/finance/historique:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * DELETE /api/finance/historique/:type/:id
 *
 * Pour les saisies qui n'auraient jamais du exister. La DERNIERE entree d'un
 * produit est refusee: sans elle, le resolveur retombe sur le catalogue
 * courant, et toutes les ventes passees changeraient de cout des la prochaine
 * modification de ce catalogue - exactement le piege qu'on vient de fermer.
 */
router.delete('/historique/:type/:id', adminStrictFinance, async (req, res) => {
    try {
        const def = HISTORIQUES_PRIX[String(req.params.type || '')];
        if (!def) return res.status(400).json({ success: false, error: 'type d\'historique inconnu' });

        const Modele = def.modele();
        const ligne = await Modele.findByPk(req.params.id);
        if (!ligne) return res.status(404).json({ success: false, error: 'entrée introuvable' });

        // COMPTER PUIS SUPPRIMER SOUS VERROU. Deux suppressions concurrentes
        // sur un produit qui n'a plus que deux entrees comptaient toutes deux
        // « 2 », passaient toutes deux la garde, et le produit se retrouvait
        // sans aucune entree - exactement l'etat que cette garde existe pour
        // empecher, et qui ferait suivre le catalogue courant a toutes ses
        // ventes passees.
        const trace = { produit: ligne.produit, valeur: ligne[def.champ], created_at: ligne.created_at };
        const refus = await sequelize.transaction(async (t) => {
            // Les lignes du produit sont verrouillees AVANT d'etre comptees:
            // sans le verrou, le compte est une photo deja perimee quand on
            // s'en sert.
            const rows = await Modele.findAll({
                where: { produit: ligne.produit },
                transaction: t, lock: t.LOCK.UPDATE
            });
            if (rows.length <= 1) return true;
            await ligne.destroy({ transaction: t });
            return false;
        });
        if (refus) {
            return res.status(409).json({
                success: false,
                error: 'Dernière entrée de ce produit : la supprimer ferait suivre le catalogue '
                     + 'courant à toutes les ventes passées. Corrigez sa valeur plutôt.'
            });
        }

        try {
            if (typeof audit.log === 'function') {
                audit.log(req, 'finance.historique.supprime', { type: req.params.type, ...trace });
            }
        } catch (e) { /* idem */ }

        invalidateFinanceDerivedCaches();
        res.json({ success: true, data: trace });
    } catch (e) {
        console.error('DELETE /api/finance/historique:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// PRIX VENTE FOURNISSEUR (point-in-time)
// =====================================================
// Prix catalogue du fournisseur, base de la commission 3% sur ventes
// boucherie. Editable + historise, meme pattern que prix_achat/prix_vente_cdc.

router.put('/prix-vente-fournisseur/:produit', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const prix = parseFloat(req.body && req.body.prix_vente);
        if (!Number.isFinite(prix) || prix < 0) {
            return res.status(400).json({
                success: false,
                error: 'prix_vente doit etre un nombre >= 0'
            });
        }
        const cat = await FournisseurPrix.findByPk(produit);
        if (!cat) {
            return res.status(404).json({
                success: false,
                error: `produit "${produit}" introuvable dans le catalogue`
            });
        }
        const username = req.session && req.session.user
            ? req.session.user.username
            : null;
        await sequelize.transaction(async (t) => {
            await FournisseurPrix.update(
                { prix_vente: prix, updated_at: new Date() },
                { where: { produit }, transaction: t }
            );
            await PrixVenteHistory.create({
                produit,
                prix_vente: prix,
                changed_by: username
            }, { transaction: t });
        });
        audit.log(req, 'prix_vente.upsert', { produit, prix_vente: prix });
        invalidateFinanceDerivedCaches();
        res.json({ success: true });
    } catch (e) {
        console.error('PUT /api/finance/prix-vente-fournisseur/:produit:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/prix-vente-fournisseur/:produit/history', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const rows = await PrixVenteHistory.findAll({
            where: { produit },
            order: [['created_at', 'DESC']],
            limit: 100
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/prix-vente-fournisseur/:produit/history:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Supprime une ligne du catalogue (par produit, PK).
// Idempotent: retourne 200 + deleted=0 si le produit n'existait pas.
router.delete('/prix/:produit', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const n = await FournisseurPrix.destroy({ where: { produit } });
        if (n > 0) {
            audit.log(req, 'prix.delete', { produit });
            invalidateFinanceDerivedCaches();
        }
        res.json({ success: true, deleted: n });
    } catch (e) {
        console.error('DELETE /api/finance/prix/:produit:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// MAPPING PRODUITS (alias libelle vente -> catalogue prix)
// =====================================================
// Vue d'ensemble: retourne le catalogue, les aliases definis, et la
// liste des libelles distincts apparus dans Vente.produit sur les 90
// derniers jours, avec leur statut de resolution (exact/alias/prefix/
// unmapped). Permet a l'UI d'afficher un tableau de matching complet.
router.get('/alias', async (req, res) => {
    try {
        // Fenetre 90 jours pour les ventes (limite la requete distinct).
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 90);
        const sinceISO = since.toISOString().slice(0, 10);

        // 4 requetes en parallele (gain ~150-200ms vs sequentiel).
        // Regex include/exclude configurables via env FINANCE_BOUCHERIE_*
        // (cf en-tete de fichier). Defaut couvre les viandes courantes Maas.
        const [catalog, aliases, invRows, distinctRows] = await Promise.all([
            FournisseurPrix.findAll({ order: [['produit', 'ASC']] }),
            ProduitAlias.findAll({ order: [['alias_produit', 'ASC']] }),
            Produit.findAll({
                where: {
                    type_catalogue: 'inventaire',
                    [Op.and]: [
                        sequelize.where(
                            sequelize.fn('LOWER', sequelize.col('nom')),
                            { [Op.regexp]: BOUCHERIE_INCLUDE_REGEX }
                        ),
                        sequelize.where(
                            sequelize.fn('LOWER', sequelize.col('nom')),
                            { [Op.notRegexp]: BOUCHERIE_EXCLUDE_REGEX }
                        )
                    ]
                },
                attributes: ['nom'],
                order: [['nom', 'ASC']]
            }),
            // Distincts Vente.produit sur 90 derniers jours.
            sequelize.query(
                `SELECT produit, COUNT(*)::int AS n
                 FROM ventes
                 WHERE date >= :since
                 GROUP BY produit
                 ORDER BY n DESC, produit ASC`,
                { type: sequelize.QueryTypes.SELECT, replacements: { since: sinceISO } }
            )
        ]);

        // Dropdown UI = union triee (inventaire boucherie ∪ catalogue).
        const set = new Set();
        invRows.forEach((p) => set.add(p.nom));
        catalog.forEach((p) => set.add(p.produit));
        const dropdown = Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));

        // Resolution statut: utilise le helper partage avec computeCreances
        // pour garantir que ce que l'UI affiche correspond exactement a ce
        // que le calcul de creances utilise (zero divergence possible).
        const resolverMaps = buildResolverMaps(catalog, aliases);
        const items = distinctRows.map((r) => {
            const resolved = resolveProduit(r.produit, resolverMaps);
            return {
                produit: r.produit,
                count: r.n,
                statut: resolved.statut,
                resolved: resolved.resolved,
                // Le coefficient DEJA enregistre, sans quoi le champ de saisie
                // repartirait a 1 a chaque rechargement - et le prochain
                // Enregistrer, meme pour ne changer que la cible, ecraserait
                // silencieusement un 0,5 pose la veille.
                coefficient: resolved.coefficient
            };
        });

        // Note: champ "catalog" supprime - le client utilisait "dropdown"
        // qui contient deja l'union catalogue + inventaire boucherie.
        res.json({
            success: true,
            data: {
                inventory: invRows.map((p) => ({ nom: p.nom })),
                dropdown,
                aliases: aliases.map((a) => ({
                    alias_produit: a.alias_produit,
                    produit_catalog: a.produit_catalog,
                    // Combien d'unites de la cible vaut UNE unite du libelle.
                    coefficient: a.coefficient == null ? 1 : parseFloat(a.coefficient)
                })),
                items
            }
        });
    } catch (e) {
        console.error('GET /api/finance/alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * COEFFICIENT d'un mapping: conversion d'unite, pas imputation de cout.
 *
 * Absent, il vaut 1 - le libelle se compte comme sa cible, cas de toutes les
 * decoupes vendues au kilo. Le Jarret vaut 0,5: il se vend a la PIECE et une
 * piece pese environ 500 g. La carcasse reste achetee UNE fois, sous
 * « Boeuf », et sa commission avec elle.
 *
 * Zero et negatif sont REFUSES, jamais ramenes a 1: un coefficient nul
 * rendrait un cout nul, donc une marge egale au prix de vente - le produit le
 * plus rentable de l'ecran, par accident, sans que rien ne le dise. La
 * contrainte SQL les refuse aussi, mais une erreur 400 explicite vaut mieux
 * qu'une violation de contrainte remontee brute.
 *
 * Sortie en dehors du gestionnaire de route pour etre testable seule, comme
 * resoudreCibleSnapshot: une regle de validation qui ne se lit qu'a travers
 * une requete HTTP finit par n'etre verifiee nulle part.
 *
 * @param {*} brut  la valeur recue, de n'importe quelle forme
 * @returns {{ok: true, valeur: number}|{ok: false, erreur: string}}
 */
function validerCoefficient(brut) {
    // « Absent » se teste sur la FORME recue, pas sur String(brut): String([])
    // rend une chaine vide, et un tableau serait passe pour un champ non
    // rempli - donc pour un coefficient de 1, valeur qu'il ne porte pas.
    const absent = brut === undefined || brut === null
        || (typeof brut === 'string' && brut.trim() === '');
    if (absent) return { ok: true, valeur: 1 };
    // Number() et non parseFloat(): parseFloat('0.5kg') rend 0,5 sans broncher,
    // et une unite collee par erreur passerait pour une saisie valide.
    const v = Number(brut);
    if (!Number.isFinite(v) || v <= 0) {
        return { ok: false, erreur: 'coefficient doit être un nombre strictement positif' };
    }
    // Au-dela de 1 000, ce n'est plus une conversion: c'est une virgule qui a
    // glisse.
    if (v > 1000) {
        return { ok: false, erreur: 'coefficient invraisemblable (1000 au maximum)' };
    }
    return { ok: true, valeur: v };
}

/**
 * La cible FINALE d'un mapping, quand la cible choisie est elle-meme un alias.
 *
 * « Veau haché -> Veau » alors que « Veau -> Boeuf » est une CHAINE, et
 * lib/prix-achat-date.js ne suit qu'UN maillon: « Veau haché » lirait le prix
 * de catalogue FIGE de « Veau » pendant que « Veau » prend le lot du jour.
 * Deux couts pour le meme animal, jusqu'a 400 F/kg d'ecart.
 *
 * On aplatit donc a l'ECRITURE - « Veau haché -> Boeuf », ce qu'un humain
 * aurait ecrit. Aplatir ici plutot que resoudre a la lecture garde la table
 * lisible: une ligne dit ce qu'elle fait, au lieu d'un « -> Veau » qui se
 * comporterait en douce comme « -> Boeuf ».
 *
 * Partage par PUT /alias et par la conversion en masse: les deux ecrivent dans
 * la meme table, et n'en garder qu'un chain-safe laissait l'autre creer
 * exactement ce qu'on venait d'interdire.
 *
 * Borne par la taille de la table, et s'arrete sur un cycle: on ne repasse
 * jamais deux fois par le meme nom.
 */
function cibleFinale(aliasMap, depart) {
    const vus = new Set();
    let cible = depart;
    while (cible && !vus.has(cible.toLowerCase())) {
        vus.add(cible.toLowerCase());
        const suivant = cibleDe(aliasMap, cible.toLowerCase());
        if (!suivant) break;
        cible = suivant;
    }
    return cible;
}

// Body: { alias_produit, produit_catalog, coefficient? }
// Upsert: si l'alias existe, sa cible est mise a jour.
// La cible est un nom de produit inventaire boucherie. Si elle n'est
// pas encore dans fournisseur_prix, on cree une entree avec prix=0
// pour satisfaire la FK et permettre a l'admin de remplir le prix
// ensuite dans l'onglet Prix fournisseur.
// Transaction + findOrCreate pour eviter une race condition si deux
// requetes concurrentes essaient de creer la meme entree catalogue.
router.put('/alias', async (req, res) => {
    try {
        const aliasProduit = String(req.body?.alias_produit || '').trim();
        const produitCatalog = String(req.body?.produit_catalog || '').trim();
        if (!aliasProduit || !produitCatalog) {
            return res.status(400).json({
                success: false,
                error: 'alias_produit et produit_catalog requis'
            });
        }
        // Validation longueur (matche VARCHAR(150) PK + VARCHAR(100) FK).
        if (aliasProduit.length > ALIAS_PRODUIT_MAX_LENGTH) {
            return res.status(400).json({
                success: false,
                error: `alias_produit trop long (max ${ALIAS_PRODUIT_MAX_LENGTH} caracteres)`
            });
        }
        if (produitCatalog.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'produit_catalog trop long (max 100 caracteres)'
            });
        }

        const coef = validerCoefficient(req.body && req.body.coefficient);
        if (!coef.ok) {
            return res.status(400).json({ success: false, error: coef.erreur });
        }
        const coefficient = coef.valeur;

        // APLATISSEMENT DE LA CIBLE, comme dans la conversion en masse.
        //
        // Le menu deroulant propose TOUTE entree du catalogue, y compris
        // celles qui sont elles-memes mappees. Choisir « Veau » alors que
        // « Veau -> Boeuf » existe creait une chaine que la resolution ne suit
        // pas: le libelle prenait le prix de catalogue FIGE de Veau pendant
        // que Veau prenait le lot du jour. On ecrit donc la cible finale.
        const aliasExistants = await ProduitAlias.findAll({ raw: true });
        const aliasMap = new Map(
            aliasExistants.map((a) => [a.alias_produit.toLowerCase(), a.produit_catalog])
        );
        // On retire le libelle en cours: sans cela, remettre a jour un alias
        // existant le ferait se suivre lui-meme.
        aliasMap.delete(aliasProduit.toLowerCase());
        const cibleAplatie = cibleFinale(aliasMap, produitCatalog);

        const username = req.session && req.session.user
            ? req.session.user.username
            : null;
        const result = await sequelize.transaction(async (t) => {
            const [, createdCatalog] = await FournisseurPrix.findOrCreate({
                where: { produit: cibleAplatie },
                defaults: {
                    produit: cibleAplatie,
                    prix_vente: 0,
                    prix_achat: null,
                    updated_at: new Date()
                },
                transaction: t
            });
            // Si auto-creation: seedee une entree prix_vente_history pour
            // que le lookup point-in-time des ventes futures sur ce nouveau
            // produit trouve une valeur (sans attendre le prochain restart
            // serveur ou le genesis seed via update-schema). prix_achat
            // reste NULL donc pas d'entree history (CHECK >= 0).
            if (createdCatalog) {
                await PrixVenteHistory.create({
                    produit: cibleAplatie,
                    prix_vente: 0,
                    changed_by: username || '_autocreate_alias_'
                }, { transaction: t });
            }
            // La ligne EXISTANTE, retrouvee sans egard a la casse. upsert()
            // porte sur la PK, sensible a la casse: enregistrer « Boeuf En
            // Détail » quand la base porte « Boeuf en détail » creait une
            // SECONDE ligne. Les deux resolvent vers la meme cle normalisee,
            // donc l'ordre physique des tuples decidait laquelle s'applique -
            // un coefficient corrige pouvait rester sans effet.
            const existante = await ProduitAlias.findOne({
                where: sequelize.where(
                    sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('alias_produit'))),
                    aliasProduit.toLowerCase()
                ),
                transaction: t
            });
            if (existante) {
                // On garde la graphie DEJA stockee: la changer reviendrait a
                // supprimer puis recreer la PK, et ferait perdre l'historique
                // d'audit attache au nom.
                await existante.update({
                    produit_catalog: cibleAplatie,
                    coefficient,
                    updated_at: new Date()
                }, { transaction: t });
            } else {
                await ProduitAlias.create({
                    alias_produit: aliasProduit,
                    produit_catalog: cibleAplatie,
                    coefficient,
                    updated_at: new Date()
                }, { transaction: t });
            }
            return { catalog_created: createdCatalog };
        });
        if (result.catalog_created) {
            audit.log(req, 'prix.autocreate', { produit: cibleAplatie, source: 'alias' });
        }
        audit.log(req, 'alias.upsert', {
            alias_produit: aliasProduit,
            produit_catalog: cibleAplatie,
            demande: produitCatalog,
            coefficient
        });
        invalidateFinanceDerivedCaches();
        // On DIT quand la cible ecrite differe de celle demandee: un choix
        // silencieusement redirige laisse l'utilisateur devant une ligne qui
        // ne dit pas ce qu'il a selectionne.
        res.json({
            success: true,
            ...result,
            produit_catalog: cibleAplatie,
            aplati: cibleAplatie !== produitCatalog ? { demande: produitCatalog } : null
        });
    } catch (e) {
        console.error('PUT /api/finance/alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Supprime un alias (laisse retomber sur fallback prefix ou unmapped).
// Idempotent: retourne 200 + deleted=0 si l'alias n'existait pas
// (cf RFC 7231 7.4.2 - DELETE doit etre idempotent).
router.delete('/alias/:alias', async (req, res) => {
    try {
        const alias = String(req.params.alias || '').trim();
        if (!alias) {
            return res.status(400).json({ success: false, error: 'alias requis' });
        }
        // Comparaison INSENSIBLE A LA CASSE, comme partout ailleurs dans la
        // resolution. L'egalite exacte supprimait 0 ligne des que l'ecran
        // renvoyait une autre graphie que celle stockee - or l'ecran liste les
        // graphies vues dans les VENTES, pas celles de la table. « Boeuf En
        // Détail » (82 ventes) affichait « Alias -> Boeuf » et sa corbeille ne
        // supprimait rien, sous un bandeau vert « Alias supprime ».
        const n = await ProduitAlias.destroy({
            where: sequelize.where(
                sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('alias_produit'))),
                alias.toLowerCase()
            )
        });
        if (n > 0) {
            audit.log(req, 'alias.delete', { alias_produit: alias });
            invalidateFinanceDerivedCaches();
        }
        // deleted: 0 n'est PAS un succes silencieux. Le client doit pouvoir le
        // dire, sinon l'utilisateur croit avoir supprime un mapping qui reste.
        res.json({ success: true, deleted: n });
    } catch (e) {
        console.error('DELETE /api/finance/alias/:alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Bulk: convertit tous les "prefix" actuellement actifs en aliases
// explicites en figeant la resolution courante. Utile pour migrer d'un
// coup l'historique sans cliquer ligne par ligne.
// Utilise bulkCreate avec updateOnDuplicate pour ecrire en 1 round-trip
// au lieu de N (cf code review).
router.post('/alias/bulk-from-prefix', async (req, res) => {
    try {
        // Fenetre 90 jours pour cibler les produits "vivants".
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 90);
        const sinceISO = since.toISOString().slice(0, 10);

        const [catalog, aliases, distinctRows] = await Promise.all([
            FournisseurPrix.findAll(),
            ProduitAlias.findAll(),
            sequelize.query(
                `SELECT DISTINCT produit FROM ventes WHERE date >= :since`,
                { type: sequelize.QueryTypes.SELECT, replacements: { since: sinceISO } }
            )
        ]);

        // Resoudre via le helper partage (statut prefix = candidat a la
        // conversion). Tri prefix DESC pour matcher le plus specifique.
        const resolverMaps = buildResolverMaps(catalog, aliases);

        const now = new Date();
        const toUpsert = [];
        const created = [];
        // Produits qui portent DEJA leur propre prix d'achat. Les convertir
        // changerait leur cout, pas seulement sa forme.
        //
        // Convertir un prefixe en alias sert a figer une resolution qui
        // s'applique deja - jamais a deplacer un prix. Or depuis que le
        // mapping passe AVANT le prix propre (lib/prix-achat-date.js), ecrire
        // un alias sur un produit qui a son prix ECRASE ce prix.
        //
        // Le cas concret: « Boeuf sur pied » se resout en 'prefix' vers
        // « Boeuf », parce que son libelle commence par ce mot. Un clic sur
        // « Convertir tous les prefixes » lui donnait donc le prix d'un KILO
        // de carcasse, alors que c'est une bete comptee a la TETE qui porte
        // son propre prix par tete. Un seul bouton recreait en masse l'erreur
        // que la suppression de la regex venait de corriger.
        const aPrixPropre = new Set(
            catalog
                .filter((c) => {
                    const v = parseFloat(c.prix_achat);
                    return Number.isFinite(v) && v > 0;
                })
                .map((c) => c.produit.trim().toLowerCase())
        );

        const ignores = [];
        const aplatis = [];
        const dejaDansLeLot = new Set();
        for (const r of distinctRows) {
            const resolved = resolveProduit(r.produit, resolverMaps);
            if (resolved.statut !== 'prefix') continue;
            if (aPrixPropre.has(String(r.produit).trim().toLowerCase())) {
                ignores.push(r.produit);
                continue;
            }
            const cible = cibleFinale(resolverMaps.aliasMap, resolved.resolved);
            if (cible !== resolved.resolved) {
                aplatis.push({ alias_produit: r.produit, via: resolved.resolved, cible });
            }
            // UNE SEULE ligne par cle normalisee dans le lot.
            //
            // produit_alias porte desormais un index UNIQUE sur
            // LOWER(TRIM(alias_produit)). Or les ventes contiennent « Boeuf en
            // gros » ET « Boeuf En Gros »: si aucune des deux n'est encore
            // mappee, elles arrivaient toutes deux ici et bulkCreate violait
            // l'index - la conversion entiere echouait en 500, alors qu'elle
            // demandait deux fois la meme chose.
            const cle = String(r.produit).trim().toLowerCase();
            if (dejaDansLeLot.has(cle)) continue;
            dejaDansLeLot.add(cle);
            toUpsert.push({
                alias_produit: r.produit,
                produit_catalog: cible,
                updated_at: now
            });
            created.push({
                alias_produit: r.produit,
                produit_catalog: cible
            });
        }

        if (toUpsert.length > 0) {
            await ProduitAlias.bulkCreate(toUpsert, {
                updateOnDuplicate: ['produit_catalog', 'updated_at']
            });
            audit.log(req, 'alias.bulk-from-prefix', {
                count: created.length,
                created,
                ignores,
                aplatis
            });
            invalidateFinanceDerivedCaches();
        }
        // `ignores` et `aplatis` sont RENDUS, pas seulement journalises: une
        // conversion en masse qui saute des lignes ou change une cible sans le
        // dire laisse croire qu'elle a tout traite tel quel, et l'utilisateur
        // cherche ensuite pourquoi un produit pointe ailleurs qu'attendu.
        res.json({ success: true, created, ignores, aplatis });
    } catch (e) {
        console.error('POST /api/finance/alias/bulk-from-prefix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// CHARGES MENSUELLES FIXES (pour le calcul PL)
// =====================================================

// ?mois=YYYY-MM : rend les montants applicables a ce mois (saisie du mois, ou
// report du dernier mois saisi, ou valeur courante). Sans le parametre, rend
// les valeurs courantes - comportement d'origine, conserve pour les appelants
// qui ne connaissent pas la dimension mensuelle.
router.get('/charges', async (req, res) => {
    try {
        const rows = await FinanceCharge.findAll({
            order: [['ordre', 'ASC'], ['nom', 'ASC']]
        });

        const mois = req.query.mois;
        if (!mois) {
            return res.json({ success: true, data: rows });
        }
        if (!/^\d{4}-\d{2}$/.test(mois)) {
            return res.status(400).json({ success: false, error: 'mois: format YYYY-MM attendu' });
        }

        const montants = (await resolveChargesPourMois([mois], rows))[mois];
        // saisi_ce_mois distingue une valeur propre au mois d'une valeur
        // heritee: l'interface peut ainsi signaler "report" plutot que de
        // laisser croire a une saisie.
        const saisis = new Set(
            (await FinanceChargeMois.findAll({ where: { mois }, raw: true }))
                .map((r) => r.nom)
        );

        res.json({
            success: true,
            mois,
            data: rows.map((r) => ({
                nom: r.nom,
                libelle: r.libelle,
                ordre: r.ordre,
                montant_mensuel: montants[r.nom],
                saisi_ce_mois: saisis.has(r.nom)
            }))
        });
    } catch (e) {
        console.error('GET /api/finance/charges:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Body: { items: [{ nom, libelle, montant_mensuel, ordre? }, ...] }
// Upsert ligne par ligne (preserve les autres entrees).
// Historise chaque CHANGEMENT effectif de montant_mensuel (meme pattern
// que prix_vente / prix_achat / prix_vente_cdc). Une entree history par
// modification reelle uniquement (pas de doublon si valeur identique).
//
// Atomicite: tout le batch tourne dans UNE seule transaction. Si une
// ligne echoue, aucune ligne du batch n'est commitee (pas de partial save).
// Performance: une seule requete pre-fetch les rows existantes (pas de N+1).
router.put('/charges', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!items) {
            return res.status(400).json({ success: false, error: 'items: array requis' });
        }
        // Mois optionnel: sans lui, seule la valeur courante est mise a jour
        // (comportement d'origine). Avec lui, le montant est aussi date et
        // s'applique a ce mois et aux suivants.
        const moisCible = req.body?.mois || null;
        if (moisCible && !/^\d{4}-\d{2}$/.test(moisCible)) {
            return res.status(400).json({ success: false, error: 'mois: format YYYY-MM attendu' });
        }
        const now = new Date();
        const rawUsername = req.session && req.session.user
            ? req.session.user.username
            : null;
        // Tronque a 150 chars pour matcher VARCHAR(150) cote BDD (evite
        // un 500 sequelize si un nom de session est anormalement long).
        const username = rawUsername ? String(rawUsername).slice(0, 150) : null;

        // 1) Validation prealable de TOUS les items avant toute ecriture.
        //    Une seule ligne invalide -> 400, rien n'est ecrit.
        //    Detection de doublons sur nom: rejet avant tout write.
        const validated = [];
        const seenNoms = new Set();
        for (const item of items) {
            const nom = String(item.nom || '').trim();
            if (!nom) continue; // ligne vide silencieusement skippee
            if (nom.length > 100) {
                return res.status(400).json({
                    success: false, error: `nom trop long (max 100): ${nom.slice(0, 30)}...`
                });
            }
            if (seenNoms.has(nom)) {
                return res.status(400).json({
                    success: false, error: `nom dupliqué dans le batch: ${nom}`
                });
            }
            seenNoms.add(nom);
            const libelleRaw = String(item.libelle || nom).trim();
            if (libelleRaw.length > 150) {
                return res.status(400).json({
                    success: false, error: `libelle trop long (max 150) pour ${nom}`
                });
            }
            const montant = parseFloat(item.montant_mensuel);
            if (!Number.isFinite(montant) || montant < 0) {
                return res.status(400).json({
                    success: false, error: `montant_mensuel invalide pour ${nom}`
                });
            }
            const ordre = Number.isFinite(parseInt(item.ordre, 10))
                ? parseInt(item.ordre, 10)
                : 0;
            validated.push({ nom, libelle: libelleRaw, montant, ordre });
        }

        // 2) Tout le batch dans UNE seule transaction, avec read sous FOR UPDATE
        //    pour serialiser les writes concurrents sur les memes nom (evite
        //    duplicate history entries si deux saves frappent en parallele).
        const auditEntries = [];
        await sequelize.transaction(async (t) => {
            const nomsToFetch = validated.map((v) => v.nom);
            const existingRows = nomsToFetch.length
                ? await FinanceCharge.findAll({
                    where: { nom: nomsToFetch },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                })
                : [];
            const existingByNom = new Map(
                existingRows.map((r) => [r.nom, r])
            );

            for (const v of validated) {
                const existing = existingByNom.get(v.nom);
                const oldMontant = existing
                    ? parseFloat(existing.montant_mensuel)
                    : null;
                const oldLibelle = existing ? existing.libelle : null;
                const oldOrdre = existing ? existing.ordre : null;

                const montantChanged = oldMontant == null
                    || Math.abs(oldMontant - v.montant) > 0.001;
                const libelleChanged = oldLibelle !== v.libelle;
                const ordreChanged = oldOrdre !== v.ordre;
                const anyChange = montantChanged || libelleChanged || ordreChanged;

                // Quand un mois est vise, finance_charges.montant_mensuel ne
                // doit PAS bouger: cette valeur sert de repli aux mois
                // anterieurs a toute saisie mensuelle. L'ecraser ferait
                // remonter la nouvelle valeur dans le passe - saisir juillet
                // changeait retroactivement juin, mai, etc.
                // Une charge creee a cette occasion n'a pas de passe: son
                // montant sert alors d'ancrage.
                const montantCatalogue = (moisCible && existing)
                    ? oldMontant
                    : v.montant;
                // Meme tolerance que montantChanged: comparer des flottants en
                // strict rewritait la ligne et bougeait updated_at pour un ecart
                // sous le seuil, sans entree d'historique correspondante.
                const montantCatalogueChange = oldMontant == null
                    || Math.abs(oldMontant - montantCatalogue) > 0.001;
                const catalogueChange = libelleChanged || ordreChanged || montantCatalogueChange;

                // updated_at ne bouge QUE si quelque chose a change.
                if (!existing || catalogueChange) {
                    await FinanceCharge.upsert({
                        nom: v.nom,
                        libelle: v.libelle,
                        montant_mensuel: montantCatalogue,
                        ordre: v.ordre,
                        updated_at: catalogueChange ? now : (existing ? existing.updated_at : now)
                    }, { transaction: t });
                }

                // History: trace les changements de la valeur d'ancrage. Les
                // montants mensuels sont eux traces par finance_charges_mois.
                if (montantChanged && !moisCible) {
                    await FinanceChargeHistory.create({
                        nom: v.nom,
                        libelle: v.libelle,
                        montant_mensuel: v.montant,
                        changed_by: username
                    }, { transaction: t });
                }

                if (anyChange || !existing) {
                    // montantCatalogue et non v.montant: avec un mois cible,
                    // l'ancrage n'est PAS modifie. Journaliser le montant saisi
                    // laisserait croire a un changement du catalogue qui n'a pas
                    // eu lieu - d'autant que l'historique est saute dans ce cas.
                    auditEntries.push({
                        nom: v.nom,
                        montant_mensuel: montantCatalogue,
                        ...(moisCible ? { mois: moisCible, montant_du_mois: v.montant } : {})
                    });
                }

                // Montant date: enregistre pour le mois demande. Le PL de ce
                // mois et des suivants s'en servira, sans toucher aux mois
                // anterieurs deja calcules.
                if (moisCible) {
                    await FinanceChargeMois.upsert({
                        mois: moisCible,
                        nom: v.nom,
                        montant_mensuel: v.montant,
                        updated_at: now
                    }, { transaction: t });
                }
            }
        });

        // 4) Audit log apres commit (les entries refletent ce qui a effectivement change).
        for (const a of auditEntries) {
            audit.log(req, 'charge.upsert', a);
        }

        const rows = await FinanceCharge.findAll({ order: [['ordre', 'ASC'], ['nom', 'ASC']] });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('PUT /api/finance/charges:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Liste les changements historiques de montant_mensuel pour une charge.
// CASCADE: si la charge est supprimee, son historique l'est aussi (FK).
router.get('/charges/:nom/history', async (req, res) => {
    try {
        const nom = String(req.params.nom || '').trim();
        if (!nom) {
            return res.status(400).json({ success: false, error: 'nom requis' });
        }
        const rows = await FinanceChargeHistory.findAll({
            where: { nom },
            order: [['created_at', 'DESC']],
            limit: 100
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/charges/:nom/history:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Supprime une charge (par nom, PK).
router.delete('/charges/:nom', async (req, res) => {
    try {
        const nom = String(req.params.nom || '').trim();
        if (!nom) {
            return res.status(400).json({ success: false, error: 'nom requis' });
        }
        const n = await FinanceCharge.destroy({ where: { nom } });
        if (n > 0) {
            audit.log(req, 'charge.delete', { nom });
        }
        res.json({ success: true, deleted: n });
    } catch (e) {
        console.error('DELETE /api/finance/charges/:nom:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// PL (Profit/Loss) — reserve aux admin / superviseur
// =====================================================
// Formule:
//   PL = total_ventes
//      - total_avances (sur la periode, depuis MataBanq)
//      - commission_maas (3% sur ventes elligibles)
//      + marge_cdc (Il me doit)
//      - charges_proratisees (par mois: charges_mensuelles × jours_couverts /
//        jours_reels_du_mois ; 30 fixe surestimait juillet de 3,3%)
//      - depenses_periode (table depenses, saisies onglet Depenses, periode)
//      - paiements_fournisseur (table fournisseur_paiements, sur la periode)
//      + variation_stock_nette
//
// total_avances: somme des operations type='avance' de MataBanq filtrees
// ICI sur [dateDebut, dateFin]. Ne PAS utiliser status[0].total_avances:
// c'est un cumul annee, insensible aux dates envoyees a l'API.
//
// variation_stock_brute = stock_soir_fin - stock_matin_debut
// variation_stock_nette = ((100 - stock_pertes_decoupe_pct) / 100) × variation_stock_brute
//
// Stock qui augmente = actif latent positif. Le coefficient (default
// 95% = 5% pertes decoupe) compense la perte de volume entre achat
// brut et produit fini decoupe. Configurable via finance_config.
// Si pas de saisie stock pile aux dates demandees, on prend la date
// la plus proche <= demandee (fallback).
//
/**
 * GET /api/finance/simulation?dateDebut=&dateFin=
 *
 * Volumes vendus, par produit suivi, sur la periode. C'est TOUT ce que cette
 * route calcule.
 *
 * Elle ne recalcule PAS le resultat: le client lit le PL par /api/finance/pl,
 * la seule route qui l'etablit. Deux chemins qui calculent le meme nombre
 * finissent toujours par en rendre deux differents - ce depot l'a paye
 * plusieurs fois.
 *
 * Le reste de la simulation est de l'arithmetique sur ces volumes, faite cote
 * client pour rester instantanee quand on change le montant du bump:
 *
 *   sensibilite(X) = X x quantite vendue        (quantites inchangees)
 *   PL apres bump  = PL actuel + sensibilite(X)
 *   prix d'equilibre = prix moyen - PL actuel / quantite
 *
 * Le coefficient "1 franc de chiffre d'affaires = 1 franc de resultat" a ete
 * MESURE, pas suppose: en injectant une vente de 1 000 000 puis de 3 000 000 F
 * sur juillet 2026, le PL bouge d'exactement le meme montant dans les deux cas.
 * Aucun poste du resultat n'est proportionnel au chiffre d'affaires.
 */
router.get('/simulation', async (req, res) => {
    try {
        const role = (req.session && req.session.user && req.session.user.role || '').toLowerCase();
        if (!['admin', 'superviseur'].includes(role)) {
            return res.status(403).json({
                success: false,
                error: 'Accès réservé aux administrateurs et superviseurs'
            });
        }

        const today = new Date();
        const rawDebut = req.query.dateDebut;
        const rawFin = req.query.dateFin;
        const dateDebut = rawDebut ? parseDateVersISO(rawDebut)
            : `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const dateFin = rawFin ? parseDateVersISO(rawFin) : today.toISOString().slice(0, 10);
        if ((rawDebut && !dateDebut) || (rawFin && !dateFin)) {
            return res.status(400).json({ success: false, error: 'invalid dateDebut/dateFin' });
        }

        // Memes bornes que le PL, aux memes mots. Les deux routes sont appelees
        // ENSEMBLE par l'ecran: si l'une refuse et l'autre accepte, l'utilisateur
        // recoit deux verdicts contradictoires pour une seule question.
        //
        // Sans ces gardes, une periode inversee rendait un IN () vide et donc un
        // 500 avec le message d'erreur SQL brut a l'ecran, et une periode de dix
        // ans construisait une liste de 7 308 dates la ou le PL refusait net.
        const startD = new Date(dateDebut + 'T00:00:00Z');
        const endD = new Date(dateFin + 'T00:00:00Z');
        if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
            return res.status(400).json({ success: false, error: 'invalid dateDebut/dateFin' });
        }
        if (startD > endD) {
            return res.status(400).json({ success: false, error: 'dateDebut must be <= dateFin' });
        }
        const nbJours = Math.floor((endD - startD) / 86400000) + 1;
        const MAX_JOURS = 366;
        if (nbJours > MAX_JOURS) {
            return res.status(400).json({
                success: false,
                error: `periode trop longue (${nbJours} jours, max ${MAX_JOURS})`
            });
        }

        // MEME filtre de date que le PL, via le meme helper. J'avais d'abord
        // ecrit `date >= :debut AND date <= :fin`, en supposant que ventes.date
        // etait toujours en ISO. C'est vrai des tenants d'aujourd'hui - verifie,
        // zero ligne hors format sur les cinq schemas - mais la colonne est un
        // TEXTE de format mixte, et le PL enumere deja les deux graphies pour
        // cette raison. Deux routes qui interrogent la meme table par deux
        // chemins differents finissent par rendre deux chiffres differents.
        const dateList = graphiesDeDatesPourPeriode(dateDebut, dateFin);
        // Lignes BRUTES, agregees ensuite par lib/volumes-vendus.js. C'etait
        // auparavant un GROUP BY SQL suivi d'un regroupement JS ecrit ici, en
        // double de celui de computePl: deux codes qui repondaient a la meme
        // question, donc deux chiffres qui allaient finir par diverger. Le
        // GROUP BY economisait un transfert de quelques milliers de lignes,
        // ce que la periode maximale (366 jours) garde tres modeste.
        // `date` sert a ponderer le prix d'achat jour par jour (voir plus bas).
        // Colonne de plus sur la meme requete, aucun aller-retour ajoute.
        // nom_client et commande_id ne servent qu'a la v2 (fidelisation,
        // commandes a multiplier), mais les porter ici ne coute que deux
        // colonnes sur la meme requete.
        const lignes = await sequelize.query(
            `SELECT produit, nombre, montant, date, nom_client, commande_id, prix_unit, id
               FROM ventes
              WHERE date IN (:dateList)`,
            { type: sequelize.QueryTypes.SELECT, replacements: { dateList } }
        );

        // MEME agregation que le PL, par le meme module: les graphies d'un
        // produit s'additionnent au lieu de se concurrencer, et la regle de
        // normalisation ne vit qu'a un endroit.
        const { agregerVolumes, trouverProduit } = require('../lib/volumes-vendus');
        const volumes = agregerVolumes(lignes);

        // Prix d'ACHAT. Il sert au levier VOLUME, pas au levier prix:
        // augmenter le prix ne coute rien de plus, mais vendre un kilo de plus
        // oblige a l'acheter. Seule la MARGE tombe dans le resultat. Sur le
        // boeuf en juillet, 4 728 F de prix moyen contre 3 835 F d'achat:
        // rapporter le resultat au prix de vente surestimait le volume
        // necessaire d'un facteur cinq.
        //
        // DEUX REGIMES, selon le drapeau d'administration:
        //
        //  - drapeau ferme: comportement d'origine, mot pour mot. Un prix
        //    unique, resolu a la date de FIN. L'ecran actuel ne change pas.
        //
        //  - drapeau ouvert: le prix devient la MOYENNE de la periode ponderee
        //    par les quantites vendues chaque jour, et la famille poulet
        //    s'applique. Figer un prix unique etait faux des que le cout bouge
        //    dans le mois: le boeuf va de 3 735 a 4 435 F sur juillet 2026,
        //    et la simulation valorisait les 31 journees au prix du dernier
        //    jour. computePl, lui, resout deja par borne.
        const reglagesSim = await lireReglagesSimulationV2();
        const v2 = reglagesSim.actif;

        let resolveurPrix;
        let prixAchatDe;
        // Le resolveur de la DATE DE FIN, resolu une seule fois.
        //
        // `prixAchatDe` rend la moyenne ponderee du mois; celui-ci rend le
        // prix a la date de fin, dont produits_vendus a besoin pour
        // `prix_achat_fin`. pourDate() fait un travail reel a chaque appel
        // (historique, derniere reception, lot MATA): l'appeler dans le map
        // des produits le refaisait une fois par ligne.
        let prixAchatFinDe = null;
        let origineDe = () => null;
        // Prix de VENTE catalogue des carcasses, expose en v2 seulement.
        // C'est l'assiette reelle de la commission MaaS (commissionPct x prix
        // catalogue x quantites livrees, cf routes/finance-creances.js): le
        // moteur de l'ecran en a besoin pour faire suivre la commission aux
        // achats que les leviers volume et parage induisent - sans quoi le
        // levier volume etait surestime d'environ 20 %.
        let catalogueV2 = null;
        let projectionV2 = null;
        // Parage MESURE du mois, arrete a la veille: le diviseur de la marge
        // unitaire, a la place du parametre fixe a 5 %.
        let parageMesureV2 = null;
        let topClientsV2 = null;
        let commandesV2 = null;
        let clientsHistoriqueV2 = null;

        if (!v2) {
            const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');
            resolveurPrix = await creerResolveurPrixAchat(dateFin);
            prixAchatDe = resolveurPrix.pourDate(dateFin).prixAchat;
        } else {
            const { creerResolveurPrixAchatSimulation } = require('../lib/prix-achat-simulation');
            resolveurPrix = await creerResolveurPrixAchatSimulation({ dateMax: dateFin });

            // FournisseurPrix vient de l'import de tete de fichier: le require
            // local rendait le MEME objet (cache de Node) et n'etait que du
            // bruit.
            const rowsPv = await FournisseurPrix.findAll({ raw: true });
            const pvDe = (cle) => {
                const r = rowsPv.find((x) => normaliserNomProduit(x.produit) === cle);
                const v = r ? parseFloat(r.prix_vente) : NaN;
                return Number.isFinite(v) && v > 0 ? v : null;
            };
            // Le prix catalogue de CHAQUE produit, pas seulement des trois
            // carcasses. L'ecran rangeait d'office tout produit ni bovin ni
            // ovin dans la volaille: le Laxass, vendu 200 F, se voyait
            // commissionne sur les 3 500 F du poulet - 105 F l'unite - et
            // ressortait a -62 F de marge nette quand il en gagne 43.
            const pvParProduit = {};
            for (const r of rowsPv) {
                const v = parseFloat(r.prix_vente);
                if (Number.isFinite(v) && v > 0) {
                    pvParProduit[normaliserNomProduit(r.produit)] = v;
                }
            }
            catalogueV2 = {
                pv_boeuf: pvDe('boeuf'),
                pv_agneau: pvDe('agneau'),
                pv_poulet: pvDe('poulet'),
                par_produit: pvParProduit
            };

            // ---- Donnees de PROJECTION fin de mois (methode P1/P2).
            //
            // CA par jour de la periode demandee: derive des lignes deja
            // chargees, zero requete de plus. L'historique des 92 jours qui
            // PRECEDENT la periode sert a deux choses: les rythmes
            // historiques comparables de la regle 70/30, et la CALIBRATION du
            // coefficient P1/P2 sur les ventes du tenant lui-meme plutot que
            // sur la valeur de reference du document.
            const caParJour = {};
            for (const l of lignes) {
                const iso = parseDateVersISO(l.date);
                if (iso) caParJour[iso] = (caParJour[iso] || 0) + (parseFloat(l.montant) || 0);
            }

            const finHisto = new Date(dateDebut + 'T00:00:00Z');
            finHisto.setUTCDate(finHisto.getUTCDate() - 1);
            const debutHisto = new Date(finHisto);
            debutHisto.setUTCDate(debutHisto.getUTCDate() - 91);
            const histoDebutIso = debutHisto.toISOString().slice(0, 10);
            const histoFinIso = finHisto.toISOString().slice(0, 10);
            // nom_client sur la MEME requete: l'habitude d'achat d'un client ne
            // se lit pas sur la periode courante seule. « Aucun passage depuis
            // 7 jours » ne veut rien dire pour qui vient tous les quinze jours.
            const lignesHisto = await sequelize.query(
                `SELECT date, montant, nom_client FROM ventes WHERE date IN (:dl)`,
                {
                    type: sequelize.QueryTypes.SELECT,
                    replacements: { dl: graphiesDeDatesPourPeriode(histoDebutIso, histoFinIso) }
                }
            );
            const caHisto = {};
            for (const l of lignesHisto) {
                const iso = parseDateVersISO(l.date);
                if (iso) caHisto[iso] = (caHisto[iso] || 0) + (parseFloat(l.montant) || 0);
            }

            // Coefficient de REFERENCE du document, par tenant. La calibration
            // sur l'historique, faite cote client, prime quand elle est
            // possible; cette valeur est le repli et le point de comparaison.
            const COEFFS_DOCUMENT = {
                o_foire: 1.336, mbao: 1.243, keur_massar: 1.280, sacre_coeur: 1.392
            };
            const slugTenant = String(require('../config/tenant').slug || '').toLowerCase();

            // La calibration ENREGISTREE, si un administrateur en a fige une.
            //
            // Elle voyage avec la projection et non avec /reglages, qui ne
            // rend ses cles qu'aux administrateurs: le coefficient pilote le
            // chiffre que TOUT LE MONDE lit a l'ecran, il ne peut pas etre
            // invisible a ceux qui le subissent.
            //
            // Relue depuis `reglagesSim`, deja charge en tete de handler: une
            // seconde lecture aurait fait deux allers-retours en base par
            // requete ET deux traitements differents de la panne, celui-ci
            // ignorant le repli documente de lireReglagesSimulationV2().
            const coeffEnregistre = reglagesSim.coeffP1P2 || null;

            projectionV2 = {
                ca_par_jour: caParJour,
                historique: { debut: histoDebutIso, fin: histoFinIso, ca_par_jour: caHisto },
                coeff_defaut: COEFFS_DOCUMENT[slugTenant] || 1.28,
                coeff_enregistre: coeffEnregistre
            };

            // ---- PARAGE MESURE DU MOIS, arrete a la VEILLE de dateFin.
            //
            // La marge unitaire divise le prix carcasse par (1 - parage). Elle
            // le faisait avec stock_pertes_decoupe_pct, un parametre fixe a
            // 5 %, alors que le parage reellement mesure change le SIGNE du
            // resultat: a 4 520 F la carcasse et 5 400 F de prix moyen, la
            // marge vaut +642 F a 5 % et -79 F a 17,5 %.
            //
            // La VEILLE, et non le jour meme: l'inventaire du soir se saisit
            // souvent tard. Une journee dont le stock du soir n'est pas encore
            // entre affiche un parage voisin de 100 % - elle empoisonnerait le
            // taux du mois entier au moment precis ou l'on s'en sert.
            //
            // Le 1er du mois n'a pas de veille dans son mois: on rend null
            // plutot que de cumuler le mois precedent, qui decrirait autre
            // chose. Le client retombe alors sur le parametre.
            parageMesureV2 = null;
            try {
                const veille = new Date(dateFin + 'T00:00:00Z');
                veille.setUTCDate(veille.getUTCDate() - 1);
                const veilleIso = veille.toISOString().slice(0, 10);
                if (veilleIso.slice(0, 7) === dateFin.slice(0, 7)) {
                    const { tauxParageMois } = require('../lib/parage-mois');
                    const { lirePackCompositions } = require('../lib/pack-compositions');
                    const { chargerContexteParage: ctxDe } = require('../lib/parage-contexte');
                    const ctxParage = await ctxDe(sequelize);
                    const packsParage = await lirePackCompositions();
                    const t = await tauxParageMois(sequelize, veilleIso, ctxParage, packsParage);
                    // `perte` est une FRACTION (0,175), l'ecran attend des
                    // points de pourcentage - comme stock_pertes_decoupe_pct
                    // qu'il remplace.
                    const pct = (b) => (b && b.perte !== null && b.perte !== undefined)
                        ? round2(parseFloat(b.perte) * 100) : null;
                    parageMesureV2 = {
                        jusquau: veilleIso,
                        bovin: pct(t.bovin),
                        ovin: pct(t.ovin),
                        jours_mesures: {
                            bovin: (t.bovin && t.bovin.joursMesures) || 0,
                            ovin: (t.ovin && t.ovin.joursMesures) || 0
                        }
                    };
                }
            } catch (e) {
                // Un parage illisible ne doit pas priver l'ecran de sa
                // simulation: le client garde le parametre, comme avant.
                console.warn('[simulation] parage mesure indisponible:', e.message);
            }

            // ---- Clients de la periode, pour la fidelisation: les plus gros
            // par chiffre d'affaires, avec leur dernier passage. Derive des
            // memes lignes.
            const parClient = new Map();
            for (const l of lignes) {
                const nom = String(l.nom_client || '').trim();
                if (!nom) continue;
                const cle = nom.toLowerCase();
                if (!parClient.has(cle)) parClient.set(cle, { nom, ca: 0, nb: 0, dernier: null });
                const cl = parClient.get(cle);
                cl.ca += parseFloat(l.montant) || 0;
                cl.nb += 1;
                const iso = parseDateVersISO(l.date);
                if (iso && (!cl.dernier || iso > cl.dernier)) cl.dernier = iso;
            }
            topClientsV2 = Array.from(parClient.values())
                .sort((a, b) => b.ca - a.ca)
                .slice(0, 8)
                .map((cl) => ({ nom: cl.nom, ca: round2(cl.ca), nb: cl.nb, dernier: cl.dernier }));

            // ---- HABITUDE D'ACHAT, sur l'historique ET la periode courante.
            //
            // Relancer sur un delai fixe ("aucun passage depuis 7 jours") se
            // trompe des deux cotes: on harcele le client bimensuel et on
            // laisse filer l'hebdomadaire qui a saute deux tours. Ce qu'il faut
            // comparer, c'est le silence a SON rythme a lui.
            //
            // On transporte les JOURNEES de passage, pas les lignes: deux
            // achats le meme jour sont une visite. Le calcul d'intervalle et la
            // decision vivent dans le module pur, teste.
            const habitudes = new Map();
            const noterPassage = (nomBrut, iso, montant) => {
                const nom = String(nomBrut || '').trim();
                if (!nom || !iso) return;
                const cle = nom.toLowerCase();
                if (!habitudes.has(cle)) habitudes.set(cle, { nom, jours: new Map(), ca: 0 });
                const h = habitudes.get(cle);
                const m = parseFloat(montant) || 0;
                h.jours.set(iso, (h.jours.get(iso) || 0) + m);
                h.ca += m;
            };
            for (const l of lignesHisto) noterPassage(l.nom_client, parseDateVersISO(l.date), l.montant);
            for (const l of lignes) noterPassage(l.nom_client, parseDateVersISO(l.date), l.montant);

            // Plafonne aux 40 plus gros de la fenetre: de quoi tenir un top 5 et
            // des relances, sans porter toute la clientele dans la reponse.
            // Le plafond retient les plus gros SUR LA FENETRE **et** les plus
            // gros DU MOIS DERNIER.
            //
            // Trier sur le seul CA de la fenetre ecartait le client qui n'est
            // present que depuis peu: un restaurant a 900 000 F le mois
            // dernier passait derriere quarante reguliers cumulant plus sur
            // trois mois, et disparaissait donc du « top 5 des gros clients du
            // mois dernier » - la liste ratait precisement celui qu'elle
            // cherche. On garde les deux classements, dedupliques.
            const moisPrecedent = (() => {
                const d = new Date(String(dateFin).slice(0, 7) + '-01T00:00:00Z');
                d.setUTCMonth(d.getUTCMonth() - 1);
                return d.toISOString().slice(0, 7);
            })();
            const caMoisDernier = (h) => {
                let s = 0;
                for (const [j, m] of h.jours.entries()) {
                    if (String(j).slice(0, 7) === moisPrecedent) s += m;
                }
                return s;
            };
            const tous = Array.from(habitudes.values());
            const parFenetre = tous.slice().sort((a, b) => b.ca - a.ca).slice(0, 40);
            const parMoisDernier = tous.slice()
                .sort((a, b) => caMoisDernier(b) - caMoisDernier(a)).slice(0, 20);
            const retenusClients = [];
            const vusClients = new Set();
            for (const h of parFenetre.concat(parMoisDernier)) {
                const cle = String(h.nom).trim().toLowerCase();
                if (vusClients.has(cle)) continue;
                vusClients.add(cle);
                retenusClients.push(h);
            }

            clientsHistoriqueV2 = {
                debut: histoDebutIso,
                fin: dateFin,
                clients: retenusClients
                    .map((h) => ({
                        nom: h.nom,
                        ca_fenetre: round2(h.ca),
                        // [date ISO, montant] triees: l'ecran en tire les
                        // intervalles et les cumuls mensuels qu'il veut.
                        passages: Array.from(h.jours.entries())
                            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                            .map(([j, m]) => ({ date: j, ca: round2(m) }))
                    }))
            };

            // ---- Commandes de la periode: les lignes partageant un
            // commande_id. Le serveur livre les PANIERS; le classement par PL
            // estime se fait cote ecran, seul a connaitre les marges nettes.
            // Les 30 plus grosses par CA suffisent: on cherche les meilleures,
            // pas l'exhaustivite.
            const parCommande = new Map();
            for (const l of lignes) {
                const id = l.commande_id;
                if (id === null || id === undefined || id === '') continue;
                if (!parCommande.has(id)) {
                    parCommande.set(id, { id, client: null, date: null, ca: 0, produits: new Map() });
                }
                const cde = parCommande.get(id);
                cde.ca += parseFloat(l.montant) || 0;
                const nomCl = String(l.nom_client || '').trim();
                if (nomCl && !cde.client) cde.client = nomCl;
                const isoCde = parseDateVersISO(l.date);
                if (isoCde && (!cde.date || isoCde > cde.date)) cde.date = isoCde;
                const prod = String(l.produit || '').trim();
                if (prod) {
                    if (!cde.produits.has(prod)) cde.produits.set(prod, { produit: prod, quantite: 0, ca: 0 });
                    const pr = cde.produits.get(prod);
                    pr.quantite += parseFloat(l.nombre) || 0;
                    pr.ca += parseFloat(l.montant) || 0;
                }
            }
            commandesV2 = Array.from(parCommande.values())
                .sort((a, b) => b.ca - a.ca)
                .slice(0, 30)
                .map((cde) => ({
                    id: cde.id, client: cde.client, date: cde.date, ca: round2(cde.ca),
                    lignes: Array.from(cde.produits.values()).map((p) => ({
                        produit: p.produit, quantite: round2(p.quantite), ca: round2(p.ca)
                    }))
                }));

            // Un resolveur par JOURNEE, memoise: pourDate relit tout
            // l'historique a chaque appel, et il y a une ligne de vente par
            // appel sinon.
            const parJour = new Map();
            const pour = (iso) => {
                if (!parJour.has(iso)) parJour.set(iso, resolveurPrix.pourDate(iso));
                return parJour.get(iso);
            };

            // Somme(prix du jour x quantite du jour) / Somme(quantite), par
            // produit. Les journees dont le cout est inconnu sont ECARTEES du
            // numerateur ET du denominateur: les inclure a zero ferait passer
            // une donnee manquante pour un achat gratuit.
            // LE CUMUL SE FAIT SUR LA CIBLE, PAS SUR LE LIBELLE DE VENTE.
            //
            // « Boeuf en gros » et « Boeuf en détail » sortent de la MEME
            // carcasse: leur cout doit etre identique. Cumuler par libelle
            // faisait moyenner chacun sur SON propre calendrier de vente, et
            // les deux divergeaient sans qu'aucune carcasse ne differe. Mesure
            // sur aout 2026: 4 037 pour le gros contre 4 150 pour le detail -
            // 113 F/u d'ecart, uniquement parce que le gros avait fait 70 % de
            // son volume avant une hausse de prix contre 53 % pour le detail.
            //
            // On accumule donc en UNITES DE LA CIBLE (quantite x coefficient)
            // au prix de la cible, puis on reconvertit par libelle. Le Jarret,
            // mappe vers Boeuf avec 0,5, consomme bien un demi-kilo de
            // carcasse par piece vendue et porte la moitie du prix.
            const cumul = new Map();
            const cibleParLibelle = new Map();
            const originesParLibelle = new Map();
            for (const l of lignes) {
                const iso = parseDateVersISO(l.date);
                if (!iso) continue;
                const q = parseFloat(l.nombre) || 0;
                if (q <= 0) continue;
                const r = pour(iso);
                const pa = parseFloat(r.prixAchat(l.produit));
                if (!Number.isFinite(pa) || pa <= 0) continue;
                const dest = r.cibleDuCout ? r.cibleDuCout(l.produit) : null;
                const cible = (dest && dest.cible) || l.produit;
                const coef = (dest && dest.coefficient) || 1;
                const cleLib = normaliserNomProduit(l.produit);
                cibleParLibelle.set(cleLib, { cible, coef });
                // L'ORIGINE reste attachee au LIBELLE. Le cout est commun a la
                // carcasse, la phrase qui le decrit ne l'est pas: « Boeuf en
                // gros » est mappe x1, le Jarret x0,5. Les melanger faisait
                // afficher « sources multiples » sur les trois.
                const oLib = r.origine(l.produit);
                if (oLib) {
                    if (!originesParLibelle.has(cleLib)) originesParLibelle.set(cleLib, new Set());
                    originesParLibelle.get(cleLib).add(oLib);
                }
                // Le prix de la CIBLE: prixAchat rend deja prix_cible x coef,
                // on remonte donc au prix unitaire de la carcasse.
                const prixCible = coef > 0 ? pa / coef : pa;
                const cle = normaliserNomProduit(cible);
                if (!cumul.has(cle)) cumul.set(cle, { pondere: 0, qte: 0, origines: new Set() });
                const c = cumul.get(cle);
                c.pondere += prixCible * (q * coef);
                c.qte += q * coef;
            }
            /** Le cumul de la CIBLE d'un libelle, et le coefficient qui y mene. */
            const cumulDe = (nom) => {
                const d = cibleParLibelle.get(normaliserNomProduit(nom));
                if (!d) return null;
                const c = cumul.get(normaliserNomProduit(d.cible));
                return c ? { c, coef: d.coef } : null;
            };

            const finDePeriode = resolveurPrix.pourDate(dateFin);
            prixAchatFinDe = finDePeriode.prixAchat;
            prixAchatDe = (nom) => {
                const d = cumulDe(nom);
                if (d && d.c.qte > 0) return (d.c.pondere / d.c.qte) * d.coef;
                // AUCUNE journee ponderable. Deux cas distincts tombent ici,
                // et le repli sur la fin de periode convient aux deux:
                //  - produit sans vente: rien a ponderer;
                //  - produit vendu dont aucune journee n'avait de cout connu -
                //    par exemple un prix d'achat saisi APRES la periode, ou un
                //    produit entre dans la famille poulet apres coup.
                // Rendre null dans le second cas priverait l'ecran d'une marge
                // qu'il peut estimer; le prix de fin de periode est le
                // meilleur substitut disponible, et prix_achat_origine dit
                // d'ou il vient.
                return finDePeriode.prixAchat(nom);
            };
            // UNE seule valeur, jamais une composee. La moyenne ponderee peut
            // melanger des journees resolues differemment - un prix propre
            // apparu en cours de mois apres des journees resolues par le
            // mapping - et concatener les phrases ferait dire a l'ecran que le
            // cout vient de deux endroits a la fois.
            //
            // Quand les origines different, on le DIT plutot que d'en elire
            // une: le prix affiche est alors une moyenne de provenances, et
            // c'est exactement ce qu'il faut savoir avant de s'y fier.
            origineDe = (nom) => {
                const o = originesParLibelle.get(normaliserNomProduit(nom));
                if (!o || !o.size) return finDePeriode.origine(nom);
                if (o.size === 1) return o.values().next().value;
                return `sources multiples (${Array.from(o).join(', ')})`;
            };
        }

        // Les cinq d'origine, plus ceux que l'administration a ajoutes. La
        // base reste codee en dur: un tableau dont les lignes changent d'un
        // mois a l'autre ne se compare pas, et l'ajout doit etre un acte
        // explicite. Hors v2, la liste ne bouge pas du tout.
        const listeSuivie = v2 && reglagesSim.produitsSuivis.length
            ? PRODUITS_SIMULATION.concat(
                reglagesSim.produitsSuivis.filter((nom) => !PRODUITS_SIMULATION.some(
                    (base) => normaliserNomProduit(base) === normaliserNomProduit(nom)
                ))
            )
            : PRODUITS_SIMULATION;

        // ---- PRIX RETENU POUR LA SUITE DU MOIS.
        //
        // Le prix MOYEN explique le passe: il melange les tarifs successifs et
        // les remises. Il ne dit rien de ce qui sera facture demain. Or les
        // jours qui restent se vendront au tarif COURANT - c'est lui qui doit
        // servir a projeter, sans quoi le plan reclame un effort calcule sur
        // des prix qu'on ne pratique plus.
        //
        // Regle posee par le proprietaire du produit: parmi les lignes de la
        // DERNIERE JOURNEE vendue, le prix MAJORITAIRE. La derniere ligne seule
        // se laisserait dicter par une vente exceptionnelle; le majoritaire du
        // jour resiste a une remise isolee.
        //
        // A egalite de nombre de lignes: le plus gros volume, puis le prix le
        // plus haut - un depart arbitraire mais STABLE d'un appel a l'autre.
        const prixRetenuParCle = new Map();
        {
            const parCle = new Map();
            for (const l of lignes) {
                const iso = parseDateVersISO(l.date);
                const pu = parseFloat(l.prix_unit);
                if (!iso || !Number.isFinite(pu) || pu <= 0) continue;
                const cle = normaliserNomProduit(l.produit);
                if (!cle) continue;
                if (!parCle.has(cle)) parCle.set(cle, new Map());
                const parDate = parCle.get(cle);
                if (!parDate.has(iso)) parDate.set(iso, new Map());
                const parPrix = parDate.get(iso);
                const e = parPrix.get(pu) || { nb: 0, q: 0 };
                e.nb += 1;
                e.q += parseFloat(l.nombre) || 0;
                parPrix.set(pu, e);
            }
            for (const [cle, parDate] of parCle) {
                const derniere = Array.from(parDate.keys()).sort().pop();
                const parPrix = parDate.get(derniere);
                let meilleur = null;
                for (const [prix, e] of parPrix) {
                    if (!meilleur
                        || e.nb > meilleur.nb
                        || (e.nb === meilleur.nb && e.q > meilleur.q)
                        || (e.nb === meilleur.nb && e.q === meilleur.q && prix > meilleur.prix)) {
                        meilleur = { prix, nb: e.nb, q: e.q };
                    }
                }
                if (meilleur) {
                    prixRetenuParCle.set(cle, {
                        prix: round2(meilleur.prix),
                        date: derniere,
                        nb_lignes: meilleur.nb,
                        // Combien de prix DIFFERENTS ce jour-la: au-dela de un,
                        // le majoritaire est un choix, et l'ecran doit pouvoir
                        // le dire plutot que de le presenter comme une evidence.
                        nb_prix_ce_jour: parPrix.size
                    });
                }
            }
        }
        const prixRetenuDe = (nom) => prixRetenuParCle.get(normaliserNomProduit(nom)) || null;

        const produits = listeSuivie.map((nom) => {
            const agg = trouverProduit(volumes.produits, nom)
                || { quantite: 0, ca: 0, nb_lignes: 0, graphies: [] };
            const prixMoyen = agg.quantite > 0 ? agg.ca / agg.quantite : null;
            const pa = prixAchatDe ? parseFloat(prixAchatDe(nom)) : NaN;
            const prixAchat = Number.isFinite(pa) && pa > 0 ? round2(pa) : null;
            // Marge nulle ou negative: vendre plus n'approche pas de
            // l'equilibre, ca l'eloigne. Le cas doit rester visible, donc on
            // renvoie la valeur telle quelle plutot que de la masquer.
            const marge = (prixMoyen !== null && prixAchat !== null)
                ? round2(prixMoyen - prixAchat) : null;
            return {
                nom,
                quantite: round2(agg.quantite),
                ca: round2(agg.ca),
                prix_achat: prixAchat,
                marge_unitaire: marge,
                // Prix MOYEN constate, et non prix de catalogue: c'est celui-la
                // qui explique le chiffre d'affaires de la periode.
                prix_moyen: agg.quantite > 0 ? round2(agg.ca / agg.quantite) : null,
                // Le prix qui sera pratique demain, pour projeter. Null si le
                // produit n'a rien vendu sur la periode.
                prix_retenu: prixRetenuDe(nom),
                nb_lignes: agg.nb_lignes,
                // Deja triees par agregerVolumes. Ne pas retrier ici: .sort()
                // trie EN PLACE, donc sur le tableau porte par volumes.produits.
                graphies: agg.graphies,
                // Un produit sans vente n'est pas une erreur, mais sa
                // sensibilite vaut zero et l'ecran doit pouvoir le dire.
                sans_vente: agg.quantite === 0,
                // D'ou vient le cout: 'propre' (catalogue ou historique du
                // produit lui-meme) ou « mappé vers X » ou null
                // quand il reste inconnu. Le mode debut de l'ecran en a besoin:
                // un chiffre dont on ne peut pas nommer la source ne se
                // verifie pas. Null hors Simulation 2.0, ou la notion n'existe
                // pas.
                prix_achat_origine: origineDe(nom)
            };
        });

        // ---- TOUS les produits vendus, avec leur cout quand il est connu.
        //
        // PRODUITS_SIMULATION est une liste FERMEE, et c'est voulu: le tableau
        // de sensibilite doit se comparer d'un mois a l'autre, donc ses lignes
        // ne doivent pas apparaitre et disparaitre. Mais le plan d'equilibre,
        // lui, cherche ou aller chercher de la marge - et rien ne justifie
        // qu'il ignore une cuisse de poulet qui se vend avec un cout connu.
        //
        // Deux listes pour deux usages, donc, plutot qu'une liste ouverte qui
        // casserait la comparaison. Les produits SANS cout connu sont rendus
        // avec marge nulle: l'ecran les nomme au lieu de les taire, c'est ce
        // qui pousse a completer le catalogue.
        let produitsVendus = null;
        let candidatsV2 = null;
        let ecartesV2 = null;
        if (v2) {
            produitsVendus = volumes.produits
                .filter((a) => a.quantite > 0)
                .map((a) => {
                    // agregerVolumes TRIE les graphies par ordre alphabetique:
                    // prendre la premiere donnait la graphie alphabetiquement
                    // premiere, pas la plus courante - la faute de frappe
                    // d'une seule ligne l'emportait sur l'orthographe des
                    // quatre-vingts autres. A defaut d'un comptage par
                    // graphie, la plus LONGUE est un meilleur candidat: elle
                    // porte les accents, que leur absence raccourcit rarement
                    // mais jamais l'inverse.
                    const nom = (a.graphies || []).slice().sort(
                        (x, y) => String(y).length - String(x).length
                            || String(x).localeCompare(String(y), 'fr')
                    )[0] || a.cle;
                    const pa = prixAchatDe ? parseFloat(prixAchatDe(nom)) : NaN;
                    const prixAchat = Number.isFinite(pa) && pa > 0 ? round2(pa) : null;
                    // LE COUT D'ACHAT POUR LA SUITE, a cote de la moyenne du
                    // mois.
                    //
                    // `prix_achat` est une moyenne PONDEREE des journees
                    // ecoulees: elle explique le passe, et melange les lots
                    // anciens aux recents. Les jours qui RESTENT se paieront au
                    // dernier prix connu - celui du dernier transfert recu pour
                    // le boeuf. Projeter sur la moyenne sous-estime le cout des
                    // que la carcasse a rencheri (mesure: 4 157 contre 4 480).
                    //
                    // Meme raisonnement que `prix_retenu` cote VENTE, qui
                    // existe deja pour la meme raison. La symetrie manquait.
                    const paFin = prixAchatFinDe ? parseFloat(prixAchatFinDe(nom)) : NaN;
                    const prixAchatFin = Number.isFinite(paFin) && paFin > 0 ? round2(paFin) : null;
                    return {
                        nom,
                        quantite: round2(a.quantite),
                        ca: round2(a.ca),
                        prix_moyen: a.prix_moyen === null ? null : round2(a.prix_moyen),
                        prix_retenu: prixRetenuDe(nom),
                        prix_achat: prixAchat,
                        prix_achat_fin: prixAchatFin,
                        nb_lignes: a.nb_lignes,
                        sans_vente: false,
                        prix_achat_origine: origineDe(nom)
                    };
                });

            // ---- CANDIDATS a l'ajout dans la liste suivie, par marge.
            //
            // Condition posee par le proprietaire du produit: le nom vendu doit
            // etre AUSSI un nom de stock. Sans ligne de stock, le produit n'a
            // ni borne matin ni borne soir - donc ni variation ni parage a lui
            // opposer, et il n'apporterait qu'un prix a la simulation.
            //
            // Une seule requete, sur les noms DISTINCTS de la table stocks:
            // c'est un ensemble court, et la comparaison se fait ensuite en
            // memoire avec la meme normalisation que partout ailleurs.
            const nomsStock = await sequelize.query(
                'SELECT DISTINCT produit FROM stocks',
                { type: sequelize.QueryTypes.SELECT }
            );
            const clesStock = new Set(
                nomsStock.map((r) => normaliserNomProduit(r.produit)).filter(Boolean)
            );
            // Seuls les CINQ d'origine sont ecartes: ils sont toujours suivis
            // et ne se decochent pas. Ceux que l'administration a ajoutes
            // restent dans la liste, coches - sans quoi l'ecran devait les
            // afficher a part, et le panneau se lisait comme deux listes sans
            // rapport.
            // Les 5 de base ET ceux que l'administration a ajoutes. N'y mettre
            // que les 5 laissait un produit ajoute retomber dans
            // `produits_ecartes`: l'ecran le declarait « aucune vente ce
            // mois-ci » sur des ventes bien reelles.
            const dejaSuivi = new Set(listeSuivie.map((n) => normaliserNomProduit(n)));

            // Le serveur rend la marge BRUTE et les deux prix; c'est l'ECRAN
            // qui reclasse en marge NETTE DE PARAGE, parce que lui seul porte
            // le contexte de parage par espece (cfgMap et categorieDe vivent
            // dans computePl, pas ici). Sans ce reclassement cote client, un
            // produit a +50 F bruts mais -137 F nets etait presente comme un
            // gisement de marge.
            const candidatsBruts = produitsVendus
                .filter((p) => {
                    if (dejaSuivi.has(normaliserNomProduit(p.nom))) return false;
                    if (!clesStock.has(normaliserNomProduit(p.nom))) return false;
                    // Sans cout connu, aucune marge a proposer: le produit
                    // apparait deja dans les recommandations "coût inconnu".
                    return p.prix_achat !== null && p.prix_moyen !== null;
                })
                .map((p) => ({
                    nom: p.nom,
                    quantite: p.quantite,
                    ca: p.ca,
                    prix_moyen: p.prix_moyen,
                    prix_achat: p.prix_achat,
                    marge_unitaire: round2(p.prix_moyen - p.prix_achat)
                }))
                .filter((p) => p.marge_unitaire > 0)
                .sort((a, b) => b.marge_unitaire - a.marge_unitaire);

            candidatsV2 = candidatsBruts.slice(0, 20);
            // Les candidats VALIDES mais tronques par le plafond d'affichage:
            // ils ne doivent pas ressortir en « marge nulle ou negative » dans
            // la liste des ecartes, ce qui etait un mensonge sur leur compte.
            const clesCandidates = new Set(candidatsBruts.map((c) => normaliserNomProduit(c.nom)));

            // POURQUOI un produit vendu n'est-il pas proposable.
            //
            // Sans cela, un tenant dont le catalogue est incomplet voit un
            // panneau vide et conclut que la fonction ne marche pas. Mesure
            // sur la production: chez O.Foire et Keur Massar, AUCUN candidat -
            // et la cause est la meme partout, un prix d'achat absent. C'est
            // une liste de choses a faire, pas une panne.
            ecartesV2 = produitsVendus
                .filter((p) => !dejaSuivi.has(normaliserNomProduit(p.nom)))
                // Compare a TOUS les candidats valides, pas aux 20 affiches.
                .filter((p) => !clesCandidates.has(normaliserNomProduit(p.nom)))
                .map((p) => {
                    let motif = null;
                    if (!clesStock.has(normaliserNomProduit(p.nom))) motif = 'sans_stock';
                    else if (p.prix_achat === null) motif = 'sans_prix_achat';
                    else if (p.prix_moyen === null) motif = 'sans_prix_vente';
                    else motif = 'marge_nulle';
                    return { nom: p.nom, ca: p.ca, motif };
                })
                .sort((a, b) => b.ca - a.ca)
                .slice(0, 20);
        }

        // Somme de TOUTES les lignes de vente de la periode, tous produits
        // confondus. Le client s'en sert pour verifier que le denominateur des
        // pourcentages - le total_ventes du PL - se rapporte bien au meme
        // perimetre que les numerateurs calcules ici.
        //
        // Les deux coincident aujourd'hui au franc pres. Mais le numerateur
        // vient de cette route et le denominateur du PL: le jour ou le PL
        // filtrera quelque chose que cette requete ne filtre pas, les
        // pourcentages deviendront faux SANS RIEN DIRE. Renvoyer le total
        // permet a l'ecran de s'en apercevoir plutot que d'afficher des parts
        // qui ne somment plus.
        const totalToutesLignes = volumes.total_ca;

        res.json({
            success: true,
            data: {
                periode: { dateDebut, dateFin },
                produits,
                // Null hors v2: le plan d'equilibre n'y existe pas.
                produits_vendus: produitsVendus,
                // Produits proposes a l'ajout, par marge decroissante.
                produits_candidats: candidatsV2,
                // Produits vendus non proposables, avec la raison.
                produits_ecartes: ecartesV2,
                // Ce que l'administration a ajoute a la liste de base.
                produits_suivis_ajoutes: v2 ? reglagesSim.produitsSuivis : null,
                total_ventes_toutes_lignes: round2(totalToutesLignes),
                produit_equilibre: PRODUIT_EQUILIBRE,
                // Mesure, cf le commentaire d'en-tete de cette route.
                coefficient_pl_par_franc_vendu: 1,
                // 1 = comportement d'origine, 2 = drapeau d'administration
                // ouvert. Le client aiguille dessus plutot que d'interroger le
                // drapeau separement: la version voyage DANS la reponse qui
                // porte les chiffres, elle ne peut donc pas etre en desaccord
                // avec eux.
                version: v2 ? 2 : 1,
                // null hors v2: ces notions n'y servent a rien.
                catalogue: catalogueV2,
                projection: projectionV2,
                // Le parage qui DIVISE la marge unitaire, avec sa fenetre et
                // le nombre de journees mesurables qui le composent: un taux
                // sans son assise ne se juge pas.
                parage_mesure: parageMesureV2,
                top_clients: topClientsV2,
                commandes: commandesV2,
                clients_historique: clientsHistoriqueV2,
                prix_achat: {
                    // 'periode' dit que le cout est une moyenne ponderee par
                    // les quantites vendues; 'fin_de_periode' qu'il est fige
                    // au dernier jour.
                    mode: v2 ? 'periode' : 'fin_de_periode',
                    // La composition de la famille est un REGLAGE, pas un
                    // resultat: elle ne sort que pour les admins, comme le
                    // decident deja GET /api/simulation-v2/reglages et
                    // GET /api/finance/config. Cette route etant ouverte aux
                    // superviseurs, la laisser passer ici annulait les deux
                    // autres restrictions.
                    //
                    // prix_achat_origine reste rendu a tous: il dit d'ou vient
                    // un cout affiche, ce qui est necessaire pour le lire, et
                    // ne divulgue pas la liste.

                    // Le RESUME du prix bovin retenu suit les avertissements,
                    // au meme endroit: qu'il vienne de MATA ou du catalogue,
                    // c'est la meme question - sur quel prix ce resultat
                    // repose-t-il. Le taire quand tout va bien laissait
                    // l'utilisateur sans le chiffre qui explique son cout.
                    avertissements: (resolveurPrix.avertissements || []).concat(
                        typeof resolveurPrix.resumePrixBoeuf === 'function'
                            ? resolveurPrix.resumePrixBoeuf() : []
                    ),
                    // Fourchette des prix bovins reellement pratiques, pour les
                    // scenarios << cout au plus haut / au plus bas >> de la
                    // projection. Null hors v2, ou la notion ne sert a rien.
                    boeuf_stats: (v2 && typeof resolveurPrix.statsPrixBoeuf === 'function')
                        ? resolveurPrix.statsPrixBoeuf() : null
                }
            }
        });
    } catch (error) {
        console.error('Erreur simulation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Periode par defaut du PL: 1er du mois -> aujourd'hui (UTC). Partagee par
// la route, le bouton "Figer le PL du jour" et le cron du soir.
function periodePlParDefaut() {
    const today = new Date();
    return {
        dateDebut: `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`,
        dateFin: today.toISOString().slice(0, 10)
    };
}

// Erreur metier a statut HTTP: la route la mappe, le cron se contente de
// la logger. Evite de faire passer du res.status() dans le calcul.
function erreurPl(statusHttp, message) {
    return Object.assign(new Error(message), { statusHttp });
}

// Memoisation du PL par periode. Un TTL COURT en plus de l'invalidation
// sur mutation: les ventes s'ecrivent dans server.js, qui ne passe pas par
// invalidateFinanceDerivedCaches - un cache sans TTL montrerait un PL
// perime apres une vente. 60s suffisent a absorber les allers-retours
// d'onglets (PL et Simulation lisent le meme calcul).
const _plMemo = new Map();
const PL_MEMO_TTL_MS = 60 * 1000;
// Plafond defensif: sans lui, des requetes sur des periodes toutes
// differentes (usage normal ou non) accumuleraient des entrees jamais
// relues donc jamais remplacees, au-dela meme du TTL - rien ne les purge
// sinon. Une carte de 500 periodes couvre tres largement l'usage reel
// (quelques periodes par tenant) sans borner artificiellement le confort.
const PL_MEMO_MAX_ENTRIES = 500;
async function computePlMemoise(dateDebut, dateFin) {
    const cle = `${dateDebut}|${dateFin}`;
    const maintenant = Date.now();
    const present = _plMemo.get(cle);
    if (present && (maintenant - present.at) < PL_MEMO_TTL_MS) return present.data;
    // Purge des entrees perimees a chaque lecture: la carte ne grossit pas
    // indefiniment entre deux invalidations meme si aucune cle n'est
    // jamais redemandee.
    for (const [k, v] of _plMemo) {
        if ((maintenant - v.at) >= PL_MEMO_TTL_MS) _plMemo.delete(k);
    }
    const data = await computePl(dateDebut, dateFin);
    _plMemo.set(cle, { data, at: Date.now() });
    // Le Map JS conserve l'ordre d'insertion: la premiere cle est la plus
    // ancienne, evincee en priorite si le plafond est depasse.
    while (_plMemo.size > PL_MEMO_MAX_ENTRIES) {
        const plusAncienne = _plMemo.keys().next().value;
        if (plusAncienne === undefined) break;
        _plMemo.delete(plusAncienne);
    }
    return data;
}

/**
 * LE calcul du PL, sans HTTP. La route GET /pl, le bouton "Figer le PL du
 * jour" et le cron du soir (scripts/pl-snapshot-cron.js) passent tous par
 * ici: trois chiffres qui ne peuvent pas diverger. Dates en ISO YYYY-MM-DD.
 *
 * Le corps garde l'indentation de la route dont il est extrait: le diff
 * reste lisible et l'historique git suit chaque ligne.
 */
async function computePl(dateDebut, dateFin) {
        // Nombre de jours dans la periode (inclus). Sert a l'affichage: le
        // prorata des charges, lui, se calcule mois par mois sur les jours
        // REELS de chaque mois (voir decouperEnMois), sans mois conventionnel.
        const startD = new Date(dateDebut + 'T00:00:00Z');
        const endD = new Date(dateFin + 'T00:00:00Z');
        if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
            throw erreurPl(400, 'invalid dateDebut/dateFin');
        }
        if (startD > endD) {
            throw erreurPl(400, 'dateDebut must be <= dateFin');
        }
        const nbDaysPeriod = Math.floor((endD - startD) / 86400000) + 1;

        // Borner la periode pour eviter une croissance non controlee du
        // IN(...) construit plus bas (2 entrees par jour) et plus
        // generalement borner les ressources de la requete (charges,
        // computeCreances, MataBanq, etc). Le PL est concu pour des
        // periodes mensuelles/trimestrielles; 1 an + 1 (366) couvre les
        // rapports annuels.
        const MAX_DAYS_PERIOD = 366;
        if (nbDaysPeriod > MAX_DAYS_PERIOD) {
            throw erreurPl(400, `periode trop longue (${nbDaysPeriod} jours, max ${MAX_DAYS_PERIOD})`);
        }

        // 1. Total ventes sur la periode (= Vente.date IN periode, montant)
        const { Op: SeqOp } = require('sequelize');
        // ATTENTION: Vente.date est un texte libre avec format MIXTE selon
        // l'epoque d'insertion: YYYY-MM-DD (recent) ET DD-MM-YYYY (legacy).
        // SQL BETWEEN avec une borne ISO matche seulement les ventes ISO et
        // rate silencieusement les ventes DD-MM-YYYY (la comparaison lex
        // sur "13-05-2026" vs "2026-05-01" est fausse). Visualisation/
        // GET /api/ventes contourne en filtrant cote JS apres normalisation
        // — on reproduit cette tolerance ici via Op.in enumerant les jours
        // dans les 2 formats. Indexable + correct.
        const dateList = graphiesDeDatesPourPeriode(dateDebut, dateFin);
        const ventes = await Vente.findAll({
            where: { date: { [SeqOp.in]: dateList } },
            // 'produit' est indispensable a la ventilation par famille. Une
            // liste d'attributs explicite ne remonte QUE ce qu'elle nomme, sans
            // erreur: sans lui, estBoucherie recevait undefined et classait
            // 100% du chiffre d'affaires hors boucherie.
            //
            // 'nombre' sert aux VOLUMES vendus (agregerVolumes ci-dessous).
            // C'est une colonne de plus sur la MEME requete: aucun aller-retour
            // supplementaire, alors que faire calculer les volumes ailleurs en
            // aurait coute un, sur les memes lignes, avec le risque de deux
            // filtres de dates qui divergent.
            //
            // 'date' sert a reperer une DERNIERE JOURNEE SANS VENTE (plus bas).
            attributes: ['montant', 'produit', 'nombre', 'date']
        });
        // totalVentes = somme des Vente.montant REELLES uniquement.
        // Les commandes envoyees au CDC sont prises en compte ailleurs dans
        // la formule via "+ Marge CDC" (creances.ce_qu_il_me_doit), pas
        // ici — sinon on compterait deux fois la contribution CDC.
        const totalVentes = ventes.reduce((s, v) => s + (parseFloat(v.montant) || 0), 0);

        // Volumes vendus par produit, sur les MEMES lignes que totalVentes.
        // Ils entrent dans le resultat du PL, donc dans pl_snapshots.payload:
        // une simulation rejouee sur un PL fige lira les volumes de ce jour-la
        // plutot que ceux d'aujourd'hui.
        const { agregerVolumes } = require('../lib/volumes-vendus');
        const volumesVendus = agregerVolumes(ventes);

        // DERNIERE JOURNEE SANS VENTE.
        //
        // Une periode qui se termine sur une journee vide se lit exactement
        // comme une periode complete: le total, les charges proratisees et le
        // nombre de jours comptent tous cette journee. Le cas usuel n'est pas
        // une journee reellement sans chiffre d'affaires - c'est une date de
        // fin posee plus loin que la derniere saisie, et le resultat parait
        // alors simplement mauvais au lieu d'etre signale comme incomplet.
        //
        // On compte les LIGNES, pas le montant: une journee dont les ventes
        // s'annulent a zero a bien ete saisie, et ne doit rien declencher.
        let nbLignesDateFin = 0;
        let montantDateFin = 0;
        let derniereDateAvecVente = null;
        for (const v of ventes) {
            const iso = parseDateVersISO(v.date);
            if (!iso) continue;
            if (iso === dateFin) {
                nbLignesDateFin += 1;
                montantDateFin += parseFloat(v.montant) || 0;
            }
            if (!derniereDateAvecVente || iso > derniereDateAvecVente) derniereDateAvecVente = iso;
        }
        const ventesDateFin = {
            date: dateFin,
            nb_lignes: nbLignesDateFin,
            montant: round2(montantDateFin),
            aucune_vente: nbLignesDateFin === 0,
            // La derniere journee de la PERIODE qui porte des ventes. Dit a
            // l'utilisateur ou ramener sa date de fin, plutot que de le laisser
            // la chercher. Null si la periode entiere est vide.
            derniere_date_avec_vente: derniereDateAvecVente
        };

        // 2. Commission MaaS + Marge CDC via computeCreances
        const { computeCreances } = require('./finance-creances');
        const creances = await computeCreances({ dateDebut, dateFin });
        const commission = creances.ce_que_je_dois || 0;
        const margeCdc = creances.ce_qu_il_me_doit || 0;

        // 3. Total avances depuis MataBanq, SUR LA PERIODE.
        //    ATTENTION: contrairement a ce qu'on a longtemps suppose, MataBanq
        //    n'applique PAS dateDebut/dateFin a status[0].total_avances: ce
        //    champ est un CUMUL ANNEE (metadata.year_filter). Mesure: demander
        //    2 jours, 4 semaines ou l'annee entiere renvoie la meme valeur.
        //    L'utiliser ici gonflait le PL de tout le cumul depuis janvier.
        //    On somme donc les operations 'avance' filtrees sur la periode,
        //    exactement comme le fait l'UI pour son tableau et ses tuiles.
        let totalAvances = 0;
        // Etat de la SOURCE, distinct du montant. Un zero peut vouloir dire
        // "aucune avance sur la periode" ou "on n'a pas pu demander": ces deux
        // reponses ne se valent pas, et rien ne les distinguait.
        let avancesEtat = 'ok';
        let avancesRaison = null;
        try {
            const { fetchCreanceCdb, aDesIdentifiants } = require('../lib/depenses-creance-client');
            // On regarde les IDENTIFIANTS, pas la configuration complete.
            // estConfigure() exige en plus un libelle lisible, et confondre les
            // deux laissait passer un cas faux: identifiants presents mais
            // brand-config.json sans libelle, fetchCreanceCdb rend null, les
            // avances valent 0 - et le PL se declarait 'non_configure' donc
            // FIABLE, puis se figeait ampute. Ce deploiement utilise bien
            // MataBanq: son silence est une panne, pas un choix.
            const identifiants = aDesIdentifiants();
            const cdb = await fetchCreanceCdb({ dateDebut, dateFin });
            // L'ETAT SE DEDUIT DE LA VALEUR DE RETOUR, PAS DU catch.
            //
            // fetchCreanceCdb ne leve JAMAIS sur les pannes qu'on veut
            // detecter: lib/depenses-creance-client.js rend null sur quatre
            // chemins distincts - variables d'environnement absentes, libelle
            // introuvable, reponse HTTP en erreur, panne reseau - et le
            // documente comme un "echec gracieux". Le catch ci-dessous
            // n'attrapait donc rien, totalAvances restait a 0, et RIEN dans la
            // reponse ne le signalait: le snapshot pouvait graver un PL ampute
            // de tout le montant des avances. Mesure sur le 1er au 10 aout
            // 2026: 1 825 273 F d'avances, soit largement de quoi faire passer
            // un resultat negatif pour un resultat positif.
            // TROIS etats, et non deux. La distinction est ce qui manquait:
            //
            //  - 'non_configure': ce deploiement n'utilise pas MataBanq. Mode
            //    explicitement supporte (.env.example). Les avances valent
            //    legitimement zero, le PL est COMPLET, le figeage est permis.
            //    Confondre ce cas avec une panne rendait le figeage impossible
            //    a jamais sur ces tenants: recette, nouveau point de vente,
            //    poste de developpement.
            //
            //  - 'indisponible': la source est configuree mais muette. Il
            //    manque un poste, le PL est faux, on refuse de le graver.
            //
            //  - 'ok': lue.
            if (!identifiants) {
                avancesEtat = 'non_configure';
                avancesRaison = 'MataBanq n\'est pas configuré sur ce déploiement';
            } else if (!cdb) {
                avancesEtat = 'indisponible';
                avancesRaison = 'MataBanq configuré mais injoignable';
            } else if (!Array.isArray(cdb.details)) {
                // `details` ABSENT est une anomalie; `details` vide ne l'est
                // pas. Une reponse saine sans client rapproche pour ce label
                // rend un tableau vide, et l'ecran la traite deja comme
                // normale (js/finance.js). L'exiger non vide bloquait le
                // figeage sur une reponse pourtant valide.
                avancesEtat = 'indisponible';
                avancesRaison = 'réponse MataBanq sans bloc de détails';
            }
            const ops = (cdb && Array.isArray(cdb.details) && cdb.details[0]
                && Array.isArray(cdb.details[0].operations))
                ? cdb.details[0].operations : [];
            for (const op of ops) {
                if (String(op.type || '').toLowerCase() !== 'avance') continue;
                // Comparaison lexicographique sur YYYY-MM-DD = chronologique.
                const d = String(op.date_operation || '').slice(0, 10);
                if (!d || d < dateDebut || d > dateFin) continue;
                totalAvances += parseFloat(op.montant) || 0;
            }
        } catch (e) {
            // Le catch reste un filet: il ne peut pas servir de signal, mais
            // une exception inattendue doit tout de meme fermer la source.
            //
            // SEULEMENT si l'etat vaut encore 'ok'. Ecraser inconditionnellement
            // aurait pu requalifier un 'non_configure' en 'indisponible' et
            // rebloquer le figeage sur un tenant qui n'a jamais eu d'avances a
            // lire - le defaut meme que cette distinction corrige. Le chemin
            // n'est pas atteignable aujourd'hui; il ne tiendrait qu'a la
            // brievete de ce bloc try.
            if (avancesEtat === 'ok') {
                avancesEtat = 'indisponible';
                avancesRaison = `erreur inattendue (${e.message})`;
            }
            console.warn('[PL] fetch CDB avances echoue:', e.message);
        }

        // 4. Paiements faits au fournisseur sur la periode (table locale).
        const paiements = await FournisseurPaiement.findAll({
            where: { date: { [SeqOp.between]: [dateDebut, dateFin] } },
            attributes: ['montant']
        });
        const totalPaiementsFournisseur = paiements.reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);

        // 4bis. Depenses ponctuelles de la periode (onglet Finance > Depenses,
        // table locale `depenses`: reparations, achats divers...). Distinctes
        // des charges fixes proratisees (masse salariale, loyer) et des
        // avances MataBanq (flux du partenaire CDB) — sans cette ligne elles
        // n'etaient deduites nulle part dans le PL. Depense.date est un
        // DATEONLY (YYYY-MM-DD), le BETWEEN sur les bornes ISO est correct.
        const depensesRows = await Depense.findAll({
            where: { date: { [SeqOp.between]: [dateDebut, dateFin] } },
            attributes: ['montant', 'categorie']
        });
        const totalDepenses = depensesRows.reduce((s, d) => s + (parseFloat(d.montant) || 0), 0);

        // 5. Charges proratisees, mois par mois.
        //
        // C'etait auparavant montant_mensuel x nbJoursPeriode / 30. Ce mois
        // conventionnel de 30 jours facturait juillet 31/30e: 420 000 devenait
        // 434 000 pour un mois pourtant complet. On prorate desormais sur les
        // jours REELS de chaque mois, si bien qu'un mois entier vaut
        // exactement son montant (31/31, 28/28...).
        //
        // Le decoupage par mois sert aussi les montants dates: une periode a
        // cheval prend le montant propre a chaque mois traverse.
        const chargesRows = await FinanceCharge.findAll({ order: [['ordre', 'ASC']] });
        const moisCouverts = decouperEnMois(dateDebut, dateFin);
        const montantsParMois = await resolveChargesPourMois(
            moisCouverts.map((m) => m.mois),
            chargesRows
        );

        const chargesDetail = chargesRows.map((c) => {
            const parMois = moisCouverts.map((m) => {
                const montant = montantsParMois[m.mois][c.nom];
                return {
                    mois: m.mois,
                    montant_mensuel: montant,
                    jours_couverts: m.joursCouverts,
                    jours_du_mois: m.joursDuMois,
                    prorata: round2(montant * m.joursCouverts / m.joursDuMois)
                };
            });
            return {
                nom: c.nom,
                libelle: c.libelle,
                // Montant du dernier mois de la periode: c'est celui qui a un
                // sens a afficher en regard d'une periode d'un seul mois.
                montant_mensuel: parMois[parMois.length - 1].montant_mensuel,
                prorata: round2(parMois.reduce((s, p) => s + p.prorata, 0)),
                par_mois: parMois
            };
        });
        const chargesTotalMensuel = chargesDetail.reduce((s, c) => s + c.montant_mensuel, 0);
        const chargesProratisees = chargesDetail.reduce((s, c) => s + c.prorata, 0);

        // Depenses et charges fixes sont TOUTES DEUX soustraites du PL: une
        // depense saisie dans une categorie qui recouvre une charge fixe
        // (loyer, salaire, electricite...) serait deduite deux fois. On la
        // signale sans l'exclure — la categorie ne dit pas s'il s'agit du
        // paiement de l'abonnement (double compte) ou d'un surcout ponctuel
        // qui s'y ajoute legitimement (ex. "Courant d'urgence" en
        // electricite). Cf lib/depenses-recurrentes.js.
        const { detecterDoubleCompte } = require('../lib/depenses-recurrentes');
        const alerteDoubleCompte = detecterDoubleCompte(depensesRows, chargesRows);

        // 6. Variation de stock = stock_soir(dateFin) - stock_matin(dateDebut).
        // Si pas de saisie pile aux dates: prendre la date la plus proche <=
        // demandee (sinon 0). On somme sum(total) pour tous les produits / PV
        // (variation globale entreprise).
        //
        // ATTENTION: stocks.date est stocke en TEXTE format DD-MM-YYYY (cf
        // db/utils.js#formatDate). Comparer lexicalement contre l'ISO
        // YYYY-MM-DD donne des resultats faux ("14-05-2026" < "2026-05-01"
        // lex). On convertit DD-MM-YYYY -> YYYY-MM-DD via substring + concat
        // (pur string manip, IMMUTABLE - donc indexable, cf
        // db/update-schema.js#idx_stocks_date_iso). L'ordre lex sur ISO
        // YYYY-MM-DD = ordre chronologique, donc <= et ORDER BY marchent
        // directement sur la forme ISO sans cast vers DATE.
        // Stock valorise au prix d'ACHAT quand il est connu (cf
        // lib/valorisation-stock.js). Un seul resolveur pour les deux bornes:
        // il charge le catalogue et l'historique une fois, puis resout par
        // date. Deux appels en creeraient deux, dont un appel de plus a DATA.
        const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');
        const resolveurPrix = await creerResolveurPrixAchat(dateFin);
        // Les deux bornes sont independantes: elles partent ensemble plutot
        // qu'en serie, le resolveur de prix etant deja charge.
        // La famille (Boucherie / Epicerie / Autres) vient de categories.famille,
        // partagee avec le parage: c'est la notion metier qui separe la viande
        // du reste, et elle range la Volaille et le Caprin AVEC le bovin.
        const { chargerContexteParage } = require('../lib/parage-contexte');
        const ctxFamille = await chargerContexteParage(sequelize);
        const estBoucherie = ctxFamille.estBoucherie;

        // Ventilation des ventes par famille, pour information: savoir quelle
        // part du chiffre d'affaires ne vient pas de la viande. Meme resolveur
        // que le stock, donc les deux se lisent avec la meme definition.
        let ventesBoucherie = 0;
        let ventesHorsBoucherie = 0;
        for (const v of ventes) {
            const m = parseFloat(v.montant) || 0;
            if (estBoucherie(v.produit)) ventesBoucherie += m;
            else ventesHorsBoucherie += m;
        }

        // Le MEME jeu de produits est ecarte des deux bornes, sinon la variation
        // compare deux perimetres. Il est determine sur le stock du soir, la ou
        // le negatif apparait.
        const produitsNonFiables = await produitsAStockSoirNegatif(dateFin);
        const [stockMatinVal, stockSoirVal] = await Promise.all([
            valoriserSnapshotStock('matin', dateDebut, resolveurPrix.pourDate, estBoucherie, produitsNonFiables, ctxFamille.categorieDe),
            valoriserSnapshotStock('soir', dateFin, resolveurPrix.pourDate, estBoucherie, produitsNonFiables, ctxFamille.categorieDe)
        ]);

        const stockMatinDebut = stockMatinVal.valeur;
        const stockMatinDate = stockMatinVal.date_utilisee;
        // `let`: la borne du soir peut etre remplacee plus bas par une
        // ESTIMATION quand personne n'a encore compte le soir de dateFin.
        let stockSoirEffectif = stockSoirVal;
        let stockSoirDate = stockSoirVal.date_utilisee;
        // Produits restes au prix de VENTE, faute de prix d'achat: l'ecran les
        // marque d'un asterisque. Les deux bornes sont rendues SEPAREMENT: un
        // produit present le matin et absent le soir ne concerne qu'une des
        // deux lignes, et une liste fusionnee accusait le stock soir d'un
        // melange de bases qu'il ne contenait pas - une fausse piste pour qui
        // cherche a expliquer une variation.
        const stockMatinAuPrixDeVente = stockMatinVal.produits_au_prix_de_vente;
        // Coefficient pertes decoupe (default 5%): la viande perd du
        // volume lors de la decoupe, donc on ne valorise que (100-X)%
        // de la variation brute.
        const cfgRows = await FinanceConfig.findAll();
        const cfgMap = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
        // Taux du mois de la date de FIN. La variation stock est un seul
        // nombre pour toute la periode (stock matin du debut -> stock soir de
        // la fin): un seul coefficient s'y applique, il n'y a rien a
        // decouper par mois. Pour un PL d'un seul mois - le cas courant -
        // c'est exactement le taux de ce mois.
        const moisFin = dateFin.slice(0, 7);
        const pertesPct = parseFloat(await resolveConfigPourMois(
            moisFin, 'stock_pertes_decoupe_pct', cfgMap.stock_pertes_decoupe_pct
        ));
        const safePertesPct = Number.isFinite(pertesPct) && pertesPct >= 0 && pertesPct <= 100
            ? pertesPct
            : 5;
        const coeffStock = (100 - safePertesPct) / 100;

        // --- Stock du soir ESTIME, tant qu'il n'est pas compte ---------------
        //
        // Sans comptage a dateFin, cette fonction repliait EN SILENCE sur le
        // dernier inventaire - parfois vieux de plusieurs jours - en comparant
        // donc deux instants non adjacents alors que ventes, charges et
        // depenses, elles, couvrent bien toute la periode.
        //
        // On estime desormais, par inversion de l'identite du parage
        // (soir = ancre + transferts - vendu / rendement), et on le DIT: rien
        // n'est ecrit en base, et le PL ne peut pas etre fige dans cet etat.
        const estimation = await estimerBorneSoir({
            ancre: stockSoirVal,
            dateFin,
            contexte: ctxFamille,
            resolveurPrix,
            estBoucherie,
            produitsNonFiables,
            ratioRepli: coeffStock
        });
        if (estimation) {
            stockSoirEffectif = estimation.valorisation;
            stockSoirDate = estimation.date_demandee_jjmmaaaa;
        }

        // LE CATALOGUE, pour le panneau de simulation du stock estime.
        //
        // Seuls les produits qui portent un PRIX D'ACHAT y figurent: on ne
        // peut pas ajouter a la main une ligne dont la valeur serait zero, ce
        // qui gonflerait le stock d'une quantite sans montant, en silence.
        // `boucherie` decide si le coefficient de pertes de decoupe s'applique.
        //
        // Construit APRES l'estimation et seulement si elle existe: il ne sert
        // qu'a ce panneau, et la requete partait jusqu'ici sur chaque calcul de
        // PL - y compris l'immense majorite qui a un comptage du soir reel.
        const catalogueProduits = estimation
            ? (await FournisseurPrix.findAll({ raw: true }))
                .map((r) => ({
                    produit: r.produit,
                    prix: r.prix_achat == null ? null : parseFloat(r.prix_achat),
                    boucherie: !!estBoucherie(r.produit)
                }))
                .filter((p) => Number.isFinite(p.prix) && p.prix > 0)
                .sort((a, b) => a.produit.localeCompare(b.produit, 'fr'))
            : [];

        const stockSoirFin = stockSoirEffectif.valeur;
        const stockSoirAuPrixDeVente = stockSoirEffectif.produits_au_prix_de_vente;
        const variationStockBrute = stockSoirFin - stockMatinDebut;
        // Le coefficient de pertes de DECOUPE ne s'applique qu'a la viande.
        // Applique a toute la variation, il retranchait 5% a des sachets
        // d'epicerie qu'on ne pare pas - et comme le stock des produits
        // automatiques vaut leurs ventes, il en rognait 5% sans raison.
        // stockSoirEffectif, PAS stockSoirVal: quand le soir est estime, c'est
        // l'estimation qui est la borne du PL. Lire l'ancre ici comparerait la
        // variation a un instant que le reste du calcul a deja remplace.
        const variationBoucherie = stockSoirEffectif.valeur_boucherie - stockMatinVal.valeur_boucherie;
        // Ventilation de la variation boucherie par espece. Le PL applique un
        // coefficient de parage UNIQUE, alors que lib/parage.js calcule deja
        // deux ratios separes, bovin et ovin. Exposer le partage ne change
        // aucun montant aujourd'hui: il rend possible de donner un taux par
        // espece sans avoir a deviner leur poids respectif.
        //
        // Ce que la mesure montre et qu'un total masquait: sur juillet 2026 le
        // bovin fait +13 480 F quand l'ovin fait -6 200 F. Le signe differe,
        // donc augmenter le taux de parage agneau AMELIORE le resultat.
        const variationBovin = stockSoirEffectif.valeur_bovin - stockMatinVal.valeur_bovin;
        const variationOvin = stockSoirEffectif.valeur_ovin - stockMatinVal.valeur_ovin;
        const variationAutreBoucherie = stockSoirEffectif.valeur_autre_boucherie
            - stockMatinVal.valeur_autre_boucherie;
        const variationHorsBoucherie = stockSoirEffectif.valeur_hors_boucherie - stockMatinVal.valeur_hors_boucherie;
        const variationStockNette = coeffStock * variationBoucherie + variationHorsBoucherie;

        // 7. COUT DES VENTES, MARGE, puis PL
        //
        // Les avances et les paiements fournisseur sont de la TRESORERIE
        // sortie pour acheter, pas le cout de ce qui a ete vendu: une partie
        // est encore sur l'etal. Ce qui a reellement ete consomme, c'est donc
        // les sorties MOINS ce que la periode a mis en stock.
        //
        // Sans ce poste, l'ecran laissait lire « ventes - avances » comme une
        // marge - ici +15 347 F sur 2,85 M de CA, soit 0,5 %, alors que la
        // marge reelle est de 10,4 %. L'ecart, ce sont les 377 517 F de
        // marchandise payee et pas encore vendue.
        const coutDesVentes = totalAvances + totalPaiementsFournisseur - variationStockNette;
        const margeDesVentes = totalVentes - coutDesVentes;

        // Le PL s'ecrit alors comme une cascade lisible, et rend EXACTEMENT
        // le meme nombre que la formule d'origine:
        //   marge - commission + marge CDC - charges - depenses
        const pl = margeDesVentes
            - commission
            + margeCdc
            - chargesProratisees
            - totalDepenses;

        return {
                periode: { dateDebut, dateFin, nb_jours: nbDaysPeriod },
                total_ventes: round2(totalVentes),
                // COUT DES VENTES et MARGE, rendus a cote des postes bruts.
                // `taux_marge` est en POINTS DE POURCENTAGE du CA: c'est lui
                // que la projection extrapole, et non les avances - les
                // extrapoler comme un cout sans extrapoler le stock qu'elles
                // creent ecrasait la marge projetee de 10,4 % a 0,5 %.
                cout_des_ventes: round2(coutDesVentes),
                marge_des_ventes: round2(margeDesVentes),
                taux_marge: totalVentes > 0
                    ? Math.round((margeDesVentes / totalVentes) * 10000) / 100
                    : null,
                // Volumes vendus par produit, issus des MEMES lignes que
                // total_ventes. Presents ici pour etre figes avec le PL: sans
                // eux, une simulation rejouee sur un PL fige melangerait un
                // resultat fige et des volumes vivants.
                //
                // total_ca et total_ventes portent la MEME somme, sur les memes
                // lignes - mais total_ventes est arrondi au centime et
                // total_ca ne l'est pas, l'arrondi appartenant a la sortie
                // depuis qu'il faussait le prix moyen. Un controle qui
                // confronte les deux doit donc se donner une tolerance, comme
                // celui des postes: au-dela du centime, l'ecart est un signal
                // de defaut; en deca, c'est l'arrondi.
                volumes: volumesVendus,
                // Etat de la DERNIERE JOURNEE de la periode: une date de fin
                // posee au-dela de la derniere saisie donne un PL qui a l'air
                // complet. L'ecran le dit plutot que de laisser croire a un
                // mauvais resultat.
                ventes_date_fin: ventesDateFin,
                // ETAT DES SOURCES, a cote des montants et jamais confondu
                // avec eux. `fiable` est faux des qu'un poste repose sur une
                // source muette: c'est ce que POST /pl/snapshot regarde pour
                // refuser de graver un PL ampute.
                sources: {
                    avances: { etat: avancesEtat, raison: avancesRaison },
                    // 'non_configure' est FIABLE: le poste vaut zero parce
                    // qu'il n'existe pas sur ce deploiement, pas parce qu'on
                    // n'a pas pu le lire. Seule une source configuree et
                    // muette rend le PL incomplet.
                    fiable: avancesEtat !== 'indisponible'
                },
                // Part non-boucherie du chiffre d'affaires, pour information.
                // Un produit sans famille connue compte comme hors boucherie:
                // mieux vaut le signaler que le ranger d'office dans la viande.
                ventes_boucherie: round2(ventesBoucherie),
                ventes_hors_boucherie: round2(ventesHorsBoucherie),
                ventes_hors_boucherie_pct: totalVentes > 0
                    ? round2((ventesHorsBoucherie / totalVentes) * 100)
                    : null,
                total_avances: round2(totalAvances),
                commission_maas: round2(commission),
                marge_cdc: round2(margeCdc),
                depenses_periode: round2(totalDepenses),
                // Montant des depenses dont la categorie recouvre une charge
                // fixe deja proratisee (risque de double compte, non exclu).
                depenses_double_compte: alerteDoubleCompte,
                paiements_fournisseur: round2(totalPaiementsFournisseur),
                charges: {
                    total_mensuel: round2(chargesTotalMensuel),
                    // Rapport global periode/mois. N'est plus un simple
                    // nbJours/30: chaque mois compte sur ses propres jours,
                    // donc un mois complet donne exactement 1.
                    ratio_jours: chargesTotalMensuel > 0
                        ? round2(chargesProratisees / chargesTotalMensuel)
                        : 0,
                    mois_couverts: moisCouverts,
                    total_prorata: round2(chargesProratisees),
                    detail: chargesDetail
                },
                stock: {
                    matin_debut: round2(stockMatinDebut),
                    matin_date: stockMatinDate,
                    soir_fin: round2(stockSoirFin),
                    soir_date: stockSoirDate,
                    variation_brute: round2(variationStockBrute),
                    pertes_decoupe_pct: safePertesPct,
                    coeff: round2(coeffStock),
                    variation_nette: round2(variationStockNette),
                    // Base de valorisation: prix d'achat fournisseur, sauf pour
                    // les produits ci-dessous restes au prix de vente. Une liste
                    // par borne: elles n'ont aucune raison d'etre identiques.
                    matin_au_prix_de_vente: stockMatinAuPrixDeVente,
                    soir_au_prix_de_vente: stockSoirAuPrixDeVente,
                    // Detail par produit de chaque borne (nom, quantite, prix
                    // utilise, base achat/vente): l'ecran l'affiche a la
                    // demande, l'export Excel l'emporte, et les snapshots le
                    // portent d'office puisqu'ils stockent cette reponse.
                    // LE CATALOGUE, pour le panneau de simulation du stock
                    // estime: on ne peut ajouter qu'un produit qui porte un
                    // prix d'achat, sinon la ligne vaudrait zero en silence.
                    // `boucherie` decide si le coefficient de pertes de
                    // decoupe s'applique a la ligne ajoutee.
                    produits_catalogue: catalogueProduits,
                    matin_detail: stockMatinVal.detail_lignes || [],
                    soir_detail: stockSoirEffectif.detail_lignes || [],
                    // Borne du soir ESTIMEE faute de comptage a la date de fin.
                    // Un client d'avant cette version ne lit pas ces champs et
                    // se comporte comme avant; un snapshot fige avant elle non
                    // plus, d'ou le booleen plutot qu'un objet toujours present.
                    soir_estime: !!estimation,
                    soir_origine: estimation ? 'estimation' : 'comptage',
                    estimation: estimation ? estimation.meta : null,
                    // Le coefficient ne porte que sur la boucherie: l'ecran doit
                    // pouvoir le dire plutot que laisser croire a un 5% global.
                    variation_boucherie: round2(variationBoucherie),
                    variation_hors_boucherie: round2(variationHorsBoucherie),
                    // variation_bovin + variation_ovin + variation_autre_boucherie
                    // == variation_boucherie AVANT arrondi. Les quatre champs
                    // etant arrondis SEPAREMENT a deux decimales, leur somme
                    // peut differer du total de quelques centimes: c'est un
                    // artefact d'affichage, pas un ecart de calcul, et un
                    // controle qui exigerait l'egalite stricte sur ces valeurs
                    // signalerait a tort.
                    //
                    // 'autre' recueille la volaille, le caprin et tout produit
                    // dont l'espece est inconnue: le ranger d'office dans une
                    // espece fausserait le taux qu'on lui appliquera.
                    variation_bovin: round2(variationBovin),
                    variation_ovin: round2(variationOvin),
                    variation_autre_boucherie: round2(variationAutreBoucherie),
                    // Stocks negatifs ecartes de la somme (produits a stock
                    // calcule dont les entrees ne sont pas saisies).
                    negatifs_ignores: round2(
                        (stockMatinVal.valeur_negative_ignoree || 0)
                        + (stockSoirEffectif.valeur_negative_ignoree || 0)
                    ),
                    nb_lignes_negatives:
                        (stockMatinVal.lignes_negatives || []).length
                        + (stockSoirEffectif.lignes_negatives || []).length,
                    // Produits ecartes des DEUX bornes faute de stock fiable.
                    produits_ecartes: produitsNonFiables.pourAffichage || [],
                    // Pourquoi tel prix a ete retenu: DATA injoignable, aucun
                    // lot pour la journee, historique illisible. Sans cela, un
                    // repli sur le catalogue fournisseur reste invisible et le
                    // chiffre parait simplement faux.
                    // Le RESUME du prix bovin retenu suit les avertissements,
                    // au meme endroit: qu'il vienne de MATA ou du catalogue,
                    // c'est la meme question - sur quel prix ce resultat
                    // repose-t-il. Le taire quand tout va bien laissait
                    // l'utilisateur sans le chiffre qui explique son cout.
                    avertissements: (resolveurPrix.avertissements || []).concat(
                        typeof resolveurPrix.resumePrixBoeuf === 'function'
                            ? resolveurPrix.resumePrixBoeuf() : []
                    )
                },
                pl: round2(pl)
        };
}

// Periode: dateDebut/dateFin (YYYY-MM-DD). Defaut = 1er du mois -> aujourd'hui.
router.get('/pl', async (req, res) => {
    try {
        // Distinguer "param absent" (-> defaut) de "param fourni mais malforme" (-> 400).
        const { dateDebut: defaultDebut, dateFin: defaultFin } = periodePlParDefaut();
        const rawDebut = req.query.dateDebut;
        const rawFin = req.query.dateFin;
        const dateDebut = rawDebut ? parseDateVersISO(rawDebut) : defaultDebut;
        const dateFin = rawFin ? parseDateVersISO(rawFin) : defaultFin;
        if (rawDebut && !dateDebut) {
            return res.status(400).json({ success: false, error: 'invalid dateDebut' });
        }
        if (rawFin && !dateFin) {
            return res.status(400).json({ success: false, error: 'invalid dateFin' });
        }

        const data = await computePlMemoise(dateDebut, dateFin);
        res.json({ success: true, data });
    } catch (e) {
        if (!e.statusHttp) console.error('GET /api/finance/pl:', e);
        res.status(e.statusHttp || 500).json({ success: false, error: e.message });
    }
});

// Fige le PL: calcul FRAIS (pas le memo), une ligne par date, la derniere
// ecrase. Le cron du soir ecrit la meme chose avec source='cron'.
//
// Body optionnel { date } pour RATTRAPER une journee passee. Sans lui, la
// periode par defaut (1er du mois -> aujourd'hui), comportement d'origine.
//
// Ce rattrapage est le pendant obligatoire du refus ci-dessous: sans lui, une
// nuit ou la source ne repond pas laissait un trou DEFINITIF, puisque
// periodePlParDefaut() construit sa date a partir de l'instant present et que
// la date est cle primaire. Poser une garde sans fournir son remede, c'est
// echanger un chiffre faux contre une donnee manquante et irrecuperable.
/**
 * Gardes du figeage, isolees de HTTP pour etre testables.
 *
 * Sans date: comportement d'origine, la periode par defaut, source 'manuel'.
 * Avec date: rattrapage d'une journee passee, sous trois conditions.
 *
 * @param {Object} args
 * @param {Object} args.body        corps de la requete
 * @param {Object} args.defaut      { dateDebut, dateFin } de periodePlParDefaut()
 * @param {string} args.role        role de la session, en minuscules
 * @param {Object|null} args.existant ligne pl_snapshots deja presente a cette date
 * @returns {{dateDebut, dateFin, source, remplace}}
 * @throws {Error} avec statusHttp et code
 */
function resoudreCibleSnapshot({ body, defaut, role, existant }) {
    const corps = body || {};
    const brut = corps.date;
    if (brut === undefined || brut === null || String(brut).trim() === '') {
        return {
            dateDebut: defaut.dateDebut, dateFin: defaut.dateFin,
            source: 'manuel', remplace: null
        };
    }

    const refus = (message, statusHttp, code) => {
        const err = new Error(message);
        err.statusHttp = statusHttp;
        if (code) err.code = code;
        return err;
    };

    const iso = parseDateVersISO(String(brut));
    if (!iso) throw refus('date invalide (attendu YYYY-MM-DD ou DD-MM-YYYY)', 400, 'date_invalide');

    // Une date FUTURE figerait une periode vide en se faisant passer pour un
    // resultat. computePl ne borne que la LONGUEUR de la periode, pas sa
    // position.
    if (iso > defaut.dateFin) {
        throw refus(`date future refusée : ${iso} est après aujourd'hui`, 400, 'date_future');
    }

    // ADMIN STRICT sur cette branche seulement. Le chemin par defaut fige la
    // journee COURANTE, et un superviseur a toujours pu le faire. Rattraper
    // une date PASSEE est autre chose: c'est ecrire dans l'historique.
    // checkPlAccess, qui garde ce prefixe, laisse passer admin ET superviseur,
    // trop large pour ce geste-la.
    if (role !== 'admin') {
        throw refus('Le rattrapage d\'une date passée est réservé aux administrateurs', 403, 'admin_requis');
    }

    // UN PL FIGE NE S'ECRASE PAS PAR ACCIDENT. La cle primaire est la date et
    // l'ecriture est un upsert: sans cette garde, rattraper une date DEJA
    // figee remplacait silencieusement une valeur officielle par un recalcul
    // qui peut differer. Mesure sur le 1er au 10 aout 2026: le fige dit
    // -65 514,94 et le recalcul -37 442,44, les donnees de stock ayant bouge
    // depuis. La valeur d'origine, peut-etre deja lue et exportee,
    // disparaissait sans trace. Le remplacement reste possible, mais il doit
    // etre DEMANDE.
    if (existant && corps.remplacer !== true) {
        throw refus(
            `Le PL du ${iso} est déjà figé (${existant.pl} FCFA, source ${existant.source}). `
            + 'Renvoyez remplacer: true pour l\'écraser.',
            409, 'deja_fige'
        );
    }

    return {
        // Meme convention que tout l'historique: un PL fige est un cumul du
        // 1er du mois a la date figee. Rattraper avec une autre borne rendrait
        // la ligne incomparable aux autres.
        dateDebut: iso.slice(0, 8) + '01',
        dateFin: iso,
        source: 'rattrapage',
        // La valeur remplacee part dans la trace: c'est la seule facon de
        // savoir plus tard ce qui a ete ecrase, et par qui.
        remplace: existant ? { pl: existant.pl, source: existant.source } : null
    };
}

router.post('/pl/snapshot', async (req, res) => {
    try {
        const defaut = periodePlParDefaut();
        const role = (req.session && req.session.user && req.session.user.role || '').toLowerCase();
        // La ligne existante n'est lue QUE si une date est demandee: le chemin
        // par defaut ecrase la journee courante a dessein, et le cron comme le
        // bouton "Figer le PL du jour" doivent pouvoir refiger apres une
        // saisie tardive.
        const brut = req.body && req.body.date;
        const viseUneDate = brut !== undefined && brut !== null && String(brut).trim() !== '';
        const isoDemande = viseUneDate ? parseDateVersISO(String(brut)) : null;
        const existant = isoDemande
            ? await PlSnapshot.findByPk(isoDemande, { raw: true })
            : null;

        const { dateDebut, dateFin, source, remplace } =
            resoudreCibleSnapshot({ body: req.body, defaut, role, existant });

        const data = await computePl(dateDebut, dateFin);

        // REFUS DE FIGER UN PL AMPUTE.
        //
        // Un PL fige est destine a etre relu des mois plus tard, compare et
        // exporte. Le graver alors qu'une source n'a pas repondu produit un
        // chiffre faux que plus rien ne signale ensuite: la valeur est en
        // base, elle a l'air definitive.
        //
        // Le cas est mesure et pas theorique: sur le 1er au 10 aout 2026 les
        // avances valent 1 825 273 F. Les compter pour zero fait passer un
        // resultat de -65 515 F a +1 759 758 F.
        //
        // 409 et non 500: la demande est comprise, l'etat du systeme ne permet
        // pas d'y repondre maintenant. Le figeage redeviendra possible des que
        // la source repond, sans rien changer.
        if (data.sources && data.sources.fiable === false) {
            const raison = (data.sources.avances && data.sources.avances.raison) || 'source indisponible';
            const err = new Error(
                `PL non figé : ${raison}. Les avances comptent pour 0, le résultat serait faux.`
            );
            err.statusHttp = 409;
            err.code = 'source_indisponible';
            throw err;
        }

        // Meme refus, autre cause: un PL dont le stock du soir est ESTIME ne se
        // fige pas non plus. La table ne porte qu'une ligne par date, aucune
        // route ne permet de corriger un snapshot passe, et l'estimation bouge
        // a chaque vente. Le figer graverait un chiffre provisoire dans un
        // historique immuable.
        if (data.stock && data.stock.soir_estime) {
            return res.status(409).json({
                success: false,
                code: 'stock_soir_estime',
                error: `Stock du soir non encore saisi pour le ${dateFin} : le PL affiché `
                    + `repose sur une estimation et ne peut pas être figé. `
                    + `Saisissez l'inventaire du soir, puis refigez.`
            });
        }


        const username = req.session && req.session.user ? req.session.user.username : null;
        await PlSnapshot.upsert({
            date: dateFin,
            periode_debut: dateDebut,
            periode_fin: dateFin,
            pl: data.pl,
            total_ventes: data.total_ventes,
            source,
            created_by: username,
            payload: data,
            updated_at: new Date()
        });
        audit.log(req, 'pl_snapshot.save', { date: dateFin, pl: data.pl, source, remplace });
        res.json({ success: true, data: { date: dateFin, pl: data.pl, source, remplace } });
    } catch (e) {
        if (!e.statusHttp) console.error('POST /api/finance/pl/snapshot:', e);
        res.status(e.statusHttp || 500).json({ success: false, error: e.message });
    }
});

// Liste des PL figes (bouton Historique PL): dates + chiffres cles, sans
// les payloads - un an d'historique par tenant reste une reponse legere.
router.get('/pl/snapshots', async (req, res) => {
    try {
        const rows = await PlSnapshot.findAll({
            attributes: ['date', 'periode_debut', 'periode_fin', 'pl', 'total_ventes', 'source', 'created_by', 'updated_at'],
            order: [['date', 'DESC']],
            limit: 400,
            raw: true
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/pl/snapshots:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Un PL fige complet, tel que l'ecran l'a calcule ce jour-la: le client le
// re-rend avec le MEME code d'affichage que le PL courant.
router.get('/pl/snapshots/:date', async (req, res) => {
    try {
        const dateISO = parseDateVersISO(String(req.params.date || ''));
        if (!dateISO) {
            return res.status(400).json({ success: false, error: 'date invalide' });
        }
        const snap = await PlSnapshot.findByPk(dateISO, { raw: true });
        if (!snap) {
            return res.status(404).json({ success: false, error: `aucun PL figé le ${dateISO}` });
        }
        res.json({ success: true, data: snap });
    } catch (e) {
        console.error('GET /api/finance/pl/snapshots/:date:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * D'OU VIENT L'ECART DE PL entre une journee et la veille.
 *
 * Les deux PL figes sont des CUMULS depuis le 1er: leur difference poste par
 * poste est la contribution de la journee. Tout le calcul vit dans
 * lib/pl-ecart-jour.js, module pur et teste; cette route ne fait que charger
 * les deux lignes et le brancher.
 *
 * PARAMETRES
 *   date       la journee expliquee (obligatoire)
 *   reference  la photo a laquelle on la compare. Defaut: J-1. Le client
 *              envoie J-1, mais le parametre reste explicite: l'ecran, lui,
 *              se compare au dernier PL FIGE, qui peut dater de trois jours.
 *              Les deux lectures sont legitimes, et chacune annonce la sienne.
 *   debut      le 1er jour du cumul. Defaut: le 1er du mois de `date`. Sans
 *              lui, un PL affiche du 05 au 14 serait explique par des cumuls
 *              partant du 1er, et aucune colonne ne correspondrait a l'ecran.
 *   mode       auto (defaut) | force | fige — voir plus bas.
 */
router.get('/pl/ecart-jour', async (req, res) => {
    try {
        const dateISO = parseDateVersISO(String(req.query.date || ''));
        if (!dateISO) {
            return res.status(400).json({ success: false, error: 'date invalide' });
        }
        const veilleISO = parseDateVersISO(String(req.query.reference || ''))
            || new Date(new Date(dateISO + 'T00:00:00Z').getTime() - 86400000)
                .toISOString().slice(0, 10);
        if (veilleISO >= dateISO) {
            return res.status(400).json({ success: false,
                error: 'la référence doit précéder la date' });
        }
        const [snapJour, snapVeille] = await Promise.all([
            PlSnapshot.findByPk(dateISO, { raw: true }),
            PlSnapshot.findByPk(veilleISO, { raw: true })
        ]);
        // TROIS MODES, parce que « figé » et « à jour » ne sont pas la meme
        // question. Le recalcul passe par computePl, qui valorise le stock AUX
        // PRIX DE LA DATE demandee - il n'invente donc pas de revalorisation -
        // mais lit les donnees TELLES QU'ELLES SONT MAINTENANT: une vente
        // saisie en retard y figure, alors qu'un snapshot pris ce soir-la ne
        // l'aurait pas contenue. Le module le signale.
        //   auto  (defaut) - les photos figees, completees par un recalcul
        //                    quand elles manquent. La journee en cours n'est
        //                    jamais figee avant 23h35.
        //   force          - tout recalculer MAINTENANT, meme si un PL a ete
        //                    fige. Un snapshot peut etre perime: une vente
        //                    saisie en retard, un stock corrige depuis. Ce
        //                    mode montre l'etat courant, et signale l'ecart
        //                    avec ce qui avait ete fige.
        //   fige           - ne comparer que des photos figees, sans rien
        //                    recalculer.
        // `recalculer=0/1` reste accepte: c'est l'ancien parametre.
        const mode = resoudreMode(req.query);
        // LE DEBUT DU CUMUL vient du client, qui sait quelle periode il
        // affiche. Sans lui, un PL du 05 au 14 aurait ete explique par des
        // cumuls partant du 1er: l'ecart de la journee serait reste juste -
        // les deux cumuls partagent leur base - mais les colonnes « veille »
        // et « jour » auraient montre des totaux etrangers a l'ecran.
        const debutPeriode = parseDateVersISO(String(req.query.debut || ''))
            || ((snapJour && snapJour.payload && snapJour.payload.periode) || {}).dateDebut
            || dateISO.slice(0, 8) + '01';
        let payloadJour = snapJour ? snapJour.payload : null;
        let payloadVeille = snapVeille ? snapVeille.payload : null;
        let veilleRecalculee = false, jourRecalcule = false;
        // Ce que le PL FIGE disait, garde pour le comparer au recalcul.
        const plFige = {
            jour: snapJour ? parseFloat(snapJour.pl) : null,
            veille: snapVeille ? parseFloat(snapVeille.pl) : null
        };
        if (mode !== 'fige') {
            for (const cote of [
                { a: 'jour', iso: dateISO, present: !!payloadJour },
                { a: 'veille', iso: veilleISO, present: !!payloadVeille }
            ]) {
                if (cote.present && mode !== 'force') continue;
                try {
                    const calcule = await computePlMemoise(debutPeriode, cote.iso);
                    if (cote.a === 'jour') { payloadJour = calcule; jourRecalcule = true; }
                    else { payloadVeille = calcule; veilleRecalculee = true; }
                } catch (e) {
                    // Un recalcul qui echoue ne doit pas emporter la route: le
                    // module rendra son refus habituel, qui dit quoi faire.
                    console.warn('[PL] recalcul ' + cote.a + ' echoue:', e.message);
                }
            }
        }
        // LES LIGNES ENTREES DANS LE CUMUL entre les deux photos, lues APRES
        // avoir su qu'il y a deux photos a comparer.
        //
        // Depenses et paiements vivent dans des tables locales datees: la
        // journee est l'intervalle ]veille, jour]. On les lit ici plutot que
        // de les figer dans le payload, ce qui rend le detail disponible sur
        // TOUT l'historique deja fige, pas seulement sur les jours a venir.
        //
        // `Op` vient de l'import de tete (ligne 47). computePl en declare un
        // local sous le nom SeqOp, ce qui pouvait laisser croire qu'aucun
        // n'etait disponible ici - il l'etait.
        let depensesRows = [], paiementsRows = [];
        if (payloadJour && payloadVeille) {
            const f = fenetreEntrees(veilleISO, dateISO);
            [depensesRows, paiementsRows] = await Promise.all([
                Depense.findAll({
                    where: { date: { [Op.between]: [f.debut, f.fin] } },
                    attributes: ['date', 'montant', 'categorie'],
                    raw: true
                }),
                // Pas de colonne « fournisseur »: la table ne porte qu'UN
                // fournisseur, et decrit chaque versement par son mode, sa
                // reference et son commentaire. Le libelle se compose donc.
                FournisseurPaiement.findAll({
                    where: { date: { [Op.between]: [f.debut, f.fin] } },
                    attributes: ['date', 'montant', 'mode', 'reference', 'commentaire'],
                    raw: true
                })
            ]);
        }
        const r = ecartJour({
            jour: payloadJour,
            veille: payloadVeille,
            veilleRecalculee: veilleRecalculee,
            jourRecalcule: jourRecalcule,
            plFige: plFige,
            depenses: depensesRows.map((d) => ({
                date: d.date, montant: d.montant, libelle: d.categorie
            })),
            paiements: paiementsRows.map((p) => ({
                date: p.date, montant: p.montant,
                libelle: [p.mode, p.reference ? 'réf. ' + p.reference : null, p.commentaire]
                    .filter(Boolean).join(' · ') || 'versement fournisseur'
            }))
        });
        res.json({
            success: true,
            data: Object.assign({
                date_jour: dateISO,
                date_veille: veilleISO,
                // La SOURCE de chaque photo: un snapshot manuel fige a 14 h ne
                // couvre pas la meme journee que celui du cron de 23h35, et
                // comparer les deux ferait apparaitre une demi-journee comme
                // un ecart. L'ecran le dit plutot que de le taire.
                mode: mode,
                // LE RECALCUL PRIME sur le snapshot. En mode force, un PL fige
                // existe mais n'a PAS servi: annoncer sa source et sa date de
                // figeage decrirait une photo que le calcul a ecartee. La date
                // de figeage tombe alors a null - il n'y a pas de figeage
                // derriere le chiffre rendu.
                source_jour: jourRecalcule ? 'recalcul' : (snapJour ? snapJour.source : null),
                source_veille: veilleRecalculee ? 'recalcul'
                    : (snapVeille ? snapVeille.source : null),
                fige_jour: jourRecalcule ? null : (snapJour ? snapJour.updated_at : null),
                fige_veille: veilleRecalculee ? null : (snapVeille ? snapVeille.updated_at : null)
            }, r)
        });
    } catch (e) {
        console.error('GET /api/finance/pl/ecart-jour:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Valeur d'un parametre de Finance applicable a un mois.
 *
 * Meme mecanique que les charges: la ligne finance_config_mois la plus
 * recente avec mois <= M, a defaut la valeur courante de finance_config.
 *
 * Sans cela, changer le taux de pertes decoupe recalculait tous les PL passes
 * avec la nouvelle valeur: un PL deja imprime n'etait plus reproductible.
 */
async function resolveConfigPourMois(mois, key, valeurAncrage) {
    const { Op } = require('sequelize');
    const row = await FinanceConfigMois.findOne({
        where: { key, mois: { [Op.lte]: mois } },
        order: [['mois', 'DESC']],
        raw: true
    });
    return row ? row.value : valeurAncrage;
}

/**
 * Montant de chaque charge pour chacun des mois demandes.
 *
 * Pour un mois M et une charge C: la ligne finance_charges_mois la plus
 * recente avec mois <= M; a defaut finance_charges.montant_mensuel.
 *
 * Le report en avant est voulu - une saisie pour 2026-07 vaut aussi pour les
 * mois suivants jusqu'a la prochaine - et le repli sur la valeur courante
 * garantit qu'un PL anterieur a toute saisie mensuelle rend le meme resultat
 * qu'avant l'introduction de cette table.
 *
 * Rend { [mois]: { [nom]: montant } }.
 */
async function resolveChargesPourMois(listeMois, chargesRows) {
    const defauts = Object.fromEntries(
        chargesRows.map((c) => [c.nom, parseFloat(c.montant_mensuel) || 0])
    );
    const resultat = Object.fromEntries(
        listeMois.map((m) => [m, { ...defauts }])
    );
    if (!listeMois.length || !chargesRows.length) return resultat;

    // Une seule requete: toutes les lignes <= au plus grand mois demande.
    // Le volume est celui du nombre de saisies, pas des mois traverses.
    const moisMax = listeMois.reduce((a, b) => (a > b ? a : b));
    const { Op: SeqOp } = require('sequelize');
    const rows = await FinanceChargeMois.findAll({
        where: { mois: { [SeqOp.lte]: moisMax } },
        order: [['nom', 'ASC'], ['mois', 'ASC']],
        raw: true
    });

    for (const mois of listeMois) {
        for (const row of rows) {
            // rows triees par mois croissant: la derniere <= mois gagne.
            if (row.mois <= mois) {
                resultat[mois][row.nom] = parseFloat(row.montant_mensuel) || 0;
            }
        }
    }
    return resultat;
}

// =====================================================
// CASH ET STOCK — reserve aux admin / superviseur
// =====================================================
// Formule:
//   Valeur(D) = Stock_soir(D) × coeff
//             + Σ cloture.montant_total_caisse where date=D, is_latest, NOT NULL
//             − Σ cloture.depot_mata            where date=D, is_latest, NOT NULL
//             − Σ commission_MaaS where 1er du mois de D ≤ date ≤ D
//
// coeff = (100 - stock_pertes_decoupe_pct) / 100  (partage avec PL)
// Stock_soir est valorise au PRIX D'ACHAT fournisseur quand il est connu, et
// au prix de vente sinon (produits alors nommes) - cf lib/valorisation-stock.js.
// Stock soir: fallback au snapshot le plus proche <= D si pas pile a D.
// Solde du fournisseur: commission MaaS du MOIS EN COURS, la facturation
// fournisseur etant mensuelle. C'etait un cumul depuis 1970 jusqu'au
// 2026-08-01, ce qui faisait porter a la Valeur du jour des dettes de mois
// deja clos.

// Memoization du cumul commission par date (key=dateD).
// computeCreances('1970-01-01', dateD) est couteux (scan tous Ventes +
// resolution prix point-in-time). Pour les dates PASSEES, le resultat est
// stable (les ventes ne changent pas retroactivement). Pour la date du
// jour, on garde le cache court (60s) car de nouvelles ventes arrivent.
const _cashStockCumulCache = new Map(); // dateD -> { value, ts }
const CASH_STOCK_CACHE_TODAY_TTL_MS = 60 * 1000;
function getCachedCumul(dateD, todayISO) {
    const e = _cashStockCumulCache.get(dateD);
    if (!e) return null;
    // Dates strictement < today: cache illimite (stable). Today: TTL 60s.
    if (dateD < todayISO) return e.value;
    if (Date.now() - e.ts < CASH_STOCK_CACHE_TODAY_TTL_MS) return e.value;
    return null;
}
function setCachedCumul(dateD, value) {
    _cashStockCumulCache.set(dateD, { value, ts: Date.now() });
}
// Invalidation unifiee de tous les caches derives Finance:
// - financeCache (catalogue prix + aliases, TTL 60s)
// - _cashStockCumulCache (cumul commission MaaS par date)
//
// A appeler depuis toute mutation qui peut changer les calculs derives:
//   - cote routes/finance.js: prix*, alias*, config, charges*, paiements*
//   - cote server.js: mutations Vente (POST/PUT/DELETE /api/ventes,
//     /api/ventes/jour/:date, /api/vider-base, conversion precommande,
//     suppression commande_id). Cf invalidateFinanceCachesOnVenteMutation().
//
// Attache au router pour rester accessible apres le module.exports = router
// (en fin de fichier) qui remplacerait sinon l'export.
function invalidateFinanceDerivedCaches() {
    financeCache.invalidate();
    _cashStockCumulCache.clear();
    // Le PL depend des prix, charges, depenses, paiements et config: toute
    // mutation finance jette aussi sa memoisation (le TTL couvre le reste).
    _plMemo.clear();
}
router.invalidateFinanceDerivedCaches = invalidateFinanceDerivedCaches;
// Le cron du soir (scripts/pl-snapshot-cron.js) et le snapshot manuel
// passent par LE meme calcul que la route - exporte a cote du router,
// comme invalidateFinanceDerivedCaches ci-dessus.
router.computePl = computePl;
router.periodePlParDefaut = periodePlParDefaut;
// Gardes du figeage, exposees pour etre testees sans monter HTTP ni base.
router.resoudreCibleSnapshot = resoudreCibleSnapshot;
router.validerCoefficient = validerCoefficient;

router.get('/cash-stock', async (req, res) => {
    try {
        // Auth: seuls admin et superviseur (meme regle que PL).
        const role = (req.session && req.session.user && req.session.user.role || '').toLowerCase();
        if (!['admin', 'superviseur'].includes(role)) {
            return res.status(403).json({
                success: false,
                error: 'Accès réservé aux administrateurs et superviseurs'
            });
        }

        // Date (defaut: aujourd'hui).
        const today = new Date();
        const todayISO = today.toISOString().slice(0, 10);
        const rawDate = req.query.date;
        const dateD = rawDate ? parseDateVersISO(rawDate) : todayISO;
        if (rawDate && !dateD) {
            return res.status(400).json({ success: false, error: 'invalid date' });
        }
        const dParsed = new Date(dateD + 'T00:00:00Z');
        if (isNaN(dParsed.getTime())) {
            return res.status(400).json({ success: false, error: 'invalid date' });
        }
        // Pas de Valeur dans le futur - avec une tolerance d'un jour.
        //
        // todayISO vient de toISOString(), donc de l'UTC, alors que l'interface
        // propose la date LOCALE du navigateur. A l'est de Greenwich les deux
        // divergent pendant les premieres heures de la journee: a Dubai (UTC+4),
        // le client proposait le 07 pendant que le serveur en etait au 06, et
        // Cash et Stock rejetait sa propre date par defaut plusieurs heures par
        // jour. Un client peut etre jusqu'a 14 h en avance sur UTC; un jour de
        // tolerance couvre tous les fuseaux, et au-dela l'erreur est reelle.
        const todayParsed = new Date(todayISO + 'T00:00:00Z');
        const borneHaute = new Date(todayParsed.getTime() + 24 * 3600 * 1000);
        if (dParsed > borneHaute) {
            return res.status(400).json({
                success: false,
                error: 'date ne peut pas etre dans le futur',
                // Distingue le refus d'une saisie absurde d'une journee
                // simplement pas encore renseignee: l'interface n'affiche une
                // erreur rouge que pour le premier cas.
                code: 'date_futur'
            });
        }

        // 1) Stock soir(D) avec fallback au snapshot le plus proche <= D.
        // stocks.date est en TEXTE DD-MM-YYYY; on convertit en ISO via la
        // constante STOCKS_DATE_AS_ISO_SQL (IMMUTABLE, indexable - cf
        // idx_stocks_date_iso). Pas de cast date necessaire: ordre lex sur
        // ISO = ordre chronologique.
        // Valorise au prix d'ACHAT quand il est connu, exactement comme le PL:
        // la MEME fonction, pour que les deux ecrans ne puissent pas diverger.
        const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');
        const resolveurPrix = await creerResolveurPrixAchat(dateD);
        // La famille (Boucherie / Epicerie / Autres) vient de categories.famille,
        // partagee avec le parage: c'est la notion metier qui separe la viande
        // du reste, et elle range la Volaille et le Caprin AVEC le bovin.
        const { chargerContexteParage } = require('../lib/parage-contexte');
        const ctxFamille = await chargerContexteParage(sequelize);
        const estBoucherie = ctxFamille.estBoucherie;
        const produitsNonFiables = await produitsAStockSoirNegatif(dateD);
        const stockSoirVal = await valoriserSnapshotStock('soir', dateD, resolveurPrix.pourDate, estBoucherie, produitsNonFiables);
        const stockSoirBrut = stockSoirVal.valeur;
        const stockSoirDateUtilisee = stockSoirVal.date_utilisee;
        const stockAuPrixDeVente = stockSoirVal.produits_au_prix_de_vente;

        // 2) Coefficient (partage avec PL via finance_config).
        const cfgRows = await FinanceConfig.findAll();
        const cfgMap = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
        // Taux applicable au mois de la date demandee.
        const pertesPct = parseFloat(await resolveConfigPourMois(
            dateD.slice(0, 7), 'stock_pertes_decoupe_pct', cfgMap.stock_pertes_decoupe_pct
        ));
        const safePertesPct = Number.isFinite(pertesPct) && pertesPct >= 0 && pertesPct <= 100
            ? pertesPct
            : 5;
        const coeff = (100 - safePertesPct) / 100;
        // Meme regle qu'au PL: le coefficient de decoupe ne porte que sur la
        // viande. L'epicerie entre a sa valeur pleine.
        const stockSoirNet = coeff * stockSoirVal.valeur_boucherie
            + stockSoirVal.valeur_hors_boucherie;

        // 3) Cash en caisse = somme montant_total_caisse pour la derniere
        //    cloture (is_latest) de chaque PV a la date D. NULL ignore.
        // depot_mata figure ici parce que la liste `attributes` est explicite:
        // une colonne oubliee ne remonte PAS et la ligne afficherait 0 partout,
        // sans la moindre erreur.
        const cashRows = await ClotureCaisse.findAll({
            where: { date: dateD, is_latest: true },
            attributes: ['point_de_vente', 'montant_total_caisse', 'depot_mata', 'updated_at'],
            order: [['point_de_vente', 'ASC']]
        });
        const cashParPv = cashRows.map((c) => {
            const m = c.montant_total_caisse;
            const d = c.depot_mata;
            return {
                point_de_vente: c.point_de_vente,
                montant: m == null ? null : round2(parseFloat(m)),
                renseigne: m != null,
                depot_mata: d == null ? null : round2(parseFloat(d))
            };
        });
        const cashCaisseTotal = cashParPv.reduce(
            (s, c) => s + (c.montant != null ? c.montant : 0), 0
        );
        const pvSansSaisie = cashParPv.filter((c) => !c.renseigne).map((c) => c.point_de_vente);

        // 3 bis) Depot Mata = ce que le point de vente a verse a Mata ce
        //    jour-la. Le comptage de la caisse se fait AVANT le depot, donc
        //    ces billets sont encore comptes dans montant_total_caisse alors
        //    qu'ils ne sont plus la valeur du point de vente: on les retire.
        //
        //    Ce n'est PAS un paiement au fournisseur: le solde du fournisseur
        //    (ligne suivante) reste la dette brute et n'est pas touche ici.
        //    Un depot n'est deduit que si la cloture a DECLARE son cash. Sans
        //    montant, la ligne compte 0 au-dessus: retirer son depot enleverait
        //    un argent jamais ajoute. La route POST l'interdit deja (montant
        //    obligatoire, depot plafonne), mais la table clotures_caisse est
        //    partagee avec DATA, dont le modele ignore montant_total_caisse.
        const depotMataTotal = cashParPv.reduce(
            (s, c) => s + (c.renseigne && c.depot_mata != null ? c.depot_mata : 0), 0
        );

        // 4) Solde du fournisseur = commission MaaS du MOIS EN COURS
        //    (du 1er du mois de D jusqu'a D inclus).
        //
        //    C'etait auparavant un cumul depuis 1970 ("vision bilan"). La
        //    facturation fournisseur etant mensuelle, ce cumul faisait porter
        //    a la Valeur du jour des dettes de mois deja clos.
        //
        //    Memoize par date: pour les dates passees le resultat est stable,
        //    pour today on cache 60s. Evite de rescanner les ventes a chaque
        //    ouverture du panneau.
        const moisDebut = dateD.slice(0, 8) + '01';
        let soldeDuFournisseur = getCachedCumul(dateD, todayISO);
        if (soldeDuFournisseur === null) {
            const { computeCreances } = require('./finance-creances');
            const creancesMois = await computeCreances({
                dateDebut: moisDebut,
                dateFin: dateD
            });
            soldeDuFournisseur = creancesMois.ce_que_je_dois || 0;
            setCachedCumul(dateD, soldeDuFournisseur);
        }

        // 5) Valeur finale
        const valeur = stockSoirNet + cashCaisseTotal - depotMataTotal - soldeDuFournisseur;

        // La tolerance d'un jour existe pour les fuseaux a l'est de Greenwich,
        // pas pour valoriser une journee qui n'a pas eu lieu. Au-dela de la
        // date du serveur ET sans aucune cloture, ce qui sort n'est pas une
        // mesure: c'est le dernier snapshot de stock repris tel quel, moins une
        // commission, presente comme une Valeur du jour. On le dit.
        const dansLaTolerance = dateD > todayISO;
        const aucuneDonnee = dansLaTolerance && cashParPv.length === 0;

        res.json({
            success: true,
            data: {
                date: dateD,
                stock: {
                    soir_brut: round2(stockSoirBrut),
                    soir_date_utilisee: stockSoirDateUtilisee,
                    coeff: round2(coeff),
                    pertes_decoupe_pct: safePertesPct,
                    soir_net: round2(stockSoirNet),
                    // Produits restes au prix de vente, faute de prix d'achat
                    // fournisseur: l'ecran les marque d'un asterisque.
                    produits_au_prix_de_vente: stockAuPrixDeVente,
                    soir_boucherie: round2(stockSoirVal.valeur_boucherie || 0),
                    soir_hors_boucherie: round2(stockSoirVal.valeur_hors_boucherie || 0),
                    negatifs_ignores: round2(stockSoirVal.valeur_negative_ignoree || 0),
                    nb_lignes_negatives: (stockSoirVal.lignes_negatives || []).length,
                    produits_ecartes: produitsNonFiables.pourAffichage || []
                },
                depot_mata: round2(depotMataTotal),
                cash: {
                    total: round2(cashCaisseTotal),
                    nb_pv_avec_cloture: cashParPv.length,
                    nb_pv_renseigne: cashParPv.filter((c) => c.renseigne).length,
                    pv_sans_saisie: pvSansSaisie,
                    par_pv: cashParPv
                },
                solde_du_fournisseur: round2(soldeDuFournisseur),
                // Periode reellement couverte par le solde ci-dessus: permet a
                // l'interface de dire "du 01 au 31" plutot qu'un vague "cumul".
                solde_periode: { debut: moisDebut, fin: dateD },
                valeur: round2(valeur),
                // Journee posterieure a la date du serveur et sans aucune
                // cloture: l'interface affiche un message neutre plutot que ce
                // total, qui n'est mesure sur rien.
                aucune_donnee: aucuneDonnee
            }
        });
    } catch (e) {
        console.error('GET /api/finance/cash-stock:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// CONFIG
// =====================================================

// ?mois=YYYY-MM : stock_pertes_decoupe_pct est rendu pour ce mois (saisie du
// mois, report du dernier mois saisi, ou valeur d'ancrage). Sans le
// parametre, valeurs courantes - comportement d'origine.
/**
 * finance_config, PRIVEE DES CLES DE SIMULATION 2.0.
 *
 * Ces routes rendent toute la table sans filtre et sont gardees par
 * checkAdvancedAccess, qui laisse passer superviseur et superutilisateur. Les
 * cles v2 y fuitaient donc a des roles auxquels /api/simulation-v2/reglages
 * refuse expressement de les montrer: deux routes qui disent le contraire
 * l'une de l'autre sur les memes donnees. Leur seule porte de lecture est le
 * routeur v2.
 *
 * Partage par le GET et par l'echo du PUT: filtrer d'un cote seulement ne
 * servait a rien, il suffisait d'ecrire une cle quelconque pour recevoir les
 * autres en retour.
 */
async function lireConfigPublique() {
    // CLES_RESERVEES, pas Object.values(CLES): la liste noire doit couvrir les
    // cles RETIREES du code autant que les cles vivantes. Les lignes d'une cle
    // supprimee restent en base sur les tenants deja deployes, et les deriver
    // de la liste vivante faisait fuiter chaque suppression - retirer une cle
    // du code l'exposait sur la route.
    const { CLES_RESERVEES } = require('../lib/simulation-v2/reglages');
    const reserveesV2 = new Set(CLES_RESERVEES);
    const rows = await FinanceConfig.findAll();
    const config = {};
    for (const r of rows) {
        if (reserveesV2.has(r.key)) continue;
        config[r.key] = r.value;
    }
    return config;
}

router.get('/config', async (req, res) => {
    try {
        const config = await lireConfigPublique();

        const mois = req.query.mois;
        if (mois) {
            if (!/^\d{4}-\d{2}$/.test(mois)) {
                return res.status(400).json({ success: false, error: 'mois: format YYYY-MM attendu' });
            }
            config.stock_pertes_decoupe_pct = await resolveConfigPourMois(
                mois, 'stock_pertes_decoupe_pct', config.stock_pertes_decoupe_pct
            );
            const propre = await FinanceConfigMois.findOne({
                where: { mois, key: 'stock_pertes_decoupe_pct' }, raw: true
            });
            return res.json({ success: true, mois, data: config, pertes_saisi_ce_mois: !!propre });
        }
        res.json({ success: true, data: config });
    } catch (e) {
        console.error('GET /api/finance/config:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Body: { commission_pct?, categories_eligibles?, stock_pertes_decoupe_pct? }
router.put('/config', async (req, res) => {
    try {
        // parage_dechets: la FAMILLE dechet - les produits dont le bilan
        // (soir + vendu + jete - matin) mesure le dechet PRODUIT par la
        // decoupe. Configuree dans le meme ecran admin que les exclusions,
        // et stockee pareil: une liste CSV de noms, pas de table dediee.
        const allowedKeys = ['commission_pct', 'categories_eligibles', 'stock_pertes_decoupe_pct', 'parage_exclusions', 'parage_dechets'];
        // Mois optionnel: ne s'applique qu'a stock_pertes_decoupe_pct, seul
        // parametre date a ce jour.
        const moisCible = req.body?.mois || null;
        if (moisCible && !/^\d{4}-\d{2}$/.test(moisCible)) {
            return res.status(400).json({ success: false, error: 'mois: format YYYY-MM attendu' });
        }
        const now = new Date();
        // Deux passes: TOUT valider avant de RIEN ecrire, puis toutes les
        // ecritures dans une transaction. En un seul passage, une requete
        // multi-cles pouvait persister les premieres valeurs et echouer sur la
        // suivante: etat partiel en base sous une reponse 400.
        const aEcrire = [];
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                const value = String(req.body[key]);
                // Produits verrouilles (lib/parage.js): "Boeuf" est la
                // carcasse, l'exclure ou le mettre en famille dechet
                // effondrerait le denominateur du parage. L'ecran desactive la
                // case, mais une regle qui ne vit que dans l'ecran se
                // contourne - ici comme pour le jete a impact positif.
                if (key === 'parage_exclusions' || key === 'parage_dechets') {
                    const { estProduitVerrouille } = require('../lib/parage');
                    const interdits = value.split(',').map((s) => s.trim())
                        .filter((s) => s && estProduitVerrouille(s));
                    if (interdits.length) {
                        return res.status(400).json({
                            success: false,
                            error: `${interdits.join(', ')} : produit verrouillé, il porte le stock du parage et ne peut être ni exclu ni mis en famille déchet`
                        });
                    }
                }
                // Validations numeriques (commission_pct, stock_pertes_decoupe_pct):
                // doivent etre entre 0 et 100 inclus.
                if ((key === 'commission_pct' || key === 'stock_pertes_decoupe_pct')
                    && !(parseFloat(value) >= 0 && parseFloat(value) <= 100)) {
                    return res.status(400).json({
                        success: false,
                        error: `${key} doit etre entre 0 et 100`
                    });
                }
                aEcrire.push({ key, value });
            }
        }
        await sequelize.transaction(async (t) => {
            for (const { key, value } of aEcrire) {
                // Avec un mois, le taux de pertes est DATE et l'ancrage
                // n'est pas touche: sinon la nouvelle valeur deviendrait le
                // repli des mois anterieurs et reecrirait le passe.
                if (moisCible && key === 'stock_pertes_decoupe_pct') {
                    await FinanceConfigMois.upsert({ mois: moisCible, key, value, updated_at: now }, { transaction: t });
                } else {
                    await FinanceConfig.upsert({ key, value, updated_at: now }, { transaction: t });
                }
            }
        });
        // commission_pct change -> les calculs derives (commission MaaS cumul
        // dans cash-stock) doivent etre recomputed. Invalider tous les caches
        // finance-derives pour rester safe.
        invalidateFinanceDerivedCaches();
        // MEME filtre qu'au GET. Sans lui, la reponse du PUT rendait les cles
        // de Simulation 2.0 a un superviseur, ce qui annulait le filtre pose
        // sur la lecture: il suffisait d'ecrire n'importe quelle autre cle
        // pour les recevoir en echo.
        res.json({ success: true, data: await lireConfigPublique() });
    } catch (e) {
        console.error('PUT /api/finance/config:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// DEPENSES
// =====================================================

// Categories de depenses ACTIVES, pour alimenter les <select> de l'onglet
// Depenses. Configurables dans ADMIN > Categories depenses (CRUD cote
// server.js). Tout utilisateur authentifie: c'est une liste de reference.
router.get('/depense-categories', async (req, res) => {
    try {
        const { DepenseCategorie } = require('../db/models');
        const rows = await DepenseCategorie.findAll({
            where: { actif: true },
            order: [['ordre', 'ASC'], ['libelle', 'ASC']],
            attributes: ['nom', 'libelle']
        });
        res.json({ success: true, categories: rows });
    } catch (e) {
        console.error('GET /api/finance/depense-categories:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/depenses', async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const where = {};
        if (req.query.dateDebut) where.date = { [Op.gte]: req.query.dateDebut };
        if (req.query.dateFin) {
            where.date = where.date || {};
            where.date[Op.lte] = req.query.dateFin;
        }
        if (req.query.categorie) where.categorie = req.query.categorie;
        const rows = await Depense.findAll({
            where,
            attributes: { exclude: ['justificatif_data'] }, // exclure le binaire dans la liste
            order: [['date', 'DESC'], ['id', 'DESC']]
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/depenses:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST multipart: champs { date, montant, categorie?, description? } + file 'justificatif'
router.post('/depenses', upload.single('justificatif'), async (req, res) => {
    try {
        const { date, montant, categorie, description } = req.body;
        if (!date || !montant) {
            return res.status(400).json({ success: false, error: 'date et montant requis' });
        }
        const mt = parseFloat(montant);
        if (!Number.isFinite(mt) || mt <= 0) {
            return res.status(400).json({ success: false, error: 'montant doit etre un nombre > 0' });
        }
        const payload = {
            date,
            montant: mt,
            categorie: categorie || null,
            description: description || null,
            created_by: req.session?.user?.username || null
        };
        if (req.file) {
            payload.justificatif_filename = req.file.originalname;
            payload.justificatif_mime = req.file.mimetype;
            payload.justificatif_data = req.file.buffer;
            payload.justificatif_size = req.file.size;
        }
        const created = await Depense.create(payload);
        // Ne pas renvoyer le binaire dans la reponse de creation.
        const { justificatif_data, ...slim } = created.toJSON();
        res.json({ success: true, data: slim });
    } catch (e) {
        console.error('POST /api/finance/depenses:', e);
        const status = e.message?.startsWith('Type de fichier non autorise') ? 400 : 500;
        res.status(status).json({ success: false, error: e.message });
    }
});

router.delete('/depenses/:id', checkAdvancedAccess, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ success: false, error: 'id invalide' });
        }
        const rows = await Depense.destroy({ where: { id } });
        if (rows === 0) {
            return res.status(404).json({ success: false, error: 'Depense introuvable' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/finance/depenses/:id:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Telecharge le justificatif binaire (Content-Type recupere depuis la BDD).
router.get('/depenses/:id/justificatif', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ success: false, error: 'id invalide' });
        }
        const dep = await Depense.findByPk(id);
        if (!dep || !dep.justificatif_data) {
            return res.status(404).json({ success: false, error: 'Justificatif introuvable' });
        }
        res.setHeader('Content-Type', dep.justificatif_mime || 'application/octet-stream');
        res.setHeader(
            'Content-Disposition',
            `inline; filename="${(dep.justificatif_filename || 'justificatif').replace(/"/g, '')}"`
        );
        res.send(dep.justificatif_data);
    } catch (e) {
        console.error('GET /api/finance/depenses/:id/justificatif:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// PAIEMENTS FOURNISSEUR
// =====================================================

router.get('/paiements', async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const where = {};
        if (req.query.dateDebut) where.date = { [Op.gte]: req.query.dateDebut };
        if (req.query.dateFin) {
            where.date = where.date || {};
            where.date[Op.lte] = req.query.dateFin;
        }
        const rows = await FournisseurPaiement.findAll({
            where,
            order: [['date', 'DESC'], ['id', 'DESC']]
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/paiements:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/paiements', async (req, res) => {
    try {
        const { date, montant, mode, reference, commentaire } = req.body;
        if (!date || !montant) {
            return res.status(400).json({ success: false, error: 'date et montant requis' });
        }
        const mt = parseFloat(montant);
        if (!Number.isFinite(mt) || mt <= 0) {
            return res.status(400).json({ success: false, error: 'montant doit etre un nombre > 0' });
        }
        const created = await FournisseurPaiement.create({
            date,
            montant: mt,
            mode: mode || null,
            reference: reference || null,
            commentaire: commentaire || null,
            created_by: req.session?.user?.username || null
        });
        res.json({ success: true, data: created });
    } catch (e) {
        console.error('POST /api/finance/paiements:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/paiements/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ success: false, error: 'id invalide' });
        }
        const rows = await FournisseurPaiement.destroy({ where: { id } });
        if (rows === 0) {
            return res.status(404).json({ success: false, error: 'Paiement introuvable' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/finance/paiements/:id:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// =====================================================
// CALCUL DES CREANCES (interne, gate session)
// =====================================================
// Reponse:
//   {
//     success: true,
//     data: {
//       local: { ...calcul Maas (commission 3% + marge Centre Decoupe)... },
//       cdb:   { ...creance officielle depuis mata-depenses-management... }
//                | null si l'API externe est down / non configuree
//     }
//   }
router.get('/creances', async (req, res) => {
    try {
        const { computeCreances } = require('./finance-creances');
        const { fetchCreanceCdb } = require('../lib/depenses-creance-client');

        // Parallel: calcul local + fetch API externe.
        // L'API externe peut etre down ou pas configuree -> on degrade
        // gracieusement (cdb=null + warning) plutot que tout casser.
        // Chronometrage: cette route est parfois coupee cote client
        // (ERR_CONNECTION_CLOSED) sans laisser la moindre erreur serveur. La
        // ligne START est donc aussi importante que la ligne finale: START
        // sans ligne finale = la requete est bien entree et est morte en
        // cours (temps ou memoire); pas de START du tout = elle n'a jamais
        // atteint le handler.
        const periode = `${req.query.dateDebut || '?'}->${req.query.dateFin || '?'}`;
        console.log(`⏱️  creances START ${periode}`);

        // La ligne FIN ci-dessous est emise AVANT res.json(): elle ne prouve
        // donc pas que la reponse est partie. Ces deux ecouteurs le disent:
        //   SENT    = reponse entierement ecrite sur la socket (+ sa taille)
        //   ABANDON = la connexion est tombee avant la fin de l'envoi
        //             (client qui annule/recharge, ou proxy qui coupe)
        // Un FIN sain suivi d'un ABANDON = le calcul n'est pas en cause.
        // La taille se lit sur la SOCKET et non dans Content-Length: le
        // middleware compression retire cet en-tete des qu'il gzippe, et cette
        // instrumentation - la seule du depot a mesurer une taille de reponse,
        // ajoutee pour diagnostiquer des ERR_CONNECTION_CLOSED - serait
        // retombee sur "?" pour toute requete de navigateur.
        //
        // bytesWritten est CUMULATIF par socket: en keep-alive, il porte aussi
        // les reponses precedentes. On retient donc sa valeur au depart et on
        // ne journalise que la difference.
        const octetsAvant = res.socket ? res.socket.bytesWritten : null;
        res.on('finish', () => {
            let surLeFil = null;
            if (res.socket && octetsAvant !== null) {
                const delta = res.socket.bytesWritten - octetsAvant;
                if (delta > 0) surLeFil = delta;
            }
            console.log(`⏱️  creances SENT ${periode} bytes=${res.get('Content-Length') || surLeFil || '?'}`);
        });
        res.on('close', () => {
            if (!res.writableEnded) {
                console.warn(`⚠️  creances ABANDON ${periode} — connexion coupée avant la fin de l'envoi`);
            }
        });

        const timings = {};
        const tDebut = Date.now();
        const tCdb = Date.now();

        const [local, cdbResult] = await Promise.allSettled([
            computeCreances({
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin,
                timings
            }),
            fetchCreanceCdb({
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin
            }).finally(() => { timings.cdb = Date.now() - tCdb; })
        ]);

        const total = Date.now() - tDebut;
        const rss = Math.round(process.memoryUsage().rss / 1048576);
        const detail = Object.entries(timings).map(([k, v]) => `${k}=${v}`).join(' ');
        console.log(`⏱️  creances FIN ${periode} total=${total}ms rss=${rss}Mo | ${detail}`);

        if (local.status === 'rejected') {
            throw local.reason;
        }

        const data = {
            local: local.value,
            cdb: cdbResult.status === 'fulfilled' ? cdbResult.value : null,
            cdb_error: cdbResult.status === 'rejected'
                ? (cdbResult.reason && cdbResult.reason.message) || 'Erreur appel API depenses'
                : null
        };
        res.json({ success: true, data });
    } catch (e) {
        console.error('GET /api/finance/creances:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
