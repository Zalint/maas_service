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
    sequelize
} = require('../db/models');
const { resolveProduit, buildResolverMaps } = require('../lib/produit-resolver');
const financeCache = require('../lib/finance-cache');
const audit = require('../lib/finance-audit');

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
async function valoriserSnapshotStock(typeStock, dateMax, pourDate, estBoucherie, produitsExclus) {
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
    const r = valoriserLignes({ lignes: retenues, prixAchat, estBoucherie });
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
                // Reglage courant (non historise): c'est un interrupteur de
                // config, pas un prix. Affiche en lecture seule en mode as-of.
                prix_achat_dynamique: r.prix_achat_dynamique === true,
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
                prix_achat_dynamique: prixAchatDynamique
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
                resolved: resolved.resolved
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
                    produit_catalog: a.produit_catalog
                })),
                items
            }
        });
    } catch (e) {
        console.error('GET /api/finance/alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Body: { alias_produit, produit_catalog }
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

        const username = req.session && req.session.user
            ? req.session.user.username
            : null;
        const result = await sequelize.transaction(async (t) => {
            const [, createdCatalog] = await FournisseurPrix.findOrCreate({
                where: { produit: produitCatalog },
                defaults: {
                    produit: produitCatalog,
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
                    produit: produitCatalog,
                    prix_vente: 0,
                    changed_by: username || '_autocreate_alias_'
                }, { transaction: t });
            }
            await ProduitAlias.upsert({
                alias_produit: aliasProduit,
                produit_catalog: produitCatalog,
                updated_at: new Date()
            }, { transaction: t });
            return { catalog_created: createdCatalog };
        });
        if (result.catalog_created) {
            audit.log(req, 'prix.autocreate', { produit: produitCatalog, source: 'alias' });
        }
        audit.log(req, 'alias.upsert', {
            alias_produit: aliasProduit,
            produit_catalog: produitCatalog
        });
        invalidateFinanceDerivedCaches();
        res.json({ success: true, ...result });
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
        const n = await ProduitAlias.destroy({ where: { alias_produit: alias } });
        if (n > 0) {
            audit.log(req, 'alias.delete', { alias_produit: alias });
            invalidateFinanceDerivedCaches();
        }
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
        for (const r of distinctRows) {
            const resolved = resolveProduit(r.produit, resolverMaps);
            if (resolved.statut !== 'prefix') continue;
            toUpsert.push({
                alias_produit: r.produit,
                produit_catalog: resolved.resolved,
                updated_at: now
            });
            created.push({
                alias_produit: r.produit,
                produit_catalog: resolved.resolved
            });
        }

        if (toUpsert.length > 0) {
            await ProduitAlias.bulkCreate(toUpsert, {
                updateOnDuplicate: ['produit_catalog', 'updated_at']
            });
            audit.log(req, 'alias.bulk-from-prefix', {
                count: created.length,
                created
            });
            invalidateFinanceDerivedCaches();
        }
        res.json({ success: true, created });
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
        const lignes = await sequelize.query(
            `SELECT produit,
                    SUM(nombre::numeric)  AS quantite,
                    SUM(montant::numeric) AS ca,
                    COUNT(*)::int         AS nb_lignes
             FROM ventes
             WHERE date IN (:dateList)
             GROUP BY produit`,
            { type: sequelize.QueryTypes.SELECT, replacements: { dateList } }
        );

        // Regroupement par nom normalise: plusieurs graphies d'un meme produit
        // doivent additionner leurs volumes, pas se concurrencer.
        const parCle = new Map();
        for (const l of lignes) {
            const cle = normaliserNomProduit(l.produit);
            if (!parCle.has(cle)) parCle.set(cle, { quantite: 0, ca: 0, nb_lignes: 0, graphies: [] });
            const agg = parCle.get(cle);
            agg.quantite += Number(l.quantite) || 0;
            agg.ca += Number(l.ca) || 0;
            agg.nb_lignes += Number(l.nb_lignes) || 0;
            if (!agg.graphies.includes(l.produit)) agg.graphies.push(l.produit);
        }

        const produits = PRODUITS_SIMULATION.map((nom) => {
            const agg = parCle.get(normaliserNomProduit(nom))
                || { quantite: 0, ca: 0, nb_lignes: 0, graphies: [] };
            return {
                nom,
                quantite: round2(agg.quantite),
                ca: round2(agg.ca),
                // Prix MOYEN constate, et non prix de catalogue: c'est celui-la
                // qui explique le chiffre d'affaires de la periode.
                prix_moyen: agg.quantite > 0 ? round2(agg.ca / agg.quantite) : null,
                nb_lignes: agg.nb_lignes,
                graphies: agg.graphies.sort((a, b) => a.localeCompare(b, 'fr')),
                // Un produit sans vente n'est pas une erreur, mais sa
                // sensibilite vaut zero et l'ecran doit pouvoir le dire.
                sans_vente: agg.quantite === 0
            };
        });

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
        const totalToutesLignes = lignes.reduce((a, l) => a + (Number(l.ca) || 0), 0);

        res.json({
            success: true,
            data: {
                periode: { dateDebut, dateFin },
                produits,
                total_ventes_toutes_lignes: round2(totalToutesLignes),
                produit_equilibre: PRODUIT_EQUILIBRE,
                // Mesure, cf le commentaire d'en-tete de cette route.
                coefficient_pl_par_franc_vendu: 1
            }
        });
    } catch (error) {
        console.error('Erreur simulation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Periode: dateDebut/dateFin (YYYY-MM-DD). Defaut = 1er du mois -> aujourd'hui.
router.get('/pl', async (req, res) => {
    try {
        // Auth: seuls admin et superviseur
        const role = (req.session && req.session.user && req.session.user.role || '').toLowerCase();
        if (!['admin', 'superviseur'].includes(role)) {
            return res.status(403).json({
                success: false,
                error: 'Accès réservé aux administrateurs et superviseurs'
            });
        }

        // Periode (defaut: 1er du mois -> aujourd'hui)
        const today = new Date();
        const defaultDebut = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const defaultFin = today.toISOString().slice(0, 10);
        // Distinguer "param absent" (-> defaut) de "param fourni mais malforme" (-> 400).
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

        // Nombre de jours dans la periode (inclus). Sert a l'affichage: le
        // prorata des charges, lui, se calcule mois par mois sur les jours
        // REELS de chaque mois (voir decouperEnMois), sans mois conventionnel.
        const startD = new Date(dateDebut + 'T00:00:00Z');
        const endD = new Date(dateFin + 'T00:00:00Z');
        if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
            return res.status(400).json({ success: false, error: 'invalid dateDebut/dateFin' });
        }
        if (startD > endD) {
            return res.status(400).json({
                success: false,
                error: 'dateDebut must be <= dateFin'
            });
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
            return res.status(400).json({
                success: false,
                error: `periode trop longue (${nbDaysPeriod} jours, max ${MAX_DAYS_PERIOD})`
            });
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
            attributes: ['montant', 'produit']
        });
        // totalVentes = somme des Vente.montant REELLES uniquement.
        // Les commandes envoyees au CDC sont prises en compte ailleurs dans
        // la formule via "+ Marge CDC" (creances.ce_qu_il_me_doit), pas
        // ici — sinon on compterait deux fois la contribution CDC.
        const totalVentes = ventes.reduce((s, v) => s + (parseFloat(v.montant) || 0), 0);

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
        try {
            const { fetchCreanceCdb } = require('../lib/depenses-creance-client');
            const cdb = await fetchCreanceCdb({ dateDebut, dateFin });
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
            valoriserSnapshotStock('matin', dateDebut, resolveurPrix.pourDate, estBoucherie, produitsNonFiables),
            valoriserSnapshotStock('soir', dateFin, resolveurPrix.pourDate, estBoucherie, produitsNonFiables)
        ]);

        const stockMatinDebut = stockMatinVal.valeur;
        const stockMatinDate = stockMatinVal.date_utilisee;
        const stockSoirFin = stockSoirVal.valeur;
        const stockSoirDate = stockSoirVal.date_utilisee;
        // Produits restes au prix de VENTE, faute de prix d'achat: l'ecran les
        // marque d'un asterisque. Les deux bornes sont rendues SEPAREMENT: un
        // produit present le matin et absent le soir ne concerne qu'une des
        // deux lignes, et une liste fusionnee accusait le stock soir d'un
        // melange de bases qu'il ne contenait pas - une fausse piste pour qui
        // cherche a expliquer une variation.
        const stockMatinAuPrixDeVente = stockMatinVal.produits_au_prix_de_vente;
        const stockSoirAuPrixDeVente = stockSoirVal.produits_au_prix_de_vente;
        const variationStockBrute = stockSoirFin - stockMatinDebut;
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
        // Le coefficient de pertes de DECOUPE ne s'applique qu'a la viande.
        // Applique a toute la variation, il retranchait 5% a des sachets
        // d'epicerie qu'on ne pare pas - et comme le stock des produits
        // automatiques vaut leurs ventes, il en rognait 5% sans raison.
        const variationBoucherie = stockSoirVal.valeur_boucherie - stockMatinVal.valeur_boucherie;
        const variationHorsBoucherie = stockSoirVal.valeur_hors_boucherie - stockMatinVal.valeur_hors_boucherie;
        const variationStockNette = coeffStock * variationBoucherie + variationHorsBoucherie;

        // 7. PL final
        const pl = totalVentes
            - totalAvances
            - commission
            + margeCdc
            - chargesProratisees
            - totalDepenses
            - totalPaiementsFournisseur
            + variationStockNette;

        res.json({
            success: true,
            data: {
                periode: { dateDebut, dateFin, nb_jours: nbDaysPeriod },
                total_ventes: round2(totalVentes),
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
                    // Le coefficient ne porte que sur la boucherie: l'ecran doit
                    // pouvoir le dire plutot que laisser croire a un 5% global.
                    variation_boucherie: round2(variationBoucherie),
                    variation_hors_boucherie: round2(variationHorsBoucherie),
                    // Stocks negatifs ecartes de la somme (produits a stock
                    // calcule dont les entrees ne sont pas saisies).
                    negatifs_ignores: round2(
                        (stockMatinVal.valeur_negative_ignoree || 0)
                        + (stockSoirVal.valeur_negative_ignoree || 0)
                    ),
                    nb_lignes_negatives:
                        (stockMatinVal.lignes_negatives || []).length
                        + (stockSoirVal.lignes_negatives || []).length,
                    // Produits ecartes des DEUX bornes faute de stock fiable.
                    produits_ecartes: produitsNonFiables.pourAffichage || [],
                    // Pourquoi tel prix a ete retenu: DATA injoignable, aucun
                    // lot pour la journee, historique illisible. Sans cela, un
                    // repli sur le catalogue fournisseur reste invisible et le
                    // chiffre parait simplement faux.
                    avertissements: resolveurPrix.avertissements || []
                },
                pl: round2(pl)
            }
        });
    } catch (e) {
        console.error('GET /api/finance/pl:', e);
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
}
router.invalidateFinanceDerivedCaches = invalidateFinanceDerivedCaches;

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
router.get('/config', async (req, res) => {
    try {
        const rows = await FinanceConfig.findAll();
        const config = {};
        for (const r of rows) config[r.key] = r.value;

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
        const allowedKeys = ['commission_pct', 'categories_eligibles', 'stock_pertes_decoupe_pct', 'parage_exclusions'];
        // Mois optionnel: ne s'applique qu'a stock_pertes_decoupe_pct, seul
        // parametre date a ce jour.
        const moisCible = req.body?.mois || null;
        if (moisCible && !/^\d{4}-\d{2}$/.test(moisCible)) {
            return res.status(400).json({ success: false, error: 'mois: format YYYY-MM attendu' });
        }
        const now = new Date();
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                const value = String(req.body[key]);
                // Validations numeriques (commission_pct, stock_pertes_decoupe_pct):
                // doivent etre entre 0 et 100 inclus.
                if ((key === 'commission_pct' || key === 'stock_pertes_decoupe_pct')
                    && !(parseFloat(value) >= 0 && parseFloat(value) <= 100)) {
                    return res.status(400).json({
                        success: false,
                        error: `${key} doit etre entre 0 et 100`
                    });
                }
                // Avec un mois, le taux de pertes est DATE et l'ancrage
                // n'est pas touche: sinon la nouvelle valeur deviendrait le
                // repli des mois anterieurs et reecrirait le passe.
                if (moisCible && key === 'stock_pertes_decoupe_pct') {
                    await FinanceConfigMois.upsert({ mois: moisCible, key, value, updated_at: now });
                } else {
                    await FinanceConfig.upsert({ key, value, updated_at: now });
                }
            }
        }
        // commission_pct change -> les calculs derives (commission MaaS cumul
        // dans cash-stock) doivent etre recomputed. Invalider tous les caches
        // finance-derives pour rester safe.
        invalidateFinanceDerivedCaches();
        const rows = await FinanceConfig.findAll();
        const config = {};
        for (const r of rows) config[r.key] = r.value;
        res.json({ success: true, data: config });
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
