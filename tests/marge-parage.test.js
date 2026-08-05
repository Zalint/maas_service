/**
 * Marge sur la matiere: vendu_kg x prix de vente moyen - theorique_kg x prix
 * d'achat moyen, les deux ponderes.
 *
 * Les chiffres de chaque test sont calculables de tete, pour qu'une regression
 * se lise sans deboguer.
 */
const { calculerParage } = require('../lib/parage');
const { calculerMarge, repartirMontantPack } = require('../lib/marge-parage');

const categorieDe = (n) => (/boeuf|veau|foie|jarret/i.test(n) ? 'bovin'
    : (/agneau|mouton/i.test(n) ? 'ovin' : null));

const CATALOGUE = { 'Boeuf en détail': 4800, 'Veau en détail': 4600, 'Oeuf': 2700, 'Foie': 4000, 'Agneau': 5300 };
const ACHAT_PRODUIT = { 'Foie': 2500 };
const DEFAUT = { bovin: 3835, ovin: 4500 };

const marge = (parage, ventes, packs) => calculerMarge({
    parage, ventes, packs: packs || {}, categorieDe,
    prixVente: (p) => CATALOGUE[p] || null,
    prixAchat: (p) => ACHAT_PRODUIT[p] || null,
    prixAchatDefaut: DEFAUT
});

describe('repartition du montant d un pack', () => {
    // Un pack porte UN montant alors que ses kilos comptent dans plusieurs
    // categories. Le repartir au kilo ferait payer le meme prix a l'oeuf et au
    // filet; au prorata de la valeur, chacun garde son poids economique.
    test('au prorata de la valeur catalogue, pas des kilos', () => {
        const parts = repartirMontantPack(
            [{ produit: 'Boeuf en détail', quantite: 8, unite: 'kg' },
             { produit: 'Oeuf', quantite: 1, unite: 'tablette' }],
            (p) => CATALOGUE[p] || null
        );
        // 8 x 4800 = 38400 ; 1 x 2700 = 2700 ; total 41100
        expect(parts[0].part).toBeCloseTo(38400 / 41100, 10);
        expect(parts[1].part).toBeCloseTo(2700 / 41100, 10);
        expect(parts[0].part + parts[1].part).toBeCloseTo(1, 10);
    });

    // Une tablette d'oeufs pese 0 kg au sens du parage mais vaut son prix.
    // L'ignorer donnerait toute la valeur du pack a la viande.
    test('un composant a 0 kg garde sa part de valeur', () => {
        const parts = repartirMontantPack(
            [{ produit: 'Boeuf en détail', quantite: 8, unite: 'kg' },
             { produit: 'Oeuf', quantite: 1, unite: 'tablette' }],
            (p) => CATALOGUE[p] || null
        );
        expect(parts[1].kg).toBe(0);
        expect(parts[1].part).toBeGreaterThan(0);
    });

    test('sans aucun prix connu: repli sur les kilos', () => {
        const parts = repartirMontantPack(
            [{ produit: 'Inconnu A', quantite: 3, unite: 'kg' },
             { produit: 'Inconnu B', quantite: 1, unite: 'kg' }],
            () => null
        );
        expect(parts[0].part).toBeCloseTo(0.75, 10);
        expect(parts[1].part).toBeCloseTo(0.25, 10);
    });

    test('ni prix ni kilos: aucune part, et pas de division par zero', () => {
        const parts = repartirMontantPack(
            [{ produit: 'Oeuf', quantite: 1, unite: 'tablette' }],
            () => null
        );
        expect(parts[0].part).toBe(0);
        expect(Number.isFinite(parts[0].part)).toBe(true);
    });
});

