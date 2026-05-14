/**
 * Routes de l'onglet Finance.
 *
 * Toutes les routes (sauf /api/external/creance qui est expose
 * separement dans server.js avec auth API key) sont gates par
 * checkAdvancedAccess (admin / superutilisateur / superviseur).
 *
 * Routes exposees:
 *   GET    /api/finance/prix
 *   PUT    /api/finance/prix
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

const {
    Depense,
    FournisseurPrix,
    FinanceConfig,
    FournisseurPaiement,
    Vente
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
// Expose la meme structure que /api/external/creance pour permettre a la
// page UI Finance d'afficher les chiffres sans cle API.
router.get('/creances', async (req, res) => {
    try {
        const { computeCreances } = require('./finance-creances');
        const data = await computeCreances({
            dateDebut: req.query.dateDebut,
            dateFin: req.query.dateFin
        });
        res.json({ success: true, data });
    } catch (e) {
        console.error('GET /api/finance/creances:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
