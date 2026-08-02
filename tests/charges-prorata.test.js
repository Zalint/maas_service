/**
 * Prorata des charges fixes dans le PL.
 *
 * Regression corrigee: le prorata utilisait un mois conventionnel de 30 jours
 * (montant x nbJours / 30). Juillet, qui compte 31 jours, etait donc facture
 * 31/30e: 420 000 FCFA de charges devenaient 434 000 pour un mois pourtant
 * complet. Le prorata se calcule desormais sur les jours REELS de chaque mois
 * traverse, si bien qu'un mois entier vaut exactement son montant.
 */

const { decouperEnMois, joursDansLeMois } = require('../lib/charges-prorata');

// Applique le prorata comme le fait le PL, a montant mensuel constant.
function proratiser(dateDebut, dateFin, montantMensuel) {
    return decouperEnMois(dateDebut, dateFin).reduce(
        (total, m) => total + montantMensuel * m.joursCouverts / m.joursDuMois,
        0
    );
}

describe('joursDansLeMois', () => {
    test('mois de 31, 30 et 28 jours', () => {
        expect(joursDansLeMois('2026-07')).toBe(31);
        expect(joursDansLeMois('2026-06')).toBe(30);
        expect(joursDansLeMois('2026-02')).toBe(28);
    });

    test('fevrier bissextile', () => {
        expect(joursDansLeMois('2024-02')).toBe(29);
    });
});

describe('decouperEnMois', () => {
    test('un mois complet: un seul segment, entierement couvert', () => {
        expect(decouperEnMois('2026-07-01', '2026-07-31')).toEqual([
            { mois: '2026-07', joursCouverts: 31, joursDuMois: 31 }
        ]);
    });

    test('periode a cheval sur deux mois', () => {
        expect(decouperEnMois('2026-06-15', '2026-07-10')).toEqual([
            { mois: '2026-06', joursCouverts: 16, joursDuMois: 30 },
            { mois: '2026-07', joursCouverts: 10, joursDuMois: 31 }
        ]);
    });

    test('journee unique', () => {
        expect(decouperEnMois('2026-07-15', '2026-07-15')).toEqual([
            { mois: '2026-07', joursCouverts: 1, joursDuMois: 31 }
        ]);
    });

    test('trois mois, dont un partiel a chaque bout', () => {
        const segments = decouperEnMois('2026-01-20', '2026-03-05');
        expect(segments.map((s) => s.mois)).toEqual(['2026-01', '2026-02', '2026-03']);
        expect(segments.map((s) => s.joursCouverts)).toEqual([12, 28, 5]);
        expect(segments.map((s) => s.joursDuMois)).toEqual([31, 28, 31]);
    });

    test('bornes inversees: aucun segment', () => {
        expect(decouperEnMois('2026-07-31', '2026-07-01')).toEqual([]);
    });
});

describe('prorata applique aux charges', () => {
    const CHARGES = 420000; // masse salariale + loyer + electricite + internet

    test("juillet complet vaut exactement le montant mensuel (le bug rendait 434 000)", () => {
        expect(proratiser('2026-07-01', '2026-07-31', CHARGES)).toBeCloseTo(420000, 2);
    });

    test('fevrier complet aussi, malgre ses 28 jours', () => {
        expect(proratiser('2026-02-01', '2026-02-28', CHARGES)).toBeCloseTo(420000, 2);
    });

    test('juin complet, 30 jours', () => {
        expect(proratiser('2026-06-01', '2026-06-30', CHARGES)).toBeCloseTo(420000, 2);
    });

    test('demi-mois: prorate sur les jours reels du mois', () => {
        // 15 jours sur les 31 de juillet, et non sur 30.
        expect(proratiser('2026-07-01', '2026-07-15', CHARGES))
            .toBeCloseTo(420000 * 15 / 31, 2);
    });

    test('deux mois complets valent deux fois le montant mensuel', () => {
        expect(proratiser('2026-06-01', '2026-07-31', CHARGES)).toBeCloseTo(840000, 2);
    });

    test('periode a cheval: chaque mois compte sur ses propres jours', () => {
        const attendu = CHARGES * 16 / 30 + CHARGES * 10 / 31;
        expect(proratiser('2026-06-15', '2026-07-10', CHARGES)).toBeCloseTo(attendu, 2);
    });

    test("une annee complete vaut douze mois, sans derive", () => {
        expect(proratiser('2026-01-01', '2026-12-31', CHARGES)).toBeCloseTo(420000 * 12, 2);
    });
});
