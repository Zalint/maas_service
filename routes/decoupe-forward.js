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

// Centres connus de Mata, utilisés en fallback si MATA_DECOUPE_CENTRE n'est
// pas défini. Source: config/centres-decoupe.json côté Mata.
const CENTRES_PAR_DEFAUT = ['Centre de Découpe Dakar', 'Centre de Découpe Banlieue'];

// MATA_DECOUPE_CENTRE peut contenir une liste séparée par ';' pour permettre à
// l'admin de choisir un centre par commande. La 1ère entrée sert de défaut si
// le client ne précise rien. Espaces autour du ';' ignorés.
function parseCentres() {
    const raw = process.env.MATA_DECOUPE_CENTRE;
    if (!raw) return CENTRES_PAR_DEFAUT.slice();
    const list = raw.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    return list.length > 0 ? list : CENTRES_PAR_DEFAUT.slice();
}

router.get('/centres', (req, res) => {
    res.json({ success: true, centres: parseCentres() });
});

// Expose l'URL externe du centre de découpe (sans la clé API) pour que le
// front puisse ouvrir l'app Mata dans un nouvel onglet. Si MATA_DECOUPE_BASE_URL
// est vide, retourne url=null.
router.get('/external-url', (req, res) => {
    const base = process.env.MATA_DECOUPE_BASE_URL;
    res.json({
        success: true,
        url: base ? `${base.replace(/\/$/, '')}/centre-decoupe.html` : null
    });
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

        // Payload Mata: camelCase. Mata dérive pointVente / origine /
        // partenaireMaas / creePar de la clé x-api-key — on n'envoie pas
        // ces champs (l'utilisateur Mata "Keur Bally" est associé à la clé
        // par exemple).
        const payload = {
            produits: produits.map((p) => ({
                categorie: p.categorie || p.category || '',
                produit: p.produit || p.name || '',
                prixUnit: Number(p.prixUnit != null ? p.prixUnit : p.price) || 0,
                nombre: Number(p.nombre != null ? p.nombre : p.quantity) || 0,
                montant: Number(p.montant != null ? p.montant : (p.price * p.quantity)) || 0
            })),
            pointVenteExecutant: centre,
            nomClient: nom_client || '',
            numeroClient: numero_client || '',
            adresseClient: adresse_client || '',
            instructionsClient: instructions_client || ''
        };
        if (notes) payload.notes = notes;

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

        // Mata renvoie { success, commande: {commandeRef, pointVente, ...} }
        const cmd = (data && data.commande) || {};
        const ref = cmd.commandeRef || data.commandeRef || data.commande_ref || data.ref || null;
        // Pour le journal local on garde la PV envoyée par le POS (vérité côté
        // maas), pas cmd.pointVente qui dépend du binding de la clé côté Mata
        // — souvent mal renseigné et hors de notre contrôle.
        const pointVenteResolu = point_vente || cmd.pointVente || '';
        const montantTotal = Number(cmd.montantTotal != null ? cmd.montantTotal : (montant_total || 0)) || 0;
        const username = req.session && req.session.user ? req.session.user.username : null;
        console.log(`[decoupe-forward] commande envoyée à ${centre} — ref=${ref || '?'} pour ${pointVenteResolu}`);

        // Journal local pour la tab "Mes commandes". Best-effort: si l'insert
        // échoue, la commande est quand même envoyée à Mata avec succès, on
        // log juste l'incident.
        try {
            await DecoupeOrderLog.create({
                commande_ref: ref,
                point_vente: pointVenteResolu,
                point_vente_executant: centre,
                produits: payload.produits,
                montant_total: montantTotal,
                nom_client: payload.nomClient || null,
                numero_client: payload.numeroClient || null,
                adresse_client: payload.adresseClient || null,
                instructions_client: payload.instructionsClient || null,
                cree_par: username ? `${tenant.slug || 'maas'}:${username}` : (cmd.creePar || null),
                mata_response: cmd
            });
        } catch (logErr) {
            console.error('[decoupe-forward] échec journalisation locale:', logErr.message);
        }

        // Réponse au frontend: on renvoie ref + l'objet Mata complet pour debug
        res.json({ success: true, commande_ref: ref, commande: cmd, raw: data });
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
