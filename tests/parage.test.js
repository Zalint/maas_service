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

describe('composantes du stock theorique', () => {
    // theorique = matin + transferts - soir. Exposer la somme seule ne permet
    // pas de voir LAQUELLE des trois saisies manque quand le chiffre parait
    // faux - et c'est ce detail que l'export par jour doit porter.
    test('les trois composantes sont rendues separement', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            transferts: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20, impact: '1' }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 30 }],
            ventes: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 85 }]
        }));
        const b = r.Mbao.bovin;
        expect(b.matin).toBe(100);
        expect(b.transferts).toBe(20);
        expect(b.soir).toBe(30);
        expect(b.theorique).toBe(90);
        expect(b.vendu).toBe(85);
        // La somme doit rester coherente avec les composantes.
        expect(b.matin + b.transferts - b.soir).toBe(b.theorique);
    });

    test('un transfert sortant compte en negatif', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 50 }],
            transferts: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 15, impact: '-1' }],
            ventes: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 30 }]
        }));
        expect(r.Mbao.bovin.transferts).toBe(-15);
        expect(r.Mbao.bovin.theorique).toBe(35);
    });

    test('les kilos issus des packs comptent au vendu, pas au stock', () => {
        const r = calculerParage(Object.assign(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20 }],
            ventes: [{ pointVente: 'Mbao', produit: 'PackTest', nombre: 2 }]
        }), { packs: { PackTest: [{ produit: 'Boeuf en détail', quantite: 4, unite: 'kg' }] } }));
        expect(r.Mbao.bovin.matin).toBe(20);
        expect(r.Mbao.bovin.transferts).toBe(0);
        expect(r.Mbao.bovin.vendu).toBe(8);
    });

    test('un produit exclu ne compte dans aucune composante', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 40 }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 10 }],
            exclusions: new Set(['Agneau'])
        }));
        const o = r.Mbao ? r.Mbao.ovin : { matin: 0, soir: 0, theorique: 0 };
        expect(o.matin).toBe(0);
        expect(o.soir).toBe(0);
        expect(o.theorique).toBe(0);
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
        // perte est la valeur AFFICHEE a l'ecran (les 5% de parage), pas
        // ratio: c'est elle qu'il faut tenir, sinon une inversion de signe
        // passerait les tests en affichant 95% de perte au lieu de 5%.
        expect(r.Mbao.bovin.perte).toBeCloseTo(0.05, 6);
    });

    test('denominateur nul: pas de ratio, et surtout pas zero', () => {
        const r = calculerParage(base({
            ventes: [{ pointVente: 'Mbao', produit: 'Agneau', nombre: 3 }]
        }));
        expect(r.Mbao.ovin.ratio).toBeNull();
        expect(r.Mbao.ovin.ratio).not.toBe(0);
        // null et non 0: l'ecran doit montrer un tiret, pas "0% de parage"
        // qui se lirait comme une decoupe parfaite.
        expect(r.Mbao.ovin.perte).toBeNull();
    });

    test('denominateur negatif: pas de ratio non plus', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 10 }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Agneau', quantite: 30 }]
        }));
        expect(r.Mbao.ovin.theorique).toBe(-20);
        expect(r.Mbao.ovin.ratio).toBeNull();
        expect(r.Mbao.ovin.perte).toBeNull();
    });

    // Du stock sorti SANS aucune vente: 100% de perte, et il FAUT que ca se
    // voie. Des kilos ont quitte le stock sans qu'aucune vente ne soit
    // enregistree - c'est le signal d'un vol ou d'une saisie manquante.
    // Masquer cette ligne reviendrait a masquer exactement ce qu'on cherche.
    test('stock sorti sans vente: 100% de perte, et ca doit rester visible', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 18.8 }],
            stocksSoir: [],
            ventes: []
        }));
        expect(r.Mbao.bovin.theorique).toBeCloseTo(18.8, 6);
        expect(r.Mbao.bovin.vendu).toBe(0);
        expect(r.Mbao.bovin.ratio).toBe(0);
        expect(r.Mbao.bovin.perte).toBe(1);
        // Surtout pas null: un tiret ici effacerait l'alerte.
        expect(r.Mbao.bovin.perte).not.toBeNull();
    });

    // Constate en production le 02/08/2026: le tableau affichait 100% en rouge
    // et l'infobulle annoncait "0 kg / 0 kg". Les deux etaient vrais - a
    // l'affichage. Dans la machine, theorique valait 5.55e-17: le stock du
    // matin saisi en plusieurs lignes et celui du soir en une seule ne
    // s'annulent pas exactement en virgule flottante. Le residu etant > 0, le
    // ratio valait 0 et le parage 100%, sur une journee ou rien n'avait bouge.
    test('residu de virgule flottante: pas de parage a 100% sur une journee immobile', () => {
        const r = calculerParage(base({
            stocksMatin: [
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 0.1 },
                { pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 0.2 }
            ],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 0.3 }],
            ventes: []
        }));
        // Le residu existe bel et bien: le test n'a de sens que s'il est > 0.
        expect(r.Mbao.bovin.theorique).toBeGreaterThan(0);
        expect(r.Mbao.bovin.theorique).toBeLessThan(0.001);
        expect(r.Mbao.bovin.ratio).toBeNull();
        expect(r.Mbao.bovin.perte).toBeNull();
        expect(r.Mbao.bovin.perte).not.toBe(1);
    });

    test('un gramme reel reste sous le seuil, dix grammes comptent', () => {
        const avec = (q) => calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: q }],
            stocksSoir: [], ventes: []
        })).Mbao.bovin;
        expect(avec(0.0005).perte).toBeNull();
        expect(avec(0.01).perte).toBe(1);
    });

    // Le seul autre cas a ignorer: rien en stock, rien vendu. 0/0 n'est pas une
    // perte de 100%, c'est une journee sans matiere.
    test('0/0: aucune matiere, aucune vente -> pas de ratio', () => {
        const r = calculerParage(base({
            stocksMatin: [],
            stocksSoir: [],
            ventes: []
        }));
        const bovin = r.Mbao ? r.Mbao.bovin : { ratio: null, perte: null };
        expect(bovin.ratio).toBeNull();
        expect(bovin.perte).toBeNull();
    });

    test('0/0 avec des lignes de stock a zero des deux cotes', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 12 }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 12 }],
            ventes: []
        }));
        expect(r.Mbao.bovin.theorique).toBe(0);
        expect(r.Mbao.bovin.vendu).toBe(0);
        expect(r.Mbao.bovin.ratio).toBeNull();
        expect(r.Mbao.bovin.perte).toBeNull();
    });

    test('une seule vente suffit a rendre le parage mesurable', () => {
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 18.8 }],
            stocksSoir: [],
            ventes: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 17.8 }]
        }));
        expect(r.Mbao.bovin.ratio).toBeCloseTo(17.8 / 18.8, 6);
        expect(r.Mbao.bovin.perte).toBeCloseTo(1 - 17.8 / 18.8, 6);
    });

    test('vendu au-dela du theorique: la perte devient negative, pas bornee', () => {
        // Un rendement > 100% signale une erreur de saisie (stock du soir
        // sous-estime). La valeur doit ressortir telle quelle pour que
        // l'anomalie se voie, au lieu d'etre ecretee a zero.
        const r = calculerParage(base({
            stocksMatin: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 100 }],
            stocksSoir: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', quantite: 20 }],
            ventes: [{ pointVente: 'Mbao', produit: 'Boeuf en détail', nombre: 90 }]
        }));
        expect(r.Mbao.bovin.ratio).toBeCloseTo(1.125, 6);
        expect(r.Mbao.bovin.perte).toBeCloseTo(-0.125, 6);
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

