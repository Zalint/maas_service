/**
 * @jest-environment node
 *
 * Le detail par date confronte aux avances du partenaire.
 *
 * Deux comptabilites decrivent la meme livraison par deux bouts: Maas la
 * valorise a la reception au prix d'achat fournisseur, MataBanq enregistre une
 * avance au depart. Elles doivent tomber sur le meme montant, et sur aout 2026
 * a Mbao elles y tombent au franc.
 *
 * LA COMPARAISON EST PAR DATE. Une journee porte plusieurs produits et une
 * seule avance: confronter une ligne isolee ferait crier a l'ecart sur toutes
 * les journees a plusieurs produits.
 */

const { rapprocherAvances, TOLERANCE_PAR_DEFAUT } = require('../lib/rapprochement-avances');

const l = (date, produit, montant_achat) => ({ date, produit, montant_achat });
const av = (date, montant) => ({ date, montant });

describe('la comparaison porte sur le TOTAL de la date', () => {
    test('plusieurs produits somment a l avance du jour', () => {
        // Le 17/08 reel: Boeuf 688 500 + Yell 8 000 = 696 500 = l'avance.
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-17', 'Boeuf', 688500), l('2026-08-17', 'Yell', 8000)],
            avances: [av('2026-08-17', 696500)]
        });
        const d = r.par_date['2026-08-17'];
        expect(d.montant_achat).toBe(696500);
        expect(d.ecart).toBe(0);
        expect(d.statut).toBe('correspond');
        expect(d.nb_produits).toBe(2);
    });

    test('une ligne seule ne se compare PAS a l avance du jour', () => {
        // Si la regle etait par ligne, Boeuf 688 500 contre 696 500 crierait a
        // l'ecart de 8 000 alors que la journee tombe juste.
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-17', 'Boeuf', 688500), l('2026-08-17', 'Yell', 8000)],
            avances: [av('2026-08-17', 696500)]
        });
        expect(r.resume.nb_ecart).toBe(0);
    });

    test('le cas reel du 14/08: quatre produits, accord exact', () => {
        const r = rapprocherAvances({
            detailParDate: [
                l('2026-08-14', 'Boeuf', 393344), l('2026-08-14', 'Poulet', 90000),
                l('2026-08-14', 'Yell', 8000), l('2026-08-14', 'Foie', 5625)
            ],
            avances: [av('2026-08-14', 496969)]
        });
        expect(r.par_date['2026-08-14'].statut).toBe('correspond');
        expect(r.par_date['2026-08-14'].ecart).toBe(0);
    });
});

describe('la tolerance', () => {
    test('vaut 5 F par defaut', () => {
        expect(TOLERANCE_PAR_DEFAUT).toBe(5);
    });

    test('5 F d ecart correspond encore, 6 F non', () => {
        const faire = (montant) => rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', montant)],
            avances: [av('2026-08-10', 100000)]
        }).par_date['2026-08-10'].statut;
        expect(faire(100005)).toBe('correspond');
        expect(faire(99995)).toBe('correspond');
        expect(faire(100006)).toBe('ecart');
        expect(faire(99994)).toBe('ecart');
    });

    test('une tolerance explicite remplace la valeur par defaut', () => {
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', 100050)],
            avances: [av('2026-08-10', 100000)],
            tolerance: 100
        });
        expect(r.par_date['2026-08-10'].statut).toBe('correspond');
        expect(r.tolerance).toBe(100);
    });

    test('une tolerance illisible retombe sur 5, jamais sur zero', () => {
        // Zero ferait crier a l'ecart sur le moindre centime d'arrondi.
        for (const mauvaise of [null, undefined, 'abc', NaN]) {
            const r = rapprocherAvances({
                detailParDate: [l('2026-08-10', 'Boeuf', 100003)],
                avances: [av('2026-08-10', 100000)],
                tolerance: mauvaise
            });
            expect(r.tolerance).toBe(5);
            expect(r.par_date['2026-08-10'].statut).toBe('correspond');
        }
    });
});

