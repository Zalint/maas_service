/**
 * @jest-environment jsdom
 *
 * Le cumul mensuel de reconciliation et les journees qu'on en ecarte.
 *
 * agregerReconciliationMois() est devenue la source UNIQUE des totaux et des
 * deux parages du mois: le chargement complet et le retour par le cache
 * passent tous deux par elle. Elle n'avait aucun test.
 *
 * Comme parage-mois.test.js, on charge la VRAIE fonction depuis script.js par
 * extraction plutot que d'en recopier la logique: une copie diverge.
 */
const { chargerDepuisScript } = require('./helpers/extraire-fonction');

const { agreger, cle } = chargerDepuisScript(
    [
        'function cleExclusion(dateStr, pointVente)',
        'function agregerReconciliationMois(lignes, exclusions)'
    ],
    '{ agreger: agregerReconciliationMois, cle: cleExclusion }'
);

/** Une journee mesurable: du theorique, du vendu, et un ratio non nul. */
const jour = (date, pv, opts = {}) => ({
    date, pointVente: pv,
    ventes: opts.ventes || 0,
    ventesSaisies: opts.saisies || 0,
    creances: opts.creances || 0,
    cashPayment: opts.cash || 0,
    parageBovinDetail: opts.bovin === null ? null : Object.assign(
        { ratio: 0.95, theorique: 100, vendu: 95, parProduit: { 'Boeuf': { theorique: 100, vendu: 95 } } },
        opts.bovin || {}
    ),
    parageOvinDetail: opts.ovin === undefined ? null : opts.ovin
});

describe('totaux du mois', () => {
    test('somme les quatre colonnes des lignes retenues', () => {
        const r = agreger([
            jour('01/08/2026', 'Mbao', { ventes: 100, saisies: 90, creances: 5, cash: 85 }),
            jour('02/08/2026', 'Mbao', { ventes: 200, saisies: 210, creances: 0, cash: 210 })
        ], new Set());
        expect(r.totaux).toEqual({
            ventesTheoriques: 300, ventesSaisies: 300, creances: 5, versements: 295
        });
        expect(r.retenues).toBe(2);
        expect(r.exclues).toBe(0);
    });

    test('une ligne exclue sort de TOUTES les metriques', () => {
        const lignes = [
            jour('01/08/2026', 'Mbao', { ventes: 100, saisies: 90 }),
            jour('02/08/2026', 'Mbao', { ventes: 200, saisies: 210 })
        ];
        const r = agreger(lignes, new Set([cle('02/08/2026', 'Mbao')]));
        expect(r.totaux.ventesTheoriques).toBe(100);
        expect(r.totaux.ventesSaisies).toBe(90);
        expect(r.parage.bovin.theorique).toBe(100); // une seule journee comptee
        expect(r.exclues).toBe(1);
    });

    test('la cle porte la LIGNE, pas la journee: un seul point de vente sort', () => {
        const lignes = [
            jour('01/08/2026', 'Mbao', { ventes: 100 }),
            jour('01/08/2026', 'O.Foire', { ventes: 300 })
        ];
        const r = agreger(lignes, new Set([cle('01/08/2026', 'Mbao')]));
        expect(r.totaux.ventesTheoriques).toBe(300);
        expect(r.retenues).toBe(1);
    });

    test('aucune ligne: des zeros, pas un plantage', () => {
        for (const vide of [[], null, undefined]) {
            const r = agreger(vide, new Set());
            expect(r.totaux.ventesTheoriques).toBe(0);
            expect(r.exclues).toBe(0);
        }
    });
});

