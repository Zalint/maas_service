/**
 * QUEL TAUX DE PARAGE APPLIQUER A QUEL PRODUIT.
 *
 * Le parametre `stock_pertes_decoupe_pct` est un chiffre DECIDE - 5 % - pose
 * une fois pour toutes et applique au boeuf, au veau et a l'agneau sans
 * distinction. Le depot sait pourtant MESURER la perte reelle, par espece:
 *
 *   parage = 1 - ventes / (stock matin + transferts - stock soir)
 *
 * Mesure sur aout 2026 a Mbao: bovin 3,96 % sur 23 jours, ovin 1,4 % sur 2
 * jours. Le parametre surestime donc le cout du boeuf d'un point et celui de
 * l'agneau de plus de trois. Sur 773 kg de boeuf vendus, un point de parage
 * pese environ 35 000 F de marge.
 *
 * POURQUOI PAS LE TAUX DU JOUR, qui serait plus precis en apparence:
 *
 *   1. Sur une seule journee le ratio est du bruit. Une grosse livraison avec
 *      peu de ventes rend un taux aberrant, et l'ovin n'a que 2 jours
 *      mesurables sur 25 - un taux journalier n'y existe presque jamais.
 *   2. Quand le stock du soir n'est pas compte, il est ESTIME: le ratio du
 *      jour se calculerait alors sur une estimation.
 *   3. Ce ratio a les ventes du jour a son numerateur. L'utiliser pour
 *      valoriser la marge sur ces memes ventes rend le calcul circulaire.
 *
 * D'ou le taux du MOIS, par espece, avec repli sur le parametre quand la
 * mesure ne tient pas debout. Module PUR: il recoit les mesures deja faites
 * par lib/parage-mois.js et ne fait que choisir.
 */

// En dessous de ce nombre de journees mesurees, la moyenne ne veut rien dire:
// l'ovin d'aout 2026 tient sur 2 jours, et son 1,4 % pourrait aussi bien etre
// 12 % le mois suivant. On preferera le parametre, stable et assume.
const JOURS_MIN_PAR_DEFAUT = 5;

// Un parage de la moitie de la carcasse n'est pas un taux, c'est une saisie
// manquante. Au-dela, la mesure decrit un trou de donnees et le parametre
// vaut mieux qu'elle.
const PERTE_MAX_PLAUSIBLE = 0.5;

function nb(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} a
 * @param {object} a.mesures        { bovin: {perte, joursMesures}, ovin: {...} }
 *                                  perte en FRACTION (0,0396), pas en points.
 * @param {number} a.parametrePct   le taux decide, en POINTS (5)
 * @param {number} [a.joursMin=5]
 * @returns {{bovin: object, ovin: object, autre: object}} chacun
 *   { pct, source: 'mesure'|'parametre', jours, raison }
 */
function tauxParEspece(a) {
    const args = a || {};
    const mesures = args.mesures || {};
    const brut = parseFloat(args.parametrePct);
    // Meme garde que partout ailleurs dans le depot: hors de [0, 100[, le
    // parametre rendrait un diviseur nul ou negatif.
    const parametre = Number.isFinite(brut) && brut >= 0 && brut < 100 ? brut : 5;
    const joursMin = Number.isFinite(parseFloat(args.joursMin))
        ? Math.max(1, Math.trunc(parseFloat(args.joursMin)))
        : JOURS_MIN_PAR_DEFAUT;

    const choisir = (espece) => {
        const m = mesures[espece] || {};
        const perte = m.perte;
        const jours = Math.trunc(nb(m.joursMesures));
        if (perte === null || perte === undefined || !Number.isFinite(parseFloat(perte))) {
            return { pct: parametre, source: 'parametre', jours: jours,
                raison: 'aucune mesure disponible' };
        }
        const p = parseFloat(perte);
        if (jours < joursMin) {
            return { pct: parametre, source: 'parametre', jours: jours,
                raison: jours + ' jour(s) mesuré(s), il en faut ' + joursMin };
        }
        // Une perte NEGATIVE veut dire qu'on a vendu plus que sorti: une
        // entree n'a pas ete saisie. Ce n'est pas un gain de matiere.
        if (p < 0 || p >= PERTE_MAX_PLAUSIBLE) {
            return { pct: parametre, source: 'parametre', jours: jours,
                raison: 'mesure hors bornes (' + Math.round(p * 1000) / 10 + ' %)' };
        }
        return { pct: Math.round(p * 100 * 100) / 100, source: 'mesure', jours: jours,
            raison: 'mesuré sur ' + jours + ' jour(s)' };
    };

    return {
        bovin: choisir('bovin'),
        ovin: choisir('ovin'),
        // Volaille, poisson, caprin: la boucherie sans mesure dediee. Le
        // parametre reste, faute de mieux - et c'est dit.
        autre: { pct: parametre, source: 'parametre', jours: 0,
            raison: 'pas de mesure par espèce pour cette catégorie' }
    };
}

/**
 * Le taux a appliquer a UN produit, prêt à être passé aux agregations.
 *
 * Rend 0 hors boucherie: on ne pare pas un sachet d'épices, et diviser son
 * cout par 0,95 le rendrait plus cher qu'il n'est.
 *
 * @param {object} taux        retour de tauxParEspece
 * @param {Function} categorieDe  (produit) => 'bovin'|'ovin'|null
 * @param {Function} estBoucherie (produit) => bool
 * @returns {(produit: string) => number} taux en POINTS
 */
function paragePourProduit(taux, categorieDe, estBoucherie) {
    const t = taux || {};
    return (produit) => {
        if (estBoucherie && !estBoucherie(produit)) return 0;
        const cat = categorieDe ? categorieDe(produit) : null;
        const bloc = (cat === 'bovin' ? t.bovin : cat === 'ovin' ? t.ovin : t.autre) || {};
        return Number.isFinite(parseFloat(bloc.pct)) ? parseFloat(bloc.pct) : 0;
    };
}

module.exports = {
    tauxParEspece,
    paragePourProduit,
    JOURS_MIN_PAR_DEFAUT,
    PERTE_MAX_PLAUSIBLE
};
