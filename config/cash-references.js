/**
 * Reference de paiement en especes par point de vente.
 *
 * C'est la valeur ecrite dans cash_payments.payment_reference a la cloture de
 * caisse, et celle qui permet de rattacher un paiement importe a son point de
 * vente (points_vente.payment_ref -> getPaymentRefMapping).
 *
 * LA DONNEE VIT DANS brand-config.json, champ `references_caisse`, a cote de
 * nom_complet et points_vente_codes. Ce module ne fait que la lire: il n'y a
 * pas de table en dur ici. Elle etait auparavant codee dans server.js, donc
 * invisible depuis la configuration du tenant et non modifiable sans deploiement.
 *
 * Format attendu, par marque:
 *   "references_caisse": { "Mbao": "CASH_MBA", "Abattage": "CASH_ABATS" }
 *
 * Attention: plusieurs points de vente peuvent partager une reference
 * ('Abattage' et 'Depot central' partagent CASH_ABATS). Comme
 * getPaymentRefMapping indexe PAR reference (reference -> nom), une reference
 * partagee ne peut designer qu'un seul point de vente: le dernier lu gagne.
 */
const path = require('path');

// brand-config.json est charge une fois puis mis en cache par require().
// La configuration du tenant, quand elle existe, prime sur celle de la racine.
function chargerReferences() {
    const refs = {};
    const candidats = [
        path.join(__dirname, '..', 'brand-config.json')
    ];

    // TENANT_SLUG est la variable utilisee par config/tenant.js.
    const tenant = process.env.TENANT_SLUG;
    if (tenant && tenant !== 'default') {
        candidats.push(path.join(__dirname, 'tenants', String(tenant).toLowerCase(), 'brand-config.json'));
    }

    for (const fichier of candidats) {
        let config;
        try {
            config = require(fichier);
        } catch (e) {
            continue; // fichier absent: on passe au suivant
        }
        for (const marque of Object.values(config || {})) {
            Object.assign(refs, (marque && marque.references_caisse) || {});
        }
    }
    return refs;
}

const CASH_REFERENCES = chargerReferences();

/**
 * Reference de caisse d'un point de vente, ou null s'il n'en a pas.
 * @param {string} pointVente
 * @returns {string|null}
 */
function generateCashReference(pointVente) {
    return CASH_REFERENCES[pointVente] || null;
}

module.exports = { CASH_REFERENCES, generateCashReference };
