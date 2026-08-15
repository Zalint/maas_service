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

// Le Mapping produits, tel que routes/finance.js le fournit: quelle LIGNE DE
// STOCK une vente consomme, et dans quelle proportion. Sans lui, une vente de
// « Boeuf en détail » ne decrementerait rien - le module le signale.
const CIBLES = {
    'Boeuf en détail': { cible: 'Boeuf', coefficient: 1 },
    'Boeuf en gros': { cible: 'Boeuf', coefficient: 1 },
    'Jarret': { cible: 'Boeuf', coefficient: 0.5 },
    'Poulet en détail': { cible: 'Poulet', coefficient: 1 },
    'Yell': { cible: 'Yell', coefficient: 1 },
    // Le dechet se VEND sous « Dechet » et se STOCKE sous « Déchet 400 ».
    // C'est un mapping comme les autres: sans lui, la vente ne decrementerait
    // rien et le module le signalerait.
    'Dechet': { cible: 'Déchet 400', coefficient: 1 }
};

const base = (o) => Object.assign({
    lignesAncre: [], transferts: [], ventes: [],
    ratios: { bovin: 0.96, ovin: null },
    ratioRepli: 0.95,
    cibleDe: (p) => CIBLES[p] || { cible: p, coefficient: 1 },
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
    test('chaque ligne perd SES ventes, pas celles de sa voisine', () => {
        // LA REGLE A CHANGE, et c'est le coeur du correctif.
        //
        // AVANT: le pool bovin faisait 70 + 30 = 100 kg, on estimait 50 pour
        // l'ensemble puis on repartissait au prorata - Boeuf 35, Foie 15. Le
        // Foie perdait donc 15 kg SANS avoir rien vendu, uniquement parce que
        // le boeuf s'etait vendu. C'est ce que le proprietaire du produit a
        // signale sur ses vrais chiffres.
        //
        // MAINTENANT: le Mapping produits dit que « Boeuf en détail » consomme
        // du « Boeuf ». Le Boeuf perd ses 48/0,96 = 50 kg, le Foie ne bouge
        // pas.
        const r = estimerStockSoir(base({
            lignesAncre: [
                { produit: 'Boeuf', quantite: 70, total: 268450, prix_unitaire: 3835 },
                { produit: 'Foie', quantite: 30, total: 120000, prix_unitaire: 4000 }
            ],
            ventes: [{ produit: 'Boeuf en détail', nombre: 48 }]
        }));
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(20, 3);
        expect(ligne('Foie')(r).quantite).toBeCloseTo(30, 3);
    });

    test('le JARRET consomme un demi-kilo de carcasse par piece', () => {
        // Le coefficient du mapping sert des DEUX cotes: au cout comme a la
        // quantite. 10 jarrets vendus retirent 5 kg de carcasse, pas 10 -
        // divises ensuite par le parage.
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 70, total: 0, prix_unitaire: 3835 }],
            ventes: [{ produit: 'Jarret', nombre: 10 }]
        }));
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(70 - (10 * 0.5) / 0.96, 3);
    });

    test('les trois libelles bovins se cumulent sur la MEME ligne', () => {
        // La formule posee par le proprietaire:
        //   ventes(Boeuf) = Boeuf en gros + Boeuf en détail + 0,5 x Jarret
        const r = estimerStockSoir(base({
            lignesAncre: [{ produit: 'Boeuf', quantite: 200, total: 0, prix_unitaire: 3835 }],
            ventes: [
                { produit: 'Boeuf en détail', nombre: 30 },
                { produit: 'Boeuf en gros', nombre: 12 },
                { produit: 'Jarret', nombre: 8 }
            ]
        }));
        const consomme = (30 + 12 + 8 * 0.5) / 0.96;
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(200 - consomme, 3);
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

    test('le cas du 14-08-2026, valeur reelle du Boeuf 108,3 kg', () => {
        // Le cas qui a fait tomber le prorata. Hier: Boeuf 57,3 et Viande
        // Hachee 13,75. Une carcasse de 87,8 kg arrive sur le Boeuf, 38,75 kg
        // de boeuf se vendent, parage mesure 4 %.
        //
        // Le prorata du comptage d'hier donnait 95,57 kg (-12,73), celui du
        // disponible 108,24 (-0,06). Le calcul PAR PRODUIT n'a plus rien a
        // repartir: il tombe sur la valeur exacte, et la Viande Hachee - qui
        // n'a rien vendu ce jour-la - ne bouge pas d'un gramme.
        const r = estimerStockSoir(base({
            ratios: { bovin: 0.96036, ovin: null },
            lignesAncre: [
                { produit: 'Boeuf', quantite: 57.3, total: 0, prix_unitaire: 4480 },
                { produit: 'Viande Hachée', quantite: 13.75, total: 0, prix_unitaire: 3600 }
            ],
            transferts: [{ produit: 'Boeuf', quantite: 87.8, impact: '1' }],
            // Les 38,75 kg de ventes bovines de la journee se REPARTISSENT:
            // 35,34 de boeuf et 3,41 de viande hachee. Les mettre tous sous
            // « Boeuf en détail » - mon premier jeu d'essai - donnait 104,75 kg
            // au lieu de 108,3: le boeuf absorbait des kilos partis de la
            // hachee. La justesse de la formule tient donc entierement a
            // l'attribution des ventes, ce que le Mapping produits fournit.
            ventes: [
                { produit: 'Boeuf en détail', nombre: 35.34 },
                { produit: 'Viande Hachée', nombre: 3.41 }
            ]
        }));
        // 57,3 + 87,8 - 35,34/0,96036 = 108,3 kg — la valeur REELLE relevee.
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(108.3, 1);
        // La hachee ne perd que SES ventes. Elle est encore classee bovine
        // ici, donc elle subit le parage: 13,75 - 3,41/0,96036 = 10,20.
        expect(ligne('Viande Hachée')(r).quantite).toBeCloseTo(10.2, 1);

        // LA DECOMPOSITION, terme a terme. L'ecran l'affiche et laisse
        // l'utilisateur corriger sur sa foi: un total juste obtenu de termes
        // faux passerait les deux assertions ci-dessus sans qu'on le voie.
        // On verifie donc que chaque terme vaut ce qu'il doit ET qu'ils se
        // recomposent en la quantite affichee.
        const cB = ligne('Boeuf')(r).calcul;
        expect(cB.ancre).toBeCloseTo(57.3, 2);
        expect(cB.transferts).toBeCloseTo(87.8, 2);
        expect(cB.vendus).toBeCloseTo(35.34, 2);
        expect(cB.diviseur).toBeCloseTo(0.96036, 4);
        expect(cB.taux_parage).toBeCloseTo(4, 1);
        expect(cB.sortis).toBeCloseTo(35.34 / 0.96036, 2);
        expect(cB.pool).toBe('bovin');
        expect(cB.ancre + cB.transferts - cB.sortis)
            .toBeCloseTo(ligne('Boeuf')(r).quantite, 1);

        // La hachee n'a AUCUN transfert: le terme doit valoir zero, pas etre
        // absent - une case vide se lit comme « on ne sait pas ».
        const cH = ligne('Viande Hachée')(r).calcul;
        expect(cH.ancre).toBeCloseTo(13.75, 2);
        expect(cH.transferts).toBe(0);
        expect(cH.vendus).toBeCloseTo(3.41, 2);
        expect(cH.diviseur).toBeCloseTo(0.96036, 4);
        expect(cH.sortis).toBeCloseTo(3.41 / 0.96036, 2);
        expect(cH.pool).toBe('bovin');
        expect(cH.ancre + cH.transferts - cH.sortis)
            .toBeCloseTo(ligne('Viande Hachée')(r).quantite, 1);
    });

    test("sortir la hachee du parage la rapproche du releve", () => {
        // Le proprietaire du produit doit ajouter « Viande Hachée » a
        // parage_exclusions: elle a son propre stock et ne sort pas de la
        // carcasse. On mesure ici ce que ce reglage change, pour qu'il le
        // decide sur un chiffre et non sur une intuition.
        //
        // Le parage est une perte de DECOUPE. De la viande deja hachee n'en
        // subit pas: lui appliquer les 4 % du boeuf lui retire 0,14 kg qui
        // n'ont jamais ete pares.
        const commun = {
            ratios: { bovin: 0.96036, ovin: null },
            lignesAncre: [{ produit: 'Viande Hachée', quantite: 13.75, total: 0, prix_unitaire: 3600 }],
            ventes: [{ produit: 'Viande Hachée', nombre: 3.41 }]
        };
        const avec = estimerStockSoir(base(commun));
        const sans = estimerStockSoir(base(Object.assign({}, commun, {
            exclusions: new Set(['Viande Hachée'])
        })));
        expect(ligne('Viande Hachée')(avec).quantite).toBeCloseTo(13.75 - 3.41 / 0.96036, 2);
        expect(ligne('Viande Hachée')(sans).quantite).toBeCloseTo(13.75 - 3.41, 2);
        // 10,20 contre 10,34: le releve reel penche pour la seconde.
        expect(ligne('Viande Hachée')(sans).quantite)
            .toBeGreaterThan(ligne('Viande Hachée')(avec).quantite);
    });

    test('une vente SANS ligne de stock a decrementer est SIGNALEE', () => {
        // Le repli le plus dangereux du module: une vente dont la cible n'a
        // pas de ligne ne decremente rien, et l'ecran affiche une journee sans
        // consommation. Il ne casse pas, il ment - donc il parle.
        const r = estimerStockSoir(base({
            cibleDe: (p) => ({ cible: p, coefficient: 1 }),   // aucun mapping
            lignesAncre: [{ produit: 'Boeuf', quantite: 70, total: 0, prix_unitaire: 3835 }],
            ventes: [{ produit: 'Boeuf en détail', nombre: 48 }]
        }));
        expect(ligne('Boeuf')(r).quantite).toBeCloseTo(70, 3);   // rien retranche
        const a = r.avertissements.join(' ');
        expect(a).toMatch(/sans ligne de stock/i);
        // La graphie D'ORIGINE, pas la cle normalisee: le message renvoie vers
        // la colonne « Mappe vers », qui ecrit « Boeuf en détail ».
        expect(a).toContain('Boeuf en détail');
        expect(a).toMatch(/Mappe vers/i);
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
