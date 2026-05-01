/**
 * @jest-environment node
 *
 * Tests d'intégration pour les nouveaux endpoints de routes/config-admin.js:
 *  - PUT /categories/:id avec famille (Boucherie/Epicerie/Autres)
 *  - GET/PUT /inventaire-categories
 *  - GET /produits avec categoriesMeta + prix_personnalise + inventaire_parent
 *  - POST /produits (auto-détachement quand prix modifié)
 *  - POST /produits-inventaire (ventes mapping + propagation prix)
 *  - POST /produits/:nom/reattach
 *
 * Tous les modèles Sequelize et configService sont mockés.
 */

// =============== Mocks ===============
const mockProduit = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn()
};
const mockCategory = {
    findAll: jest.fn(),
    findOrCreate: jest.fn(),
    findByPk: jest.fn()
};
const mockInventaireCategory = {
    findAll: jest.fn(),
    upsert: jest.fn()
};
const mockPointVente = { findAll: jest.fn(), findOne: jest.fn() };
const mockPrixPointVente = { upsert: jest.fn() };
const mockPrixHistorique = { create: jest.fn(), bulkCreate: jest.fn() };
const mockUser = {};

const mockConfigService = { invalidateCache: jest.fn() };

jest.mock('../db', () => ({
    sequelize: { query: jest.fn(), QueryTypes: { SELECT: 'SELECT' } }
}));

jest.mock('../db/models', () => ({
    User: mockUser,
    PointVente: mockPointVente,
    Category: mockCategory,
    InventaireCategory: mockInventaireCategory,
    Produit: mockProduit,
    PrixPointVente: mockPrixPointVente,
    PrixHistorique: mockPrixHistorique
}));

jest.mock('../db/config-service', () => mockConfigService);

const express = require('express');
const request = require('supertest');

function makeApp({ role = 'admin' } = {}) {
    delete require.cache[require.resolve('../routes/config-admin')];
    const router = require('../routes/config-admin');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = { user: { username: 'TESTADMIN', role } };
        next();
    });
    app.use('/api/admin/config', router);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
});

// =============== Auth middleware ===============
describe('Auth middleware', () => {
    test('401 quand pas de session', async () => {
        delete require.cache[require.resolve('../routes/config-admin')];
        const router = require('../routes/config-admin');
        const app = express();
        app.use(express.json());
        // Middleware qui force req.session = null pour simuler "non authentifié".
        // Sans ça, la session est undefined ET le middleware admin teste
        // !req.session, donc renvoie aussi 401 — mais supertest peut traîner
        // sur certaines versions sans une session explicite.
        app.use((req, _res, next) => { req.session = null; next(); });
        app.use('/api/admin/config', router);
        const res = await request(app).get('/api/admin/config/inventaire-categories');
        expect(res.status).toBe(401);
    }, 30000);

    test('403 sur rôle non admin/supervisor pour les endpoints admin-only', async () => {
        const res = await request(makeApp({ role: 'user' }))
            .put('/api/admin/config/categories/1')
            .send({ famille: 'Boucherie' });
        expect(res.status).toBe(403);
    });

    test('superviseur autorisé en lecture inventaire-categories', async () => {
        mockInventaireCategory.findAll.mockResolvedValueOnce([]);
        const res = await request(makeApp({ role: 'superviseur' }))
            .get('/api/admin/config/inventaire-categories');
        expect(res.status).toBe(200);
    });
});

