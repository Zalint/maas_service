/**
 * Regression: double compte potentiel entre les DEPENSES ponctuelles et les
 * CHARGES FIXES proratisees, toutes deux soustraites du PL.
 *
 * Le PL ne retire pas ces depenses (une depense 'electricite' peut etre un
 * surcout ponctuel qui s'ajoute legitimement a l'abonnement mensuel), il les
 * SIGNALE. Ces tests verrouillent la detection.
 */

const { detecterDoubleCompte } = require('../lib/depenses-recurrentes');

// Charges fixes reelles d'un tenant: les cles ne correspondent pas aux
// categories de depenses ('elec' vs 'electricite', 'masse_salariale' vs
// 'salaire'), d'ou le rapprochement par mots-cles normalises.
const CHARGES = [
    { nom: 'masse_salariale', libelle: 'Masse salariale' },
    { nom: 'loyer', libelle: 'Loyer' },
    { nom: 'elec', libelle: 'Électricité' },
    { nom: 'internet', libelle: 'Internet' }
];

describe('Detection du double compte depenses / charges fixes', () => {

    test('depense dans les DEUX buckets: le loyer du mois saisi en depense est signale', () => {
        const depenses = [{ categorie: 'loyer', montant: '125000' }];
        const r = detecterDoubleCompte(depenses, CHARGES);
        expect(r.montant).toBe(125000);
        expect(r.categories).toEqual(['loyer']);
    });

    test('cle de charge differente de la categorie: "elec" <-> "electricite"', () => {
        const r = detecterDoubleCompte([{ categorie: 'electricite', montant: '2500' }], CHARGES);
        expect(r.montant).toBe(2500);
        expect(r.categories).toEqual(['electricite']);
    });

    test('accents et underscores: "salaire" <-> "Masse salariale"', () => {
        const r = detecterDoubleCompte([{ categorie: 'salaire', montant: '50000' }], CHARGES);
        expect(r.montant).toBe(50000);
        expect(r.categories).toEqual(['salaire']);
    });

    test('depense ponctuelle hors charges fixes: aucune alerte', () => {
        const depenses = [
            { categorie: 'autre', montant: '15000' },
            { categorie: 'transport', montant: '3000' },
            { categorie: 'entretien', montant: '7000' }
        ];
        expect(detecterDoubleCompte(depenses, CHARGES)).toEqual({ montant: 0, categories: [] });
    });

    test('categorie sans charge fixe correspondante: "eau" non signalee si absente des charges', () => {
        const r = detecterDoubleCompte([{ categorie: 'eau', montant: '4000' }], CHARGES);
        expect(r.montant).toBe(0);
        expect(r.categories).toEqual([]);
    });

    test('melange: seules les categories recouvrantes sont sommees', () => {
        const depenses = [
            { categorie: 'loyer', montant: '125000' },      // recouvre
            { categorie: 'electricite', montant: '2500' },  // recouvre
            { categorie: 'autre', montant: '15000' },       // non
            { categorie: 'transport', montant: '3000' }     // non
        ];
        const r = detecterDoubleCompte(depenses, CHARGES);
        expect(r.montant).toBe(127500);
        expect(r.categories).toEqual(['electricite', 'loyer']);
    });

    test('robuste aux entrees vides / nulles', () => {
        expect(detecterDoubleCompte([], CHARGES)).toEqual({ montant: 0, categories: [] });
        expect(detecterDoubleCompte(null, null)).toEqual({ montant: 0, categories: [] });
        expect(detecterDoubleCompte([{ categorie: null, montant: '10' }], CHARGES).montant).toBe(0);
    });

    test('aucune charge fixe configuree: rien ne peut etre en double', () => {
        const r = detecterDoubleCompte([{ categorie: 'loyer', montant: '125000' }], []);
        expect(r).toEqual({ montant: 0, categories: [] });
    });
});
