/**
 * @jest-environment node
 *
 * lib/achats-boeuf-client.js: le prix d'achat du boeuf lu chez DATA, depuis
 * l'UNE des deux sources - parDateBoeufMaas (prix facture au MaaS, commission
 * comprise) ou parDateBoeuf (prix de revient seul) - sans repli de l'une sur
 * l'autre, et avec un avertissement quand la source demandee ne donne rien.
 */

const {
    normaliserSource, SOURCE_MAAS, SOURCE_REVIENT, _internals
} = require('../lib/achats-boeuf-client');
const { _atDate, _rowsDepuisListe } = _internals;

describe('normaliserSource', () => {
    test('maas est le defaut: tout ce qui n est pas "revient" y retombe', () => {
        expect(normaliserSource(undefined)).toBe(SOURCE_MAAS);
        expect(normaliserSource('')).toBe(SOURCE_MAAS);
        expect(normaliserSource('maas')).toBe(SOURCE_MAAS);
        expect(normaliserSource('n importe quoi')).toBe(SOURCE_MAAS);
    });

    test('revient est reconnu, casse et espaces compris', () => {
        expect(normaliserSource('revient')).toBe(SOURCE_REVIENT);
        expect(normaliserSource('  REVIENT  ')).toBe(SOURCE_REVIENT);
    });
});

describe('_rowsDepuisListe', () => {
    test('lit le champ demande et trie croissant', () => {
        const rows = _rowsDepuisListe([
            { date: '2026-08-29', prix_maas_kg: 4640, nb_betes: 4 },
            { date: '2026-08-17', prix_maas_kg: 4665, nb_betes: 5 }
        ], 'prix_maas_kg');
        expect(rows).toEqual([
            { date: '2026-08-17', prix: 4665, n: 5 },
            { date: '2026-08-29', prix: 4640, n: 4 }
        ]);
    });

    test('le champ de l AUTRE source n est pas lu par accident', () => {
        // Une entree qui ne porte que prix_revient_kg ne doit RIEN donner quand
        // on demande prix_maas_kg: les deux valeurs ne veulent pas dire la meme
        // chose (commission comprise ou non).
        expect(_rowsDepuisListe(
            [{ date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4 }],
            'prix_maas_kg'
        )).toEqual([]);
    });

    test('arrondit par exces au multiple de 5 meme si DATA ne l a pas fait', () => {
        expect(_rowsDepuisListe(
            [{ date: '2026-08-29', prix_revient_kg: 4470.38, nb_betes: 4 }],
            'prix_revient_kg'
        )).toEqual([{ date: '2026-08-29', prix: 4475, n: 4 }]);
    });

    test('un prix null (DATA sans catalogue ni commission a cette date) est ecarte', () => {
        // Cote DATA, prix_maas_kg vaut null avec un `motif` quand le prix
        // catalogue du boeuf ou le taux manquent: pas de prix ce jour-la,
        // surtout pas un prix a 0.
        const rows = _rowsDepuisListe([
            { date: '2026-08-29', prix_maas_kg: null, motif: 'aucune commission a cette date' },
            { date: '2026-08-30', prix_maas_kg: 4640, nb_betes: 1 }
        ], 'prix_maas_kg');
        expect(rows).toEqual([{ date: '2026-08-30', prix: 4640, n: 1 }]);
    });

    test('date illisible, prix negatif, element malforme ou liste absente: pas d erreur', () => {
        expect(_rowsDepuisListe([
            { date: 'pas-une-date', prix_maas_kg: 4640 },
            { date: '2026-08-29', prix_maas_kg: -10 },
            null,
            {}
        ], 'prix_maas_kg')).toEqual([]);
        expect(_rowsDepuisListe(undefined, 'prix_maas_kg')).toEqual([]);
    });
});

