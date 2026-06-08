/**
 * @jest-environment node
 *
 * Tests d'intégration des routes /api/decoupe (forwarder Mata).
 *
 * Stratégie:
 *  - Sequelize / DecoupeOrderLog / tenant sont mockés pour éviter de tirer
 *    une vraie connexion DB (et permettre de tester les chemins d'erreur DB
 *    facilement).
 *  - global.fetch est mocké pour tester le forward upstream sans réseau.
 *  - supertest pilote l'app Express avec uniquement le router découpe monté.
 *  - testEnvironment node (pas jsdom) car supertest a besoin de TextEncoder
 *    qui n'est pas exposé sous jsdom dans cette version de jest.
 */

// =============== Mocks (avant les require de la cible) ===============

const mockDecoupeLogCreate = jest.fn();
const mockDecoupeLogFindAll = jest.fn();
const mockSequelizeQuery = jest.fn();

jest.mock('../db', () => ({
    sequelize: {
        query: (...args) => mockSequelizeQuery(...args),
        QueryTypes: { SELECT: 'SELECT' }
    }
}));

jest.mock('../db/models', () => ({
    DecoupeOrderLog: {
        create: (...args) => mockDecoupeLogCreate(...args),
        findAll: (...args) => mockDecoupeLogFindAll(...args)
    }
}));

jest.mock('../config/tenant', () => ({
    slug: 'mbao',
    name: 'Mbao',
    schema: 'mbao'
}));

// =============== Imports ===============
const express = require('express');
const request = require('supertest');

// =============== Helper pour monter l'app ===============
function makeApp() {
    // Re-require le router à chaque test pour réinitialiser les modules
    delete require.cache[require.resolve('../routes/decoupe-forward')];
    const router = require('../routes/decoupe-forward');
    const app = express();
    app.use(express.json());
    // Mock minimal de session pour le username log
    app.use((req, _res, next) => {
        req.session = { user: { username: 'TESTUSER' } };
        next();
    });
    app.use('/api/decoupe', router);
    return app;
}

// =============== Lifecycle ===============
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
    mockDecoupeLogCreate.mockReset();
    mockDecoupeLogFindAll.mockReset();
    mockSequelizeQuery.mockReset();
    // Reset env pour tests indépendants
    delete process.env.MATA_DECOUPE_BASE_URL;
    delete process.env.MATA_DECOUPE_API_KEY;
    delete process.env.MATA_DECOUPE_CENTRE;
    delete process.env.MATA_DECOUPE_TIMEOUT_MS;
    process.env.TENANT_TZ = 'Africa/Dakar';
    // fetch est mocké au cas par cas
    global.fetch = jest.fn();
});

afterAll(() => {
    process.env = ORIGINAL_ENV;
});

// =============== GET /centres ===============
describe('GET /api/decoupe/centres', () => {
    test('renvoie les défauts quand env non configurée', async () => {
        const res = await request(makeApp()).get('/api/decoupe/centres');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.centres).toEqual(['Centre de Découpe Dakar', 'Centre de Découpe Banlieue']);
    });

    test('parse l\'env MATA_DECOUPE_CENTRE', async () => {
        process.env.MATA_DECOUPE_CENTRE = 'Centre A;Centre B';
        const res = await request(makeApp()).get('/api/decoupe/centres');
        expect(res.body.centres).toEqual(['Centre A', 'Centre B']);
    });
});

// =============== GET /external-url ===============
describe('GET /api/decoupe/external-url', () => {
    test('null quand BASE_URL absente', async () => {
        const res = await request(makeApp()).get('/api/decoupe/external-url');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, url: null });
    });

    test('compose URL avec /centre-decoupe.html', async () => {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com';
        const res = await request(makeApp()).get('/api/decoupe/external-url');
        expect(res.body.url).toBe('https://mata.example.com/centre-decoupe.html');
    });

    test('strip le slash final de BASE_URL', async () => {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com/';
        const res = await request(makeApp()).get('/api/decoupe/external-url');
        expect(res.body.url).toBe('https://mata.example.com/centre-decoupe.html');
    });
});