describe('parage cumule', () => {
    test('somme les KILOS, jamais la moyenne des taux journaliers', () => {
        // Une journee de 2 kg ne doit pas peser autant qu'une de 200 kg.
        const r = agreger([
            jour('01/08/2026', 'Mbao', { bovin: { ratio: 0.5, theorique: 2, vendu: 1, parProduit: {} } }),
            jour('02/08/2026', 'Mbao', { bovin: { ratio: 1, theorique: 200, vendu: 200, parProduit: {} } })
        ], new Set());
        // 201 / 202, et non la moyenne de 50 % et 100 %.
        expect(r.parage.bovin.vendu).toBe(201);
        expect(r.parage.bovin.theorique).toBe(202);
    });

    test('une journee sans matiere (ratio null) n entre nulle part', () => {
        const r = agreger([
            jour('01/08/2026', 'Mbao', { bovin: { ratio: null, theorique: 999, vendu: 999, parProduit: {} } }),
            jour('02/08/2026', 'Mbao', { bovin: { ratio: 1, theorique: 10, vendu: 10, parProduit: {} } })
        ], new Set());
        // Le theorique de la journee sans ratio n'est PAS entre au denominateur.
        expect(r.parage.bovin.theorique).toBe(10);
        expect(r.parage.bovin.vendu).toBe(10);
    });

    test('le bilan dechet suit les memes journees que le taux', () => {
        const avecDechet = (d) => ({
            ratio: 1, theorique: 10, vendu: 10, parProduit: {},
            dechet: { matin: 1, transferts: 2, soir: 3, vendu: 4, jete: 5, produit: 6 }
        });
        const r = agreger([
            jour('01/08/2026', 'Mbao', { bovin: avecDechet() }),
            jour('02/08/2026', 'Mbao', { bovin: avecDechet() })
        ], new Set());
        expect(r.parage.bovin.dechet).toEqual({
            matin: 2, transferts: 4, soir: 6, vendu: 8, jete: 10, produit: 12
        });
    });
});

describe('composition par produit', () => {
    test('cumule chaque produit sur les journees retenues', () => {
        const l = (theo, vendu) => ({
            ratio: 1, theorique: theo, vendu,
            parProduit: { 'Boeuf': { theorique: theo, vendu }, 'Foie': { theorique: 2, vendu: 1 } }
        });
        const r = agreger([
            jour('01/08/2026', 'Mbao', { bovin: l(100, 90) }),
            jour('02/08/2026', 'Mbao', { bovin: l(50, 45) })
        ], new Set());
        expect(r.parage.bovin.parProduit).toEqual({
            'Boeuf': { theorique: 150, vendu: 135 },
            'Foie': { theorique: 4, vendu: 2 }
        });
    });

    test('la composition d une journee exclue disparait aussi', () => {
        const l = { ratio: 1, theorique: 48, vendu: 0, parProduit: { 'Laxass': { theorique: 48, vendu: 0 } } };
        const lignes = [jour('13/08/2026', 'Mbao', { bovin: l })];
        expect(agreger(lignes, new Set()).parage.bovin.parProduit.Laxass).toBeDefined();
        const apres = agreger(lignes, new Set([cle('13/08/2026', 'Mbao')]));
        expect(apres.parage.bovin.parProduit).toEqual({});
    });

    test('une journee sans parProduit ne casse pas le cumul', () => {
        const r = agreger([
            jour('01/08/2026', 'Mbao', {
                bovin: { ratio: 1, theorique: 10, vendu: 10, parProduit: undefined }
            })
        ], new Set());
        expect(r.parage.bovin.parProduit).toEqual({});
        expect(r.parage.bovin.theorique).toBe(10);
    });
});

describe('robustesse des entrees', () => {
    test('des montants en TEXTE sont additionnes comme des nombres', () => {
        // Les lignes reviennent du cache via JSON: rien ne garantit le type.
        const r = agreger([
            { date: '01/08/2026', pointVente: 'Mbao', ventes: '100.5', ventesSaisies: '90', creances: null, cashPayment: undefined }
        ], new Set());
        expect(r.totaux.ventesTheoriques).toBe(100.5);
        expect(r.totaux.ventesSaisies).toBe(90);
        expect(r.totaux.creances).toBe(0);
        expect(r.totaux.versements).toBe(0);
    });

    test('sans ensemble d exclusions, tout est retenu', () => {
        const r = agreger([jour('01/08/2026', 'Mbao', { ventes: 7 })], null);
        expect(r.totaux.ventesTheoriques).toBe(7);
        expect(r.retenues).toBe(1);
    });
});
