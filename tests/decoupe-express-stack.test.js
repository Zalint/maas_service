/**
 * @jest-environment node
 *
 * Test d'intégration "stack express complète" pour /api/decoupe.
 *
 * Différence vs decoupe-forward.routes.test.js:
 *  - Là-bas, on monte juste le routeur (sans middleware d'auth réel) avec
 *    une session injectée par un middleware factice → on teste la logique
 *    métier mais PAS la chaîne d'auth.
 *  - Ici, on monte avec un vrai checkAuth (mocké pour rejeter sans session
 *    et accepter avec) + cookie-parser/express-session minimal pour
 *    simuler ce que fait server.js. On vérifie que la chaîne complète
 *    auth → routing → response fonctionne bout-en-bout.
 */

const express = require('express');
const request = require('supertest');

// =============== Mocks ===============
jest.mock('../db', () => ({
    sequelize: { query: jest.fn(), QueryTypes: { SELECT: 'SELECT' } }
}));

const mockDecoupeLogCreate = jest.fn();
const mockDecoupeLogFindAll = jest.fn();
jest.mock('../db/models', () => ({
    DecoupeOrderLog: {
        create: (...a) => mockDecoupeLogCreate(...a),
        findAll: (...a) => mockDecoupeLogFindAll(...a)
    }
}));

jest.mock('../config/tenant', () => ({ slug: 'mbao', name: 'Mbao' }));

// =============== checkAuth réaliste ===============
//
// Mirror du checkAuth de server.js: rejette si pas de session.user, accepte
// sinon. Pas de DB lookup pour simplifier.
function checkAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Non authentifié' });
    }
    next();
}

// =============== Build app: montage identique à server.js:522 ===============

function makeFullStackApp({ session = null } = {}) {
    delete require.cache[require.resolve('../routes/decoupe-forward')];
    const decoupeRouter = require('../routes/decoupe-forward');
    const app = express();
    app.use(express.json());
    // Session middleware factice (mémoire). Réplique l'effet de express-session
    // en injectant req.session.
    app.use((req, _res, next) => {
        req.session = session;
        next();
    });
    // Mount EXACT comme server.js:522
    app.use('/api/decoupe', checkAuth, decoupeRouter);
    return app;
}

