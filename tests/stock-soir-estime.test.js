/**
 * Estimation du stock du soir tant qu'il n'est pas compte (lib/stock-soir-estime).
 *
 * Les chiffres sont calculables de tete pour qu'une regression se lise sans
 * deboguer. Le cas central est celui du depot: le stock est tenu sous "Boeuf"
 * et les ventes sortent sous "Boeuf en detail" / "Boeuf en gros".
 */
const { estimerStockSoir } = require('../lib/stock-soir-estime');

// Catalogue reel simplifie du tenant: Boeuf et Foie sont bovin, Agneau ovin,
// Poulet est de la boucherie MAIS sans categorie de parage (famille Volaille),
// Vermicelles est de l'epicerie.
const CAT = {
    'Boeuf': 'bovin', 'Boeuf en détail': 'bovin', 'Boeuf en gros': 'bovin',
    'Foie': 'bovin', 'Yell': 'bovin', 'Jarret': 'bovin',
    'Viande Hachée': 'bovin',
    'Agneau': 'ovin', 'Laxass': 'ovin',
    'Déchet 400': 'bovin', 'Dechet': 'bovin'
};
const BOUCHERIE = new Set(Object.keys(CAT).concat(['Poulet', 'Poulet en détail']));

const base = (o) => Object.assign({
    lignesAncre: [], transferts: [], ventes: [],
    ratios: { bovin: 0.96, ovin: null },
    ratioRepli: 0.95,
    categorieDe: (p) => CAT[p] || null,
    estBoucherie: (p) => BOUCHERIE.has(p),
    exclusions: new Set(),
    familleDechet: new Set(['Dechet', 'Déchet 400']),
    packs: {}
}, o);

const ligne = (produit) => (r) => r.lignes.find((l) => l.produit === produit);

describe('la formule: on retranche les kilos SORTIS, pas les kilos vendus', () => {
    test('le cas du depot: stock sous "Boeuf", ventes sous "Boeuf en detail"', () => {
        // 73,8 kg de carcasse au dernier comptage. 30 kg vendus au detail et en
        // gros. Avec 4% de parage mesure, il a fallu sortir 30/0,96 = 31,25 kg.
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 73.8, total: 283023, prix_unitaire: 3835 }],
            ventes: [
                { produit: 'Boeuf en détail', nombre: 20 },
                { produit: 'Boeuf en gros', nombre: 10 }
            ]
        }));
        expect(r.parCategorie.bovin.kg_vendus).toBeCloseTo(30, 3);
        expect(r.parCategorie.bovin.kg_sortis).toBeCloseTo(31.25, 3);
        expect(r.parCategorie.bovin.kg_estime).toBeCloseTo(42.55, 3);
        // La carcasse est bien decrementee, alors qu'aucune vente ne porte son nom.
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(42.55, 3);
    });

    test('sans parage, la meme journee laisserait 43,8 kg: l ecart est le parage', () => {
        const sansParage = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 73.8, total: 283023, prix_unitaire: 3835 }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 30 }],
            ratios: { bovin: 1, ovin: null }
        }));
        expect(ligne('Boeuf')(sansParage).quantite).toBeCloseTo(43.8, 3);
    });

    test('le total est RECALCULE, jamais repris de l ancre', () => {
        // valoriserLignes conserve `total` pour un produit sans prix d'achat:
        // garder celui de l'ancre associerait une vieille valeur a une nouvelle
        // quantite, en silence.
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 73.8, total: 283023, prix_unitaire: 3835 }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 30 }],
            ratios: { bovin: 1, ovin: null }
        }));
        expect(ligne('Boeuf')(r).total).toBeCloseTo(43.8 * 3835, 0);
        expect(ligne('Boeuf')(r).total).not.toBe(283023);
    });

    test('la quantite de l ancre est conservee a cote, pour l affichage', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 73.8, total: 283023, prix_unitaire: 3835 }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 30 }]
        }));
        expect(ligne('Boeuf')(r).quantite_ancre).toBeCloseTo(73.8, 3);
    });
});

