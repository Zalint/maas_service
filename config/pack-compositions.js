/**
 * Configuration des compositions par défaut pour les packs
 * Chaque pack contient une liste de produits avec leurs quantités
 *
 * Les noms de produits doivent correspondre EXACTEMENT au catalogue, car ils
 * servent à retrouver la catégorie du produit (Bovin, Ovin...) lorsqu'un pack
 * est décomposé. Cette copie référençait "Veau" et "Poulet", qui existent au
 * catalogue mais SANS catégorie: les kilos d'un pack vendu sans composition
 * personnalisée n'étaient donc rattachés à aucune catégorie. L'écran de
 * mapping du POS, lui, propose bien "Veau en détail" et "Poulet en détail".
 */

const PACK_COMPOSITIONS = {
  "Pack25000": [
    { produit: "Veau en détail", quantite: 4, unite: "kg" },
    { produit: "Poulet en détail", quantite: 2, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack20000": [
    { produit: "Veau en détail", quantite: 3.5, unite: "kg" },
    { produit: "Poulet en détail", quantite: 1, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack50000": [
    { produit: "Agneau", quantite: 2.5, unite: "kg" },
    { produit: "Veau en détail", quantite: 6, unite: "kg" },
    { produit: "Poulet en détail", quantite: 4, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack35000": [
    { produit: "Veau en détail", quantite: 4, unite: "kg" },
    { produit: "Poulet en détail", quantite: 2, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack30000": [
    { produit: "Veau en détail", quantite: 2, unite: "kg" },
    { produit: "Poulet en détail", quantite: 6, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 0.5, unite: "tablette" }
  ],
  "Pack75000": [
    { produit: "Veau en détail", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 5, unite: "kg" },
    { produit: "Poulet en détail", quantite: 5, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ],
  "Pack100000": [
    { produit: "Veau en détail", quantite: 8, unite: "kg" },
    { produit: "Agneau", quantite: 1, unite: "kg" },
    { produit: "Poulet en détail", quantite: 5, unite: "pièce", poids_unitaire: 1.5 },
    { produit: "Oeuf", quantite: 1, unite: "tablette" }
  ]
};

/**
 * Récupère la composition par défaut d'un pack
 * @param {string} packName - Nom du pack (ex: "Pack25000")
 * @returns {Array|null} - Tableau de produits ou null si le pack n'existe pas
 */
function getPackComposition(packName) {
  return PACK_COMPOSITIONS[packName] || null;
}

/**
 * Crée un objet extension pour une vente de pack
 * @param {string} packType - Type de pack
 * @param {Array} composition - Composition du pack (par défaut ou modifiée)
 * @param {boolean} modifie - Indique si la composition a été modifiée
 * @returns {Object} - Objet extension à stocker dans la base de données
 */
function createPackExtension(packType, composition, modifie = false) {
  return {
    pack_type: packType,
    composition: composition,
    modifie: modifie,
    date_composition: new Date().toISOString()
  };
}

/**
 * Vérifie si un produit est un pack
 * @param {string} produit - Nom du produit
 * @returns {boolean} - true si c'est un pack
 */
function isPack(produit) {
  return PACK_COMPOSITIONS.hasOwnProperty(produit);
}

/**
 * Liste tous les packs disponibles
 * @returns {Array} - Liste des noms de packs
 */
function getAllPacks() {
  return Object.keys(PACK_COMPOSITIONS);
}

/**
 * Verifie que la table est exploitable. Appelee au demarrage du serveur:
 * mieux vaut un message clair au boot qu'un parage faux decouvert un mois
 * plus tard, ou un pack affiche sans composition en caisse.
 *
 * Rend la liste des problemes, vide si tout va bien.
 */
const { UNITES_CONNUES } = require('../lib/parage');

function verifierCompositions(table) {
    const source = table || PACK_COMPOSITIONS;
    const problemes = [];
    const packs = Object.keys(source);
    if (!packs.length) {
        problemes.push('aucun pack defini');
        return problemes;
    }
    for (const pack of packs) {
        const composition = source[pack];
        if (!Array.isArray(composition) || !composition.length) {
            problemes.push(`${pack}: composition vide`);
            continue;
        }
        composition.forEach((c, i) => {
            if (!c || !c.produit) problemes.push(`${pack}[${i}]: produit manquant`);
            if (!(parseFloat(c && c.quantite) > 0)) problemes.push(`${pack}[${i}]: quantite invalide`);
            const unite = String((c && c.unite) || '').toLowerCase();
            // Une piece sans poids unitaire ne peut pas etre convertie en kg:
            // elle disparait silencieusement du parage. C'est exactement la
            // divergence qui existait entre les copies.
            if ((unite === 'piece' || unite === 'pièce')
                && !(parseFloat(c.poids_unitaire) > 0)) {
                problemes.push(`${pack}[${i}] ${c.produit}: unite "piece" sans poids_unitaire`);
            }
            // Une unite inconnue est convertie en 0 kg sans erreur: le pack
            // perd ces kilos et le parage baisse sans qu'on sache pourquoi.
            // Acces null-safe: un element null est deja signale plus haut
            // ("produit manquant"); ici il ferait lever verifierCompositions,
            // qui ne rapporterait plus AUCUN probleme au lieu de tous les lister.
            if (c && !UNITES_CONNUES.includes(unite)) {
                problemes.push(`${pack}[${i}] ${c.produit}: unite inconnue "${c.unite}"`);
            }
        });
    }
    return problemes;
}

module.exports = {
  PACK_COMPOSITIONS,
  verifierCompositions,
  getPackComposition,
  createPackExtension,
  isPack,
  getAllPacks
};
