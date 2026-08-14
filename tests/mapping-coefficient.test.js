/**
 * Le coefficient du Mapping produits, cote saisie.
 *
 * C'est le seul champ de cet ecran qui MULTIPLIE un cout. Une valeur nulle y
 * rendrait une marge egale au prix de vente, et le produit passerait en tete
 * des classements de rentabilite sans que rien ne signale d'ou vient le
 * chiffre. La validation vaut donc d'etre verrouillee pour elle-meme.
 *
 * @jest-environment node
 */

const { validerCoefficient } = require('../routes/finance');

describe('absent = 1, le comportement d avant la colonne', () => {
    test('undefined, null et chaine vide valent 1', () => {
        // Le champ est facultatif a l'ecran: la quasi-totalite des decoupes se
        // vendent dans l'unite de leur carcasse. Exiger une saisie ferait
        // ressaisir 1 des dizaines de fois.
        for (const brut of [undefined, null, '', '   ']) {
            expect(validerCoefficient(brut)).toEqual({ ok: true, valeur: 1 });
        }
    });
});

describe('les valeurs acceptees', () => {
    test('le cas Jarret: 0,5', () => {
        // Vendu a la PIECE, environ 500 g - la moitie d'un kilo de carcasse.
        expect(validerCoefficient(0.5)).toEqual({ ok: true, valeur: 0.5 });
        expect(validerCoefficient('0.5')).toEqual({ ok: true, valeur: 0.5 });
    });

    test('1 reste 1, et les valeurs superieures a 1 sont legitimes', () => {
        // Un libelle peut se vendre par lot: une unite vendue = plusieurs
        // unites de la cible. Rien ne justifie de brider ce sens-la.
        expect(validerCoefficient(1).valeur).toBe(1);
        expect(validerCoefficient(2.5).valeur).toBe(2.5);
        expect(validerCoefficient(1000).valeur).toBe(1000);
    });
});

describe('les valeurs refusees, et le motif rendu', () => {
    test('zero et negatif sont REFUSES, jamais ramenes a 1', () => {
        // Les ramener silencieusement a 1 changerait le cout sans le dire.
        // Un refus explicite laisse l'utilisateur decider.
        for (const brut of [0, '0', -1, '-0.5']) {
            const r = validerCoefficient(brut);
            expect(r.ok).toBe(false);
            expect(r.erreur).toMatch(/strictement positif/);
        }
    });

    test('ce qui n est pas un nombre est refuse', () => {
        for (const brut of ['abc', {}, [1, 2], NaN, Infinity]) {
            expect(validerCoefficient(brut).ok).toBe(false);
        }
    });

    test('une unite collee ne passe PAS pour une saisie valide', () => {
        // parseFloat('0.5kg') rend 0,5 sans broncher. La saisie serait
        // acceptee, le champ afficherait 0,5, et personne ne saurait que la
        // moitie de ce qui a ete tape a ete jetee.
        expect(validerCoefficient('0.5kg').ok).toBe(false);
        expect(validerCoefficient('2 pieces').ok).toBe(false);
    });

    test('au-dela de 1000, c est une virgule qui a glisse', () => {
        const r = validerCoefficient(1001);
        expect(r.ok).toBe(false);
        expect(r.erreur).toMatch(/1000 au maximum/);
    });

    test('un tableau vide ne devient pas 1 par accident', () => {
        // Number([]) vaut 0, donc refuse. C'est le bon resultat, mais il
        // tient a une conversion implicite: on le verrouille.
        expect(validerCoefficient([]).ok).toBe(false);
    });
});