describe('marge, cas nominal', () => {
    const packs = { Pack50000: [
        { produit: 'Boeuf en détail', quantite: 8, unite: 'kg' },
        { produit: 'Oeuf', quantite: 1, unite: 'tablette' }
    ] };
    const ventes = [
        { pointVente: 'M', produit: 'Boeuf en détail', nombre: 60, montant: 288000 },
        { pointVente: 'M', produit: 'Foie', nombre: 4, montant: 16000 },
        { pointVente: 'M', produit: 'Pack50000', nombre: 2, montant: 100000 }
    ];
    const parage = calculerParage({
        stocksMatin: [{ pointVente: 'M', produit: 'Boeuf', quantite: 100 },
                      { pointVente: 'M', produit: 'Foie', quantite: 5 }],
        transferts: [],
        stocksSoir: [{ pointVente: 'M', produit: 'Boeuf', quantite: 20 }],
        ventes, categorieDe, packs
    });
    const r = marge(parage.M, ventes, packs).bovin;

    test('les kilos vendus incluent le contenu des packs', () => {
        expect(r.details.hors_pack.vendu_kg).toBe(64);   // 60 boeuf + 4 foie
        expect(r.details.pack.vendu_kg).toBe(16);        // 8 kg x 2 packs
        expect(r.vendu_kg).toBe(80);
    });

    test('le chiffre d affaires du pack est sa part de valeur', () => {
        // 100000 x 38400/41100
        expect(r.details.pack.ca_vendu).toBeCloseTo(100000 * 38400 / 41100, 6);
        expect(r.details.hors_pack.ca_vendu).toBe(304000);
        expect(r.ca_vendu).toBeCloseTo(304000 + 100000 * 38400 / 41100, 6);
    });

    test('le prix de vente moyen est pondere par les kilos', () => {
        expect(r.details.hors_pack.prix_vente_moyen).toBe(304000 / 64);
        expect(r.prix_vente_moyen).toBeCloseTo(r.ca_vendu / 80, 6);
    });

    // Le foie a son prix d'achat propre; le boeuf prend celui de la matiere.
    test('le cout mele prix propre et prix de la matiere', () => {
        expect(r.theorique_kg).toBe(85);                 // boeuf 80 + foie 5
        expect(r.cout_theorique).toBe(80 * 3835 + 5 * 2500);
        expect(r.prix_achat_moyen).toBeCloseTo((80 * 3835 + 5 * 2500) / 85, 6);
    });

    test('la marge est bien CA moins cout', () => {
        expect(r.marge).toBeCloseTo(r.ca_vendu - r.cout_theorique, 6);
    });
});

describe('le veau est un boeuf vendu plus cher', () => {
    // Meme carcasse, donc meme prix d'achat; la prime se voit cote vente.
    //
    // Cette equivalence est une regle METIER: elle est fournie par l'appelant
    // via prixAchat, et non devinee par le calcul. Sans elle, le veau tomberait
    // dans la deduction a 10% et couterait 4140 au lieu de 3835 - une marge
    // faussee par une hypothese la ou existe un prix reel.
    test('veau et boeuf partagent le prix d achat, quand l appelant le dit', () => {
        const ventes = [{ pointVente: 'M', produit: 'Veau en détail', nombre: 10, montant: 46000 }];
        const parage = calculerParage({
            stocksMatin: [{ pointVente: 'M', produit: 'Veau en détail', quantite: 12 }],
            stocksSoir: [], transferts: [], ventes, categorieDe
        });
        const r = calculerMarge({
            parage: parage.M, ventes, packs: {}, categorieDe,
            prixVente: (p) => CATALOGUE[p] || null,
            // La route resout Veau -> prix du Boeuf.
            prixAchat: (p) => (/veau|boeuf/i.test(p) ? 3835 : (ACHAT_PRODUIT[p] || null)),
            prixAchatDefaut: DEFAUT
        }).bovin;
        expect(r.prix_achat_moyen).toBe(3835);
        expect(r.cout_theorique).toBe(12 * 3835);
        expect(r.prix_vente_moyen).toBe(4600);
        // Aucune hypothese: tout est mesure.
        expect(r.hypotheses).toEqual([]);
    });

    test('sans cette regle, le veau serait deduit a 10% - et signale', () => {
        const parage = calculerParage({
            stocksMatin: [{ pointVente: 'M', produit: 'Veau en détail', quantite: 12 }],
            stocksSoir: [], transferts: [], ventes: [], categorieDe
        });
        const r = marge(parage.M, []).bovin;
        expect(r.prix_achat_moyen).toBeCloseTo(4600 * 0.9, 6);
        expect(r.hypotheses).toHaveLength(1);
        expect(r.hypotheses[0].methode).toMatch(/marge supposee de 10%/);
    });
});