describe('repartition au prorata sur les produits de la categorie', () => {
    test('deux produits bovins descendent du meme facteur', () => {
        // Ancre bovin = 70 + 30 = 100 kg. 48 kg vendus, ratio 0,96 -> 50 sortis.
        // Estime = 50 kg, facteur 0,5: chaque ligne est divisee par deux.
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 70, total: 268450, prix_unitaire: 3835 },
                { produit: 'Foie', quantite: 30, total: 120000, prix_unitaire: 4000 }
            ],
            ventes: [{ produit: 'Boeuf en détail', nombre: 48 }]
        }));
        expect(r.parCategorie.bovin.kg_estime).toBeCloseTo(50, 3);
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(35, 3);
        expect(ligne('Foie')(r).quantite).toBeCloseTo(15, 3);
        // La somme de la categorie vaut bien l'estimation.
        expect(ligne('Boeuf')(r).quantite + ligne('Foie')(r).quantite).toBeCloseTo(50, 3);
    });

    test('les categories ne se melangent pas', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 100, total: 383500, prix_unitaire: 3835 },
                { produit: 'Agneau', quantite: 20, total: 90000, prix_unitaire: 4500 }
            ],
            ventes: [{ produit: 'Boeuf en détail', nombre: 48 }],
            ratios: { bovin: 0.96, ovin: 0.98 }
        }));
        // L'ovin n'a rien vendu: il reste intact.
        expect(ligne('Agneau')(r).quantite).toBeCloseTo(20, 3);
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(50, 3);
    });
});

describe('hors boucherie: aucun parage', () => {
    test('soustraction directe, produit par produit', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Vermicelles', quantite: 12, total: 6000, prix_unitaire: 500 }],
            ventes: [{ produit: 'Vermicelles', nombre: 5 }]
        }));
        expect(ligne('Vermicelles')(r).quantite).toBeCloseTo(7, 3);
        expect(r.nb_lignes_sans_parage).toBe(1);
        expect(r.nb_lignes_parage).toBe(0);
    });

    test('boucherie SANS categorie de parage (volaille) suit la voie sans parage', () => {
        // Poulet est de la famille Boucherie mais categorieDe rend null: aucun
        // taux mesure ne lui correspond, on ne lui en applique aucun.
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Poulet', quantite: 15, total: 45000, prix_unitaire: 3000 }],
            ventes: [{ produit: 'Poulet', nombre: 4 }]
        }));
        expect(ligne('Poulet')(r).quantite).toBeCloseTo(11, 3);
    });

    test('un produit exclu du parage n est pas rabote par le taux', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 50, total: 191750, prix_unitaire: 3835 },
                { produit: 'Boeuf sur pied', quantite: 200, total: 700000, prix_unitaire: 3500 }
            ],
            ventes: [{ produit: 'Boeuf en détail', nombre: 24 }],
            exclusions: new Set(['Boeuf sur pied'])
        }));
        expect(ligne('Boeuf sur pied')(r).quantite).toBeCloseTo(200, 3);
    });

    test('la famille dechet garde son propre livre', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 50, total: 191750, prix_unitaire: 3835 },
                { produit: 'Déchet 400', quantite: 4, total: 1600, prix_unitaire: 400 }
            ],
            ventes: [
                { produit: 'Boeuf en détail', nombre: 24 },
                { produit: 'Dechet', nombre: 1.5 }
            ]
        }));
        // Le dechet vendu sort du stock dechet, pas du flux viande, et sans parage.
        expect(ligne('Déchet 400')(r).quantite).toBeCloseTo(2.5, 3);
        // Et il n'a pas gonfle les kilos vendus de la categorie.
        expect(r.parCategorie.bovin.kg_vendus).toBeCloseTo(24, 3);
    });
});

describe('transferts', () => {
    test('le signe vient de impact, la quantite est toujours positive', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 50, total: 191750, prix_unitaire: 3835 }],
            transferts: [
                { produit: 'Boeuf', quantite: 30, impact: '1' },
                { produit: 'Boeuf', quantite: 10, impact: '-1' }
            ],
            ventes: [],
            ratios: { bovin: 1, ovin: null }
        }));
        expect(r.parCategorie.bovin.kg_transferts).toBeCloseTo(20, 3);
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(70, 3);
    });

    test('un jete VIDE le stock dechet: c est une sortie bien reelle', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Déchet 400', quantite: 5, total: 2000, prix_unitaire: 400 }],
            transferts: [{ produit: 'Déchet 400', quantite: 3, impact: '-1', extension: { dechet_jete: true } }],
            ventes: []
        }));
        expect(ligne('Déchet 400')(r).quantite).toBeCloseTo(2, 3);
    });

    test('mais un jete ne retranche RIEN au flux viande', () => {
        // Le jete est la pesee d'un dechet mis a la poubelle. La viande, elle,
        // a deja perdu ces kilos au parage: les retrancher une seconde fois
        // les compterait deux fois.
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 50, total: 191750, prix_unitaire: 3835 },
                { produit: 'Déchet 400', quantite: 5, total: 2000, prix_unitaire: 400 }
            ],
            transferts: [{ produit: 'Déchet 400', quantite: 3, impact: '-1', extension: { dechet_jete: true } }],
            ventes: [],
            ratios: { bovin: 1, ovin: null }
        }));
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(50, 3);
        expect(r.parCategorie.bovin.kg_transferts).toBeCloseTo(0, 3);
    });
});

