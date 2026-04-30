/**
 * Forwarder vers le centre de découpe Mata.
 *
 * Le maas-app ne stocke pas les commandes de découpe localement — elles
 * vivent côté Mata dans la table `commandes_decoupe`. Cette route reçoit
 * un payload depuis le POS local, l'enrichit (origine, partenaire_maas,
 * centre exécutant), puis fait un POST authentifié sur Mata via
 * `x-api-key`.
 *
 * Configuration (env vars):
 *  - MATA_DECOUPE_BASE_URL: e.g. https://mata.example.com
 *  - MATA_DECOUPE_API_KEY:  clé partagée fournie par l'équipe Mata
 *  - MATA_DECOUPE_CENTRE:   nom du centre exécutant pour ce tenant
 *                           (ex: "Centre de Découpe Banlieue")
 *
 * Si MATA_DECOUPE_API_KEY n'est pas définie, l'endpoint retourne 503 avec
 * un message clair plutôt que de partir avec une clé vide.
 */

const express = require('express');
const router = express.Router();
const tenant = require('../config/tenant');
const { DecoupeOrderLog } = require('../db/models');

// MATA_DECOUPE_CENTRE peut contenir une liste séparée par ';' pour permettre à
// l'admin de choisir un centre par commande. La 1ère entrée sert de défaut si
// le client ne précise rien. Espaces autour du ';' ignorés.
function parseCentres() {
    const raw = process.env.MATA_DECOUPE_CENTRE || 'Centre de découpe';
    return raw.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
}

router.get('/centres', (req, res) => {
    res.json({ success: true, centres: parseCentres() });
});

router.post('/send', async (req, res) => {
    try {
        const baseUrl = process.env.MATA_DECOUPE_BASE_URL;
        const apiKey = process.env.MATA_DECOUPE_API_KEY;
        const centresAutorises = parseCentres();
        const centreParDefaut = centresAutorises[0] || 'Centre de découpe';

        if (!baseUrl || !apiKey) {
            return res.status(503).json({
                success: false,
                error: 'Intégration centre de découpe non configurée (MATA_DECOUPE_BASE_URL / MATA_DECOUPE_API_KEY manquantes).'
            });
        }

        const {
            point_vente,
            produits,
            montant_total,
            nom_client,
            numero_client,
            adresse_client,
            instructions_client,
            notes,
            point_vente_executant: centreSouhaite
        } = req.body || {};

        // Valider le centre choisi: doit être dans la liste configurée pour
        // éviter qu'un client envoie n'importe quoi à Mata.
        let centre = centreParDefaut;
        if (centreSouhaite) {
            if (!centresAutorises.includes(centreSouhaite)) {
                return res.status(400).json({
                    success: false,
                    error: `Centre "${centreSouhaite}" non autorisé. Valeurs acceptées: ${centresAutorises.join(', ')}`
                });
            }
            centre = centreSouhaite;
        }

        if (!Array.isArray(produits) || produits.length === 0) {
            return res.status(400).json({ success: false, error: 'Liste de produits vide.' });
        }
        if (!point_vente) {
            return res.status(400).json({ success: false, error: 'point_vente requis.' });
        }

        const username = req.session && req.session.user ? req.session.user.username : 'maas';

        const payload = {
            point_vente,
            point_vente_executant: centre,
            origine: 'MaaS',
            partenaire_maas: tenant.name || tenant.slug || 'MaaS',
            produits: produits.map((p) => ({
                categorie: p.categorie || p.category || '',
                produit: p.produit || p.name || '',
                prixUnit: Number(p.prixUnit != null ? p.prixUnit : p.price) || 0,
                nombre: Number(p.nombre != null ? p.nombre : p.quantity) || 0,
                montant: Number(p.montant != null ? p.montant : (p.price * p.quantity)) || 0
            })),
            montant_total: Number(montant_total) || 0,
            nom_client: nom_client || '',
            numero_client: numero_client || '',
            adresse_client: adresse_client || '',
            instructions_client: instructions_client || '',
            cree_par: `${tenant.slug || 'maas'}:${username}`,
            notes: notes || ''
        };

        const url = `${baseUrl.replace(/\/$/, '')}/api/commandes-decoupe/external`;
        const upstream = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify(payload)
        });

        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
            console.error('[decoupe-forward] upstream error', upstream.status, data);
            return res.status(upstream.status).json({
                success: false,
                error: data.error || data.message || `Mata a renvoyé HTTP ${upstream.status}.`
            });
        }

        const ref = data.commande_ref || data.ref || (data.data && data.data.commande_ref) || null;
        console.log(`[decoupe-forward] commande envoyée à ${centre} — ref=${ref || '?'} pour ${point_vente}`);

        // Journal local pour la tab "Mes commandes". Best-effort: si l'insert
        // échoue, la commande est quand même envoyée à Mata avec succès, on
        // log juste l'incident.
        try {
            await DecoupeOrderLog.create({
                commande_ref: ref,
                point_vente,
                point_vente_executant: centre,
                produits: payload.produits,
                montant_total: payload.montant_total,
                nom_client: payload.nom_client || null,
                numero_client: payload.numero_client || null,
                adresse_client: payload.adresse_client || null,
                instructions_client: payload.instructions_client || null,
                cree_par: payload.cree_par
            });
        } catch (logErr) {
            console.error('[decoupe-forward] échec journalisation locale:', logErr.message);
        }

        res.json({ success: true, ...data, commande_ref: ref });
    } catch (error) {
        console.error('[decoupe-forward] error', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/decoupe/mine
 * Liste les commandes envoyées par ce tenant. Pas de filtrage par utilisateur,
 * juste par tenant (la table est déjà scopée par schéma Postgres en multi-tenant).
 * Retourne les 100 dernières par défaut.
 */
router.get('/mine', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const rows = await DecoupeOrderLog.findAll({
            order: [['created_at', 'DESC']],
            limit
        });
        res.json({ success: true, commandes: rows });
    } catch (error) {
        console.error('[decoupe-forward] /mine error', error);
        res.status(500).json({ success: false, error: error.message, commandes: [] });
    }
});

module.exports = router;
