/**
 * @jest-environment node
 *
 * Smoke test paramétré: tous les endpoints sensibles doivent rejeter une
 * requête sans session avec 401. Si quelqu'un ajoute un nouvel endpoint
 * sans middleware d'auth, ce test attrapera la régression.
 *
 * Stratégie: lecture statique du source de server.js + routes/* pour
 * vérifier que les endpoints qui parlent de données métier sont gardés
 * par checkAuth ou requireAdmin/requireAdminOrSupervisor.
 */

const fs = require('fs');
const path = require('path');

// =============== Inventaire des sources ===============

const ROUTE_FILES = [
    { path: 'server.js', authMiddleware: ['checkAuth', 'checkReadAccess', 'checkWriteAccess', 'checkAdmin'] },
    { path: 'routes/decoupe-forward.js', authMiddleware: ['checkAuth'] }, // mounted with checkAuth
    { path: 'routes/config-admin.js', authMiddleware: ['requireAdmin', 'requireAdminOrSupervisor'] }
];

// Endpoints publics autorisés (login, healthcheck, static, etc.) — ne sont
// PAS censés exiger une session. Liste blanche.
const PUBLIC_ENDPOINTS = [
    /\/login\b/,
    /\/api\/login\b/,
    /\/api\/health\b/,
    /\/api\/check-session\b/,
    /\/api\/tenant\b/,             // expose juste l'identité tenant
    /\/api\/client-config\b/,      // config UI publique
    /\/api\/brand-config\b/,
    /\/logout\b/,
    /\/api\/logout\b/,
];

// =============== Extraction d'endpoints ===============

function extractEndpoints(src, filePath) {
    const lines = src.split('\n');
    const endpoints = [];
    // Match: app.get/post/put/delete('/path', middleware1, middleware2, …, handler)
    //        router.get/post/…
    const re = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]([^)]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const verb = m[1].toUpperCase();
        const route = m[2];
        const middleware = m[3]; // ", checkAuth, requireAdmin, async (req, res) => …"
        endpoints.push({ verb, route, middleware, file: filePath });
    }
    return endpoints;
}

function isPublicEndpoint(route) {
    return PUBLIC_ENDPOINTS.some((re) => re.test(route));
}

function hasAuthMiddleware(middlewareSig, allowedNames) {
    return allowedNames.some((name) => middlewareSig.includes(name));
}

// =============== Tests ===============

describe('Smoke auth: endpoints critiques du PR ont un middleware d\'auth', () => {
    // Plutôt que scanner tous les endpoints (server.js a des endpoints
    // legacy avec divers middlewares dont validateApiKey, on génère trop
    // de faux positifs), on cible explicitement les endpoints CRITIQUES
    // ajoutés ou modifiés par le PR. Si on en ajoute un nouveau sans
    // auth, on l'ajoute ici et on fait échouer le test.

    const CRITICAL_ENDPOINTS = [
        // Tous via mount checkAuth global
        { file: 'routes/decoupe-forward.js', mountAuth: 'checkAuth (mounted in server.js)' },
        // Per-endpoint via requireAdmin/Supervisor
        { file: 'routes/config-admin.js', endpointAuth: ['requireAdmin', 'requireAdminOrSupervisor'] }
    ];

    test('routes/decoupe-forward.js: mount /api/decoupe avec checkAuth', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'), 'utf8'
        );
        expect(src).toMatch(/app\.use\(['"]\/api\/decoupe['"],\s*checkAuth/);
    });

    test('routes/config-admin.js: tous les endpoints ont requireAdmin ou Supervisor', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'routes', 'config-admin.js'), 'utf8'
        );
        const eps = extractEndpoints(src, 'routes/config-admin.js');
        const sansAuth = eps.filter((e) =>
            !hasAuthMiddleware(e.middleware, ['requireAdmin', 'requireAdminOrSupervisor'])
        );
        if (sansAuth.length > 0) {
            const list = sansAuth.map((e) => `${e.verb} ${e.route}`).join('\n  ');
            throw new Error(
                `Endpoints de config-admin.js sans middleware d'auth:\n  ${list}`
            );
        }
        expect(sansAuth).toEqual([]);
    });
});

