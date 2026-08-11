/**
 * Ventilation du stock par espece, prerequis des deux taux de parage.
 *
 * lib/parage.js calcule DEJA deux ratios separes, bovin et ovin, mais le PL
 * n'applique qu'un coefficient de parage unique a toute la boucherie. Exposer
 * le partage ne change aucun montant: il rend possible de donner un taux par
 * espece sans deviner leur poids respectif.
 *
 * @jest-environment node
 */

const { valoriserLignes } = require('../lib/valorisation-stock');

const PRIX = { boeuf: 3835, agneau: 4500, poulet: 3000, laxass: 200 };
const prixAchat = (p) => PRIX[String(p).toLowerCase()] || null;
const estBoucherie = (p) => String(p).toLowerCase() !== 'couscous';
const categorieDe = (p) => {
    const n = String(p).toLowerCase();
    if (n === 'boeuf') return 'bovin';
    if (n === 'agneau' || n === 'laxass') return 'ovin';
    return null; // poulet: categorie inconnue en base, mesure en production
};

test('les trois parts somment exactement a la part boucherie', () => {
    const r = valoriserLignes({
        lignes: [
            { produit: 'Boeuf',    quantite: 46, total: 176410 },
            { produit: 'Agneau',   quantite: 10, total: 45000 },
            { produit: 'Laxass',   quantite: 31, total: 6200 },
            { produit: 'Poulet',   quantite: 9,  total: 27000 },
            { produit: 'Couscous', quantite: 10, total: 6500 }
        ],
        prixAchat, estBoucherie, categorieDe
    });
    expect(r.valeur_bovin + r.valeur_ovin + r.valeur_autre_boucherie)
        .toBeCloseTo(r.valeur_boucherie, 6);
    // Couscous n'est pas de la boucherie: il n'entre dans aucune des trois.
    expect(r.valeur_hors_boucherie).toBeCloseTo(6500, 6);
});

test('chaque espece recoit ce qui lui revient', () => {
    const r = valoriserLignes({
        lignes: [
            { produit: 'Boeuf',  quantite: 46, total: 0 },
            { produit: 'Agneau', quantite: 10, total: 0 }
        ],
        prixAchat, estBoucherie, categorieDe
    });
    expect(r.valeur_bovin).toBeCloseTo(46 * 3835, 6);
    expect(r.valeur_ovin).toBeCloseTo(10 * 4500, 6);
    expect(r.valeur_autre_boucherie).toBe(0);
});

test("une espece inconnue va dans 'autre', jamais dans bovin ou ovin", () => {
    // Mesure en production: les produits d'inventaire n'ont pas de categorie,
    // donc le poulet n'est ni bovin ni ovin. Le ranger d'office dans une
    // espece fausserait le taux de parage qu'on lui appliquerait.
    const r = valoriserLignes({
        lignes: [{ produit: 'Poulet', quantite: 9, total: 0 }],
        prixAchat, estBoucherie, categorieDe
    });
    expect(r.valeur_bovin).toBe(0);
    expect(r.valeur_ovin).toBe(0);
    expect(r.valeur_autre_boucherie).toBeCloseTo(9 * 3000, 6);
});

test('sans categorieDe, tout tombe dans autre et rien ne casse', () => {
    const r = valoriserLignes({
        lignes: [{ produit: 'Boeuf', quantite: 46, total: 0 }],
        prixAchat, estBoucherie
    });
    expect(r.valeur_boucherie).toBeCloseTo(46 * 3835, 6);
    expect(r.valeur_autre_boucherie).toBeCloseTo(46 * 3835, 6);
    expect(r.valeur_bovin).toBe(0);
});

test('une ligne sans prix d achat est ventilee sur sa valeur saisie', () => {
    // Sans prix d'achat, la ligne garde son total saisi (donc le prix de
    // vente). Elle doit tout de meme entrer dans la bonne espece.
    const r = valoriserLignes({
        lignes: [{ produit: 'Yell', quantite: 42, total: 126000 }],
        prixAchat: () => null,
        estBoucherie: () => true,
        categorieDe: () => 'bovin'
    });
    expect(r.valeur_bovin).toBeCloseTo(126000, 6);
    expect(r.valeur_au_prix_vente).toBeCloseTo(126000, 6);
});
