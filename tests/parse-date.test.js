/**
 * parseDate (db/utils.js) — le convertisseur de dates de saisie.
 *
 * Il rendait SILENCIEUSEMENT une date fausse mais plausible pour toute entree
 * au format ISO: '2026-08-02' devenait le 16 fevrier 2008. Comme la date
 * restait valide, aucun appelant ne pouvait s'en apercevoir. Consequence
 * mesuree: syncStockJsonFromBDD interrogeait la base sur une date inexistante,
 * ne trouvait rien, et ecrivait un stock-soir.json VIDE - neuf journees en
 * portent la trace, dont huit ou la table contenait 85 a 90 lignes.
 */
const { parseDate, formatDate } = require('../lib/dates');

const enJjmmaaaa = (s) => {
    const d = parseDate(s);
    return d ? formatDate(d) : null;
};

describe('formats acceptes', () => {
    test('ISO AAAA-MM-JJ — le format que les appelants passent reellement', () => {
        expect(enJjmmaaaa('2026-08-02')).toBe('02-08-2026');
        expect(enJjmmaaaa('2026-08-08')).toBe('08-08-2026');
        expect(enJjmmaaaa('2026-01-31')).toBe('31-01-2026');
    });

    test('JJ-MM-AAAA, le format de la colonne stocks.date', () => {
        expect(enJjmmaaaa('02-08-2026')).toBe('02-08-2026');
    });

    test('JJ/MM/AAAA, le format de saisie', () => {
        expect(enJjmmaaaa('02/08/2026')).toBe('02-08-2026');
    });

    test('un ISO horodate est accepte, l heure est ignoree', () => {
        expect(enJjmmaaaa('2026-08-02T10:30:00Z')).toBe('02-08-2026');
    });

    test('annee sur deux chiffres, comportement historique conserve', () => {
        expect(enJjmmaaaa('02/08/26')).toBe('02-08-2026');
    });
});

describe('la regression qui a vide neuf fichiers', () => {
    // C'EST le test qui compte: sans lui, la branche ISO peut disparaitre a
    // la faveur d'un refactoring et le bug revient sans bruit.
    test("'2026-08-02' ne doit JAMAIS rendre une date de 2008", () => {
        const d = parseDate('2026-08-02');
        expect(d).not.toBeNull();
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(7);   // aout
        expect(d.getDate()).toBe(2);
    });

    test('les deux graphies de la meme journee donnent la meme date', () => {
        expect(enJjmmaaaa('2026-08-02')).toBe(enJjmmaaaa('02-08-2026'));
    });

    test('toutes les journees d un mois survivent a l aller-retour ISO', () => {
        for (let j = 1; j <= 31; j++) {
            const iso = `2026-08-${String(j).padStart(2, '0')}`;
            const attendu = `${String(j).padStart(2, '0')}-08-2026`;
            expect(enJjmmaaaa(iso)).toBe(attendu);
        }
    });
});

describe('formatDate ne fabrique jamais une date de repli', () => {
    // formatDate(null) valait '01-01-1970' - new Date(null) est l'epoch. Comme
    // parseDate rend null sur une entree illisible, le couple
    // formatDate(parseDate(x)) rangeait la donnee au 1er janvier 1970. Trois
    // des neuf sites d'appel font un destroy suivi d'un bulkCreate.
    test('null et undefined rendent null, pas 01-01-1970', () => {
        expect(formatDate(null)).toBeNull();
        expect(formatDate(undefined)).toBeNull();
        expect(formatDate(null)).not.toBe('01-01-1970');
    });

    test('une date invalide rend null, pas NaN-NaN-NaN', () => {
        expect(formatDate(new Date('nimporte quoi'))).toBeNull();
        expect(formatDate('pas une date')).toBeNull();
    });

    test('la chaine complete formatDate(parseDate(x)) ne retombe jamais sur 1970', () => {
        for (const mauvais of ['', 'nimporte', '31-02-2026', '2026-08']) {
            expect(formatDate(parseDate(mauvais))).toBeNull();
        }
    });

    test('une date valide passe toujours', () => {
        expect(formatDate(new Date(2026, 7, 2))).toBe('02-08-2026');
    });
});

describe('une entree douteuse rend null, jamais une date inventee', () => {
    // Mieux vaut un appelant qui echoue franchement qu'un calcul mene sur une
    // annee tiree au sort: computeStockSoirAutoValues LEVE sur date invalide,
    // mais ne pouvait rien voir tant qu'on lui rendait une date plausible.
    test('un jour qui deborde du mois est refuse', () => {
        expect(parseDate('31-02-2026')).toBeNull();
        expect(parseDate('2026-02-31')).toBeNull();
    });

    test('un mois hors bornes est refuse', () => {
        expect(parseDate('01-13-2026')).toBeNull();
    });

    test('vide, null et texte libre rendent null', () => {
        expect(parseDate('')).toBeNull();
        expect(parseDate(null)).toBeNull();
        expect(parseDate(undefined)).toBeNull();
        expect(parseDate('nimporte quoi')).toBeNull();
    });

    test('une date incomplete rend null', () => {
        expect(parseDate('2026-08')).toBeNull();
        expect(parseDate('08-2026')).toBeNull();
    });
});
