/**
 * Parage (perte de decoupe) par categorie, pour un jour et un point de vente.
 *
 *   rendement = ventesNombreAjustePack / ventesTheoriquesNombre
 *   parage    = 1 - rendement          <- c'est la PERTE, ce qu'on affiche
 *
 * avec, EN QUANTITE et non en valeur:
 *   ventesTheoriquesNombre = stock matin + transferts - stock soir
 *   ventesNombreAjustePack = quantite vendue + quantite contenue dans les
 *                            packs vendus
 *
 * Deux colonnes sont produites: 'bovin' et 'ovin'. Boeuf et veau sont
 * interchangeables et tombent tous deux dans 'bovin'.
 *
 * Les produits exclus (reglage ADMIN) sortent des DEUX cotes du rapport:
 * retirer un produit du stock theorique sans le retirer des ventes
 * comparerait deux perimetres differents. Cela vaut aussi pour les kilos
 * venant des packs.
 *
 * Module sans dependance: la resolution produit -> categorie est fournie par
 * l'appelant, ce qui rend le calcul testable sans base.
 */

const CATEGORIES = ['bovin', 'ovin'];

// L'inventaire et le catalogue n'ecrivent pas les noms de la meme facon
// ('Patte de mouton' contre 'Patte de Mouton'). La resolution de categorie
// normalise deja; les exclusions doivent le faire AUSSI, sinon un produit
// sort d'un seul cote du rapport - exactement le perimetre asymetrique que
// cette fonctionnalite existe pour empecher.
function normaliserNom(nom) {
    return String(nom || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toLowerCase();
}

// Une composition de pack s'exprime en kg, en piece (avec un poids unitaire)
// ou en tablette. Seul le poids nous interesse: une tablette d'oeufs n'a pas
// d'equivalent en kilos de viande, et de toute facon l'oeuf n'est ni bovin ni
// ovin, donc la ligne est ecartee en amont par la categorie.
// Unites acceptees. 'tablette' vaut deliberement 0 kg (des oeufs ne sont ni
// bovin ni ovin), mais elle est CONNUE: une unite hors de cette liste est une
// faute de frappe, et quantiteEnKg rendrait 0 sans rien signaler - donc un
// theorique sous-estime et un parage faux, silencieusement.
const UNITES_CONNUES = ['kg', 'piece', 'pièce', 'tablette'];

function quantiteEnKg(composant) {
    const quantite = parseFloat(composant && composant.quantite) || 0;
    if (quantite <= 0) return 0;

    const unite = String((composant && composant.unite) || '').toLowerCase();
    if (unite === 'kg') return quantite;
    if (unite === 'piece' || unite === 'pièce') {
        const poids = parseFloat(composant.poids_unitaire);
        // Sans poids unitaire connu, on ne peut pas convertir: on prefere ne
        // rien compter plutot que d'inventer un poids et fausser le ratio.
        return Number.isFinite(poids) && poids > 0 ? quantite * poids : 0;
    }
    return 0; // tablette, ou unite inconnue
}

function creerAccumulateur() {
    const acc = {};
    for (const c of CATEGORIES) {
        acc[c] = { theorique: 0, vendu: 0, ratio: null, perte: null };
    }
    return acc;
}

/**
 * @param {Object} args
 * @param {Array}  args.stocksMatin   [{ pointVente, produit, quantite }]
 * @param {Array}  args.stocksSoir    idem
 * @param {Array}  args.transferts    [{ pointVente, produit, quantite, impact }]
 * @param {Array}  args.ventes        [{ pointVente, produit, nombre, extension }]
 * @param {Function} args.categorieDe (produit) => 'bovin' | 'ovin' | null
 * @param {Set}    [args.exclusions]  noms de produits a ignorer des deux cotes
 * @param {Object} [args.packs]       compositions par defaut, { [nomPack]: [composants] }
 * @returns {Object} { [pointVente]: { bovin: {theorique,vendu,ratio}, ovin: {...} } }
 */
function calculerParage(args) {
    const {
        stocksMatin = [],
        stocksSoir = [],
        transferts = [],
        ventes = [],
        categorieDe,
        exclusions = new Set(),
        packs = {}
    } = args || {};

    const parPv = {};
    const pour = (pv) => {
        if (!parPv[pv]) parPv[pv] = creerAccumulateur();
        return parPv[pv];
    };
    const exclusionsNormalisees = new Set(
        Array.from(exclusions || []).map(normaliserNom)
    );
    const exclu = (produit) => exclusionsNormalisees.has(normaliserNom(produit));

    // --- Denominateur ---------------------------------------------------
    for (const s of stocksMatin) {
        if (exclu(s.produit)) continue;
        const cat = categorieDe(s.produit);
        if (!cat) continue;
        pour(s.pointVente)[cat].theorique += parseFloat(s.quantite) || 0;
    }

    for (const t of transferts) {
        if (exclu(t.produit)) continue;
        const cat = categorieDe(t.produit);
        if (!cat) continue;
        // Le signe vient d'impact: transferts.quantite est toujours positive.
        const impact = parseInt(t.impact, 10);
        const signe = Number.isFinite(impact) ? impact : 1;
        pour(t.pointVente)[cat].theorique += signe * (parseFloat(t.quantite) || 0);
    }

    for (const s of stocksSoir) {
        if (exclu(s.produit)) continue;
        const cat = categorieDe(s.produit);
        if (!cat) continue;
        pour(s.pointVente)[cat].theorique -= parseFloat(s.quantite) || 0;
    }

    // --- Numerateur -----------------------------------------------------
    for (const v of ventes) {
        const nombre = parseFloat(v.nombre) || 0;
        const composition = compositionDuPack(v, packs);

        if (!composition) {
            // Vente ordinaire.
            if (exclu(v.produit)) continue;
            const cat = categorieDe(v.produit);
            if (!cat) continue;
            pour(v.pointVente)[cat].vendu += nombre;
            continue;
        }

        // Vente de pack: on repartit son contenu entre les categories.
        // `nombre` est le NOMBRE DE PACKS, chaque composant est donc
        // multiplie par ce nombre.
        for (const composant of composition) {
            if (exclu(composant.produit)) continue;
            const cat = categorieDe(composant.produit);
            if (!cat) continue;
            const kg = quantiteEnKg(composant);
            if (kg <= 0) continue;
            pour(v.pointVente)[cat].vendu += kg * nombre;
        }
    }

    // --- Ratio ----------------------------------------------------------
    for (const acc of Object.values(parPv)) {
        for (const cat of CATEGORIES) {
            const d = acc[cat];
            // Un denominateur nul ou negatif ne donne pas un parage de 0, il
            // ne donne RIEN: l'appelant affiche un tiret. Rendre 0 se lirait
            // comme "aucune perte", ce qui est faux.
            // Deux conditions, pas une.
            //
            // theorique <= 0: rien a rapporter, division impossible.
            //
            // vendu == 0: le rapport vaut alors 0 quel que soit le stock, donc
            // un parage de 100% - mais cette valeur ne dit RIEN de la decoupe.
            // Elle signale du stock parti sans vente enregistree, ce que la
            // colonne Ecart montre deja en francs. Affiche dans la colonne
            // parage, ce 100% noyait les vrais taux (5 a 8%) sous des lignes
            // rouges qui n'en etaient pas.
            d.ratio = (d.theorique > 0 && d.vendu > 0) ? d.vendu / d.theorique : null;
            // Le parage est une PERTE: ce qui est sorti du stock sans etre
            // vendu. Un rendement de 96,6% se lit donc 3,4% de parage.
            d.perte = d.ratio === null ? null : 1 - d.ratio;
        }
    }

    return parPv;
}

/**
 * Composition d'une vente de pack, ou null si ce n'en est pas un.
 * Priorite a la composition enregistree avec la vente; a defaut la
 * composition par defaut du pack.
 */
function compositionDuPack(vente, packs) {
    const ext = vente && vente.extension;
    if (ext && Array.isArray(ext.composition) && ext.composition.length) {
        return ext.composition;
    }
    const parDefaut = packs && packs[vente && vente.produit];
    return Array.isArray(parDefaut) && parDefaut.length ? parDefaut : null;
}

module.exports = { calculerParage, quantiteEnKg, compositionDuPack, normaliserNom, CATEGORIES, UNITES_CONNUES };