describe('stock derive: exclusion asymetrique', () => {
    const cat = (n) => (/boeuf/i.test(n) ? 'bovin' : null);

    // Le stock entre sous "Boeuf" (la carcasse) et sort sous "Boeuf en detail"
    // (les decoupes). Le stock des decoupes est CALCULE a partir de leurs
    // ventes: le compter au denominateur ajouterait ces ventes au theorique
    // alors qu'elles sont deja au numerateur.
    test('le stock derive sort du theorique, ses ventes restent au numerateur', () => {
        const args = {
            stocksMatin: [{ pointVente: 'M', produit: 'Boeuf', quantite: 100 }],
            stocksSoir: [
                { pointVente: 'M', produit: 'Boeuf', quantite: 20 },
                // Stock calcule: 0 + 0 - 60 ventes = -60
                { pointVente: 'M', produit: 'Boeuf en détail', quantite: -60 }
            ],
            transferts: [],
            ventes: [{ pointVente: 'M', produit: 'Boeuf en détail', nombre: 60 }],
            categorieDe: cat,
            stockDerive: new Set(['Boeuf en détail'])
        };
        const r = calculerParage(args).M.bovin;
        // Theorique = 100 - 20 = 80, uniquement la carcasse reellement comptee.
        expect(r.theorique).toBe(80);
        expect(r.vendu).toBe(60);
        expect(r.perte).toBeCloseTo(1 - 60 / 80, 10);   // 25% de parage
    });

    // Sans l'exclusion, le -60 du stock derive AJOUTE 60 au theorique et le
    // parage passe de 25% a 57%: c'est le defaut que l'exclusion corrige.
    test('sans exclusion, le theorique double-compte les ventes', () => {
        const base = {
            stocksMatin: [{ pointVente: 'M', produit: 'Boeuf', quantite: 100 }],
            stocksSoir: [
                { pointVente: 'M', produit: 'Boeuf', quantite: 20 },
                { pointVente: 'M', produit: 'Boeuf en détail', quantite: -60 }
            ],
            transferts: [],
            ventes: [{ pointVente: 'M', produit: 'Boeuf en détail', nombre: 60 }],
            categorieDe: cat
        };
        const r = calculerParage(base).M.bovin;
        expect(r.theorique).toBe(140);                  // 100 - 20 - (-60)
        expect(r.perte).toBeCloseTo(1 - 60 / 140, 10);  // ~57%, fausse
    });

    test('un produit a stock derive garde sa categorie et ses ventes', () => {
        const r = calculerParage({
            stocksMatin: [],
            stocksSoir: [{ pointVente: 'M', produit: 'Boeuf en détail', quantite: -10 }],
            transferts: [],
            ventes: [{ pointVente: 'M', produit: 'Boeuf en détail', nombre: 10 }],
            categorieDe: cat,
            stockDerive: new Set(['Boeuf en détail'])
        }).M.bovin;
        expect(r.vendu).toBe(10);
        expect(r.theorique).toBe(0);
        expect(r.ratio).toBeNull();   // rien de mesurable: pas de stock reel
    });
});

