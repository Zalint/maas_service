/**
 * Parage (perte de decoupe) par categorie.
 *
 *   parage = ventesNombreAjustePack / ventesTheoriquesNombre
 *   ventesTheoriquesNombre = stock matin + transferts - stock soir  (en kg)
 *   ventesNombreAjustePack = quantite vendue + kilos venant des packs
 */

const { calculerParage, quantiteEnKg, compositionDuPack } = require('../lib/parage');

// Catalogue de test: Boeuf et Veau sont interchangeables, tous deux bovins.
const CATEGORIE = {
    'Boeuf en détail': 'bovin',
    'Boeuf en gros': 'bovin',
    'Veau en détail': 'bovin',
    'Tete de Boeuf': 'bovin',
    'Agneau': 'ovin',
    'Laxass': 'ovin',
    'Tete Agneau': 'ovin',
    'Poulet en détail': null,
    'Oeuf': null
};
const categorieDe = (p) => CATEGORIE[p] || null;

const PACKS = {
    Pack75000: [
        { produit: 'Veau en détail', quantite: 8, unite: 'kg' },
        { produit: 'Agneau', quantite: 5, unite: 'kg' },
        { produit: 'Poulet en détail', quantite: 5, unite: 'pièce', poids_unitaire: 1.5 },
        { produit: 'Oeuf', quantite: 1, unite: 'tablette' }
    ]
};

const base = (o) => Object.assign({
    stocksMatin: [], stocksSoir: [], transferts: [], ventes: [],
    categorieDe, packs: PACKS
}, o);

describe('quantiteEnKg', () => {
    test('kg pris tel quel', () => {
        expect(quantiteEnKg({ quantite: 8, unite: 'kg' })).toBe(8);
    });

    test('piece convertie par le poids unitaire', () => {
        expect(quantiteEnKg({ quantite: 5, unite: 'pièce', poids_unitaire: 1.5 })).toBe(7.5);
    });

    test('piece sans poids unitaire ne compte pas: mieux vaut rien que d inventer', () => {
        expect(quantiteEnKg({ quantite: 5, unite: 'pièce' })).toBe(0);
    });

    test('tablette ignoree', () => {
        expect(quantiteEnKg({ quantite: 1, unite: 'tablette' })).toBe(0);
    });
});

describe('compositionDuPack', () => {
    test('la composition enregistree prime sur celle par defaut', () => {
        const vente = {
            produit: 'Pack75000',
            extension: { composition: [{ produit: 'Boeuf en gros', quantite: 12, unite: 'kg' }] }
        };
        expect(compositionDuPack(vente, PACKS)).toEqual([
            { produit: 'Boeuf en gros', quantite: 12, unite: 'kg' }
        ]);
    });

    test('sans extension, on retombe sur la composition par defaut', () => {
        expect(compositionDuPack({ produit: 'Pack75000' }, PACKS)).toHaveLength(4);
    });

    test('un produit ordinaire n est pas un pack', () => {
        expect(compositionDuPack({ produit: 'Agneau' }, PACKS)).toBeNull();
    });
});

describe('denominateur: stock matin + transferts - stock soir', () => {
    test('cas nominal', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            transferts: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20, impact: '1' }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 30 }]
        }));
        expect(r.Mbao.bovin.theorique).toBe(90);
    });

    test('un transfert sortant se soustrait', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            transferts: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20, impact: '-1' }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 30 }]
        }));
        expect(r.Mbao.bovin.theorique).toBe(50);
    });

    test('bovin et ovin sont comptes separement', () => {
        const r = calculerParage(base({
            stocksMatin: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 },
                { pointVente: 'Mbao', produit: 'Agneau', quantite: 40 }
            ],
            stocksSoir: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 30 },
                { pointVente: 'Mbao', produit: 'Agneau', quantite: 10 }
            ]
        }));
        expect(r.Mbao.bovin.theorique).toBe(70);
        expect(r.Mbao.ovin.theorique).toBe(30);
    });

    test('boeuf et veau tombent dans la meme colonne', () => {
        const r = calculerParage(base({
            stocksMatin: [
                { pointVente: 'Mbao', produit: 'Boeuf en gros', quantite: 60 },
                { pointVente: 'Mbao', produit: 'Veau en détail', quantite: 40 }
            ]
        }));
        expect(r.Mbao.bovin.theorique).toBe(100);
    });
});

describe('numerateur: ventes, packs decomposes', () => {
    test('vente ordinaire', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            ventes: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 12.5 }]
        }));
        expect(r.Mbao.bovin.vendu).toBe(12.5);
    });

    test('un pack repartit son contenu entre les categories', () => {
        const r = calculerParage(base({
            stocksMatin: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 },
                { pointVente: 'Mbao', produit: 'Agneau', quantite: 50 }
            ],
            ventes: [{ pointVente: 'Mbao', produit: 'Pack75000', nombre: 1 }]
        }));
        expect(r.Mbao.bovin.vendu).toBe(8);  // Veau en détail
        expect(r.Mbao.ovin.vendu).toBe(5);   // Agneau
        // Poulet et Oeuf ne sont ni bovins ni ovins.
    });

    test('deux packs comptent double', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            ventes: [{ pointVente: 'Mbao', produit: 'Pack75000', nombre: 2 }]
        }));
        expect(r.Mbao.bovin.vendu).toBe(16);
        expect(r.Mbao.ovin.vendu).toBe(10);
    });

    test('la composition enregistree est celle qui compte', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            ventes: [{
                pointVente: 'Mbao', produit: 'Pack75000', nombre: 1,
                extension: {
                    composition: [
                        { produit: 'Boeuf en gros', quantite: 12, unite: 'kg' },
                        { produit: 'Agneau', quantite: 3, unite: 'kg' }
                    ]
                }
            }]
        }));
        expect(r.Mbao.bovin.vendu).toBe(12);
        expect(r.Mbao.ovin.vendu).toBe(3);
    });

    test('ventes ordinaires et packs s additionnent', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            ventes: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 10 },
                { pointVente: 'Mbao', produit: 'Pack75000', nombre: 1 }
            ]
        }));
        expect(r.Mbao.bovin.vendu).toBe(18);
    });
});

