/**
 * Corrections issues de la revue adversariale du socle Simulation 2.0.
 * Chaque test porte le nom du defaut qu'il empeche de revenir.
 *
 * @jest-environment node
 */

const { agregerVolumes } = require('../lib/volumes-vendus');

describe('volumes vendus : l arrondi appartient a la sortie, pas a l agregat', () => {
    test('les quantites au millieme ne sont pas ecrasees', () => {
        // Arrondir la quantite AVANT que la route ne divise donnait un prix
        // moyen de 5 020 F au lieu de 5 000, soit 0,4 % reporte sur la marge.
        const r = agregerVolumes([
            { produit: 'Boeuf', nombre: '0.125', montant: '625' },
            { produit: 'Boeuf', nombre: '0.126', montant: '630' }
        ]);
        expect(r.produits[0].quantite).toBeCloseTo(0.251, 10);
        expect(r.produits[0].prix_moyen).toBeCloseTo(5000, 10);
    });

    test('une quantite nette minuscule ne fait pas passer le produit pour non vendu', () => {
        // 1,004 puis un retour de 1 -> 0,004. Arrondi a 0, l'ecran declarait
        // le produit non vendu alors qu'il avait deux lignes.
        const r = agregerVolumes([
            { produit: 'Boeuf', nombre: '1.004', montant: '5020' },
            { produit: 'Boeuf', nombre: '-1', montant: '-5000' }
        ]);
        expect(r.produits[0].quantite).toBeGreaterThan(0);
        expect(r.produits[0].prix_moyen).toBeCloseTo(5000, 6);
    });

    test('les lignes sans produit sont comptees et nommees', () => {
        const r = agregerVolumes([
            { produit: null, nombre: '1', montant: '500' },
            { produit: '   ', nombre: '1', montant: '300' },
            { produit: 'Boeuf', nombre: '1', montant: '4800' }
        ]);
        // Elles comptent dans le total, comme le fait total_ventes du PL...
        expect(r.total_ca).toBeCloseTo(5600, 6);
        // ...mais elles n'appartiennent a aucun produit, et on peut le dire.
        expect(r.lignes_sans_produit).toBe(2);
        expect(r.produits).toHaveLength(1);
    });
});

describe('etat des sources : non configure n est pas une panne', () => {
    const CLE = 'DEPENSES_API_BASE_URL';
    const KEY = 'DEPENSES_API_KEY';
    let sauve;
    beforeEach(() => { sauve = { u: process.env[CLE], k: process.env[KEY] }; jest.resetModules(); });
    afterEach(() => {
        if (sauve.u === undefined) delete process.env[CLE]; else process.env[CLE] = sauve.u;
        if (sauve.k === undefined) delete process.env[KEY]; else process.env[KEY] = sauve.k;
        jest.resetModules();
    });

    test('sans variables d environnement, l integration est declaree non configuree', () => {
        delete process.env[CLE];
        delete process.env[KEY];
        const { estConfigure } = require('../lib/depenses-creance-client');
        expect(estConfigure()).toBe(false);
    });

    test('avec les variables mais sans label, elle ne l est pas non plus', () => {
        process.env[CLE] = 'https://exemple.test';
        process.env[KEY] = 'jeton';
        jest.doMock('fs', () => ({ existsSync: () => false, readFileSync: () => '' }));
        const { estConfigure } = require('../lib/depenses-creance-client');
        expect(estConfigure()).toBe(false);
        jest.dontMock('fs');
    });
});

describe('famille poulet : bornes et contournements', () => {
    jest.resetModules();
    const reglages = require('../lib/simulation-v2/reglages');

    test('un nom contenant une virgule ne se scinde plus en deux produits', () => {
        // La branche tableau contournait parseListe: 'Poulet, gros' entrait
        // tel quel puis etait RELU comme deux produits.
        const v = reglages.valider({ famillePoulet: ['Poulet, gros'] });
        expect(v.ok).toBe(true);
        expect(v.aEcrire[0].value).toBe('Poulet,gros');
    });

    test('la branche tableau deduplique comme la branche chaine', () => {
        const v = reglages.valider({ famillePoulet: ['Poulet en détail', 'POULET EN DETAIL'] });
        expect(v.aEcrire[0].value).toBe('Poulet en détail');
    });

    test('un nom demesure est refuse', () => {
        const v = reglages.valider({ famillePoulet: ['P'.repeat(121)] });
        expect(v.ok).toBe(false);
        expect(v.erreurs.join(' ')).toMatch(/120 caractères/);
    });
});

describe('famille poulet : un element non textuel est refuse, pas converti', () => {
    const reglages2 = require('../lib/simulation-v2/reglages');

    test('un objet dans le tableau fait echouer la validation', () => {
        // String({nom:'Poulet'}) rendait '[object Object]', qui passait la
        // validation et s'affichait comme un produit de la famille.
        const v = reglages2.valider({ famillePoulet: [{ nom: 'Poulet en gros' }] });
        expect(v.ok).toBe(false);
        expect(v.erreurs.join(' ')).toMatch(/liste de noms/);
    });

    test('un nombre est refuse lui aussi', () => {
        expect(reglages2.valider({ famillePoulet: ['Poulet en gros', 42] }).ok).toBe(false);
    });

    test('un tableau de chaines reste accepte', () => {
        const v = reglages2.valider({ famillePoulet: ['Poulet en gros', 'Poulet en détail'] });
        expect(v.ok).toBe(true);
        expect(v.aEcrire[0].value).toBe('Poulet en gros,Poulet en détail');
    });
});