// =============== Tests ===============

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
    mockDecoupeLogCreate.mockReset();
    mockDecoupeLogFindAll.mockReset();
    delete process.env.MATA_DECOUPE_BASE_URL;
    delete process.env.MATA_DECOUPE_API_KEY;
    delete process.env.MATA_DECOUPE_CENTRE;
    process.env.TENANT_TZ = 'Africa/Dakar';
    global.fetch = jest.fn();
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('Stack complète /api/decoupe — chaîne auth → router', () => {
    test('GET /centres sans session → 401 (auth bloque avant le router)', async () => {
        const app = makeFullStackApp({ session: null });
        const res = await request(app).get('/api/decoupe/centres');
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    test('GET /centres avec session valide → 200', async () => {
        const app = makeFullStackApp({
            session: { user: { username: 'TEST', role: 'admin' } }
        });
        const res = await request(app).get('/api/decoupe/centres');
        expect(res.status).toBe(200);
        expect(res.body.centres).toBeInstanceOf(Array);
    });

    test('GET /mine sans session → 401 (le findAll ne doit pas être appelé)', async () => {
        const app = makeFullStackApp({ session: null });
        const res = await request(app).get('/api/decoupe/mine');
        expect(res.status).toBe(401);
        // Le mock findAll ne doit JAMAIS avoir été appelé — auth a court-circuité
        expect(mockDecoupeLogFindAll).not.toHaveBeenCalled();
    });

    test('GET /mine avec session → router exécuté, findAll appelé', async () => {
        mockDecoupeLogFindAll.mockResolvedValueOnce([]);
        const app = makeFullStackApp({
            session: { user: { username: 'TEST', role: 'admin' } }
        });
        const res = await request(app).get('/api/decoupe/mine');
        expect(res.status).toBe(200);
        expect(mockDecoupeLogFindAll).toHaveBeenCalledTimes(1);
    });

    test('POST /send sans session → 401, fetch upstream pas appelé', async () => {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com';
        process.env.MATA_DECOUPE_API_KEY = 'k';
        const app = makeFullStackApp({ session: null });
        const res = await request(app)
            .post('/api/decoupe/send')
            .send({ point_vente: 'X', produits: [{ prixUnit: 1, nombre: 1 }] });
        expect(res.status).toBe(401);
        // Auth a court-circuité avant le forward Mata
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('POST /send avec session valide → router prend la main, fetch upstream appelé', async () => {
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com';
        process.env.MATA_DECOUPE_API_KEY = 'k';
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, commande: { commandeRef: 'CD-1' } })
        });
        mockDecoupeLogCreate.mockResolvedValueOnce({});
        const app = makeFullStackApp({
            session: { user: { username: 'TEST', role: 'admin' } }
        });
        const res = await request(app)
            .post('/api/decoupe/send')
            .send({
                point_vente: 'Mbao',
                produits: [{ categorie: 'Bovin', produit: 'Boeuf', prixUnit: 100, nombre: 2 }]
            });
        expect(res.status).toBe(200);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        // Le username TEST est passé dans cree_par
        const logArgs = mockDecoupeLogCreate.mock.calls[0][0];
        expect(logArgs.cree_par).toBe('mbao:TEST');
    });

    test('rôle non-admin: la session passe checkAuth (rôle non vérifié pour decoupe)', async () => {
        // Note: /api/decoupe ne fait que checkAuth, pas requireAdmin. Donc
        // un user lambda peut envoyer des commandes de découpe (c'est le
        // cas-d'usage normal — caissier au POS).
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com';
        process.env.MATA_DECOUPE_API_KEY = 'k';
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ success: true, commande: { commandeRef: 'X' } })
        });
        mockDecoupeLogCreate.mockResolvedValueOnce({});
        const app = makeFullStackApp({
            session: { user: { username: 'caissier', role: 'utilisateur' } }
        });
        const res = await request(app)
            .post('/api/decoupe/send')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        expect(res.status).toBe(200);
    });

    test('session sans user → 401 (cas session orpheline / ttl expiré)', async () => {
        const app = makeFullStackApp({ session: { /* pas de user */ } });
        const res = await request(app).get('/api/decoupe/centres');
        expect(res.status).toBe(401);
    });

    test('méthode HTTP inattendue sur route → 404 (pas 401, l\'auth ne bloque pas le routeur sur method-not-allowed)', async () => {
        const app = makeFullStackApp({
            session: { user: { username: 'TEST', role: 'admin' } }
        });
        // PATCH n'est pas exposé sur /centres
        const res = await request(app).patch('/api/decoupe/centres');
        // Auth passe (200 attendu côté handler) mais Express renvoie 404 car
        // pas de route matching pour PATCH.
        expect(res.status).toBe(404);
    });

    test('headers x-api-key ne sont JAMAIS lus depuis la requête entrante', async () => {
        // Vérifie qu'un client malveillant qui envoie x-api-key dans sa
        // requête ne peut pas la propager vers Mata (le serveur utilise
        // toujours process.env.MATA_DECOUPE_API_KEY).
        process.env.MATA_DECOUPE_BASE_URL = 'https://mata.example.com';
        process.env.MATA_DECOUPE_API_KEY = 'real-server-key';
        global.fetch.mockResolvedValueOnce({
            ok: true, json: async () => ({ success: true, commande: { commandeRef: 'X' } })
        });
        mockDecoupeLogCreate.mockResolvedValueOnce({});
        const app = makeFullStackApp({
            session: { user: { username: 'TEST', role: 'admin' } }
        });
        await request(app)
            .post('/api/decoupe/send')
            .set('x-api-key', 'malicious-injected-key')
            .send({ point_vente: 'Mbao', produits: [{ prixUnit: 1, nombre: 1 }] });
        // Le fetch upstream doit utiliser la clé du serveur, pas celle injectée
        const upstreamHeaders = global.fetch.mock.calls[0][1].headers;
        expect(upstreamHeaders['x-api-key']).toBe('real-server-key');
        expect(upstreamHeaders['x-api-key']).not.toBe('malicious-injected-key');
    });
});