describe('hypotheses de prix', () => {
    // Le cas du foie et du yell tant qu'ils n'ont pas de prix d'achat saisi.
    test('un prix deduit est nomme, avec sa methode et les deux prix', () => {
        const parage = calculerParage({
            stocksMatin: [{ pointVente: 'M', produit: 'Boeuf', quantite: 80 },
                          { pointVente: 'M', produit: 'Foie', quantite: 5 }],
            stocksSoir: [], transferts: [], ventes: [], categorieDe
        });
        const r = calculerMarge({
            parage: parage.M, ventes: [], packs: {}, categorieDe,
            prixVente: (p) => (p === 'Foie' ? 4000 : null),
            prixAchat: (p) => (p === 'Boeuf' ? 3835 : null),
            prixAchatDefaut: DEFAUT
        }).bovin;
        expect(r.hypotheses).toEqual([{
            produit: 'Foie',
            prix_vente: 4000,
            prix_achat_estime: 3600,
            methode: 'deduit du prix de vente, marge supposee de 10%'
        }]);
        // Le boeuf, lui, garde son prix mesure.
        expect(r.cout_theorique).toBe(80 * 3835 + 5 * 3600);
    });

    test('la marge supposee est parametrable, et le message suit', () => {
        const r = calculerMarge({
            parage: { bovin: { theorique: 10, vendu: 0, perte: null, parProduit: { Foie: { theorique: 10 } } },
                      ovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} } },
            ventes: [], categorieDe,
            prixVente: () => 1000, prixAchat: () => null,
            prixAchatDefaut: DEFAUT, margeSupposee: 0.25
        }).bovin;
        expect(r.hypotheses[0].prix_achat_estime).toBe(750);
        expect(r.hypotheses[0].methode).toMatch(/25%/);
    });
});

describe('produits sans prix d achat', () => {
    test('ils sont nommes, et ne tirent pas la moyenne vers zero', () => {
        const r = calculerMarge({
            parage: {
                bovin: { theorique: 20, vendu: 0, perte: null, parProduit: {
                    'Boeuf': { theorique: 15 }, 'Mystere': { theorique: 5 }
                } },
                ovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} }
            },
            ventes: [], categorieDe,
            prixVente: () => null,
            prixAchat: (p) => (p === 'Boeuf' ? 3835 : null),
            prixAchatDefaut: { bovin: null, ovin: null }
        }).bovin;
        expect(r.produits_sans_prix_achat).toEqual(['Mystere']);
        expect(r.kg_sans_prix_achat).toBe(5);
        // Moyenne sur les 15 kg reellement coutes, pas sur les 20.
        expect(r.prix_achat_moyen).toBe(3835);
        expect(r.cout_theorique).toBe(15 * 3835);
    });
});

describe('cas limites', () => {
    test('aucune vente: prix moyen null, jamais zero', () => {
        const r = marge({ bovin: { theorique: 10, vendu: 0, perte: 1, parProduit: { Boeuf: { theorique: 10 } } },
                          ovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} } }, []).bovin;
        expect(r.prix_vente_moyen).toBeNull();
        expect(r.ca_vendu).toBe(0);
        expect(r.marge).toBe(-10 * 3835);
    });

    test('des kilos infimes ne produisent pas un prix au kilo absurde', () => {
        const ventes = [{ pointVente: 'M', produit: 'Boeuf en détail', nombre: 0.0001, montant: 1 }];
        const r = marge({ bovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} },
                          ovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} } }, ventes).bovin;
        expect(r.prix_vente_moyen).toBeNull();
    });

    test('un produit exclu ne compte ni en kilos ni en chiffre d affaires', () => {
        const ventes = [{ pointVente: 'M', produit: 'Foie', nombre: 4, montant: 16000 }];
        const r = calculerMarge({
            parage: { bovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} },
                      ovin: { theorique: 0, vendu: 0, perte: null, parProduit: {} } },
            ventes, categorieDe,
            prixVente: (p) => CATALOGUE[p] || null,
            prixAchat: () => null, prixAchatDefaut: DEFAUT,
            exclusions: new Set(['Foie'])
        }).bovin;
        expect(r.vendu_kg).toBe(0);
        expect(r.ca_vendu).toBe(0);
    });
});
