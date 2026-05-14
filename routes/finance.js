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
 *   GET    /api/finance/alias                  (mapping vente -> catalog)
 *   PUT    /api/finance/alias                  (upsert)
 *   DELETE /api/finance/alias/:alias
 *   POST   /api/finance/alias/bulk-from-prefix (snap tous les prefix en aliases)
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
    Produit,
    Vente,
    sequelize
} = require('../db/models');
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
// Upsert ligne par ligne (preserve les autres entrees).
router.put('/prix', async (req, res) => {
    try {
        const items = Array.isArray(req.body?.items) ? req.body.items : null;
        if (!items) {
            return res.status(400).json({ success: false, error: 'items: array requis' });
        }
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
            await FournisseurPrix.upsert({
                produit,
                prix_vente: prixVente,
                prix_achat: prixAchat,
                updated_at: now
            });
        }
        const rows = await FournisseurPrix.findAll({ order: [['produit', 'ASC']] });
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('PUT /api/finance/prix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Supprime une ligne du catalogue (par produit, PK).
router.delete('/prix/:produit', async (req, res) => {
    try {
        const produit = String(req.params.produit || '').trim();
        if (!produit) {
            return res.status(400).json({ success: false, error: 'produit requis' });
        }
        const n = await FournisseurPrix.destroy({ where: { produit } });
        if (n === 0) {
            return res.status(404).json({ success: false, error: 'Produit introuvable' });
        }
        res.json({ success: true });
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
        const [catalog, aliases] = await Promise.all([
            FournisseurPrix.findAll({ order: [['produit', 'ASC']] }),
            ProduitAlias.findAll({ order: [['alias_produit', 'ASC']] })
        ]);

        // Liste des produits inventaire "boucherie" (filtre par regex sur
        // le nom car la BDD locale n'utilise pas les categories Bovin/Ovin/
        // Caprin/Volaille pour l'inventaire). On INCLUT les "parents" et
        // les variants "sur pieds" (Boeuf sur pieds, Chevre sur pieds,
        // Mouton sur pieds sont conserves). On EXCLUT seulement les
        // variants de presentation en gros / en detail qui seront mappes
        // via produit_alias vers leur parent. CORNE BOEUF GM exclu car
        // ce n'est pas un produit boucherie principal.
        const invRows = await Produit.findAll({
            where: {
                type_catalogue: 'inventaire',
                [Op.and]: [
                    sequelize.where(
                        sequelize.fn('LOWER', sequelize.col('nom')),
                        { [Op.regexp]: '(boeuf|veau|agneau|mouton|chevre|chèvre|poulet|foie|abats|yell|sans os|mergez|merguez|tete|tête|laxass|jarret|peaux?)' }
                    ),
                    sequelize.where(
                        sequelize.fn('LOWER', sequelize.col('nom')),
                        { [Op.notRegexp]: '(en gros|en détail|en detail|en dEtail|corne)' }
                    )
                ]
            },
            attributes: ['nom'],
            order: [['nom', 'ASC']]
        });

        // Le dropdown UI = union(inventaire boucherie, catalogue fournisseur_prix)
        // pour permettre a l'admin d'ajouter manuellement un produit via
        // l'onglet "Prix fournisseur" et le voir apparaitre ici aussi.
        const set = new Set();
        invRows.forEach((p) => set.add(p.nom));
        catalog.forEach((p) => set.add(p.produit));
        const dropdown = Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
        const inventory = invRows.map((p) => ({ nom: p.nom }));

        // Distincts produits saisis dans ventes sur les ~90 derniers jours
        // (limiter la fenetre evite de tirer 10 ans d'historique inutile).
        // Vente.date est stocke en texte YYYY-MM-DD donc on filtre en chaine.
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 90);
        const sinceISO = since.toISOString().slice(0, 10);

        const distinctRows = await sequelize.query(
            `SELECT produit, COUNT(*)::int AS n
             FROM ventes
             WHERE date >= :since
             GROUP BY produit
             ORDER BY n DESC, produit ASC`,
            { type: sequelize.QueryTypes.SELECT, replacements: { since: sinceISO } }
        );

        // Construire la table de resolution (la meme logique que lookupPrix
        // cote computeCreances, pour que l'UI affiche le statut reel).
        const catalogKeys = new Set(catalog.map((p) => p.produit.toLowerCase()));
        const aliasMap = new Map(aliases.map((a) => [a.alias_produit.toLowerCase(), a.produit_catalog]));

        const items = distinctRows.map((r) => {
            const lower = (r.produit || '').toLowerCase();
            // 1. Exact
            if (catalogKeys.has(lower)) {
                return { produit: r.produit, count: r.n, statut: 'exact', resolved: r.produit };
            }
            // 2. Alias
            if (aliasMap.has(lower)) {
                return { produit: r.produit, count: r.n, statut: 'alias', resolved: aliasMap.get(lower) };
            }
            // 3. Prefix fallback (deprecated mais encore actif cote calcul)
            for (const cat of catalog) {
                if (lower.startsWith(cat.produit.toLowerCase())) {
                    return { produit: r.produit, count: r.n, statut: 'prefix', resolved: cat.produit };
                }
            }
            // 4. Aucune resolution
            return { produit: r.produit, count: r.n, statut: 'unmapped', resolved: null };
        });

        res.json({
            success: true,
            data: {
                catalog: catalog.map((p) => p.produit),  // entrees fournisseur_prix existantes
                inventory,                                // produits inventaire boucherie (filtre regex)
                dropdown,                                 // union triee inventaire ∪ catalogue (= source du <select> UI)
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
        const cat = await FournisseurPrix.findByPk(produitCatalog);
        let created = false;
        if (!cat) {
            await FournisseurPrix.create({
                produit: produitCatalog,
                prix_vente: 0,
                prix_achat: null,
                updated_at: new Date()
            });
            created = true;
        }
        await ProduitAlias.upsert({
            alias_produit: aliasProduit,
            produit_catalog: produitCatalog,
            updated_at: new Date()
        });
        res.json({ success: true, catalog_created: created });
    } catch (e) {
        console.error('PUT /api/finance/alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Supprime un alias (laisse retomber sur fallback prefix ou unmapped).
router.delete('/alias/:alias', async (req, res) => {
    try {
        const alias = String(req.params.alias || '').trim();
        if (!alias) {
            return res.status(400).json({ success: false, error: 'alias requis' });
        }
        const n = await ProduitAlias.destroy({ where: { alias_produit: alias } });
        if (n === 0) {
            return res.status(404).json({ success: false, error: 'Alias introuvable' });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('DELETE /api/finance/alias/:alias:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Bulk: convertit tous les "prefix" actuellement actifs en aliases
// explicites en figeant la resolution courante. Utile pour migrer d'un
// coup l'historique sans cliquer ligne par ligne.
router.post('/alias/bulk-from-prefix', async (req, res) => {
    try {
        const [catalog, aliases] = await Promise.all([
            FournisseurPrix.findAll(),
            ProduitAlias.findAll()
        ]);
        const catalogKeys = new Set(catalog.map((p) => p.produit.toLowerCase()));
        const aliasSet = new Set(aliases.map((a) => a.alias_produit.toLowerCase()));

        // Fenetre 90 jours pour cibler les produits "vivants".
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 90);
        const sinceISO = since.toISOString().slice(0, 10);

        const distinctRows = await sequelize.query(
            `SELECT DISTINCT produit FROM ventes WHERE date >= :since`,
            { type: sequelize.QueryTypes.SELECT, replacements: { since: sinceISO } }
        );

        const now = new Date();
        const created = [];
        for (const r of distinctRows) {
            const lower = (r.produit || '').toLowerCase();
            if (catalogKeys.has(lower)) continue;   // exact match — pas besoin d'alias
            if (aliasSet.has(lower)) continue;       // alias deja defini
            // Cherche un match prefix
            const cat = catalog.find((c) => lower.startsWith(c.produit.toLowerCase()));
            if (!cat) continue;
            await ProduitAlias.upsert({
                alias_produit: r.produit,
                produit_catalog: cat.produit,
                updated_at: now
            });
            created.push({ alias_produit: r.produit, produit_catalog: cat.produit });
        }
        res.json({ success: true, created });
    } catch (e) {
        console.error('POST /api/finance/alias/bulk-from-prefix:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

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

// Body: { commission_pct?, categories_eligibles? }
router.put('/config', async (req, res) => {
    try {
        const allowedKeys = ['commission_pct', 'categories_eligibles'];
        const now = new Date();
        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                const value = String(req.body[key]);
                if (key === 'commission_pct' && !(parseFloat(value) >= 0 && parseFloat(value) <= 100)) {
                    return res.status(400).json({
                        success: false,
                        error: 'commission_pct doit etre entre 0 et 100'
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