// =============== POST /send ===============
describe('POST /api/decoupe/send', () => {
    function configureMata() {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com';
        process.env.MATA_DECOUPE_API_KEY = 'test-key-001';
        process.env.MATA_DECOUPE_CENTRE = 'Centre de Découpe Dakar;Centre de Découpe Banlieue';
    }

    test('503 quand intégration non configurée', async () => {
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 100, nombre: 1 }] });
        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/non configurée/);
    });

    test('400 sans produits', async () => {
        configureMata();
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/produits/);
    });

    test('400 sans point_vente', async () => {
        configureMata();
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ produits: [{ prixUnit: 100, nombre: 1 }] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/point_vente/);
    });

    test('400 sur centre non autorisé', async () => {
        configureMata();
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({
                point_vente: 'Mbao',
                produits: [{ prixUnit: 100, nombre: 1 }],
                point_vente_executant: 'Centre Pirate'
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/non autorisé/);
    });

    test('happy path: payload Mata camelCase + ref retournée + log local', async () => {
        configureMata();
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                success: true,
                commande: {
                    commandeRef: 'CDD-20260501-1234',
                    pointVente: 'Mbao',
                    montantTotal: 7400,
                    creePar: 'maas mbao'
                }
            })
        });
        mockDecoupeLogCreate.mockResolvedValueOnce({ id: 99 });

        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({
                point_vente: 'Mbao',
                point_vente_executant: 'Centre de Découpe Dakar',
                produits: [{
                    categorie: 'Bovin',
                    produit: 'Boeuf en détail',
                    prixUnit: 3700,
                    nombre: 2
                }],
                montant_total: 7400,
                nom_client: 'Test Client',
                numero_client: '770000000',
                adresse_client: 'Dakar',
                instructions_client: 'RAS'
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.commande_ref).toBe('CDD-20260501-1234');

        // Vérifier que fetch a été appelé sur la bonne URL avec la clé
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('https://mata.example.com/api/commandes-decoupe/external');
        expect(opts.headers['x-api-key']).toBe('test-key-001');
        expect(opts.method).toBe('POST');

        // Payload doit être en camelCase, montant calculé
        const payload = JSON.parse(opts.body);
        expect(payload).toMatchObject({
            pointVenteExecutant: 'Centre de Découpe Dakar',
            nomClient: 'Test Client',
            numeroClient: '770000000',
            adresseClient: 'Dakar',
            instructionsClient: 'RAS'
        });
        expect(payload.produits[0]).toMatchObject({
            categorie: 'Bovin',
            produit: 'Boeuf en détail',
            prixUnit: 3700,
            nombre: 2,
            montant: 7400
        });
        // Pas de pointVente / origine / partenaireMaas / creePar — Mata les dérive
        expect(payload.pointVente).toBeUndefined();
        expect(payload.origine).toBeUndefined();
        expect(payload.partenaireMaas).toBeUndefined();
        expect(payload.creePar).toBeUndefined();

        // Log local créé avec les bonnes valeurs
        expect(mockDecoupeLogCreate).toHaveBeenCalledTimes(1);
        const logArg = mockDecoupeLogCreate.mock.calls[0][0];
        expect(logArg.commande_ref).toBe('CDD-20260501-1234');
        expect(logArg.point_vente).toBe('Mbao');
        expect(logArg.point_vente_executant).toBe('Centre de Découpe Dakar');
        expect(logArg.cree_par).toBe('mbao:TESTUSER');
        expect(logArg.mata_response).toBeDefined();
    });

    test('utilise centre par défaut quand non spécifié', async () => {
        configureMata();
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, commande: { commandeRef: 'X' } })
        });
        mockDecoupeLogCreate.mockResolvedValueOnce({});
        await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
        // Premier centre de la liste = défaut
        expect(payload.pointVenteExecutant).toBe('Centre de Découpe Dakar');
    });

    test('504 sur timeout AbortController', async () => {
        configureMata();
        process.env.MATA_DECOUPE_TIMEOUT_MS = '1';
        // Simuler un fetch qui throw AbortError
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        global.fetch.mockRejectedValueOnce(abortErr);
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        expect(res.status).toBe(504);
        expect(res.body.error).toMatch(/n'a pas répondu/);
    });

    test('502 sur autre erreur réseau', async () => {
        configureMata();
        global.fetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        expect(res.status).toBe(502);
        expect(res.body.error).toMatch(/Erreur réseau/);
    });

    test('propage le code HTTP de Mata sur erreur upstream', async () => {
        configureMata();
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 403,
            json: async () => ({ error: 'Clé API invalide' })
        });
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Clé API invalide');
    });

    test('succès même si log local échoue (best-effort)', async () => {
        configureMata();
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, commande: { commandeRef: 'X-1' } })
        });
        mockDecoupeLogCreate.mockRejectedValueOnce(new Error('DB down'));
        const res = await request(makeApp())
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        expect(res.status).toBe(200);
        expect(res.body.commande_ref).toBe('X-1');
    });
});

