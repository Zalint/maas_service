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
// Renseigne quand un fichier de configuration existe mais ne se lit pas. On
// ne peut pas lever ici: le module est charge par require() au demarrage, et
// une exception empecherait le serveur entier de partir pour un fichier qui ne
// concerne que la caisse. On retient l'erreur et on la leve au point d'usage.
let erreurChargement = null;

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
            // Fichier absent: normal, tous les tenants n'ont pas leur propre
            // brand-config.json.
            if (e && e.code === 'MODULE_NOT_FOUND') continue;
            // Fichier present mais illisible (JSON malforme, droits): la table
            // serait PARTIELLE, et une table partielle est indiscernable d'un
            // point de vente sans reference. Laisse ainsi, generateCashReference
            // rendrait null, server.js sauterait l'ecriture de la ligne de
            // caisse, et la cloture reussirait sans enregistrer le cash - ce
            // silence-la a deja coute six references. On memorise donc l'erreur
            // pour la lever au point d'usage.
            console.error(`[cash-references] ${fichier} illisible:`, e && e.message);
            erreurChargement = new Error(
                `Configuration des references de caisse illisible (${fichier}): `
                + `${e && e.message}`
            );
            continue;
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
 *
 * Leve si la configuration elle-meme n'a pas pu etre lue. La distinction est
 * essentielle: l'appelant (cloture de caisse) fait `if (cashRef)` et saute
 * l'ecriture quand c'est null. Rendre null sur une configuration cassee ferait
 * donc passer la cloture SANS enregistrer le cash, en repondant 201 succes.
 * En levant, la transaction de cloture roule en arriere et l'operateur voit une
 * erreur - au lieu de decouvrir la caisse manquante des semaines plus tard.
 *
 * Un point de vente simplement absent de la table rend toujours null: c'est un
 * cas legitime, pas une panne.
 *
 * @param {string} pointVente
 * @returns {string|null}
 * @throws {Error} si un fichier de configuration existe mais n'a pas pu etre lu
 */
function generateCashReference(pointVente) {
    if (erreurChargement) throw erreurChargement;
    return CASH_REFERENCES[pointVente] || null;
}

/** Pour les tests et un eventuel controle de sante au demarrage. */
function erreurConfigReferences() {
    return erreurChargement;
}

module.exports = { CASH_REFERENCES, generateCashReference, erreurConfigReferences };
