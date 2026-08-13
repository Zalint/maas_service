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

// Le produit dont la famille BOEUF herite le cout. Meme mecanique que la
// famille poulet, et pour le meme constat: le Jarret n'a pas de prix d'achat
// propre, mais il vient de la meme carcasse. Sans lui son cout etait NUL, donc
// sa marge egale a son prix de vente - le produit le plus rentable de l'ecran.
//
// La regle veau -> boeuf, elle, reste codee dans lib/prix-achat-date.js: c'est
// une identite d'espece, pas un reglage de tenant.
const SOURCE_BOEUF = 'Boeuf';

/**
 * @param {Object} args
 * @param {string} args.dateMax        borne haute des dates qui seront demandees
 * @param {Object} args.reglages       { famillePoulet: string[], prixPouletDefaut: number }
 * @returns {Promise<{pourDate: Function, avertissements: string[]}>}
 */
async function creerResolveurPrixAchatSimulation({ dateMax, reglages }) {
    const { creerResolveurPrixAchat } = require('./prix-achat-date');
    const base = await creerResolveurPrixAchat(dateMax);

    // On REUTILISE le tableau du module de base, on ne le copie pas.
    //
    // Une copie perdait tout ce qu'il pousse APRES sa creation: le module de
    // base emet une partie de ses avertissements depuis pourDate, donc pendant
    // la resolution, pas au chargement. Celui qui compte le plus etait dans ce
    // cas: "DATA n'a renvoye aucun lot pour au moins une journee, le prix du
    // catalogue y a ete utilise". L'ecran affirmait alors un cout du boeuf
    // sans dire qu'il venait d'un repli.
    const avertissements = base.avertissements;

    const famille = new Set(
        ((reglages && reglages.famillePoulet) || []).map((n) => normaliserNom(n))
    );
    const familleBoeuf = new Set(
        ((reglages && reglages.familleBoeuf) || []).map((n) => normaliserNom(n))
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
        // Resolu a la MEME date que le reste, pour la meme raison: lire le
        // catalogue courant ici ferait diverger la famille du module de base
        // des que le prix du boeuf change en cours de periode - et il change,
        // de 3 735 a 4 435 F sur juillet.
        const brutBoeuf = parseFloat(r.prixAchat(SOURCE_BOEUF));
        const prixBoeuf = Number.isFinite(brutBoeuf) && brutBoeuf > 0 ? brutBoeuf : null;

        const prixAchat = (produit) => {
            const propre = parseFloat(r.prixAchat(produit));
            if (Number.isFinite(propre) && propre > 0) return propre;
            // La famille BOEUF passe avant la poulet: un produit range par
            // erreur dans les deux prendrait sinon le cout de la volaille sans
            // que rien ne le dise.
            if (familleBoeuf.has(normaliserNom(produit))) return prixBoeuf;
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
            if (familleBoeuf.has(normaliserNom(produit))) {
                return prixBoeuf !== null ? 'famille_boeuf' : null;
            }
            if (!famille.has(normaliserNom(produit))) return null;
            if (prixPoulet !== null) return 'famille_poulet';
            return repli > 0 ? 'repli_poulet' : null;
        };

        return { prixAchat, origine, prixAchatDefaut: r.prixAchatDefaut, origineBoeuf: r.origineBoeuf };
    };

    // resumePrixBoeuf vient du resolveur de base et doit etre RELAYE: sans
    // lui, l'ecran de simulation perdrait le prix retenu que le PL affiche.
    return {
        pourDate, avertissements,
        resumePrixBoeuf: base.resumePrixBoeuf,
        statsPrixBoeuf: base.statsPrixBoeuf
    };
}

module.exports = { creerResolveurPrixAchatSimulation, SOURCE_POULET };
