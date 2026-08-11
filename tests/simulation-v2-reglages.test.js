/**
 * Reglages de Simulation 2.0: valeurs par defaut, validation, gardes de role.
 *
 * @jest-environment node
 */

jest.mock('../db/models', () => ({ FinanceConfig: { findAll: jest.fn(), upsert: jest.fn() } }));
jest.mock('../db/index', () => ({ sequelize: { transaction: jest.fn(async (fn) => fn({})) } }));

const { FinanceConfig } = require('../db/models');
const reglages = require('../lib/simulation-v2/reglages');

describe('lireReglages', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test('inactif par defaut quand aucune cle n existe', async () => {
        FinanceConfig.findAll.mockResolvedValue([]);
        const r = await reglages.lireReglages();
        expect(r.actif).toBe(false);
        expect(r.famillePoulet).toEqual(['Poulet en détail', 'Poulet en gros']);
        expect(r.prixPouletDefaut).toBe(3000);
    });

    test("seule la valeur '1' active le drapeau", async () => {
        for (const v of ['1']) {
            FinanceConfig.findAll.mockResolvedValue([{ key: 'simulation_v2_enabled', value: v }]);
            expect((await reglages.lireReglages()).actif).toBe(true);
        }
        // Toute autre valeur ferme: sur un interrupteur, le doute ne doit
        // jamais ouvrir un ecran de resultat.
        for (const v of ['0', 'true', 'oui', '', 'x', '2']) {
            FinanceConfig.findAll.mockResolvedValue([{ key: 'simulation_v2_enabled', value: v }]);
            expect((await reglages.lireReglages()).actif).toBe(false);
        }
    });

    test('une liste vide desactive la famille, elle ne retombe pas sur le defaut', async () => {
        FinanceConfig.findAll.mockResolvedValue([{ key: 'famille_poulet', value: '  ,  , ' }]);
        const r = await reglages.lireReglages();
        expect(r.famillePoulet).toEqual([]);
    });

    test('les doublons et les blancs sont nettoyes', async () => {
        FinanceConfig.findAll.mockResolvedValue([
            { key: 'famille_poulet', value: ' Poulet en gros , poulet EN GROS ,Poulet en détail, ' }
        ]);
        const r = await reglages.lireReglages();
        expect(r.famillePoulet).toEqual(['Poulet en gros', 'Poulet en détail']);
    });

    test('un prix invalide retombe sur 3000 et le signale', async () => {
        FinanceConfig.findAll.mockResolvedValue([{ key: 'prix_achat_defaut_poulet', value: 'abc' }]);
        const r = await reglages.lireReglages();
        expect(r.prixPouletDefaut).toBe(3000);
        expect(r.avertissements.join(' ')).toMatch(/prix_achat_defaut_poulet/);
    });

    test('une base illisible ne fait pas echouer la lecture', async () => {
        FinanceConfig.findAll.mockRejectedValue(new Error('boom'));
        const r = await reglages.lireReglages();
        expect(r.actif).toBe(false);
        expect(r.avertissements.join(' ')).toMatch(/finance_config illisible/);
    });
});

describe('valider', () => {
    test('refuse un actif non booleen', () => {
        expect(reglages.valider({ actif: 'oui' }).ok).toBe(false);
    });
    test('refuse un prix hors bornes', () => {
        expect(reglages.valider({ prixPouletDefaut: 0 }).ok).toBe(false);
        expect(reglages.valider({ prixPouletDefaut: 200000 }).ok).toBe(false);
        expect(reglages.valider({ prixPouletDefaut: 3200 }).ok).toBe(true);
    });
    test('refuse une liste demesuree', () => {
        const gros = Array.from({ length: 51 }, (_, i) => 'P' + i);
        expect(reglages.valider({ famillePoulet: gros }).ok).toBe(false);
    });
    test('refuse un corps vide', () => {
        expect(reglages.valider({}).ok).toBe(false);
    });
    test('accepte une liste sous forme de chaine', () => {
        const v = reglages.valider({ famillePoulet: 'A, B ,A' });
        expect(v.ok).toBe(true);
        expect(v.aEcrire[0].value).toBe('A,B');
    });
});

describe('ecrireReglages', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    test("n'ecrit RIEN quand une seule valeur est invalide", async () => {
        const r = await reglages.ecrireReglages({ actif: true, prixPouletDefaut: -5 });
        expect(r.ok).toBe(false);
        expect(FinanceConfig.upsert).not.toHaveBeenCalled();
    });

    test('ecrit le drapeau sous la forme 0/1', async () => {
        FinanceConfig.findAll.mockResolvedValue([]);
        await reglages.ecrireReglages({ actif: true });
        expect(FinanceConfig.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ key: 'simulation_v2_enabled', value: '1' }),
            expect.anything()
        );
    });
});

