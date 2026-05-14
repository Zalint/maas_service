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

const router = express.Router();

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
        const rows = await FournisseurPrix.findAll({ order: [['produit', 'ASC']] });
        res.json({ success: true, data: rows });
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

            // Lire l'ancien etat pour ne creer une entree history QUE si
            // la valeur a effectivement change. Transaction atomique:
            // upsert catalogue + inserts history conditionnels.
            const existing = await FournisseurPrix.findByPk(produit);
            const oldPrixVente = existing ? parseFloat(existing.prix_vente) : null;
            const oldPrixAchat = existing && existing.prix_achat != null
                ? parseFloat(existing.prix_achat)
                : null;

            await sequelize.transaction(async (t) => {
                await FournisseurPrix.upsert({
                    produit,
                    prix_vente: prixVente,
                    prix_achat: prixAchat,
                    updated_at: now
                }, { transaction: t });

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
            audit.log(req, 'prix.upsert', { produit, prix_vente: prixVente, prix_achat: prixAchat });
        }
        financeCache.invalidate();
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
        financeCache.invalidate();
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
        financeCache.invalidate();
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
        financeCache.invalidate();
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
            financeCache.invalidate();
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
        financeCache.invalidate();
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
            financeCache.invalidate();
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
            financeCache.invalidate();
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

router.get('/charges', async (req, res) => {
    try {
        const rows = await FinanceCharge.findAll({
            order: [['ordre', 'ASC'], ['nom', 'ASC']]
        });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('GET /api/finance/charges:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Body: { items: [{ nom, libelle, montant_mensuel, ordre? }, ...] }
// Upsert ligne par ligne (preserve les autres entrees).
router.put('/charges', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!items) {
            return res.status(400).json({ success: false, error: 'items: array requis' });
        }
        const now = new Date();
        for (const item of items) {
            const nom = String(item.nom || '').trim();
            if (!nom) continue;
            const libelle = String(item.libelle || nom).trim();
            const montant = parseFloat(item.montant_mensuel);
            if (!Number.isFinite(montant) || montant < 0) {
                return res.status(400).json({
                    success: false,
                    error: `montant_mensuel invalide pour ${nom}`
                });
            }
            const ordre = Number.isFinite(parseInt(item.ordre, 10))
                ? parseInt(item.ordre, 10)
                : 0;
            await FinanceCharge.upsert({
                nom, libelle, montant_mensuel: montant, ordre, updated_at: now
            });
            audit.log(req, 'charge.upsert', { nom, montant_mensuel: montant });
        }
        const rows = await FinanceCharge.findAll({ order: [['ordre', 'ASC'], ['nom', 'ASC']] });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('PUT /api/finance/charges:', e);
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
//      - charges_proratisees (charges_mensuelles × nb_jours_periode / 30)
//      - paiements_fournisseur (table fournisseur_paiements, sur la periode)
//      + variation_stock_nette
//
// total_avances: filtre sur la periode automatiquement (MataBanq
// applique dateDebut/dateFin a sa requete et retourne le total des
// operations type='avance' dans cette fenetre).
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
        const toISO = (s) => {
            if (!s) return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
            return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
        };
        const dateDebut = toISO(req.query.dateDebut) || defaultDebut;
        const dateFin = toISO(req.query.dateFin) || defaultFin;

        // Nombre de jours dans la periode (inclus). Convention 30 jours/mois.
        const startD = new Date(dateDebut + 'T00:00:00Z');
        const endD = new Date(dateFin + 'T00:00:00Z');
        const nbDaysPeriod = Math.floor((endD - startD) / 86400000) + 1;

        // 1. Total ventes sur la periode (= Vente.date IN periode, montant)
        const { Op: SeqOp } = require('sequelize');
        // Vente.date stocke en string YYYY-MM-DD (cf finance-creances notes).
        const ventes = await Vente.findAll({
            where: { date: { [SeqOp.between]: [dateDebut, dateFin] } },
            attributes: ['montant']
        });
        const totalVentes = ventes.reduce((s, v) => s + (parseFloat(v.montant) || 0), 0);

        // 2. Commission MaaS + Marge CDC via computeCreances
        const { computeCreances } = require('./finance-creances');
        const creances = await computeCreances({ dateDebut, dateFin });
        const commission = creances.ce_que_je_dois || 0;
        const margeCdc = creances.ce_qu_il_me_doit || 0;

        // 3. Total avances depuis MataBanq (deja filtre par dateDebut/dateFin
        //    cote API externe, donc = avances du mois choisi).
        let totalAvances = 0;
        try {
            const { fetchCreanceCdb } = require('../lib/depenses-creance-client');
            const cdb = await fetchCreanceCdb({ dateDebut, dateFin });
            if (cdb && Array.isArray(cdb.details) && cdb.details[0]
                && Array.isArray(cdb.details[0].status) && cdb.details[0].status[0]) {
                totalAvances = parseFloat(cdb.details[0].status[0].total_avances) || 0;
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

        // 5. Charges proratisees (30 jours conventionnels)
        const chargesRows = await FinanceCharge.findAll({ order: [['ordre', 'ASC']] });
        const ratio = nbDaysPeriod / 30;
        const chargesDetail = chargesRows.map((c) => ({
            nom: c.nom,
            libelle: c.libelle,
            montant_mensuel: parseFloat(c.montant_mensuel) || 0,
            prorata: round2((parseFloat(c.montant_mensuel) || 0) * ratio)
        }));
        const chargesTotalMensuel = chargesDetail.reduce((s, c) => s + c.montant_mensuel, 0);
        const chargesProratisees = chargesDetail.reduce((s, c) => s + c.prorata, 0);

        // 6. Variation de stock = stock_soir_fin - stock_matin_debut.
        // Si pas de saisie pile aux dates: prendre la date la plus
        // proche <= demandee (sinon 0). On somme sum(total) pour tous
        // les produits / PV (variation globale entreprise).
        const stockMatinRows = await sequelize.query(
            `SELECT COALESCE(SUM(total), 0)::numeric AS total, MAX(date) AS date_utilisee
             FROM stocks
             WHERE type_stock = 'matin'
               AND date = (
                 SELECT MAX(date) FROM stocks
                 WHERE type_stock = 'matin' AND date <= :dateDebut
               )`,
            { type: sequelize.QueryTypes.SELECT, replacements: { dateDebut } }
        );
        const stockSoirRows = await sequelize.query(
            `SELECT COALESCE(SUM(total), 0)::numeric AS total, MAX(date) AS date_utilisee
             FROM stocks
             WHERE type_stock = 'soir'
               AND date = (
                 SELECT MAX(date) FROM stocks
                 WHERE type_stock = 'soir' AND date <= :dateFin
               )`,
            { type: sequelize.QueryTypes.SELECT, replacements: { dateFin } }
        );
        const stockMatinDebut = parseFloat(stockMatinRows[0].total) || 0;
        const stockMatinDate = stockMatinRows[0].date_utilisee || null;
        const stockSoirFin = parseFloat(stockSoirRows[0].total) || 0;
        const stockSoirDate = stockSoirRows[0].date_utilisee || null;
        const variationStockBrute = stockSoirFin - stockMatinDebut;
        // Coefficient pertes decoupe (default 5%): la viande perd du
        // volume lors de la decoupe, donc on ne valorise que (100-X)%
        // de la variation brute.
        const cfgRows = await FinanceConfig.findAll();
        const cfgMap = Object.fromEntries(cfgRows.map((r) => [r.key, r.value]));
        const pertesPct = parseFloat(cfgMap.stock_pertes_decoupe_pct);
        const safePertesPct = Number.isFinite(pertesPct) && pertesPct >= 0 && pertesPct <= 100
            ? pertesPct
            : 5;
        const coeffStock = (100 - safePertesPct) / 100;
        const variationStockNette = coeffStock * variationStockBrute;

        // 7. PL final
        const pl = totalVentes
            - totalAvances
            - commission
            + margeCdc
            - chargesProratisees
            - totalPaiementsFournisseur
            + variationStockNette;

        res.json({
            success: true,
            data: {
                periode: { dateDebut, dateFin, nb_jours: nbDaysPeriod },
                total_ventes: round2(totalVentes),
                total_avances: round2(totalAvances),
                commission_maas: round2(commission),
                marge_cdc: round2(margeCdc),
                paiements_fournisseur: round2(totalPaiementsFournisseur),
                charges: {
                    total_mensuel: round2(chargesTotalMensuel),
                    ratio_jours: round2(ratio),
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
                    variation_nette: round2(variationStockNette)
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

// =====================================================
// CONFIG
// =====================================================

router.get('/config', async (req, res) => {
    try {
        const rows = await FinanceConfig.findAll();
        const config = {};
        for (const r of rows) config[r.key] = r.value;
        res.json({ success: true, data: config });
    } catch (e) {
        console.error('GET /api/finance/config:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Body: { commission_pct?, categories_eligibles?, stock_pertes_decoupe_pct? }
router.put('/config', async (req, res) => {
    try {
        const allowedKeys = ['commission_pct', 'categories_eligibles', 'stock_pertes_decoupe_pct'];
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
                await FinanceConfig.upsert({ key, value, updated_at: now });
            }
        }
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

router.delete('/depenses/:id', async (req, res) => {
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
        const [local, cdbResult] = await Promise.allSettled([
            computeCreances({
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin
            }),
            fetchCreanceCdb({
                dateDebut: req.query.dateDebut,
                dateFin: req.query.dateFin
            })
        ]);

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
