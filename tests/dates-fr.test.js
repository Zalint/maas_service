/**
 * Les trois lectures d'une date, ecrites une seule fois.
 *
 * Ce module remplace six formateurs recopies dans js/finance.js et
 * js/simulation-v2.js. Les tests fixent exactement les replis que ces copies
 * avaient - c'est ce qui rend le remplacement sur: un repli qui change en
 * silence transforme une cellule de tableau en 'undefined' ou 'null'.
 *
 * @jest-environment node
 */
const d = require('../lib/dates-fr');

describe('jourISO', () => {
    test('un jour, ou un instant, rendent le meme jour', () => {
        expect(d.jourISO('2026-08-12')).toBe('2026-08-12');
        expect(d.jourISO('2026-08-12T09:30:00Z')).toBe('2026-08-12');
        expect(d.jourISO('2026-08-12T23:59:59.999+02:00')).toBe('2026-08-12');
    });

    test('AUCUN objet Date n est converti', () => {
        // C'etait le piege de la version precedente: new Date(v).toISOString()
        // sur un Date a minuit LOCAL dans une zone en avance sur UTC rend la
        // VEILLE, ce qui aurait decale une colonne entiere d'une ligne. Une
        // chaine vide s'affiche en tiret - ca se voit; un jour faux non.
        expect(d.jourISO(new Date('2026-08-12T00:00:00Z'))).toBe('');
        expect(d.jourISO(1786000000000)).toBe('');
    });

    test('ce qui n est pas une date rend une chaine vide', () => {
        for (const v of [null, undefined, '', 'demain', '12/08/2026', '2026-8-2', {}]) {
            expect(d.jourISO(v)).toBe('');
        }
    });
});

describe('enFrancais', () => {
    test('ISO vers JJ/MM/AAAA', () => {
        expect(d.enFrancais('2026-08-12')).toBe('12/08/2026');
        expect(d.enFrancais('2026-08-12T09:30:00Z')).toBe('12/08/2026');
        expect(d.enFrancais('2026-01-01')).toBe('01/01/2026');
    });

    test('rend l entree INCHANGEE quand elle n est pas lisible', () => {
        // Repli des formateurs remplaces: mieux vaut afficher une valeur brute
        // dans une cellule que rien du tout.
        expect(d.enFrancais('déjà en clair')).toBe('déjà en clair');
        expect(d.enFrancais('')).toBe('');
        expect(d.enFrancais(null)).toBe(null);
        expect(d.enFrancais(undefined)).toBe(undefined);
        const o = {};
        expect(d.enFrancais(o)).toBe(o);
    });
});

describe('ecartEnJours', () => {
    test('compte les jours calendaires, dans le bon sens', () => {
        expect(d.ecartEnJours('2026-08-09', '2026-08-12')).toBe(3);
        expect(d.ecartEnJours('2026-08-12', '2026-08-12')).toBe(0);
        expect(d.ecartEnJours('2026-08-12', '2026-08-09')).toBe(-3);
    });

    test('traverse les mois et les annees', () => {
        expect(d.ecartEnJours('2026-07-31', '2026-08-01')).toBe(1);
        expect(d.ecartEnJours('2025-12-31', '2026-01-01')).toBe(1);
        // 2028 est bissextile: fevrier compte 29 jours.
        expect(d.ecartEnJours('2028-02-28', '2028-03-01')).toBe(2);
    });

    test('les instants sont ramenes a leur jour avant la soustraction', () => {
        // Sans cette normalisation, 23h59 - 00h01 aurait rendu 0 jour la ou il
        // y en a un.
        expect(d.ecartEnJours('2026-08-11T23:59:00Z', '2026-08-12T00:01:00Z')).toBe(1);
    });

    test('une borne illisible rend null, jamais NaN', () => {
        // NaN se propage en silence; null se teste.
        expect(d.ecartEnJours('demain', '2026-08-12')).toBeNull();
        expect(d.ecartEnJours('2026-08-12', null)).toBeNull();
        expect(d.ecartEnJours(new Date(), new Date())).toBeNull();
    });
});

describe('les dates qui ont la FORME sans exister', () => {
    // Le motif ISO ne dit rien du calendrier. Une date impossible qui passe se
    // propage jusque dans une soustraction de jours, ou elle rend un ecart
    // faux plutot que le null qui aurait alerte.
    test('le 30 fevrier est refuse', () => {
        expect(d.jourISO('2026-02-30')).toBe('');
        expect(d.ecartEnJours('2026-02-01', '2026-02-30')).toBeNull();
    });

    test('le 29 fevrier est refuse hors annee bissextile, accepte dedans', () => {
        expect(d.jourISO('2027-02-29')).toBe('');   // 2027 n'est pas bissextile
        expect(d.jourISO('2028-02-29')).toBe('2028-02-29');
        // 1900 est divisible par 4 mais PAS bissextile: siecle non divisible
        // par 400. C'est le cas que les implementations naives ratent.
        expect(d.jourISO('1900-02-29')).toBe('');
        expect(d.jourISO('2000-02-29')).toBe('2000-02-29');
    });

    test('le 31 d un mois de 30 jours est refuse', () => {
        for (const m of ['04', '06', '09', '11']) {
            expect(d.jourISO(`2026-${m}-31`)).toBe('');
        }
        for (const m of ['01', '03', '05', '07', '08', '10', '12']) {
            expect(d.jourISO(`2026-${m}-31`)).toBe(`2026-${m}-31`);
        }
    });

    test('le mois 00 ou 13, et le jour 00, sont refuses', () => {
        expect(d.jourISO('2026-00-10')).toBe('');
        expect(d.jourISO('2026-13-10')).toBe('');
        expect(d.jourISO('2026-08-00')).toBe('');
    });

    test('une date valide reste intacte, instant compris', () => {
        expect(d.jourISO('2026-08-31T23:00:00Z')).toBe('2026-08-31');
    });
});
