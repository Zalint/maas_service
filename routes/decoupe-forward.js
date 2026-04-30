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

router.post('/send', async (req, res) => {
    try {
        const baseUrl = process.env.MATA_DECOUPE_BASE_URL;
        const apiKey = process.env.MATA_DECOUPE_API_KEY;
        const centre = process.env.MATA_DECOUPE_CENTRE || 'Centre de découpe';

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
            notes
        } = req.body || {};

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

        console.log(`[decoupe-forward] commande envoyée à ${centre} — ref=${data.commande_ref || data.ref || '?'} pour ${point_vente}`);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('[decoupe-forward] error', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
