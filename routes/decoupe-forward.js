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
const { sequelize } = require('../db');
const { DecoupeOrderLog } = require('../db/models');

// Centres connus de Mata, utilisés en fallback si MATA_DECOUPE_CENTRE n'est
// pas défini. Source: config/centres-decoupe.json côté Mata.
const CENTRES_PAR_DEFAUT = ['Centre de Découpe Dakar', 'Centre de Découpe Banlieue'];

// Timezone à utiliser pour les agrégats journaliers. Sans ça, Postgres retombe
// sur la TZ du serveur (souvent UTC sur Render) → décalage d'un jour aux
// frontières pour les tenants sénégalais qui ont saisi près de minuit local.
// Override via env TENANT_TZ si un tenant est dans une autre TZ.
const TENANT_TZ = process.env.TENANT_TZ || 'Africa/Dakar';

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

// Somme des commandes de découpe envoyées un jour donné, agrégée par
// point_vente. Format de retour: { "Mbao": 11700, "Sacre Coeur": 4500 }.
// Utilisée par l'écran Réconciliation pour afficher les commandes inter-PV
// à côté des ventes saisies.
// Total des commandes découpe sur une plage de dates, optionnellement
// filtrée par point_vente. Utilisé par l'écran Visualisation pour afficher
// le total des commandes découpe en parallèle des ventes saisies.
router.get('/sum-range', async (req, res) => {
    try {
        const dateDebut = req.query.dateDebut;
        const dateFin = req.query.dateFin || dateDebut;
        const pointVente = req.query.pointVente && req.query.pointVente !== 'tous' ? req.query.pointVente : null;
        if (!dateDebut || !/^\d{4}-\d{2}-\d{2}$/.test(dateDebut)) {
            return res.status(400).json({ success: false, error: 'dateDebut YYYY-MM-DD requis.' });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFin)) {
            return res.status(400).json({ success: false, error: 'dateFin YYYY-MM-DD invalide.' });
        }
        const replacements = { d1: dateDebut, d2: dateFin, tz: TENANT_TZ };
        let where = `DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz) >= :d1 AND DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz) <= :d2`;
        // Si un PV est demandé et qu'il s'agit du tenant, on accepte aussi
        // les lignes legacy avec point_vente = nom de centre (rétro-compat
        // avec le bug d'avant le fix).
        const tenantPV = tenant.name || tenant.slug || '';
        const isTenantPV = pointVente && (pointVente === tenantPV);
        if (pointVente && !isTenantPV) {
            where += ` AND point_vente = :pv`;
            replacements.pv = pointVente;
        } else if (isTenantPV) {
            // tenant PV: inclure point_vente=tenantPV OU centres connus
            const centresList = parseCentres();
            const placeholders = centresList.map((_, i) => `:c${i}`).join(',');
            centresList.forEach((c, i) => { replacements[`c${i}`] = c; });
            where += ` AND (point_vente = :tpv${centresList.length ? ` OR point_vente IN (${placeholders})` : ''})`;
            replacements.tpv = tenantPV;
        }
        const rows = await sequelize.query(
            `SELECT COALESCE(SUM(montant_total), 0) AS total FROM decoupe_order_logs WHERE ${where}`,
            { replacements, type: sequelize.QueryTypes.SELECT }
        );
        const total = rows && rows[0] ? Number(rows[0].total) || 0 : 0;
        console.log(`[sum-range] ${dateDebut}→${dateFin} pv=${pointVente || 'tous'} → ${total}`);
        res.json({ success: true, total });
    } catch (error) {
        console.error('[decoupe-forward] /sum-range error', error);
        res.status(500).json({ success: false, error: error.message, total: 0 });
    }
});

