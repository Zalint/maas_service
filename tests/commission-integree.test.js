
describe('prixMataApplicable : un seul juge pour le cout ET la commission', () => {
    const { prixMataApplicable } = require('../lib/commission-integree');
    const mata = (prix, depuis) => ({
        parNom: new Map([['agneau', prix]]),
        depuisParNom: new Map([['agneau', depuis]])
    });

    test('journee couverte : le prix facture', () => {
        expect(prixMataApplicable('Agneau', '2026-09-15', mata(4665, '2026-09-01'))).toBe(4665);
        // Le jour meme de l'entree en vigueur est couvert.
        expect(prixMataApplicable('Agneau', '2026-09-01', mata(4665, '2026-09-01'))).toBe(4665);
    });

    test('journee ANTERIEURE au tarif : refus, et le refus est dit', () => {
        // Sans ce garde, aout entier serait valorise au tarif de septembre -
        // et sa commission annulee alors que le cout ne la porte pas.
        const dits = [];
        expect(prixMataApplicable('Agneau', '2026-08-15', mata(4665, '2026-09-01'), (m) => dits.push(m)))
            .toBeNull();
        expect(dits).toHaveLength(1);
        expect(dits[0]).toMatch(/2026-09-01/);
    });

    test('date INCONNUE : refus, pas une autorisation', () => {
        // Un DATA anterieur a ces champs. Traiter l'absence comme un feu vert
        // appliquerait le tarif du jour a toute la periode.
        const dits = [];
        const sansDate = { parNom: new Map([['agneau', 4665]]), depuisParNom: new Map([['agneau', null]]) };
        expect(prixMataApplicable('Agneau', '2026-09-15', sansDate, (m) => dits.push(m))).toBeNull();
        expect(dits[0]).toMatch(/depuis quand/);
    });

    test('produit absent du catalogue MATA, prix nul ou negatif : null', () => {
        expect(prixMataApplicable('Cuisse de poulet', '2026-09-15', mata(4665, '2026-09-01'))).toBeNull();
        expect(prixMataApplicable('Agneau', '2026-09-15', mata(0, '2026-09-01'))).toBeNull();
        expect(prixMataApplicable('Agneau', '2026-09-15', mata(-10, '2026-09-01'))).toBeNull();
    });

    test('accents et casse ignores, comme partout ailleurs', () => {
        const m = { parNom: new Map([['viande hachee', 5000]]), depuisParNom: new Map([['viande hachee', '2026-01-01']]) };
        expect(prixMataApplicable('Viande Hachée', '2026-09-15', m)).toBe(5000);
    });

    test('sans donnee MATA du tout : null, sans lever', () => {
        expect(prixMataApplicable('Agneau', '2026-09-15', null)).toBeNull();
        expect(prixMataApplicable('Agneau', '2026-09-15', {})).toBeNull();
    });

    test('l avertisseur est OPTIONNEL : un refus sans lui ne leve pas', () => {
        // routes/finance-creances.js interroge la meme fonction pour decider de
        // la commission, sans vouloir dupliquer l'avertissement deja pose par
        // le cout.
        expect(() => prixMataApplicable('Agneau', '2026-08-15', mata(4665, '2026-09-01'))).not.toThrow();
    });
});
