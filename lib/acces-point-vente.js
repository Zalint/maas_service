/**
 * Acces d'un utilisateur a un point de vente.
 *
 * `user.pointVente` prend DEUX formes, selon users.js:26 et users.js:97:
 *
 *     acces_tous_points ? 'tous' : (pointsVente?.map(pv => pv.nom) || [])
 *
 * soit la CHAINE 'tous' pour un acces global, soit un TABLEAU de noms. Une
 * comparaison directe `userPointVente !== pointVente` compare donc une chaine a
 * un tableau des que l'utilisateur est cloisonne. C'est toujours vrai: la route
 * repond 403 a tout le monde sauf aux acces globaux - y compris a un
 * utilisateur qui agit sur son PROPRE point de vente.
 *
 * Ce module existe parce que la regle etait recopiee a chaque route, et que les
 * copies ont diverge: certaines gerent le tableau, d'autres non. Une seule
 * ecriture, testee.
 *
 * Module sans dependance: testable sans base ni serveur.
 */

/**
 * @param {string|string[]} userPointVente valeur de session.user.pointVente
 * @param {string} pointVente point de vente de la ressource visee
 * @returns {boolean}
 */
function aAccesAuPointVente(userPointVente, pointVente) {
    if (userPointVente === 'tous') return true;
    if (Array.isArray(userPointVente)) {
        // 'tous' peut aussi apparaitre DANS le tableau selon la configuration.
        return userPointVente.includes('tous') || userPointVente.includes(pointVente);
    }
    return userPointVente === pointVente;
}

/**
 * L'utilisateur voit-il tous les points de vente ? Sert a distinguer
 * "peut agir sur cette ressource" de "peut la deplacer ailleurs".
 */
function aAccesGlobal(userPointVente) {
    return userPointVente === 'tous'
        || (Array.isArray(userPointVente) && userPointVente.includes('tous'));
}

module.exports = { aAccesAuPointVente, aAccesGlobal };