describe('composition de pack et casse', () => {
    const { compositionDuPack } = require('../lib/parage');
    const packs = { 'Pack25000': [{ produit: 'Boeuf', quantite: 3 }] };

    // C'etait le SEUL rapprochement de nom du module a passer par une cle brute.
    // Une vente de pack non reconnue n'est pas eclatee en ses composants: elle
    // sort du numerateur du parage sans qu'aucun message ne le signale.
    test('la composition se trouve quelle que soit la casse', () => {
        expect(compositionDuPack({ produit: 'Pack25000' }, packs)).toHaveLength(1);
        expect(compositionDuPack({ produit: 'PACK25000' }, packs)).toHaveLength(1);
        expect(compositionDuPack({ produit: 'pack25000' }, packs)).toHaveLength(1);
    });

    test('un pack inconnu rend toujours null', () => {
        expect(compositionDuPack({ produit: 'Pack99999' }, packs)).toBeNull();
        expect(compositionDuPack({ produit: 'Boeuf' }, packs)).toBeNull();
    });

    test('la composition portee par la vente prime sur celle du catalogue', () => {
        const vente = { produit: 'PACK25000', extension: { composition: [{ produit: 'X', quantite: 1 }] } };
        expect(compositionDuPack(vente, packs)).toEqual([{ produit: 'X', quantite: 1 }]);
    });

    test('sans catalogue de packs, rien n explose', () => {
        expect(compositionDuPack({ produit: 'Pack25000' }, null)).toBeNull();
        expect(compositionDuPack({ produit: 'Pack25000' }, {})).toBeNull();
    });
});
