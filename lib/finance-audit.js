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
 * Strip CR/LF + caracteres de controle pour eviter le log injection.
 * Un attaquant qui passe un nom de produit type "foo\nFAKE_LOG_LINE"
 * pourrait sinon forger des lignes audit fictives.
 * @param {string} s
 * @returns {string}
 */
function sanitizeLogField(s) {
    // \x00-\x1f = ASCII control chars (inclut \n=0x0a, \r=0x0d, \t=0x09)
    // \x7f      = DEL
    return String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, '_');
}

/**
 * @param {object} req - Express request (pour extraire l'user)
 * @param {string} action - ex: 'alias.create' / 'alias.delete' / 'prix.delete'
 * @param {object} [details]
 */
function log(req, action, details) {
    const userRaw = (req && req.session && req.session.user && req.session.user.username) || 'anonymous';
    const ts = new Date().toISOString();
    let detailsStr;
    try {
        detailsStr = JSON.stringify(details || {});
    } catch (e) {
        // JSON.stringify(...) au lieu d'une concatenation manuelle qui
        // casserait sur e.message contenant guillemets ou control chars.
        detailsStr = JSON.stringify({ _serialize_error: e.message });
    }
    // Sanitize tous les champs ecrits sur stdout (defense en profondeur).
    const safeUser = sanitizeLogField(userRaw);
    const safeAction = sanitizeLogField(action);
    const safeDetails = sanitizeLogField(detailsStr);
    console.log('[finance-audit] ts=%s user=%s action=%s details=%s',
        ts, safeUser, safeAction, safeDetails);
}

module.exports = { log, sanitizeLogField };
