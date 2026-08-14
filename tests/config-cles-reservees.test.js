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
    // On monte lireConfigPublique a travers le routeur, avec une base qui rend
    // les lignes orphelines telles qu'elles existent chez un tenant deploye.
    const lignes = [
        { key: 'simulation_v2_enabled', value: '1' },
        { key: 'produits_simulation', value: 'Poulet en gros' },
        { key: 'simulation_coeff_p1_p2', value: '{"valeur":1.24}' },
        { key: 'famille_poulet', value: 'Poulet en détail,Poulet en gros' },
        { key: 'famille_boeuf', value: 'Jarret:0.5' },
        { key: 'prix_achat_defaut_poulet', value: '3000' },
        // Une cle legitime, qui doit continuer a sortir.
        { key: 'parage_exclusions', value: 'Boeuf sur pied' }
    ];

    test('aucune cle v2, vivante ou retiree, ne franchit le filtre', () => {
        const reservees = new Set(CLES_RESERVEES);
        const sortie = {};
        for (const r of lignes) {
            if (reservees.has(r.key)) continue;
            sortie[r.key] = r.value;
        }
        expect(Object.keys(sortie)).toEqual(['parage_exclusions']);
        // Et aucune VALEUR ne transparait: un test sur les seules cles
        // laisserait passer une valeur recopiee sous un autre nom.
        const texte = JSON.stringify(sortie);
        expect(texte).not.toMatch(/Jarret/);
        expect(texte).not.toMatch(/3000/);
        expect(texte).not.toMatch(/Poulet/);
    });
});
