/**
 * Helpers purs pour le forwarder découpe — séparés de routes/decoupe-forward.js
 * pour pouvoir être unit-testés sans pull-in du module Sequelize.
 */

// Centres connus de Mata, utilisés en fallback si MATA_DECOUPE_CENTRE n'est
// pas défini. Source: config/centres-decoupe.json côté Mata.
const CENTRES_PAR_DEFAUT = ['Centre de Découpe Dakar', 'Centre de Découpe Banlieue'];

/**
 * Parse la variable d'env MATA_DECOUPE_CENTRE.
 * - Liste séparée par ';', espaces ignorés autour des entrées.
 * - Vide / absent → fallback sur les 2 centres par défaut.
 * - Ne mute pas l'env, lit à chaque appel pour permettre les overrides en test.
 */
function parseCentres() {
    const raw = process.env.MATA_DECOUPE_CENTRE;
    if (!raw) return CENTRES_PAR_DEFAUT.slice();
    const list = raw.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    return list.length > 0 ? list : CENTRES_PAR_DEFAUT.slice();
}

/**
 * Normalise un produit du payload POS vers le format attendu par Mata.
 * - Accepte les clés EN (price/quantity/category/name) et FR
 *   (prixUnit/nombre/categorie/produit).
 * - Recalcule `montant` à partir de prixUnit*nombre normalisés si manquant
 *   (corrige le bug du fallback p.price * p.quantity qui retournait NaN
 *    pour les payloads en français).
 */
function normalizeProduit(p) {
    if (!p || typeof p !== 'object') {
        return { categorie: '', produit: '', prixUnit: 0, nombre: 0, montant: 0 };
    }
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
}

/**
 * Clamp dur du paramètre limit pour /mine.
 * parseInt accepte les négatifs ("-5"→-5), et `|| 100` garde -5 puisque c'est
 * truthy. On force la valeur dans [1, maxLimit] avec defaultLimit pour NaN.
 */
function clampLimit(raw, defaultLimit = 100, maxLimit = 500) {
    const parsed = parseInt(raw, 10);
    const value = Number.isFinite(parsed) ? parsed : defaultLimit;
    return Math.max(1, Math.min(value, maxLimit));
}

/**
 * Ré-attribue la PV d'une ligne legacy: si la valeur stockée est vide ou
 * correspond à un nom de centre (bug d'avant le fix de pointVenteSelect),
 * retombe sur le nom du tenant. Sinon garde la valeur.
 */
function resoudrePV(pvBrut, centresAutorises, tenantPV) {
    const centres = centresAutorises instanceof Set
        ? centresAutorises
        : new Set(centresAutorises || []);
    const pvNormalized = typeof pvBrut === 'string' ? pvBrut.trim() : '';
    if (!pvNormalized || centres.has(pvNormalized)) {
        return tenantPV || 'Inconnu';
    }
    return pvNormalized;
}

module.exports = {
    CENTRES_PAR_DEFAUT,
    parseCentres,
    normalizeProduit,
    clampLimit,
    resoudrePV
};
