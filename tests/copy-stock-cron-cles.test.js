/**
 * Le cron de copie soir -> matin ecrit-il des cles LISIBLES par l'ecran ?
 *
 * Son repli base construisait « Mbao-Boeuf-stock-soir-4 », espaces remplaces
 * par des underscores, alors que la saisie et le repli base du serveur ecrivent
 * « Mbao-Boeuf ». L'ecran de stock cherchait la cle a l'exact: le 15/08/2026 le
 * stock matin recopie du 14 au soir arrivait au navigateur et n'etait affiche
 * nulle part.
 *
 * Ce chemin n'avait AUCUN test - c'est ce qui a permis a un format divergent
 * d'y vivre. On verrouille donc le contrat des deux cotes: ce que le cron
 * ecrit, et le fait que lib/stock-index.js sache le relire.
 *
 * @jest-environment node
 */

const { StockTransformer } = require('../scripts/copy-stock-cron');
const idx = require('../lib/stock-index');

describe('le transformer soir -> matin', () => {
    // Le format que le repli base produit DESORMAIS: « <PV>-<Produit> ».
    const SOIR = {
        'Mbao-Boeuf': {
            date: '14/08/2026', 'Point de Vente': 'Mbao', Produit: 'Boeuf',
            Nombre: 108.3, PU: 5400, Montant: 584820, Commentaire: ''
        },
        'Mbao-Cuisse de poulet': {
            date: '14/08/2026', 'Point de Vente': 'Mbao', Produit: 'Cuisse de poulet',
            Nombre: 2.4, PU: 2500, Montant: 6000, Commentaire: ''
        }
    };

    test('les cles sont CONSERVEES telles quelles', () => {
        // Le transformer reecrivait « stock-soir » en « stock-matin » DANS la
        // cle. Sur le format commun il n'y a plus rien a reecrire, et c'est
        // voulu: la cle designe un couple, pas un type de stock - lequel vit
        // dans le champ typeStock.
        const r = StockTransformer.transformSoirToMatin(SOIR, new Date('2026-08-15T00:00:00Z'));
        expect(Object.keys(r).sort()).toEqual(['Mbao-Boeuf', 'Mbao-Cuisse de poulet']);
    });

    test('la date et le type sont ceux de la CIBLE, les quantites celles de la source', () => {
        const r = StockTransformer.transformSoirToMatin(SOIR, new Date('2026-08-15T00:00:00Z'));
        const b = r['Mbao-Boeuf'];
        expect(b.typeStock).toBe('matin');
        expect(b.Nombre).toBe(108.3);
        expect(b.PU).toBe(5400);
        // Le commentaire dit d'ou vient la ligne: sans lui, un stock matin
        // recopie ne se distingue pas d'une saisie.
        expect(b.Commentaire).toMatch(/Copié automatiquement du stock soir du 14\/08\/2026/);
    });

    test('ce que le cron ecrit, l ecran sait le relire', () => {
        // Le contrat qui manquait. Les deux modules sont testes separement;
        // c'est leur RENCONTRE qui avait echoue en production.
        const r = StockTransformer.transformSoirToMatin(SOIR, new Date('2026-08-15T00:00:00Z'));
        const index = idx.construire(r);
        expect(idx.trouver(r, index, 'Mbao', 'Boeuf').Nombre).toBe(108.3);
        expect(idx.trouver(r, index, 'Mbao', 'Cuisse de poulet').Nombre).toBe(2.4);
    });

    test('l ANCIEN format reste lisible, pour les fichiers deja ecrits', () => {
        // Les JSON produits avant ce correctif portent encore le suffixe et les
        // underscores. On ne les reecrit pas: le lecteur les rattrape.
        const ancien = {
            'Mbao-Boeuf-stock-soir-4': {
                date: '14/08/2026', 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 108.3, PU: 5400
            },
            'Mbao-Cuisse_de_poulet-stock-soir-16': {
                date: '14/08/2026', 'Point de Vente': 'Mbao', Produit: 'Cuisse de poulet', Nombre: 2.4, PU: 2500
            }
        };
        const r = StockTransformer.transformSoirToMatin(ancien, new Date('2026-08-15T00:00:00Z'));
        // La cle garde sa forme heritee - « stock-soir » devient « stock-matin »
        expect(Object.keys(r)).toContain('Mbao-Boeuf-stock-matin-4');
        // ... et l'ecran la retrouve quand meme, par le contenu.
        const index = idx.construire(r);
        expect(idx.trouver(r, index, 'Mbao', 'Boeuf').Nombre).toBe(108.3);
        expect(idx.trouver(r, index, 'Mbao', 'Cuisse de poulet').Nombre).toBe(2.4);
    });

    test('une entree vide ou nulle ne fait pas tomber la copie', () => {
        expect(StockTransformer.transformSoirToMatin(null, new Date())).toEqual({});
        expect(StockTransformer.transformSoirToMatin('x', new Date())).toEqual({});
        expect(StockTransformer.transformSoirToMatin({}, new Date())).toEqual({});
    });
});