// =============== PUT /categories/:id (famille) ===============
describe('PUT /api/admin/config/categories/:id', () => {
    test('met à jour la famille', async () => {
        const cat = { update: jest.fn().mockResolvedValueOnce(true) };
        mockCategory.findByPk.mockResolvedValueOnce(cat);
        const res = await request(makeApp())
            .put('/api/admin/config/categories/4')
            .send({ famille: 'Boucherie' });
        expect(res.status).toBe(200);
        expect(cat.update).toHaveBeenCalledWith({ famille: 'Boucherie' });
        expect(mockConfigService.invalidateCache).toHaveBeenCalled();
    });

    test('400 sur famille invalide', async () => {
        // findByPk doit renvoyer une catégorie pour qu'on atteigne la
        // validation de la famille (sinon 404 avant).
        mockCategory.findByPk.mockResolvedValueOnce({ update: jest.fn() });
        const res = await request(makeApp())
            .put('/api/admin/config/categories/4')
            .send({ famille: 'Pirate' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Famille invalide/);
    });

    test('404 si catégorie introuvable', async () => {
        mockCategory.findByPk.mockResolvedValueOnce(null);
        const res = await request(makeApp())
            .put('/api/admin/config/categories/999')
            .send({ nom: 'X' });
        expect(res.status).toBe(404);
    });

    test('update partiel — pas de champ envoyé → no-op', async () => {
        const cat = { update: jest.fn().mockResolvedValueOnce(true) };
        mockCategory.findByPk.mockResolvedValueOnce(cat);
        const res = await request(makeApp())
            .put('/api/admin/config/categories/4')
            .send({});
        expect(res.status).toBe(200);
        // update appelé avec un objet vide
        expect(cat.update).toHaveBeenCalledWith({});
    });
});

// =============== GET / PUT /inventaire-categories ===============
describe('GET /api/admin/config/inventaire-categories', () => {
    test('retourne la map nom→famille', async () => {
        mockInventaireCategory.findAll.mockResolvedValueOnce([
            { nom: 'Viandes', famille: 'Boucherie' },
            { nom: 'Œufs et Produits Laitiers', famille: 'Epicerie' }
        ]);
        const res = await request(makeApp())
            .get('/api/admin/config/inventaire-categories');
        expect(res.status).toBe(200);
        expect(res.body.familles).toEqual({
            'Viandes': 'Boucherie',
            'Œufs et Produits Laitiers': 'Epicerie'
        });
    });
});

describe('PUT /api/admin/config/inventaire-categories/:nom', () => {
    test('upsert avec valeur valide', async () => {
        mockInventaireCategory.upsert.mockResolvedValueOnce([{ nom: 'Conserve', famille: 'Epicerie' }]);
        const res = await request(makeApp())
            .put('/api/admin/config/inventaire-categories/Conserve')
            .send({ famille: 'Epicerie' });
        expect(res.status).toBe(200);
        expect(mockInventaireCategory.upsert).toHaveBeenCalledWith({
            nom: 'Conserve', famille: 'Epicerie'
        });
    });

    test('400 sur famille invalide', async () => {
        const res = await request(makeApp())
            .put('/api/admin/config/inventaire-categories/Conserve')
            .send({ famille: 'Pirate' });
        expect(res.status).toBe(400);
    });
});

// =============== GET /produits ===============
describe('GET /api/admin/config/produits', () => {
    test('renvoie produits + categoriesMeta + prix_personnalise + inventaire_parent', async () => {
        const fakeProduit = (nom, prix_defaut, prix_personnalise, categorie) => ({
            id: 1, nom, prix_defaut, prix_alternatifs: [],
            prix_personnalise, prixParPointVente: [], categorie
        });
        // Catégorie pour les produits
        const catBovin = { id: 4, nom: 'Bovin', famille: 'Boucherie', ordre: 1 };
        mockProduit.findAll
            // 1er appel: produits vente
            .mockResolvedValueOnce([
                fakeProduit('Boeuf en gros', 3700, false, catBovin),
                fakeProduit('Boeuf en détail', 3900, true, catBovin)
            ])
            // 2nd appel: parents inventaire pour calculer inventaire_parent
            .mockResolvedValueOnce([
                { nom: 'Boeuf', ventes: ['Boeuf en gros', 'Boeuf en détail'] }
            ]);
        mockCategory.findAll.mockResolvedValueOnce([catBovin]);

        const res = await request(makeApp()).get('/api/admin/config/produits');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const bvg = res.body.produits.Bovin['Boeuf en gros'];
        expect(bvg.prix_personnalise).toBe(false);
        expect(bvg.inventaire_parent).toBe('Boeuf');
        const bvd = res.body.produits.Bovin['Boeuf en détail'];
        expect(bvd.prix_personnalise).toBe(true);
        expect(bvd.inventaire_parent).toBe('Boeuf');
        expect(res.body.categoriesMeta.Bovin).toEqual({ id: 4, famille: 'Boucherie', ordre: 1 });
    });
});

// =============== POST /produits (propagation auto-detach) ===============
describe('POST /api/admin/config/produits', () => {
    function setupBaseMocks({ existingPrix = 3700, hasParent = true, alreadyDetached = false } = {}) {
        mockPointVente.findAll.mockResolvedValueOnce([]);
        // Parents inventaire: simuler "Boeuf en gros" listé dans ventes d'un parent
        mockProduit.findAll.mockResolvedValueOnce(
            hasParent ? [{ nom: 'Boeuf', ventes: ['Boeuf en gros'] }] : []
        );
        // findOrCreate sur le produit vente
        const produit = {
            id: 10,
            prix_defaut: existingPrix,
            prix_alternatifs: [],
            prix_personnalise: alreadyDetached,
            update: jest.fn().mockResolvedValueOnce(true)
        };
        mockCategory.findOrCreate.mockResolvedValueOnce([{ id: 4 }]);
        mockProduit.findOrCreate.mockResolvedValueOnce([produit, false]);
        return produit;
    }

    test('auto-détache quand prix modifié et parent inventaire existe', async () => {
        const produit = setupBaseMocks({ existingPrix: 3700, hasParent: true });
        mockPrixHistorique.create.mockResolvedValueOnce({});
        const res = await request(makeApp())
            .post('/api/admin/config/produits')
            .send({
                produits: {
                    Bovin: {
                        'Boeuf en gros': { default: 4000, alternatives: [] }
                    }
                }
            });
        expect(res.status).toBe(200);
        expect(produit.update).toHaveBeenCalledWith(expect.objectContaining({
            prix_defaut: 4000,
            prix_personnalise: true   // ← le détachement
        }));
    });

    test('ne re-détache pas si déjà détaché', async () => {
        const produit = setupBaseMocks({ existingPrix: 3700, alreadyDetached: true });
        mockPrixHistorique.create.mockResolvedValueOnce({});
        await request(makeApp())
            .post('/api/admin/config/produits')
            .send({
                produits: { Bovin: { 'Boeuf en gros': { default: 4000, alternatives: [] } } }
            });
        const updateArg = produit.update.mock.calls[0][0];
        expect(updateArg.prix_personnalise).toBeUndefined();
    });

    test('pas de détachement quand pas de parent', async () => {
        const produit = setupBaseMocks({ existingPrix: 3700, hasParent: false });
        mockPrixHistorique.create.mockResolvedValueOnce({});
        await request(makeApp())
            .post('/api/admin/config/produits')
            .send({
                produits: { Autres: { 'X': { default: 100, alternatives: [] } } }
            });
        const updateArg = produit.update.mock.calls[0][0];
        expect(updateArg.prix_personnalise).toBeUndefined();
    });

    test('pas d\'update si prix inchangé', async () => {
        const produit = setupBaseMocks({ existingPrix: 3700, hasParent: true });
        await request(makeApp())
            .post('/api/admin/config/produits')
            .send({
                produits: { Bovin: { 'Boeuf en gros': { default: 3700, alternatives: [] } } }
            });
        expect(produit.update).not.toHaveBeenCalled();
        expect(mockPrixHistorique.create).not.toHaveBeenCalled();
    });

    test('utilise la map PointVente préchargée (N+1 évité)', async () => {
        const produit = setupBaseMocks({ existingPrix: 3700, hasParent: false });
        // Re-mock PointVente.findAll explicitement avec un PV
        mockPointVente.findAll.mockReset();
        mockPointVente.findAll.mockResolvedValueOnce([{ id: 1, nom: 'Mbao' }]);
        mockProduit.findAll.mockReset();
        mockProduit.findAll.mockResolvedValueOnce([]);  // pas de parent
        mockCategory.findOrCreate.mockReset();
        mockCategory.findOrCreate.mockResolvedValueOnce([{ id: 4 }]);
        mockProduit.findOrCreate.mockReset();
        mockProduit.findOrCreate.mockResolvedValueOnce([produit, false]);

        await request(makeApp())
            .post('/api/admin/config/produits')
            .send({
                produits: {
                    Bovin: {
                        'Boeuf en gros': { default: 4000, alternatives: [], 'Mbao': 3500 }
                    }
                }
            });
        // PointVente.findAll appelé une seule fois (préchargement)
        expect(mockPointVente.findAll).toHaveBeenCalledTimes(1);
        // PointVente.findOne NE doit PAS être appelé (le bug N+1 est fixé)
        expect(mockPointVente.findOne).not.toHaveBeenCalled();
        expect(mockPrixPointVente.upsert).toHaveBeenCalledWith({
            produit_id: 10, point_vente_id: 1, prix: 3500
        });
    });
});

// =============== POST /produits-inventaire (propagation) ===============
describe('POST /api/admin/config/produits-inventaire', () => {
    test('persiste ventes + propage prix vers enfants non détachés', async () => {
        // Préchargements
        mockPointVente.findAll.mockResolvedValueOnce([]);
        const enfantA = { id: 21, nom: 'Boeuf en gros', prix_defaut: 3700, prix_personnalise: false };
        const enfantB = { id: 22, nom: 'Boeuf en détail', prix_defaut: 3900, prix_personnalise: true };
        mockProduit.findAll.mockResolvedValueOnce([enfantA, enfantB]);

        // findOrCreate sur le produit inventaire (existant)
        const inventaire = {
            id: 100,
            prix_defaut: 3500,         // ← l'ancien
            prix_alternatifs: [3500],
            mode_stock: 'manuel',
            unite_stock: 'unite',
            categorie_affichage: null,
            ventes: [],
            update: jest.fn().mockResolvedValueOnce(true)
        };
        mockProduit.findOrCreate.mockResolvedValueOnce([inventaire, false]);
        mockPrixHistorique.create.mockResolvedValueOnce({});
        mockPrixHistorique.bulkCreate.mockResolvedValueOnce([]);
        mockProduit.update.mockResolvedValueOnce([1]);

        const res = await request(makeApp())
            .post('/api/admin/config/produits-inventaire')
            .send({
                produitsInventaire: {
                    Boeuf: {
                        prixDefault: 4000,        // ← changement
                        alternatives: [4000],
                        mode_stock: 'manuel',
                        unite_stock: 'unite',
                        ventes: ['Boeuf en gros', 'Boeuf en détail']
                    }
                }
            });

        expect(res.status).toBe(200);
        // Le produit inventaire a été update avec ventes
        expect(inventaire.update).toHaveBeenCalledWith(expect.objectContaining({
            prix_defaut: 4000,
            ventes: ['Boeuf en gros', 'Boeuf en détail']
        }));
        // Propagation: bulkCreate historique pour l'enfant non détaché
        expect(mockPrixHistorique.bulkCreate).toHaveBeenCalled();
        const histRows = mockPrixHistorique.bulkCreate.mock.calls[0][0];
        expect(histRows).toHaveLength(1);
        expect(histRows[0].produit_id).toBe(21);  // enfantA seulement
        // Update batch sur les enfants non détachés
        expect(mockProduit.update).toHaveBeenCalledWith(
            { prix_defaut: 4000, prix_alternatifs: [4000] },
            { where: { id: [21] } }   // pas l'enfant détaché
        );
    });

    test('aucune propagation quand prix inchangé', async () => {
        mockPointVente.findAll.mockResolvedValueOnce([]);
        mockProduit.findAll.mockResolvedValueOnce([]);
        const inventaire = {
            id: 100,
            prix_defaut: 3500,
            prix_alternatifs: [3500],
            mode_stock: 'manuel',
            unite_stock: 'unite',
            categorie_affichage: null,
            ventes: ['Boeuf en gros'],
            update: jest.fn()
        };
        mockProduit.findOrCreate.mockResolvedValueOnce([inventaire, false]);
        const res = await request(makeApp())
            .post('/api/admin/config/produits-inventaire')
            .send({
                produitsInventaire: {
                    Boeuf: {
                        prixDefault: 3500,
                        alternatives: [3500],
                        mode_stock: 'manuel',
                        unite_stock: 'unite',
                        ventes: ['Boeuf en gros']
                    }
                }
            });
        expect(res.status).toBe(200);
        expect(mockPrixHistorique.bulkCreate).not.toHaveBeenCalled();
        expect(mockProduit.update).not.toHaveBeenCalled();
    });

    test('400 sur payload invalide', async () => {
        const res = await request(makeApp())
            .post('/api/admin/config/produits-inventaire')
            .send({ pas_le_bon_champ: {} });
        expect(res.status).toBe(400);
    });
});

// =============== POST /produits/:nom/reattach ===============
describe('POST /api/admin/config/produits/:nom/reattach', () => {
    const { sequelize } = require('../db');

    beforeEach(() => {
        sequelize.query.mockReset();
    });

    test('404 si produit vente introuvable', async () => {
        mockProduit.findOne.mockResolvedValueOnce(null);
        const res = await request(makeApp())
            .post('/api/admin/config/produits/Inconnu/reattach');
        expect(res.status).toBe(404);
    });

    test('400 si pas de parent', async () => {
        mockProduit.findOne.mockResolvedValueOnce({ id: 1, prix_defaut: 100 });
        sequelize.query.mockResolvedValueOnce([]);  // pas de parent
        const res = await request(makeApp())
            .post('/api/admin/config/produits/Boeuf%20en%20gros/reattach');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/lié à aucun/);
    });

    test('200: reset prix_personnalise + resync prix depuis parent', async () => {
        const produit = {
            id: 21,
            prix_defaut: 4000,
            update: jest.fn().mockResolvedValueOnce(true)
        };
        mockProduit.findOne.mockResolvedValueOnce(produit);
        sequelize.query.mockResolvedValueOnce([{ id: 100 }]);
        mockProduit.findByPk.mockResolvedValueOnce({
            id: 100, nom: 'Boeuf', prix_defaut: 3700, prix_alternatifs: [3700, 3600]
        });
        mockPrixHistorique.create.mockResolvedValueOnce({});
        const res = await request(makeApp())
            .post('/api/admin/config/produits/Boeuf%20en%20gros/reattach');
        expect(res.status).toBe(200);
        expect(produit.update).toHaveBeenCalledWith({
            prix_defaut: 3700,
            prix_alternatifs: [3700, 3600],
            prix_personnalise: false
        });
        expect(mockPrixHistorique.create).toHaveBeenCalled();
        expect(mockConfigService.invalidateCache).toHaveBeenCalled();
    });

    test('pas d\'historique créé si prix identique au parent', async () => {
        const produit = {
            id: 21, prix_defaut: 3700,
            update: jest.fn().mockResolvedValueOnce(true)
        };
        mockProduit.findOne.mockResolvedValueOnce(produit);
        sequelize.query.mockResolvedValueOnce([{ id: 100 }]);
        mockProduit.findByPk.mockResolvedValueOnce({
            id: 100, nom: 'Boeuf', prix_defaut: 3700, prix_alternatifs: []
        });
        const res = await request(makeApp())
            .post('/api/admin/config/produits/X/reattach');
        expect(res.status).toBe(200);
        expect(mockPrixHistorique.create).not.toHaveBeenCalled();
    });
});
