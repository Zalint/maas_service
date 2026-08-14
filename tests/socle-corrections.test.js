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
        // Le demontage de fs vit ici plutot qu'en fin de test: un test qui
        // echoue avant sa derniere ligne laissait sinon le mock en place pour
        // toute la suite.
        jest.unmock('fs');
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
        const { estConfigure, aDesIdentifiants } = require('../lib/depenses-creance-client');
        // Les identifiants SONT la: c'est le libelle qui manque. La
        // distinction decide si le PL peut etre fige.
        expect(aDesIdentifiants()).toBe(true);
        expect(estConfigure()).toBe(false);
    });
});

describe('liste de noms : bornes et contournements', () => {
    const reglages = require('../lib/simulation-v2/reglages');

    test('un nom contenant une virgule est REFUSE, jamais scinde', () => {
        // La virgule est le separateur du stockage: un nom qui en porte une
        // n'est pas representable. Joindre puis redecouper transformait
        // 'Poulet, gros' en DEUX produits sans qu'aucune erreur ne le dise -
        // le defaut meme que cette branche pretendait corriger.
        const v = reglages.valider({ produitsSuivis: ['Poulet, gros'] });
        expect(v.ok).toBe(false);
        expect(v.erreurs.join(' ')).toMatch(/sans virgule/);
    });

    test('la branche tableau deduplique comme la branche chaine', () => {
        const v = reglages.valider({ produitsSuivis: ['Poulet en détail', 'POULET EN DETAIL'] });
        expect(v.aEcrire[0].value).toBe('Poulet en détail');
    });

    test('un nom demesure est refuse', () => {
        const v = reglages.valider({ produitsSuivis: ['P'.repeat(121)] });
        expect(v.ok).toBe(false);
        expect(v.erreurs.join(' ')).toMatch(/120 caractères/);
    });
});

describe('liste de noms : un element non textuel est refuse, pas converti', () => {
    const reglages2 = require('../lib/simulation-v2/reglages');

    test('un objet dans le tableau fait echouer la validation', () => {
        // String({nom:'Poulet'}) rendait '[object Object]', qui passait la
        // validation et s'affichait comme un produit de la famille.
        const v = reglages2.valider({ produitsSuivis: [{ nom: 'Poulet en gros' }] });
        expect(v.ok).toBe(false);
        expect(v.erreurs.join(' ')).toMatch(/liste de noms/);
    });

    test('un nombre est refuse lui aussi', () => {
        expect(reglages2.valider({ produitsSuivis: ['Poulet en gros', 42] }).ok).toBe(false);
    });

    test('un tableau de chaines reste accepte', () => {
        const v = reglages2.valider({ produitsSuivis: ['Poulet en gros', 'Poulet en détail'] });
        expect(v.ok).toBe(true);
        expect(v.aEcrire[0].value).toBe('Poulet en gros,Poulet en détail');
    });
});