describe('exclusions', () => {
    test('un produit exclu sort des DEUX cotes du rapport', () => {
        const args = {
            stocksMatin: [
                { pointVente: 'Mbao', produit: 'Agneau', quantite: 40 },
                { pointVente: 'Mbao', produit: 'Tete Agneau', quantite: 3 }
            ],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 10 }],
            ventes: [
                { pointVente: 'Mbao', produit: 'Agneau', nombre: 25 },
                { pointVente: 'Mbao', produit: 'Tete Agneau', nombre: 3 }
            ]
        };
        const sans = calculerParage(base(args));
        expect(sans.Mbao.ovin.theorique).toBe(33); // 40 + 3 - 10
        expect(sans.Mbao.ovin.vendu).toBe(28);     // 25 + 3

        const avec = calculerParage(base(
            Object.assign({}, args, { exclusions: new Set(['Tete Agneau']) })
        ));
        expect(avec.Mbao.ovin.theorique).toBe(30); // 40 - 10
        expect(avec.Mbao.ovin.vendu).toBe(25);
    });

    test('l exclusion vaut aussi pour les kilos venant des packs', () => {
        const args = {
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 50 }],
            ventes: [{ pointVente: 'Mbao', produit: 'Pack75000', nombre: 1 }]
        };
        expect(calculerParage(base(args)).Mbao.ovin.vendu).toBe(5);
        const avec = calculerParage(base(
            Object.assign({}, args, { exclusions: new Set(['Agneau']) })
        ));
        expect(avec.Mbao.ovin.vendu).toBe(0);
    });
});

describe('ratio', () => {
    test('rapport nominal', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20 }],
            ventes: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 76 }]
        }));
        expect(r.Mbao.bovin.ratio).toBeCloseTo(0.95, 6);
    });

    test('denominateur nul: pas de ratio, et surtout pas zero', () => {
        const r = calculerParage(base({
            ventes: [{ pointVente: 'Mbao', produit: 'Agneau', nombre: 3 }]
        }));
        expect(r.Mbao.ovin.ratio).toBeNull();
        expect(r.Mbao.ovin.ratio).not.toBe(0);
    });

    test('denominateur negatif: pas de ratio non plus', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 10 }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 30 }]
        }));
        expect(r.Mbao.ovin.theorique).toBe(-20);
        expect(r.Mbao.ovin.ratio).toBeNull();
    });

    test('aucun mouvement: les deux categories sans ratio', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Poulet en détail', quantite: 10 }]
        }));
        expect(r.Mbao).toBeUndefined();
    });
});

describe('plusieurs points de vente', () => {
    test('chacun son calcul', () => {
        const r = calculerParage(base({
            stocksMatin: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 },
                { pointVente: 'Dahra', produit: 'Boeuf en détail', quantite: 50 }
            ],
            stocksSoir: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20 },
                { pointVente: 'Dahra', produit: 'Boeuf en détail', quantite: 10 }
            ],
            ventes: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 80 },
                { pointVente: 'Dahra', produit: 'Boeuf en détail', nombre: 36 }
            ]
        }));
        expect(r.Mbao.bovin.ratio).toBeCloseTo(1, 6);
        expect(r.Dahra.bovin.ratio).toBeCloseTo(0.9, 6);
    });
});

describe('exclusions insensibles a la casse et aux accents', () => {
    // L'inventaire ecrit "Patte de mouton", le catalogue "Patte de Mouton".
    // Une comparaison stricte excluait le produit d'un seul cote du rapport,
    // ce que cette fonctionnalite existe justement pour empecher.
    const catOvin = () => 'ovin';

    test('un produit exclu sort des deux cotes malgre une casse differente', () => {
        const r = calculerParage({
            stocksMatin: [
                { pointVente: 'M', produit: 'Patte de mouton', quantite: 10 },
                { pointVente: 'M', produit: 'Agneau', quantite: 20 }
            ],
            ventes: [
                { pointVente: 'M', produit: 'Patte de Mouton', nombre: 10 },
                { pointVente: 'M', produit: 'Agneau', nombre: 18 }
            ],
            categorieDe: catOvin,
            exclusions: new Set(['Patte de Mouton'])
        });
        expect(r.M.ovin.theorique).toBe(20);
        expect(r.M.ovin.vendu).toBe(18);
    });

    test('les accents ne font pas echouer la correspondance', () => {
        const r = calculerParage({
            stocksMatin: [{ pointVente: 'M', produit: 'Tete Agneau', quantite: 5 }],
            categorieDe: catOvin,
            exclusions: new Set(['Tête Agneau'])
        });
        expect(r.M).toBeUndefined();
    });
});