router.get('/sum-by-pv', async (req, res) => {
    try {
        const dateStr = req.query.date; // YYYY-MM-DD
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return res.status(400).json({ success: false, error: 'Paramètre date YYYY-MM-DD requis.' });
        }
        const rows = await sequelize.query(
            `SELECT point_vente, point_vente_executant, COALESCE(SUM(montant_total), 0) AS total
             FROM decoupe_order_logs
             WHERE DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE :tz) = :d
             GROUP BY point_vente, point_vente_executant`,
            { replacements: { d: dateStr, tz: TENANT_TZ }, type: sequelize.QueryTypes.SELECT }
        );

        // La DB est schema-per-tenant: TOUTES les lignes appartiennent à ce
        // tenant. Si point_vente est vide OU matche un nom de centre (bug
        // historique avant le fix de pointVenteSelect), on les ré-attribue
        // au tenant. Sinon on garde la valeur stockée.
        const centresConnus = new Set(parseCentres());
        const tenantPV = tenant.name || tenant.slug || 'Inconnu';
        const sums = {};
        for (const r of rows) {
            const pvBrut = r.point_vente || '';
            const pv = (!pvBrut || centresConnus.has(pvBrut)) ? tenantPV : pvBrut;
            sums[pv] = (sums[pv] || 0) + (Number(r.total) || 0);
        }
        console.log(`[sum-by-pv] date=${dateStr} → sums=${JSON.stringify(sums)} (rows=${rows.length})`);
        res.json({ success: true, date: dateStr, sums });
    } catch (error) {
        console.error('[decoupe-forward] /sum-by-pv error', error);
        res.status(500).json({ success: false, error: error.message, sums: {} });
    }
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
            produits: produits.map((p) => {
                // Normaliser d'abord prixUnit / nombre, puis recalculer montant
                // à partir de ces valeurs si l'appelant ne l'a pas fourni.
                // L'ancien fallback p.price * p.quantity tombait en NaN→0
                // pour les payloads en français (prixUnit/nombre).
                const prixUnit = Number(p.prixUnit != null ? p.prixUnit : p.price) || 0;
                const nombre = Number(p.nombre != null ? p.nombre : p.quantity) || 0;
                const montant = Number(p.montant != null ? p.montant : (prixUnit * nombre)) || 0;
                return {
                    categorie: p.categorie || p.category || '',
                    produit: p.produit || p.name || '',
                    prixUnit,
                    nombre,
                    montant
                };
            }),
            pointVenteExecutant: centre,
            nomClient: nom_client || '',
            numeroClient: numero_client || '',
            adresseClient: adresse_client || '',
            instructionsClient: instructions_client || ''
        };
        if (notes) payload.notes = notes;

        const url = `${baseUrl.replace(/\/$/, '')}/api/commandes-decoupe/external`;
        // Timeout dur sur l'appel Mata pour ne pas bloquer une requête POS si
        // l'API distante traîne. 10s est suffisant pour un upstream sain;
        // au-delà on renvoie 504 Gateway Timeout au client.
        const TIMEOUT_MS = Number(process.env.MATA_DECOUPE_TIMEOUT_MS) || 10000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let upstream;
        try {
            upstream = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            if (fetchErr && fetchErr.name === 'AbortError') {
                console.error(`[decoupe-forward] timeout après ${TIMEOUT_MS}ms vers ${url}`);
                return res.status(504).json({
                    success: false,
                    error: `Le centre de découpe Mata n'a pas répondu en moins de ${TIMEOUT_MS}ms.`
                });
            }
            console.error('[decoupe-forward] erreur réseau vers Mata:', fetchErr);
            return res.status(502).json({
                success: false,
                error: 'Erreur réseau lors de l\'appel au centre de découpe Mata.'
            });
        }
        clearTimeout(timeoutId);

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
        // Filet de sécurité: si la PV envoyée est vide OU correspond à un
        // centre (bug historique observé), on retombe sur le nom du tenant.
        const centresConnusSet = new Set(centresAutorises);
        let pointVenteResolu = point_vente || cmd.pointVente || '';
        if (!pointVenteResolu || centresConnusSet.has(pointVenteResolu)) {
            pointVenteResolu = tenant.name || tenant.slug || 'Inconnu';
        }
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
        // Clamp dur: parseInt accepte les négatifs, et `||` garde -5 puisque
        // c'est truthy → on passerait limit=-5 à Sequelize. On force entre 1 et 500.
        const parsed = parseInt(req.query.limit, 10);
        const limit = Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 100, 500));
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
