/**
 * @jest-environment node
 *
 * Roundtrip test pour POST /api/reconciliation/save → GET /api/reconciliation/load.
 *
 * Pourquoi ce test: le PR ajoute commandesInterPV au payload de réconciliation
 * (script.js calcReconPV). Cette valeur DOIT survivre la sérialisation
 * JSON.stringify côté save et JSON.parse côté load. Sans test, une régression
 * sur le serialization (ex: ajout d'un sanitizer qui drop les champs inconnus)
 * casserait silencieusement la persistance.
 *
 * Stratégie: mirror les handlers de server.js dans un mini-router supertest.
 * Si server.js change la logique, ce test ne le verra pas — c'est une
 * limitation acceptée vu que server.js fait 13k+ lignes et n'est pas
 * factorisable. La logique mirrorée est volontairement simple à comparer
 * visuellement avec server.js:4176-4280.
 */

const express = require('express');
const request = require('supertest');

// =============== Mock Reconciliation model (in-memory store) ===============

let store = new Map(); // date → row

const Reconciliation = {
    findOne: jest.fn(async ({ where }) => {
        return store.get(where.date) || null;
    }),
    create: jest.fn(async (data) => {
        const row = { ...data, id: store.size + 1, createdAt: new Date(), updatedAt: new Date() };
        store.set(data.date, row);
        // Simuler instance methods Sequelize
        row.update = async (newData) => {
            Object.assign(row, newData, { updatedAt: new Date() });
            return row;
        };
        return row;
    })
};