// =============== GET /sum-by-pv ===============
describe('GET /api/decoupe/sum-by-pv', () => {
    test('400 sans date ou format invalide', async () => {
        const r1 = await request(makeApp()).get('/api/decoupe/sum-by-pv');
        expect(r1.status).toBe(400);
        const r2 = await request(makeApp()).get('/api/decoupe/sum-by-pv?date=30-04-2026');
        expect(r2.status).toBe(400);
    });

    test('agrège par point_vente avec ré-attribution legacy', async () => {
        process.env.MATA_DECOUPE_CENTRE = 'Centre de Découpe Dakar;Centre de Découpe Banlieue';
        mockSequelizeQuery.mockResolvedValueOnce([
            { point_vente: 'Mbao', point_vente_executant: 'X', total: '7200' },
            { point_vente: 'Centre de Découpe Dakar', point_vente_executant: 'X', total: '4500' },
            { point_vente: 'Autre PV', point_vente_executant: 'X', total: '1000' }
        ]);
        const res = await request(makeApp()).get('/api/decoupe/sum-by-pv?date=2026-04-30');
        expect(res.status).toBe(200);
        // Mbao + ré-attribué centre Dakar
        expect(res.body.sums.Mbao).toBe(11700);
        expect(res.body.sums['Autre PV']).toBe(1000);
        // Le centre name n'apparaît pas comme clé séparée
        expect(res.body.sums['Centre de Découpe Dakar']).toBeUndefined();
    });

    test('passe la TZ dans les replacements SQL', async () => {
        mockSequelizeQuery.mockResolvedValueOnce([]);
        await request(makeApp()).get('/api/decoupe/sum-by-pv?date=2026-04-30');
        const opts = mockSequelizeQuery.mock.calls[0][1];
        expect(opts.replacements).toMatchObject({ d: '2026-04-30', tz: 'Africa/Dakar' });
    });
});

// =============== GET /sum-range ===============
describe('GET /api/decoupe/sum-range', () => {
    test('400 sans dateDebut', async () => {
        const res = await request(makeApp()).get('/api/decoupe/sum-range');
        expect(res.status).toBe(400);
    });

    test('400 si format dateDebut invalide', async () => {
        const res = await request(makeApp()).get('/api/decoupe/sum-range?dateDebut=2026/04/30');
        expect(res.status).toBe(400);
    });

    test('400 si dateFin présent et invalide', async () => {
        const res = await request(makeApp())
            .get('/api/decoupe/sum-range?dateDebut=2026-04-01&dateFin=invalide');
        expect(res.status).toBe(400);
    });

    test('renvoie total scalaire pour la plage', async () => {
        mockSequelizeQuery.mockResolvedValueOnce([{ total: '15000' }]);
        const res = await request(makeApp())
            .get('/api/decoupe/sum-range?dateDebut=2026-04-01&dateFin=2026-04-30');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, total: 15000 });
    });

    test('sans dateFin → utilise dateDebut comme borne haute', async () => {
        mockSequelizeQuery.mockResolvedValueOnce([{ total: '0' }]);
        await request(makeApp()).get('/api/decoupe/sum-range?dateDebut=2026-04-30');
        const opts = mockSequelizeQuery.mock.calls[0][1];
        expect(opts.replacements.d1).toBe('2026-04-30');
        expect(opts.replacements.d2).toBe('2026-04-30');
    });

    test('PV=tous → pas de filtre PV', async () => {
        mockSequelizeQuery.mockResolvedValueOnce([{ total: '0' }]);
        await request(makeApp()).get('/api/decoupe/sum-range?dateDebut=2026-04-30&pointVente=tous');
        const sql = mockSequelizeQuery.mock.calls[0][0];
        expect(sql).not.toMatch(/point_vente = :pv/);
    });

    test('PV=autre → filtre exact', async () => {
        mockSequelizeQuery.mockResolvedValueOnce([{ total: '0' }]);
        await request(makeApp())
            .get('/api/decoupe/sum-range?dateDebut=2026-04-30&pointVente=Autre');
        const opts = mockSequelizeQuery.mock.calls[0][1];
        expect(opts.replacements.pv).toBe('Autre');
    });

    test('PV=tenant → inclut les centres legacy', async () => {
        process.env.MATA_DECOUPE_CENTRE = 'Centre de Découpe Dakar;Centre de Découpe Banlieue';
        mockSequelizeQuery.mockResolvedValueOnce([{ total: '0' }]);
        await request(makeApp())
            .get('/api/decoupe/sum-range?dateDebut=2026-04-30&pointVente=Mbao');
        const sql = mockSequelizeQuery.mock.calls[0][0];
        expect(sql).toMatch(/point_vente = :tpv/);
        expect(sql).toMatch(/point_vente IN \(:c0,:c1\)/);
        const opts = mockSequelizeQuery.mock.calls[0][1];
        expect(opts.replacements.tpv).toBe('Mbao');
        expect(opts.replacements.c0).toBe('Centre de Découpe Dakar');
        expect(opts.replacements.c1).toBe('Centre de Découpe Banlieue');
    });
});