describe('packs', () => {
    test('les kilos de viande vendus en pack sont bien retranches', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 100, total: 383500, prix_unitaire: 3835 }],
            ventes: [{ produit: 'PackTest', nombre: 2 }],
            packs: { PackTest: [{ produit: 'Boeuf en détail', quantite: 12, unite: 'kg' }] },
            ratios: { bovin: 1, ovin: null }
        }));
        // 2 packs x 12 kg = 24 kg, et non 2.
        expect(r.parCategorie.bovin.kg_vendus).toBeCloseTo(24, 3);
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(76, 3);
    });
});

describe('taux non mesurable: repli nomme, jamais un zero silencieux', () => {
    test('sans mois mesurable, repli sur le taux configure et avertissement', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Agneau', quantite: 40, total: 180000, prix_unitaire: 4500 }],
            ventes: [{ produit: 'Laxass', nombre: 19 }],
            ratios: { bovin: 0.96, ovin: null },  // ovin non mesurable
            ratioRepli: 0.95
        }));
        // 19 / 0,95 = 20 kg sortis, et non 19: le repli s'applique vraiment.
        expect(r.parCategorie.ovin.kg_sortis).toBeCloseTo(20, 3);
        expect(r.parCategorie.ovin.taux_mesure).toBe(false);
        expect(r.avertissements.join(' ')).toContain('repli sur le taux de pertes');
    });

    test('un taux mesure est signale comme tel', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 50, total: 191750, prix_unitaire: 3835 }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 24 }]
        }));
        expect(r.parCategorie.bovin.taux_mesure).toBe(true);
        expect(r.parCategorie.bovin.taux_parage).toBeCloseTo(4, 1);
        expect(r.avertissements).toEqual([]);
    });
});

describe('robustesse', () => {
    test('une categorie qui vend sans aucun stock DISPONIBLE est signalee', () => {
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Vermicelles', quantite: 5, total: 2500, prix_unitaire: 500 }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 10 }]
        }));
        expect(r.avertissements.join(' ')).toContain('aucun stock disponible au dernier comptage');
    });

    test('une reception SANS ancre se repartit quand meme', () => {
        // Le garde porte desormais sur le DISPONIBLE (ancre + transferts), pas
        // sur la seule ancre. Une carcasse arrivee sur un produit qui n'avait
        // rien hier est bien du stock: la refuser laissait la journee sans
        // estimation alors que la marchandise est la.
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 0, total: 0, prix_unitaire: 3835 }],
            transferts: [{ produit: 'Boeuf', quantite: 100, impact: '1' }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 24 }]
        }));
        expect(r.avertissements.join(' ')).not.toContain('ne peut pas etre repartie');
        const boeuf = r.lignes.find((l) => l.produit === 'Boeuf');
        expect(boeuf.quantite).toBeGreaterThan(70);
        expect(boeuf.quantite).toBeLessThan(80);
    });

    test('la repartition suit le DISPONIBLE du jour, pas les parts d hier', () => {
        // Le cas mesure en production le 14-08-2026. Hier: Boeuf 57,3 et
        // Viande Hachee 13,75, soit 80,6 % / 19,4 %. Une carcasse de 87,8 kg
        // arrive sur le Boeuf: les parts reelles deviennent 91,3 % / 8,7 %.
        // Repartir sur les parts d'HIER rendait 12,7 kg de boeuf a la viande
        // hachee - la valeur reelle de « Boeuf » etait 108,3 kg.
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 57.3, total: 0, prix_unitaire: 4480 },
                { produit: 'Viande Hachée', quantite: 13.75, total: 0, prix_unitaire: 3600 }
            ],
            transferts: [{ produit: 'Boeuf', quantite: 87.8, impact: '1' }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 38.75 }]
        }));
        const boeuf = r.lignes.find((l) => l.produit === 'Boeuf');
        // Le prorata d'hier donnait 95,57: on exige nettement mieux.
        expect(boeuf.quantite).toBeGreaterThan(105);
        expect(boeuf.quantite).toBeLessThan(111);
    });

    test('une estimation peut sortir negative et passe telle quelle', () => {
        // C'est valoriserLignes qui ecarte les negatifs et les compte a part:
        // les raboter ici masquerait une sous-saisie de stock.
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Vermicelles', quantite: 2, total: 1000, prix_unitaire: 500 }],
            ventes: [{ produit: 'Vermicelles', nombre: 9 }]
        }));
        expect(ligne('Vermicelles')(r).quantite).toBeCloseTo(-7, 3);
    });

    test('aucune ligne d ancre: resultat vide, pas d exception', () => {
        expect(() => estimerStockSoir(base({}))).not.toThrow();
        expect(estimerStockSoir(base({})).lignes).toEqual([]);
    });
});
