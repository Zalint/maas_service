/**
 * Les cles de Simulation 2.0 ne sortent PAS par la route de config generique.
 *
 * GET/PUT /api/finance/config rendent toute finance_config et sont gardes par
 * checkAdvancedAccess, qui laisse passer superviseur ET superutilisateur.
 * /api/simulation-v2/reglages, lui, refuse expressement de montrer ces cles a
 * ces deux roles. Sans liste noire, deux routes disent le contraire l'une de
 * l'autre sur les memes donnees.
 *
 * Ce fichier existe pour une raison precise: la liste noire etait DERIVEE de
 * Object.values(CLES). Retirer une cle du code la retirait donc aussi de la
 * liste noire, pendant que ses lignes restaient en base sur les tenants deja
 * deployes - une suppression de code devenait une exposition de donnees, sans
 * qu'aucun test ne bronche.
 *
 * @jest-environment node
 */

// routes/finance.js destructure une quinzaine de modeles au chargement. On
// les pose tous en faux: seul FinanceConfig.findAll compte pour ce fichier,
// mais un modele absent ferait echouer le require avant le premier test.
jest.mock('../db/models', () => {
    const faux = () => ({
        findAll: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn(), upsert: jest.fn(), destroy: jest.fn(), bulkCreate: jest.fn()
    });
    return {
        Depense: faux(), FournisseurPrix: faux(), FinanceConfig: faux(),
        FournisseurPaiement: faux(), ProduitAlias: faux(), PrixVenteCdcHistory: faux(),
        PrixAchatHistory: faux(), PrixVenteHistory: faux(), FinanceCharge: faux(),
        FinanceChargeHistory: faux(), FinanceChargeMois: faux(), FinanceConfigMois: faux(),
        ClotureCaisse: faux(), Produit: faux(), Vente: faux(), PlSnapshot: faux(),
        sequelize: {
            query: jest.fn().mockResolvedValue([[], {}]),
            transaction: jest.fn(async (fn) => fn({})),
            fn: jest.fn((...a) => ({ fn: a })),
            col: jest.fn((c) => ({ col: c })),
            where: jest.fn((a, b) => ({ where: [a, b] })),
            QueryTypes: { SELECT: 'SELECT' }
        }
    };
});

const { FinanceConfig } = require('../db/models');
const { CLES, CLES_RETIREES, CLES_RESERVEES } = require('../lib/simulation-v2/reglages');

describe('la liste noire couvre le vivant ET le retire', () => {
    test('toutes les cles vivantes y sont', () => {
        for (const cle of Object.values(CLES)) {
            expect(CLES_RESERVEES).toContain(cle);
        }
    });

    test('toutes les cles retirees y sont AUSSI', () => {
        // C'est le coeur du sujet: ces trois cles n'existent plus dans le
        // code, mais elles existent encore en base.
        expect(CLES_RETIREES).toEqual(
            expect.arrayContaining(['famille_poulet', 'famille_boeuf', 'prix_achat_defaut_poulet'])
        );
        for (const cle of CLES_RETIREES) {
            expect(CLES_RESERVEES).toContain(cle);
        }
    });

    test('une cle retiree n est PAS reintroduite comme cle vivante', () => {
        // Reutiliser un nom retire pour un nouveau reglage ferait lire par
        // l'ancien chemin une valeur ecrite par le nouveau.
        for (const cle of CLES_RETIREES) {
            expect(Object.values(CLES)).not.toContain(cle);
        }
    });

    test('la liste noire ne se DERIVE pas des seules cles vivantes', () => {
        // La regression exacte: CLES_RESERVEES doit etre STRICTEMENT plus
        // grande que CLES tant qu'une cle retiree subsiste.
        expect(CLES_RESERVEES.length).toBeGreaterThan(Object.values(CLES).length);
    });
});

describe('la route filtre effectivement', () => {
    // On monte le VRAI routeur et on appelle GET /config en HTTP.
    //
    // La version precedente de ce bloc recopiait la boucle de filtrage de
    // routes/finance.js et verifiait que sa propre copie avait filtre. Preuve
    // par mutation: supprimer la ligne `if (reservees.has(r.key)) continue;`
    // du code de production - c'est-a-dire annuler entierement le correctif -
    // laissait le depot VERT. Un test qui reimplemente ce qu'il teste ne
    // protege rien.
    const express = require('express');
    const http = require('http');

    // Les lignes telles qu'elles existent chez un tenant deja deploye: les
    // trois cles retirees y sont encore, personne ne les a effacees.
    const LIGNES = [
        { key: 'simulation_v2_enabled', value: '1' },
        { key: 'produits_simulation', value: 'Poulet en gros' },
        { key: 'simulation_coeff_p1_p2', value: '{"valeur":1.24}' },
        { key: 'famille_poulet', value: 'Poulet en détail,Poulet en gros' },
        { key: 'famille_boeuf', value: 'Jarret:0.5' },
        { key: 'prix_achat_defaut_poulet', value: '3000' },
        { key: 'parage_exclusions', value: 'Boeuf sur pied' }
    ];

    // checkAdvancedAccess (middlewares/auth.js) teste canManageAdvanced, PAS
    // le role. Une session sans ce drapeau rend 403, et les assertions
    // passaient alors sur un corps d'ERREUR - vertes sans rien prouver.
    function appel(role) {
        return new Promise((resolve, reject) => {
            const app = express();
            app.use(express.json());
            app.use((req, _res, next) => {
                req.session = { user: { role, canManageAdvanced: true } };
                next();
            });
            app.use('/api/finance', require('../routes/finance'));
            const serveur = http.createServer(app).listen(0, () => {
                http.get({ port: serveur.address().port, path: '/api/finance/config' }, (res) => {
                    let b = '';
                    res.on('data', (c) => { b += c; });
                    res.on('end', () => {
                        serveur.close();
                        let j = null;
                        try { j = JSON.parse(b); } catch (e) { /* corps non JSON */ }
                        resolve({ code: res.statusCode, body: j });
                    });
                }).on('error', (e) => { serveur.close(); reject(e); });
            });
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        FinanceConfig.findAll.mockResolvedValue(LIGNES);
    });

    test('aucune cle v2, vivante ou retiree, ne franchit la route', async () => {
        const r = await appel('admin');
        expect(r.code).toBe(200);
        expect(r.body.success).toBe(true);
        // Seule la cle legitime sort.
        expect(Object.keys(r.body.data)).toEqual(['parage_exclusions']);
    });

    test('aucune VALEUR reservee ne transparait dans la reponse', async () => {
        // Un test sur les seules cles laisserait passer une valeur recopiee
        // sous un autre nom.
        const r = await appel('admin');
        const texte = JSON.stringify(r.body);
        expect(texte).not.toMatch(/Jarret/);
        expect(texte).not.toMatch(/3000/);
        expect(texte).not.toMatch(/1\.24/);
    });

    test('le superviseur non plus ne les voit pas', async () => {
        // C'est LE role qui motive le filtre: checkAdvancedAccess le laisse
        // ENTRER sur cette route, alors que /api/simulation-v2/reglages lui
        // refuse expressement ces memes cles. Sans liste noire, les deux
        // routes se contredisaient sur les memes donnees.
        const r = await appel('superviseur');
        expect(r.code).toBe(200);
        expect(Object.keys(r.body.data)).toEqual(['parage_exclusions']);
    });
});