// =============== GET /mine ===============
describe('GET /api/decoupe/mine', () => {
    test('limite par défaut 100', async () => {
        mockDecoupeLogFindAll.mockResolvedValueOnce([]);
        await request(makeApp()).get('/api/decoupe/mine');
        expect(mockDecoupeLogFindAll.mock.calls[0][0].limit).toBe(100);
    });

    test('clamp valeur négative à 1', async () => {
        mockDecoupeLogFindAll.mockResolvedValueOnce([]);
        await request(makeApp()).get('/api/decoupe/mine?limit=-5');
        expect(mockDecoupeLogFindAll.mock.calls[0][0].limit).toBe(1);
    });

    test('clamp au max 500', async () => {
        mockDecoupeLogFindAll.mockResolvedValueOnce([]);
        await request(makeApp()).get('/api/decoupe/mine?limit=99999');
        expect(mockDecoupeLogFindAll.mock.calls[0][0].limit).toBe(500);
    });

    test('renvoie les rows triées par created_at DESC', async () => {
        const rows = [
            { id: 2, commande_ref: 'A' },
            { id: 1, commande_ref: 'B' }
        ];
        mockDecoupeLogFindAll.mockResolvedValueOnce(rows);
        const res = await request(makeApp()).get('/api/decoupe/mine');
        expect(res.body.success).toBe(true);
        // Sans MATA_DECOUPE_* (supprimé en beforeEach), le statut live n'est pas
        // récupéré → enrichi à null, mais l'ordre et les données restent intacts.
        expect(res.body.commandes).toEqual([
            { id: 2, commande_ref: 'A', statut: null },
            { id: 1, commande_ref: 'B', statut: null }
        ]);
        expect(mockDecoupeLogFindAll.mock.calls[0][0].order).toEqual([['created_at', 'DESC']]);
    });

    test('500 sur erreur DB', async () => {
        mockDecoupeLogFindAll.mockRejectedValueOnce(new Error('boom'));
        const res = await request(makeApp()).get('/api/decoupe/mine');
        expect(res.status).toBe(500);
        expect(res.body.commandes).toEqual([]);
    });

    test('enrichit le statut live depuis Mata quand configuré', async () => {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.test';
        process.env.MATA_DECOUPE_API_KEY = 'k';
        mockDecoupeLogFindAll.mockResolvedValueOnce([{ id: 1, commande_ref: 'CDD-1' }]);
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, commandes: [{ commandeRef: 'CDD-1', statut: 'annule' }] })
        });
        const res = await request(makeApp()).get('/api/decoupe/mine');
        expect(res.status).toBe(200);
        expect(res.body.commandes[0].statut).toBe('annule');
    });

    test('statut null si Mata injoignable (best-effort, pas de 500)', async () => {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.test';
        process.env.MATA_DECOUPE_API_KEY = 'k';
        mockDecoupeLogFindAll.mockResolvedValueOnce([{ id: 1, commande_ref: 'CDD-1' }]);
        global.fetch = jest.fn().mockRejectedValueOnce(new Error('down'));
        const res = await request(makeApp()).get('/api/decoupe/mine');
        expect(res.status).toBe(200);
        expect(res.body.commandes[0].statut).toBeNull();
    });
});
