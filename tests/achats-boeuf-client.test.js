/**
 * @jest-environment node
 *
 * lib/achats-boeuf-client.js: le prix de revient du boeuf (avec abats et
 * frais d'abattage, pondere au kg), en priorite depuis data.parDateBoeuf
 * (calcule cote DATA), avec repli sur un calcul local depuis les achats
 * bruts si DATA ne l'expose pas encore (deploiement non synchronise).
 */

const { _internals } = require('../lib/achats-boeuf-client');
const { _atDate, _rowsDepuisParDate, _rowsDepuisAchatsBruts } = _internals;

describe('_rowsDepuisParDate (chemin rapide: DATA a deja calcule)', () => {
    test('reforme parDateBoeuf en {date, prix, n}, triees croissant', () => {
        const rows = _rowsDepuisParDate([
            { date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4, poids_total_kg: 557 },
            { date: '2026-08-17', prix_revient_kg: 4500, nb_betes: 5, poids_total_kg: 727 }
        ]);
        expect(rows).toEqual([
            { date: '2026-08-17', prix: 4500, n: 5 },
            { date: '2026-08-29', prix: 4475, n: 4 }
        ]);
    });

    test('arrondit par exces au multiple de 5 meme si DATA ne l a pas fait', () => {
        // Ne fait pas confiance a DATA pour l'arrondi: garde le MEME invariant
        // que le repli _rowsDepuisAchatsBruts, au cas ou DATA renverrait un
        // prix_revient_kg non arrondi (ou arrondi differemment).
        const rows = _rowsDepuisParDate([
            { date: '2026-08-29', prix_revient_kg: 4470.38, nb_betes: 4 }
        ]);
        expect(rows).toEqual([{ date: '2026-08-29', prix: 4475, n: 4 }]);
    });

    test('ecarte une date illisible ou un prix a zero/negatif', () => {
        const rows = _rowsDepuisParDate([
            { date: 'pas-une-date', prix_revient_kg: 4500, nb_betes: 1 },
            { date: '2026-08-29', prix_revient_kg: 0, nb_betes: 1 },
            { date: '2026-08-30', prix_revient_kg: 4500, nb_betes: 1 }
        ]);
        expect(rows).toEqual([{ date: '2026-08-30', prix: 4500, n: 1 }]);
    });

    test('un element mal forme ne fait pas lever', () => {
        expect(_rowsDepuisParDate([null, {}, { date: '2026-08-29', prix_revient_kg: 4500, nb_betes: 1 }]))
            .toEqual([{ date: '2026-08-29', prix: 4500, n: 1 }]);
    });
});

describe('_rowsDepuisAchatsBruts (repli: DATA sans parDateBoeuf)', () => {
    const boeuf = (date, prix, abats, frais, kg) => ({ bete: 'Boeuf', date, prix, abats, frais_abattage: frais, nbr_kg: kg });

    test('cout = prix - abats + frais, pondere par les kg, arrondi par exces a 5F', () => {
        // Meme lot que le 2026-08-29 reel: 2 490 000 F / 557 kg = 4470,38 -> 4475.
        const rows = _rowsDepuisAchatsBruts([
            boeuf('2026-08-29', 651000, 35000, 10000, 140),
            boeuf('2026-08-29', 651000, 35000, 10000, 140),
            boeuf('2026-08-29', 616000, 35000, 10000, 131),
            boeuf('2026-08-29', 672000, 35000, 10000, 146)
        ]);
        expect(rows).toEqual([{ date: '2026-08-29', prix: 4475, n: 4 }]);
    });

    test('le veau et les autres especes ne comptent pas dans le lot boeuf', () => {
        const rows = _rowsDepuisAchatsBruts([
            boeuf('2026-08-29', 500000, 0, 0, 100),
            { bete: 'Veau', date: '2026-08-29', prix: 999999, abats: 0, frais_abattage: 0, nbr_kg: 50 }
        ]);
        expect(rows).toEqual([{ date: '2026-08-29', prix: 5000, n: 1 }]);
    });

    test('une bete sans prix (pas encore valorisee) est ignoree, meme avec des frais', () => {
        // prix=0 mais frais_abattage>0 donnerait un cout>0 sans cette garde -
        // et ferait BAISSER a tort le prix de revient du lot.
        const rows = _rowsDepuisAchatsBruts([
            boeuf('2026-08-29', 0, 0, 10000, 140),
            boeuf('2026-08-29', 500000, 0, 0, 100)
        ]);
        expect(rows).toEqual([{ date: '2026-08-29', prix: 5000, n: 1 }]);
    });

    test('plusieurs dates restent separees et triees croissant', () => {
        const rows = _rowsDepuisAchatsBruts([
            boeuf('2026-08-29', 500000, 0, 0, 100),
            boeuf('2026-08-17', 450000, 0, 0, 100)
        ]);
        expect(rows.map((r) => r.date)).toEqual(['2026-08-17', '2026-08-29']);
    });
});

describe('getBoeufPrixAchatResolver: selection du chemin parDateBoeuf vs achats bruts', () => {
    const envAvant = { ...process.env };
    beforeEach(() => { jest.resetModules(); });
    afterEach(() => { process.env = { ...envAvant }; });

    test('parDateBoeuf VIDE (mais present) ne doit pas empecher le repli sur achats bruts', async () => {
        // Regression: un tableau vide est truthy en JS - le traiter comme
        // "DATA a le champ" sans verifier sa taille ferait ignorer des achats
        // bruts pourtant exploitables (deploiement partiel cote DATA, ou
        // fenetre de calcul de DATA qui ne couvre pas encore cette date).
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                data: {
                    parDateBoeuf: [],
                    achats: [
                        { bete: 'Boeuf', date: '2026-08-29', prix: 500000, abats: 0, frais_abattage: 0, nbr_kg: 100 }
                    ]
                }
            })
        });
        const { getBoeufPrixAchatResolver } = require('../lib/achats-boeuf-client');
        const r = await getBoeufPrixAchatResolver();
        expect(r.atDate('2026-08-29')).toBe(5000);
    });

    test('parDateBoeuf non vide est prefere aux achats bruts', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                data: {
                    parDateBoeuf: [{ date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4 }],
                    achats: [
                        { bete: 'Boeuf', date: '2026-08-29', prix: 999999, abats: 0, frais_abattage: 0, nbr_kg: 1 }
                    ]
                }
            })
        });
        const { getBoeufPrixAchatResolver } = require('../lib/achats-boeuf-client');
        const r = await getBoeufPrixAchatResolver();
        expect(r.atDate('2026-08-29')).toBe(4475);
    });
});

describe('_atDate: jour d achat le plus recent <= la date demandee', () => {
    const rows = [
        { date: '2026-08-17', prix: 4500, n: 5 },
        { date: '2026-08-27', prix: 4475, n: 4 },
        { date: '2026-08-29', prix: 4475, n: 4 }
    ];

    test('une date exacte renvoie le prix de ce jour', () => {
        expect(_atDate(rows, '2026-08-27')).toBe(4475);
    });

    test('une date entre deux lots renvoie le plus RECENT <= la date', () => {
        expect(_atDate(rows, '2026-08-28')).toBe(4475);
    });

    test('une date avant le premier lot ne renvoie rien', () => {
        expect(_atDate(rows, '2026-08-01')).toBeNull();
    });

    test('aucune ligne ou date illisible: null, pas une erreur', () => {
        expect(_atDate([], '2026-08-29')).toBeNull();
        expect(_atDate(rows, 'pas-une-date')).toBeNull();
    });
});