describe('ce qui empeche de conclure', () => {
    test('un produit sans prix d achat rend la date INCOMPLETE, pas en ecart', () => {
        // Le compter a zero ferait manquer la journee a l'avance et afficherait
        // un ecart qui ne decrit qu'une donnee absente.
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', 90000), l('2026-08-10', 'Mystere', null)],
            avances: [av('2026-08-10', 100000)]
        });
        const d = r.par_date['2026-08-10'];
        expect(d.statut).toBe('incomplet');
        expect(d.nb_sans_prix).toBe(1);
        expect(r.resume.nb_ecart).toBe(0);
        // L'ecart reste calcule, pour que l'ecran puisse le montrer a titre
        // indicatif - mais le statut interdit de l'affirmer.
        expect(d.ecart).toBe(-10000);
    });

    test('incomplet prime meme quand le total tomberait juste', () => {
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', 100000), l('2026-08-10', 'Mystere', null)],
            avances: [av('2026-08-10', 100000)]
        });
        expect(r.par_date['2026-08-10'].statut).toBe('incomplet');
    });

    test('une date sans avance se distingue d une date en ecart', () => {
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', 90000)],
            avances: []
        });
        const d = r.par_date['2026-08-10'];
        expect(d.statut).toBe('sans_avance');
        expect(d.avance).toBeNull();
        // Pas d'ecart chiffre: il n'y a rien a quoi se comparer.
        expect(d.ecart).toBeNull();
    });
});

describe('les deux sens du rapprochement', () => {
    test('plusieurs avances le meme jour s additionnent', () => {
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', 100000)],
            avances: [av('2026-08-10', 60000), av('2026-08-10', 40000)]
        });
        expect(r.par_date['2026-08-10'].avance).toBe(100000);
        expect(r.par_date['2026-08-10'].statut).toBe('correspond');
    });

    test('une avance sans aucune ligne de detail est signalee', () => {
        // Marchandise partie de chez MATA sans etre recue cote Maas, ou recue
        // sous une autre date. Le taire laisserait croire au rapprochement
        // complet.
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10', 'Boeuf', 100000)],
            avances: [av('2026-08-10', 100000), av('2026-08-06', 456020)]
        });
        expect(r.resume.avances_sans_detail).toEqual([{ date: '2026-08-06', montant: 456020 }]);
    });

    test('le resume compte chaque nature separement', () => {
        const r = rapprocherAvances({
            detailParDate: [
                l('2026-08-10', 'A', 100000),
                l('2026-08-11', 'B', 90000),
                l('2026-08-12', 'C', 50000),
                l('2026-08-13', 'D', null)
            ],
            avances: [av('2026-08-10', 100000), av('2026-08-11', 100000), av('2026-08-13', 1)]
        });
        expect(r.resume).toMatchObject({
            nb_dates: 4, nb_correspond: 1, nb_ecart: 1, nb_sans_avance: 1, nb_incomplet: 1
        });
        // L'ecart total ne porte que sur les dates reellement en desaccord.
        expect(r.resume.ecart_total).toBe(-10000);
    });
});

describe('robustesse', () => {
    test('des entrees vides rendent un resume nul, pas une erreur', () => {
        const r = rapprocherAvances({});
        expect(r.par_date).toEqual({});
        expect(r.resume.nb_dates).toBe(0);
        expect(r.resume.ecart_total).toBe(0);
    });

    test('une ligne sans date est ignoree plutot que rangee sous une cle vide', () => {
        const r = rapprocherAvances({
            detailParDate: [l(null, 'Boeuf', 1000), l('2026-08-10', 'Boeuf', 1000)],
            avances: [av('', 500), av('2026-08-10', 1000)]
        });
        expect(Object.keys(r.par_date)).toEqual(['2026-08-10']);
        expect(r.resume.avances_sans_detail).toEqual([]);
    });

    test('une date horodatee est ramenee au jour', () => {
        const r = rapprocherAvances({
            detailParDate: [l('2026-08-10T17:00:00Z', 'Boeuf', 1000)],
            avances: [av('2026-08-10T09:00:00Z', 1000)]
        });
        expect(r.par_date['2026-08-10'].statut).toBe('correspond');
    });
});
