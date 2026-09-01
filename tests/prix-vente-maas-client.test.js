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
    test('lit prixMaas (prix facture), PAS prix (catalogue nu)', () => {
        // Le coeur de la regle: `prix` est hors commission, `prixMaas` la
        // contient. Afficher `prix` sous-estimerait la facture fournisseur.
        // 'Boeuf' en lettres separees, comme le renvoie reellement DATA (pas
        // la ligature 'œ': normaliserNom ne decompose que les accents
        // combinants, pas les ligatures).
        const { parNom } = _parNomDepuisCatalogue([
            { nom: 'Boeuf', prix: 5400, prixMaas: 5400, commissionAppliquee: false },
            { nom: 'AGNEAU', prix: 5340, prixMaas: 5500, commissionAppliquee: true },
            { nom: '  Dorade  ', prix: 2915, prixMaas: 3000, commissionAppliquee: true }
        ]);
        expect(parNom.get('agneau')).toBe(5500);
        expect(parNom.get('dorade')).toBe(3000);
        // Le boeuf: DATA rend prixMaas === prix volontairement, son prix
        // facture vivant dans parDateBoeufMaas de /api/external/achats-boeuf.
        expect(parNom.get('boeuf')).toBe(5400);
        expect(parNom.size).toBe(3);
    });

    test('un prixMaas absent n est PAS repli sur prix, et il est compte', () => {
        // Un DATA anterieur au champ prixMaas: on prefere laisser la ligne
        // modifiable a la main plutot que d afficher un prix hors commission
        // en le presentant comme la facture.
        const { parNom, sansPrixMaas } = _parNomDepuisCatalogue([
            { nom: 'Poulet', prix: 3400 },
            { nom: 'Veau', prix: 4850, prixMaas: 5000 }
        ]);
        expect(parNom.has('poulet')).toBe(false);
        expect(parNom.get('veau')).toBe(5000);
        expect(sansPrixMaas).toBe(1);
    });

    test('ecarte un prixMaas a zero, negatif, ou non numerique', () => {
        const { parNom } = _parNomDepuisCatalogue([
            { nom: 'Foie', prixMaas: 0 },
            { nom: 'Laxass', prixMaas: -200 },
            { nom: 'Poulet', prixMaas: 'abc' },
            { nom: 'Veau', prixMaas: 5000 }
        ]);
        expect(parNom.size).toBe(1);
        expect(parNom.get('veau')).toBe(5000);
    });

    test('un produit pas encore tarife (ni prix ni prixMaas) n est pas compte', () => {
        // A distinguer du DATA ancien: ici il n y a simplement pas de prix,
        // ce n est pas un probleme de version a signaler.
        const { parNom, sansPrixMaas } = _parNomDepuisCatalogue([
            { nom: 'Nouveau produit', prix: null, prixMaas: null }
        ]);
        expect(parNom.size).toBe(0);
        expect(sansPrixMaas).toBe(0);
    });

    test('ecarte une entree sans nom exploitable', () => {
        const { parNom } = _parNomDepuisCatalogue([
            { nom: '', prixMaas: 3000 },
            { nom: null, prixMaas: 3000 },
            { prixMaas: 3000 }
        ]);
        expect(parNom.size).toBe(0);
    });

    test('une entree malformee ou une liste absente ne fait pas lever', () => {
        expect(_parNomDepuisCatalogue([null, undefined, {}]).parNom.size).toBe(0);
        expect(_parNomDepuisCatalogue(undefined).parNom.size).toBe(0);
        expect(_parNomDepuisCatalogue([]).parNom.size).toBe(0);
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
            json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 5400, prixMaas: 5400 }] })
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
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 5400, prixMaas: 5400 }] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 4800, prixMaas: 4800 }] }) });
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
            json: async () => ({ success: true, catalogue: [{ nom: 'Boeuf', prix: 5400, prixMaas: 5400 }] })
        });
        const { getPrixVenteMaasParNom } = require('../lib/prix-vente-maas-client');
        await getPrixVenteMaasParNom('2026-08-29');
        await getPrixVenteMaasParNom('2026-08-29');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
