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
 *   2. s'il rend null ET que le produit est dans la famille BOEUF: le prix de
 *      la ligne 'Boeuf' du catalogue - le Jarret vient de cette carcasse;
 *   3. s'il rend null ET que le produit est dans la famille POULET: le prix de
 *      la ligne 'Poulet';
 *   4. sinon le cout est INCONNU, et le produit est NOMME dans les
 *      avertissements.
 *
 * Aucune de ces familles ne s'applique a un produit qui a deja un cout propre:
 * le jour ou un admin renseignera un prix d'achat sur 'Poulet en gros', il
 * gagnera d'office.
 *
 * PLUS DE REPLI NUMERIQUE. Un prixPouletDefaut de 3 000 F servait de cout
 * quand la ligne 'Poulet' n'en portait aucun. Un cout invente est pire qu'un
 * cout absent: il produit une marge d'apparence calculee, qui entre dans les
 * classements et declenche des recommandations, sans que rien ne dise qu'elle
 * repose sur un nombre choisi d'avance. Le manque se REMONTE desormais.
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
    // LES PRODUITS DONT LE COUT RESTE INCONNU, nommes une seule fois.
    //
    // Il existait ici un repli numerique - prixPouletDefaut, 3 000 F - qui
    // servait de cout quand la ligne « Poulet » du catalogue n'en portait
    // aucun. Un cout invente est pire qu'un cout absent: il produit une marge
    // qui a l'air calculee, entre dans les classements, declenche des
    // recommandations, et rien a l'ecran ne dit qu'il repose sur un nombre
    // choisi d'avance. Le proprietaire du produit l'a tranche: on remonte le
    // manque.
    //
    // Un Set, pas un drapeau: l'avertissement doit NOMMER les produits, sinon
    // il previent d'un probleme sans dire ou le corriger. Et pourDate est
    // appele une fois par journee de la periode - sans deduplication, le meme
    // produit apparaitrait trente fois.
    const sansCout = new Set();

    /**
     * Nomme un produit dont le cout reste inconnu, une seule fois.
     *
     * L'avertissement dit AUSSI quelle ligne du catalogue le renseignerait:
     * « le cout de X est inconnu » laisse chercher, « la ligne Poulet ne porte
     * aucun prix d'achat » se corrige en trente secondes.
     */
    const noterSansCout = (produit, source) => {
        const cle = normaliserNom(produit);
        if (sansCout.has(cle)) return;
        sansCout.add(cle);
        avertissements.push(
            `Coût inconnu pour « ${produit} » : ni prix d'achat propre, ni prix sur la ligne `
            + `« ${source} » du catalogue. Sa marge est affichée SANS coût — renseignez l'un des deux.`
        );
    };

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
            if (familleBoeuf.has(normaliserNom(produit))) {
                if (prixBoeuf === null) noterSansCout(produit, SOURCE_BOEUF);
                return prixBoeuf;
            }
            if (!famille.has(normaliserNom(produit))) return null;
            if (prixPoulet !== null) return prixPoulet;
            // Plus de repli numerique: le cout est INCONNU, on le dit.
            noterSansCout(produit, SOURCE_POULET);
            return null;
        };

        /**
         * D'ou vient le cout d'un produit. Sert au mode debug: un chiffre dont
         * on ne peut pas nommer la source ne se verifie pas.
         * @returns {'propre'|'famille_boeuf'|'famille_poulet'|null}
         *   null = cout INCONNU. Il n'y a plus de repli numerique: un cout
         *   invente produisait une marge d'apparence calculee.
         */
        const origine = (produit) => {
            const propre = parseFloat(r.prixAchat(produit));
            if (Number.isFinite(propre) && propre > 0) return 'propre';
            if (familleBoeuf.has(normaliserNom(produit))) {
                return prixBoeuf !== null ? 'famille_boeuf' : null;
            }
            if (!famille.has(normaliserNom(produit))) return null;
            if (prixPoulet !== null) return 'famille_poulet';
            return null;
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