describe('getBoeufPrixAchatResolver: choix de la source, sans repli', () => {
    const envAvant = { ...process.env };
    const reponse = (data) => ({ ok: true, json: async () => ({ success: true, data }) });
    const charger = () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        return require('../lib/achats-boeuf-client');
    };

    beforeEach(() => { jest.resetModules(); });
    afterEach(() => { process.env = { ...envAvant }; });

    test('source maas: lit parDateBoeufMaas, et la commission est dite incluse', async () => {
        global.fetch = jest.fn().mockResolvedValue(reponse({
            parDateBoeufMaas: [{ date: '2026-08-29', prix_maas_kg: 4640, nb_betes: 4 }],
            parDateBoeuf: [{ date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4 }]
        }));
        const r = await charger().getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.atDate('2026-08-29')).toBe(4640);
        expect(r.commissionIncluseAuPrix('2026-08-29')).toBe(true);
        expect(r.avertissements).toEqual([]);
    });

    test('source revient: lit parDateBoeuf, et la commission N EST PAS incluse', async () => {
        global.fetch = jest.fn().mockResolvedValue(reponse({
            parDateBoeufMaas: [{ date: '2026-08-29', prix_maas_kg: 4640, nb_betes: 4 }],
            parDateBoeuf: [{ date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4 }]
        }));
        const r = await charger().getBoeufPrixAchatResolver({ source: 'revient' });
        expect(r.atDate('2026-08-29')).toBe(4475);
        expect(r.commissionIncluseAuPrix('2026-08-29')).toBe(false);
    });

    test('parDateBoeufMaas absent: PAS de repli sur parDateBoeuf, un avertissement', async () => {
        // Le coeur de la regle: un prix de revient (hors commission) presente
        // comme un prix MaaS fausserait la marge sans que personne ne le voie.
        global.fetch = jest.fn().mockResolvedValue(reponse({
            parDateBoeuf: [{ date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4 }],
            achats: [{ bete: 'Boeuf', date: '2026-08-29', prix: 500000, abats: 0, frais_abattage: 0, nbr_kg: 100 }]
        }));
        const r = await charger().getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.atDate('2026-08-29')).toBeNull();
        expect(r.count).toBe(0);
        expect(r.avertissements).toHaveLength(1);
        expect(r.avertissements[0]).toContain('parDateBoeufMaas');
        expect(r.avertissements[0]).toContain('catalogue');
    });

    test('parDateBoeufMaas vide: meme traitement, un avertissement', async () => {
        global.fetch = jest.fn().mockResolvedValue(reponse({ parDateBoeufMaas: [] }));
        const r = await charger().getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.count).toBe(0);
        expect(r.avertissements).toHaveLength(1);
    });

    test('sans prix pour la date demandee, la commission reste due ce jour-la', async () => {
        // DATA n'a des prix MaaS qu'a partir du 29: une livraison du 12 est
        // valorisee au catalogue, elle doit donc continuer de payer ses 3%.
        global.fetch = jest.fn().mockResolvedValue(reponse({
            parDateBoeufMaas: [{ date: '2026-08-29', prix_maas_kg: 4640, nb_betes: 4 }]
        }));
        const r = await charger().getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.commissionIncluseAuPrix('2026-08-12')).toBe(false);
        expect(r.commissionIncluseAuPrix('2026-08-29')).toBe(true);
    });

    test('DATA non configure: liste vide et avertissement, sans appel reseau', async () => {
        jest.resetModules();
        delete process.env.DATA_API_BASE_URL;
        delete process.env.WEB_ORDERS_API_KEY;
        delete process.env.DATA_API_KEY;
        delete process.env.EXTERNAL_API_KEY;
        global.fetch = jest.fn();
        const { getBoeufPrixAchatResolver } = require('../lib/achats-boeuf-client');
        const r = await getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.count).toBe(0);
        expect(r.avertissements[0]).toContain('pas configurée');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('DATA injoignable: liste vide et avertissement, sans lever', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const r = await charger().getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.count).toBe(0);
        expect(r.avertissements[0]).toContain('injoignable');
    });

    test('HTTP non-ok: liste vide et avertissement, sans lever', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
        const r = await charger().getBoeufPrixAchatResolver({ source: 'maas' });
        expect(r.count).toBe(0);
        expect(r.avertissements[0]).toContain('500');
    });

    test('les deux sources sont mises en cache separement', async () => {
        const mod = charger();
        global.fetch = jest.fn().mockResolvedValue(reponse({
            parDateBoeufMaas: [{ date: '2026-08-29', prix_maas_kg: 4640, nb_betes: 4 }],
            parDateBoeuf: [{ date: '2026-08-29', prix_revient_kg: 4475, nb_betes: 4 }]
        }));
        const maas = await mod.getBoeufPrixAchatResolver({ source: 'maas' });
        const revient = await mod.getBoeufPrixAchatResolver({ source: 'revient' });
        expect(maas.atDate('2026-08-29')).toBe(4640);
        expect(revient.atDate('2026-08-29')).toBe(4475);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('la meme source en cache ne redeclenche pas d appel reseau', async () => {
        const mod = charger();
        global.fetch = jest.fn().mockResolvedValue(reponse({
            parDateBoeufMaas: [{ date: '2026-08-29', prix_maas_kg: 4640, nb_betes: 4 }]
        }));
        await mod.getBoeufPrixAchatResolver({ source: 'maas' });
        await mod.getBoeufPrixAchatResolver({ source: 'maas' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
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