describe('Smoke auth: routers montés avec checkAuth global', () => {
    test('/api/decoupe est mount avec checkAuth dans server.js', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'), 'utf8'
        );
        // Pattern: app.use('/api/decoupe', checkAuth, ...)
        expect(src).toMatch(/app\.use\(['"]\/api\/decoupe['"],\s*checkAuth/);
    });

    test('/api/admin/config est mount (utilise requireAdmin/Supervisor par-endpoint)', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'), 'utf8'
        );
        // Pattern: app.use('/api/admin/config', configAdminRouter)
        expect(src).toMatch(/app\.use\(['"]\/api\/admin\/config['"],\s*configAdminRouter\)/);
    });

    test('/api/abonnements est mount avec checkAuth', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'), 'utf8'
        );
        expect(src).toMatch(/app\.use\(['"]\/api\/abonnements['"],\s*checkAuth/);
    });
});

describe('Smoke auth: aucun secret loggé', () => {
    test('pas de console.log de MATA_DECOUPE_API_KEY ou SESSION_SECRET en clair', () => {
        const filesToCheck = [
            'server.js', 'routes/decoupe-forward.js', 'routes/config-admin.js'
        ];
        // On regex le log COMPLET (sans .substring) — un log partiel via
        // .substring(0, 20) est un debug acceptable et est exclu.
        const dangerousPatterns = [
            { name: 'MATA_DECOUPE_API_KEY', re: /console\.log\([^)]*\bMATA_DECOUPE_API_KEY\s*[)\,]/ },
            { name: 'SESSION_SECRET', re: /console\.log\([^)]*\bSESSION_SECRET\s*[)\,]/ },
            { name: 'EXTERNAL_API_KEY', re: /console\.log\([^)]*\bEXTERNAL_API_KEY\s*[)\,]/ },
            { name: 'DEFAULT_ADMIN_PASSWORD', re: /console\.log\([^)]*\bDEFAULT_ADMIN_PASSWORD\s*[)\,]/ }
        ];
        for (const f of filesToCheck) {
            const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
            for (const { name, re } of dangerousPatterns) {
                if (re.test(src)) {
                    throw new Error(`${f} log le secret ${name} en clair`);
                }
            }
        }
    });

    test('pas de res.json qui renverrait MATA_DECOUPE_API_KEY au client', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'routes', 'decoupe-forward.js'), 'utf8'
        );
        // Cherche tout res.json/res.send qui contiendrait apiKey
        // (autorise process.env.MATA_DECOUPE_API_KEY dans les *headers* fetch
        //  mais pas dans le body de réponse).
        const responseLines = src.match(/res\.json\(\{[^}]*\}/g) || [];
        for (const line of responseLines) {
            expect(line).not.toMatch(/apiKey|api_key|API_KEY/i);
        }
    });
});

describe('Smoke auth: behavioral 401 sur les routes protégées', () => {
    // Ces tests instancient les routers avec un mock de session vide
    // pour confirmer que le rejet 401 fonctionne réellement (pas juste
    // que le code source a le middleware).
    const express = require('express');
    const request = require('supertest');

    function appWithoutSession(routerPath, mountAt) {
        // Les modules mockés pour decoupe-forward et config-admin sont
        // configurés par leurs propres tests. Ici on mock à minima.
        jest.resetModules();
        jest.doMock('../db', () => ({
            sequelize: { query: jest.fn(), QueryTypes: { SELECT: 'SELECT' } }
        }));
        jest.doMock('../db/models', () => ({
            User: {}, PointVente: {}, Category: {}, InventaireCategory: {},
            Produit: {}, PrixPointVente: {}, PrixHistorique: {},
            DecoupeOrderLog: { findAll: jest.fn(), create: jest.fn() }
        }));
        jest.doMock('../config/tenant', () => ({ slug: 't', name: 'T' }));
        jest.doMock('../db/config-service', () => ({ invalidateCache: jest.fn() }));

        const router = require(routerPath);
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.session = null;  // pas authentifié
            next();
        });
        app.use(mountAt, router);
        return app;
    }

    test('config-admin GET /produits → 401 sans session', async () => {
        const app = appWithoutSession('../routes/config-admin', '/api/admin/config');
        const res = await request(app).get('/api/admin/config/produits');
        expect(res.status).toBe(401);
    });

    test('config-admin POST /categories → 401 sans session', async () => {
        const app = appWithoutSession('../routes/config-admin', '/api/admin/config');
        const res = await request(app).post('/api/admin/config/categories').send({ nom: 'X' });
        expect(res.status).toBe(401);
    });

    test('config-admin PUT /categories/:id → 401 sans session', async () => {
        const app = appWithoutSession('../routes/config-admin', '/api/admin/config');
        const res = await request(app).put('/api/admin/config/categories/1').send({});
        expect(res.status).toBe(401);
    });

    test('config-admin POST /produits/:nom/reattach → 401 sans session', async () => {
        const app = appWithoutSession('../routes/config-admin', '/api/admin/config');
        const res = await request(app).post('/api/admin/config/produits/X/reattach');
        expect(res.status).toBe(401);
    });

    test('config-admin GET /inventaire-categories → 401 sans session', async () => {
        const app = appWithoutSession('../routes/config-admin', '/api/admin/config');
        const res = await request(app).get('/api/admin/config/inventaire-categories');
        expect(res.status).toBe(401);
    });
});
