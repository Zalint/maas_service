/**
 * @jest-environment node
 *
 * lib/prix-vente-maas-client.js: le prix de vente MAAS par produit, en
 * Map cle-normalisee -> prix, avec degradation gracieuse quand DATA n'est
 * pas configure ou ne repond pas.
 */

const { _internals } = require('../lib/prix-vente-maas-client');
const { _parNomDepuisCatalogue } = _internals;

describe('_parNomDepuisCatalogue', () => {
    test('cle normalisee (accents/casse) -> prix', () => {
        // 'Boeuf' en lettres separees, comme le renvoie reellement DATA (pas
        // la ligature 'œ': normaliserNom ne decompose que les accents
        // combinants, pas les ligatures - non pertinent ici, DATA et le
        // catalogue Maas ecrivent tous deux 'Boeuf').
        const parNom = _parNomDepuisCatalogue([
            { nom: 'Boeuf', prix: 5400 },
            { nom: 'AGNEAU', prix: 5500 },
            { nom: '  Dorade  ', prix: 3000 }
        ]);
        expect(parNom.get('boeuf')).toBe(5400);
        expect(parNom.get('agneau')).toBe(5500);
        expect(parNom.get('dorade')).toBe(3000);
        expect(parNom.size).toBe(3);
    });

    test('ecarte un prix a zero, negatif, ou non numerique', () => {
        const parNom = _parNomDepuisCatalogue([
            { nom: 'Foie', prix: 0 },
            { nom: 'Laxass', prix: -200 },
            { nom: 'Poulet', prix: 'abc' },
            { nom: 'Veau', prix: 5000 }
        ]);
        expect(parNom.size).toBe(1);
        expect(parNom.get('veau')).toBe(5000);
    });

    test('ecarte une entree sans nom exploitable', () => {
        const parNom = _parNomDepuisCatalogue([
            { nom: '', prix: 3000 },
            { nom: null, prix: 3000 },
            { prix: 3000 }
        ]);
        expect(parNom.size).toBe(0);
    });

    test('une entree malformee ou une liste absente ne fait pas lever', () => {
        expect(_parNomDepuisCatalogue([null, undefined, {}]).size).toBe(0);
        expect(_parNomDepuisCatalogue(undefined).size).toBe(0);
        expect(_parNomDepuisCatalogue([]).size).toBe(0);
    });
});

describe('getPrixVenteMaasParNom: degradation gracieuse', () => {
    const envAvant = { ...process.env };
    beforeEach(() => { jest.resetModules(); });
    afterEach(() => { process.env = { ...envAvant }; });

    test('non configure (pas de DATA_API_BASE_URL) -> indisponible, Map vide', async () => {
        delete process.env.DATA_API_BASE_URL;
        delete process.env.WEB_ORDERS_API_KEY;
        delete process.env.DATA_API_KEY;
        delete process.env.EXTERNAL_API_KEY;
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        const r = await getPrixVenteMaasParNom('2026-08-29');
        expect(r.disponible).toBe(false);
        expect(r.parNom.size).toBe(0);
    });

    test('une date illisible -> indisponible, Map vide, sans appel reseau', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        const r = await getPrixVenteMaasParNom('pas-une-date');
        expect(r.disponible).toBe(false);
        expect(r.parNom.size).toBe(0);
    });

    test('reponse HTTP non-ok -> indisponible, ne leve pas', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        const r = await getPrixVenteMaasParNom('2026-08-29');
        expect(r.disponible).toBe(false);
        expect(r.parNom.size).toBe(0);
    });

    test('fetch qui leve (reseau down) -> indisponible, ne remonte pas l erreur', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        const r = await getPrixVenteMaasParNom('2026-08-29');
        expect(r.disponible).toBe(false);
    });

    test('reponse OK -> catalogue transforme en Map, appelle avec la date SANS tirets', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 5400 }] })
        });
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        const r = await getPrixVenteMaasParNom('2026-08-29');
        expect(r.disponible).toBe(true);
        expect(r.parNom.get('boeuf')).toBe(5400);
        const urlAppelee = global.fetch.mock.calls[0][0];
        expect(urlAppelee).toContain('date=20260829');
        expect(urlAppelee).not.toContain('2026-08-29');
    });

    test('deux dates differentes sont mises en cache separement', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 5400 }] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 4800 }] }) });
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        const r1 = await getPrixVenteMaasParNom('2026-08-29');
        const r2 = await getPrixVenteMaasParNom('2026-08-30');
        expect(r1.parNom.get('boeuf')).toBe(5400);
        expect(r2.parNom.get('boeuf')).toBe(4800);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('la meme date en cache ne redeclenche pas un appel reseau', async () => {
        process.env.DATA_API_BASE_URL = 'http://localhost:3007';
        process.env.WEB_ORDERS_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 5400 }] })
        });
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        await getPrixVenteMaasParNom('2026-08-29');
        await getPrixVenteMaasParNom('2026-08-29');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
