/**
 * Prix d'achat vus par Simulation 2.0.
 *
 * DELEGUE entierement a lib/prix-achat-date.js et n'ajoute qu'une COUCHE DE
 * REPLI. Le module de base n'est pas touche, donc le PL, Cash et Stock, la
 * marge du Centre de Decoupe et l'API parage ne bougent pas d'un franc.
 *
 * Le repli sert un cas mesure: 'Poulet en detail' et 'Poulet en gros' n'ont
 * AUCUN prix d'achat aujourd'hui. La resolution du module de base se fait par
 * egalite stricte du nom normalise, et son seul repli de famille est la regex
 * bovine /^(boeuf|veau)/. La ligne du catalogue s'appelle 'Poulet', donc elle
 * ne correspond a rien. Consequence: ni marge, ni levier volume, ni prix
 * d'equilibre sur le poulet - 469 500 F de ventes sans cout connu sur juillet
 * 2026, soit 64 % de tout ce qui n'a pas de cout ce mois-la.
 *
 * La famille est une LISTE EXPLICITE, editee en administration, et non un
 * motif sur le mot "poulet". Deux produits reels seraient avales a tort:
 *   - 'Cuisse de poulet' porte son propre prix d'achat (1 800 F, hors Mata),
 *   - 'Merguez poulet' est un produit de vente sans rapport avec la carcasse.
 *
 * ORDRE DE RESOLUTION, et il compte:
 *   1. le module de base, qui applique d'abord la famille bovine puis
 *      l'egalite stricte;
 *   2. si et seulement s'il rend null ET que le produit est dans la famille
 *      poulet: le prix de la ligne 'Poulet' du catalogue;
 *   3. a defaut, le repli configurable (3 000 F par defaut).
 *
 * Le repli ne s'applique donc JAMAIS a un produit qui a deja un cout connu:
 * le jour ou un admin renseignera un prix d'achat propre a 'Poulet en gros',
 * il gagnera d'office sur la famille.
 */

const { normaliserNom } = require('./parage');

/** Le produit dont la famille poulet herite le cout. */
const SOURCE_POULET = 'Poulet';

/**
 * @param {Object} args
 * @param {string} args.dateMax        borne haute des dates qui seront demandees
 * @param {Object} args.reglages       { famillePoulet: string[], prixPouletDefaut: number }
 * @returns {Promise<{pourDate: Function, avertissements: string[]}>}
 */
async function creerResolveurPrixAchatSimulation({ dateMax, reglages }) {
    const { creerResolveurPrixAchat } = require('./prix-achat-date');
    const base = await creerResolveurPrixAchat(dateMax);
    const avertissements = base.avertissements.slice();

    const famille = new Set(
        ((reglages && reglages.famillePoulet) || []).map((n) => normaliserNom(n))
    );
    const repli = Number((reglages && reglages.prixPouletDefaut) || 0);

    // Un seul avertissement, pas un par journee de la periode.
    let repliSignale = false;

    const pourDate = (dateIso) => {
        const r = base.pourDate(dateIso);

        // Le cout de reference de la famille, resolu a la MEME date que le
        // reste: lire le catalogue courant ici ferait diverger la famille du
        // module de base des qu'un prix change en cours de periode.
        const brutPoulet = parseFloat(r.prixAchat(SOURCE_POULET));
        const prixPoulet = Number.isFinite(brutPoulet) && brutPoulet > 0 ? brutPoulet : null;

        const prixAchat = (produit) => {
            const propre = parseFloat(r.prixAchat(produit));
            if (Number.isFinite(propre) && propre > 0) return propre;
            if (!famille.has(normaliserNom(produit))) return null;
            if (prixPoulet !== null) return prixPoulet;
            if (repli > 0) {
                if (!repliSignale) {
                    repliSignale = true;
                    avertissements.push(
                        `La ligne « ${SOURCE_POULET} » du catalogue ne porte aucun prix d'achat : `
                        + `le repli de ${repli} F est utilisé pour la famille poulet.`
                    );
                }
                return repli;
            }
            return null;
        };

        /**
         * D'ou vient le cout d'un produit. Sert au mode debug: un chiffre dont
         * on ne peut pas nommer la source ne se verifie pas.
         * @returns {'propre'|'famille_poulet'|'repli_poulet'|null}
         */
        const origine = (produit) => {
            const propre = parseFloat(r.prixAchat(produit));
            if (Number.isFinite(propre) && propre > 0) return 'propre';
            if (!famille.has(normaliserNom(produit))) return null;
            if (prixPoulet !== null) return 'famille_poulet';
            return repli > 0 ? 'repli_poulet' : null;
        };

        return { prixAchat, origine, prixAchatDefaut: r.prixAchatDefaut, origineBoeuf: r.origineBoeuf };
    };

    return { pourDate, avertissements };
}

module.exports = { creerResolveurPrixAchatSimulation, SOURCE_POULET };