describe('la garde de role du routeur', () => {
    // Le routeur recopie checkAdminStrict plutot que de l'importer: server.js
    // require ce fichier, l'importer en sens inverse creerait un cycle.
    const router = require('../routes/simulation-v2');
    const couche = (chemin, methode) => router.stack.find(
        (l) => l.route && l.route.path === chemin && l.route.methods[methode]
    );

    test('PUT /reglages porte un middleware de plus que GET', () => {
        const get = couche('/reglages', 'get');
        const put = couche('/reglages', 'put');
        expect(get).toBeTruthy();
        expect(put).toBeTruthy();
        expect(put.route.stack.length).toBe(get.route.stack.length + 1);
    });

    test('la garde refuse superviseur et superutilisateur, accepte admin', () => {
        const garde = couche('/reglages', 'put').route.stack[0].handle;
        const essai = (role) => {
            let code = 200, suivant = false;
            const res = { status(c) { code = c; return this; }, json() { return this; } };
            garde({ session: { user: { role } } }, res, () => { suivant = true; });
            return { code, suivant };
        };
        expect(essai('admin')).toEqual({ code: 200, suivant: true });
        expect(essai('superviseur').code).toBe(403);
        expect(essai('superutilisateur').code).toBe(403);
        expect(essai('user').code).toBe(403);

        let code = 0;
        garde({}, { status(c) { code = c; return this; }, json() { return this; } }, () => {});
        expect(code).toBe(401);
    });
});

describe('GET /reglages : ce que chaque role voit', () => {
    const express = require('express');
    const http = require('http');

    function appAvecRole(role) {
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.session = role ? { user: { role } } : null; next(); });
        app.use('/api/simulation-v2', require('../routes/simulation-v2'));
        return app;
    }

    function appel(app, methode, chemin, corps) {
        return new Promise((resolve, reject) => {
            const serveur = http.createServer(app).listen(0, () => {
                const donnees = corps ? JSON.stringify(corps) : null;
                const req = http.request({
                    port: serveur.address().port, path: chemin, method: methode,
                    headers: donnees
                        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(donnees) }
                        : {}
                }, (res) => {
                    let b = '';
                    res.on('data', (c) => { b += c; });
                    res.on('end', () => {
                        serveur.close();
                        let j = null; try { j = JSON.parse(b); } catch (e) { /* corps non JSON */ }
                        resolve({ code: res.statusCode, body: j });
                    });
                });
                req.on('error', (e) => { serveur.close(); reject(e); });
                if (donnees) req.write(donnees);
                req.end();
            });
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        FinanceConfig.findAll.mockResolvedValue([
            { key: 'simulation_v2_enabled', value: '1' },
            { key: 'famille_poulet', value: 'Poulet en détail,Poulet en gros' },
            { key: 'prix_achat_defaut_poulet', value: '3000' }
        ]);
    });

    test('un admin voit tous les reglages', async () => {
        const r = await appel(appAvecRole('admin'), 'GET', '/api/simulation-v2/reglages');
        expect(r.code).toBe(200);
        expect(r.body.data.actif).toBe(true);
        expect(r.body.data.famille_poulet).toEqual(['Poulet en détail', 'Poulet en gros']);
        expect(r.body.data.prix_achat_defaut_poulet).toBe(3000);
    });

    test('un superviseur ne voit QUE le drapeau', async () => {
        const r = await appel(appAvecRole('superviseur'), 'GET', '/api/simulation-v2/reglages');
        expect(r.code).toBe(200);
        expect(r.body.data).toEqual({ actif: true });
        expect(r.body.data.famille_poulet).toBeUndefined();
        expect(r.body.data.prix_achat_defaut_poulet).toBeUndefined();
    });

    test('un superviseur ne peut pas ecrire', async () => {
        const r = await appel(appAvecRole('superviseur'), 'PUT', '/api/simulation-v2/reglages', { actif: false });
        expect(r.code).toBe(403);
        expect(FinanceConfig.upsert).not.toHaveBeenCalled();
    });

    test('une session absente donne 401 sur l ecriture', async () => {
        const r = await appel(appAvecRole(null), 'PUT', '/api/simulation-v2/reglages', { actif: false });
        expect(r.code).toBe(401);
    });

    test('un corps invalide rend 400 et n ecrit rien', async () => {
        const r = await appel(appAvecRole('admin'), 'PUT', '/api/simulation-v2/reglages', { prixPouletDefaut: -1 });
        expect(r.code).toBe(400);
        expect(FinanceConfig.upsert).not.toHaveBeenCalled();
    });
});

describe('deduplication de la famille', () => {
    test('accents et casse sont ignores, comme a la resolution des prix', () => {
        // 'Poulet en détail' et 'POULET EN DETAIL' resolvent vers le meme cout:
        // les garder tous deux afficherait un doublon qui n'en est pas un.
        const v = reglages.valider({
            famillePoulet: 'Poulet en détail, POULET EN DETAIL, Poulet en gros'
        });
        expect(v.ok).toBe(true);
        expect(v.aEcrire[0].value).toBe('Poulet en détail,Poulet en gros');
    });

    test('deux produits reellement differents sont conserves', () => {
        const v = reglages.valider({ famillePoulet: 'Poulet en détail, Cuisse de poulet' });
        expect(v.aEcrire[0].value).toBe('Poulet en détail,Cuisse de poulet');
    });
});
