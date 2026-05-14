/**
 * Audit log pour les mutations Finance (catalogue prix, aliases,
 * paiements, dépenses).
 *
 * Écrit une ligne JSON structurée sur stdout — collectée par Render
 * Logs / une éventuelle stack ELK plus tard. Pas de table BDD dédiée
 * pour l'instant (KISS) ; si besoin de requêtes a posteriori, on
 * pourra ajouter un modèle FinanceAuditLog ultérieurement sans casser
 * cette API.
 *
 * Format ligne :
 *   [finance-audit] ts=... user=... action=... target=... details=...
 *
 * Usage :
 *   const audit = require('../lib/finance-audit');
 *   audit.log(req, 'alias.create', { alias_produit: 'x', produit_catalog: 'y' });
 */

'use strict';

/**
 * @param {object} req - Express request (pour extraire l'user)
 * @param {string} action - ex: 'alias.create' / 'alias.delete' / 'prix.delete'
 * @param {object} [details]
 */
function log(req, action, details) {
    const user = (req && req.session && req.session.user && req.session.user.username) || 'anonymous';
    const ts = new Date().toISOString();
    // Sérialiser en JSON pour collecte facile par log aggregator.
    let detailsStr = '';
    try {
        detailsStr = JSON.stringify(details || {});
    } catch (e) {
        detailsStr = '{"_serialize_error":"' + e.message + '"}';
    }
    console.log('[finance-audit] ts=%s user=%s action=%s details=%s',
        ts, user, action, detailsStr);
}

module.exports = { log };
