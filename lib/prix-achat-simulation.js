/**
 * Prix d'achat vus par Simulation 2.0.
 *
 * DELEGUE entierement a lib/prix-achat-date.js. Ce module n'ajoute plus qu'une
 * chose: il NOMME les produits dont le cout reste inconnu.
 *
 * IL PORTAIT DEUX FAMILLES, elles ont disparu. « famille_poulet » et
 * « famille_boeuf » disaient quels libelles de vente prennent le cout de
 * quelle carcasse - exactement ce que l'ecran « Mapping produits » regle deja
 * pour la commission, avec sa colonne « Mappe vers ». Le depot portait donc la
 * MEME notion a deux endroits, avec deux regles differentes: une liste
 * explicite ici, une resolution exact/alias/prefixe la-bas.
 *
 * La resolution vit desormais dans lib/prix-achat-date.js, qui lit le mapping:
 *
 *   1. le prix PROPRE du produit, s'il en a un au catalogue. Foie et Yell sont
 *      achetes separement de la carcasse: leur ligne est la verite, et aucun
 *      mapping ne doit la couvrir;
 *   2. sinon le mapping: « Mappe vers » x coefficient. Le coefficient est une
 *      CONVERSION D'UNITE, pas une imputation - la carcasse est achetee une
 *      seule fois, sous « Boeuf », et sa commission avec elle. Un Jarret vaut
 *      0,5 parce qu'il se vend a la piece et qu'une piece pese environ 500 g;
 *   3. sinon la famille boeuf/veau, identite d'espece codee en dur.
 *
 * AUCUN REPLI NUMERIQUE. Un prixPouletDefaut de 3 000 F servait de cout quand
 * la ligne « Poulet » n'en portait aucun. Un cout invente est pire qu'un cout
 * absent: il produit une marge d'apparence calculee, qui entre dans les
 * classements et declenche des recommandations, sans que rien ne dise qu'elle
 * repose sur un nombre choisi d'avance. Le manque se REMONTE.
 */

const { normaliserNom } = require('./parage');

/**
 * @param {Object} args
 * @param {string} args.dateMax  borne haute des dates qui seront demandees
 * @returns {Promise<{pourDate: Function, avertissements: string[]}>}
 */
async function creerResolveurPrixAchatSimulation({ dateMax }) {
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

    // Les produits nommes une seule fois. pourDate est appele une fois par
    // journee de la periode: sans deduplication, le meme produit apparaitrait
    // trente fois dans les avertissements.
    const sansCout = new Set();

    const pourDate = (dateIso) => {
        const r = base.pourDate(dateIso);

        const prixAchat = (produit) => {
            const v = r.prixAchat(produit);
            const n = parseFloat(v);
            if (Number.isFinite(n) && n > 0) return n;
            // Le cout est INCONNU, et on le dit. L'avertissement nomme AUSSI
            // le geste qui le corrige: « le cout de X est inconnu » laisse
            // chercher, « mappez-le ou donnez-lui un prix » se traite.
            const cle = normaliserNom(produit);
            if (produit && !sansCout.has(cle)) {
                sansCout.add(cle);
                avertissements.push(
                    `Coût inconnu pour « ${produit} » : ni prix d'achat propre, ni entrée `
                    + `« Mappé vers » dans Mapping produits. Sa marge est affichée SANS coût.`
                );
            }
            return null;
        };

        /**
         * D'ou vient le cout d'un produit. Un chiffre dont on ne peut pas
         * nommer la source ne se verifie pas.
         *
         * La phrase vient du module de base, seul a connaitre la resolution:
         * « prix propre », « mappé vers Boeuf × 0,5 », « famille bovine ». La
         * reconstituer ici en ferait une seconde definition, libre de diverger
         * du calcul qu'elle pretend decrire.
         *
         * Seule la regle du cout NUL reste ici, parce qu'elle est celle de
         * cette couche: un cout de zero est inconnu, pas gratuit - donc sans
         * origine a nommer.
         * @returns {string|null}
         */
        const origine = (produit) => {
            const n = parseFloat(r.prixAchat(produit));
            if (!Number.isFinite(n) || n <= 0) return null;
            return typeof r.origine === 'function' ? r.origine(produit) : null;
        };

        return { prixAchat, origine, prixAchatDefaut: r.prixAchatDefaut, origineBoeuf: r.origineBoeuf };
    };

    // resumePrixBoeuf vient du resolveur de base et doit etre RELAYE: sans
    // lui, l'ecran de simulation perdrait le prix retenu que le PL affiche.
    return {
        pourDate,
        avertissements,
        resumePrixBoeuf: base.resumePrixBoeuf,
        statsPrixBoeuf: base.statsPrixBoeuf
    };
}

module.exports = { creerResolveurPrixAchatSimulation };