// =============== Mini-router: mirror de server.js:4176+ ===============

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { user: { username: 'TESTUSER', role: 'admin' } };
        next();
    });

    app.post('/api/reconciliation/save', async (req, res) => {
        try {
            const { date, reconciliation, cashPaymentData, comments } = req.body;
            if (!date || !reconciliation) {
                return res.status(400).json({ success: false, message: 'Date et données requises' });
            }
            let existing = await Reconciliation.findOne({ where: { date } });
            const dataToSave = {
                date,
                data: JSON.stringify(reconciliation),
                cashPaymentData: cashPaymentData ? JSON.stringify(cashPaymentData) : null,
                comments: comments ? JSON.stringify(comments) : null,
                version: 1
            };
            if (existing) {
                await existing.update(dataToSave);
            } else {
                await Reconciliation.create(dataToSave);
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/reconciliation/load', async (req, res) => {
        try {
            const { date } = req.query;
            if (!date) return res.status(400).json({ success: false, message: 'Date requise' });
            const row = await Reconciliation.findOne({ where: { date } });
            if (!row) return res.json({ success: true, data: null });
            const response = {
                id: row.id,
                date: row.date,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt
            };
            try { response.data = JSON.parse(row.data); }
            catch (e) { response.data = row.data; }
            response.reconciliation = response.data;
            if (row.cashPaymentData) {
                try { response.cashPaymentData = JSON.parse(row.cashPaymentData); }
                catch (e) { response.cashPaymentData = null; }
            }
            if (row.comments) {
                try { response.comments = JSON.parse(row.comments); }
                catch (e) { response.comments = null; }
            }
            res.json({ success: true, data: response });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return app;
}

// =============== Tests ===============

beforeEach(() => {
    store = new Map();
    Reconciliation.findOne.mockClear();
    Reconciliation.create.mockClear();
});

describe('save → load roundtrip', () => {
    test('commandesInterPV persiste à travers save/load', async () => {
        const reconciliationData = {
            'Mbao': {
                stockMatin: 762200,
                stockSoir: 508800,
                transferts: 0,
                ventesSaisies: 226400,
                commandesInterPV: 11700,  // ← le champ ajouté par le PR
                creances: 0,
                difference: 27000
            }
        };

        // SAVE
        const saveRes = await request(makeApp())
            .post('/api/reconciliation/save')
            .send({ date: '2026-04-30', reconciliation: reconciliationData });
        expect(saveRes.status).toBe(200);
        expect(saveRes.body.success).toBe(true);

        // LOAD
        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        expect(loadRes.status).toBe(200);
        expect(loadRes.body.data.reconciliation.Mbao.commandesInterPV).toBe(11700);
    });

    test('commentaires persistent', async () => {
        await request(makeApp())
            .post('/api/reconciliation/save')
            .send({
                date: '2026-04-30',
                reconciliation: { 'Mbao': { ventesSaisies: 100, commentaire: 'Note du jour' } },
                comments: { 'Mbao': 'Note séparée' }
            });
        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        expect(loadRes.body.data.comments.Mbao).toBe('Note séparée');
        expect(loadRes.body.data.reconciliation.Mbao.commentaire).toBe('Note du jour');
    });

    test('cashPaymentData persiste', async () => {
        await request(makeApp())
            .post('/api/reconciliation/save')
            .send({
                date: '2026-04-30',
                reconciliation: { 'Mbao': {} },
                cashPaymentData: { 'Mbao': 5000, 'Sacre Coeur': 3000 }
            });
        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        expect(loadRes.body.data.cashPaymentData).toEqual({
            'Mbao': 5000, 'Sacre Coeur': 3000
        });
    });

    test('update remplace les données précédentes (pas de doublon)', async () => {
        const date = '2026-04-30';
        // Premier save
        await request(makeApp()).post('/api/reconciliation/save')
            .send({ date, reconciliation: { 'Mbao': { commandesInterPV: 1000 } } });
        // Re-save avec valeur différente
        await request(makeApp()).post('/api/reconciliation/save')
            .send({ date, reconciliation: { 'Mbao': { commandesInterPV: 2500 } } });

        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=' + date);
        expect(loadRes.body.data.reconciliation.Mbao.commandesInterPV).toBe(2500);
        // Une seule entrée en store
        expect(store.size).toBe(1);
        // Seulement 1 create, le 2nd save → update
        expect(Reconciliation.create).toHaveBeenCalledTimes(1);
    });

    test('plusieurs PV persistent indépendamment', async () => {
        const reconciliation = {
            'Mbao': { ventesSaisies: 8200, commandesInterPV: 11700 },
            'Sacre Coeur': { ventesSaisies: 5000, commandesInterPV: 0 },
            'Keur Massar': { ventesSaisies: 3000, commandesInterPV: 1500 }
        };
        await request(makeApp()).post('/api/reconciliation/save')
            .send({ date: '2026-04-30', reconciliation });
        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        const data = loadRes.body.data.reconciliation;
        expect(data.Mbao.commandesInterPV).toBe(11700);
        expect(data['Sacre Coeur'].commandesInterPV).toBe(0);
        expect(data['Keur Massar'].commandesInterPV).toBe(1500);
    });

    test('valeurs spéciales JSON survivent (decimals, null, true/false)', async () => {
        const reconciliation = {
            'Mbao': {
                stockMatin: 762200.50,        // decimal
                ventesSaisies: 226400,
                commandesInterPV: 11700,
                cashPaymentZero: 0,            // 0 ≠ null
                hasErrors: false,              // boolean
                manquant: null,                // null
                pourcentageEcart: 10.66        // decimal
            }
        };
        await request(makeApp()).post('/api/reconciliation/save')
            .send({ date: '2026-04-30', reconciliation });
        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        const data = loadRes.body.data.reconciliation.Mbao;
        expect(data.stockMatin).toBe(762200.50);
        expect(data.cashPaymentZero).toBe(0);
        expect(data.hasErrors).toBe(false);
        expect(data.manquant).toBeNull();
        expect(data.pourcentageEcart).toBeCloseTo(10.66, 2);
    });

    test('compatibilité backward: response inclut data + reconciliation (alias)', async () => {
        await request(makeApp()).post('/api/reconciliation/save')
            .send({ date: '2026-04-30', reconciliation: { Mbao: { x: 1 } } });
        const loadRes = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        // Le champ 'data' et le champ 'reconciliation' doivent être identiques
        // (alias de compatibilité maintenu).
        expect(loadRes.body.data.data).toEqual(loadRes.body.data.reconciliation);
    });
});

describe('Validation des entrées', () => {
    test('400 sans date sur save', async () => {
        const res = await request(makeApp()).post('/api/reconciliation/save')
            .send({ reconciliation: {} });
        expect(res.status).toBe(400);
    });

    test('400 sans reconciliation sur save', async () => {
        const res = await request(makeApp()).post('/api/reconciliation/save')
            .send({ date: '2026-04-30' });
        expect(res.status).toBe(400);
    });

    test('400 sans date sur load', async () => {
        const res = await request(makeApp()).get('/api/reconciliation/load');
        expect(res.status).toBe(400);
    });

    test('load sur date inexistante → data=null mais success=true', async () => {
        const res = await request(makeApp())
            .get('/api/reconciliation/load?date=2099-12-31');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeNull();
    });
});

describe('Robustesse parsing', () => {
    test('data JSON corrompu → fallback graceful', async () => {
        // Simuler une row avec data corrompu (cas legacy improbable mais
        // documente le filet de sécurité du handler)
        store.set('2026-04-30', {
            id: 1,
            date: '2026-04-30',
            data: 'pas du json valide',
            cashPaymentData: null,
            comments: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        const res = await request(makeApp())
            .get('/api/reconciliation/load?date=2026-04-30');
        expect(res.status).toBe(200);
        // data tombe sur la chaîne brute en cas de parse échoué
        expect(res.body.data.data).toBe('pas du json valide');
    });
});
