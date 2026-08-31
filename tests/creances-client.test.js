/**
 * @jest-environment node
 *
 * Le solde des creances clients: solde de depart + flux suivi depuis une
 * date d'ouverture, PAS une somme depuis toujours - cf lib/creances-client.js
 * pour le pourquoi (aucun historique de remboursement n'existe avant qu'on
 * commence a le tracer).
 */

const { construireCreancesClient } = require('../lib/creances-client');

const v = (date, montant) => ({ date, montant });

describe('construireCreancesClient', () => {
    test('sans aucun flux, le total est le solde d ouverture', () => {
        const r = construireCreancesClient({
            soldeOuverture: 500000,
            dateOuverture: '2026-08-01',
            ventesCreance: [],
            remboursements: []
        });
        expect(r.total).toBe(500000);
        expect(r.fiable).toBe(true);
    });

    test('les nouvelles ventes a credit augmentent le solde', () => {
        const r = construireCreancesClient({
            soldeOuverture: 100000,
            dateOuverture: '2026-08-01',
            ventesCreance: [v('2026-08-05', 20000), v('2026-08-10', 15000)],
            remboursements: []
        });
        expect(r.ventes_creance.montant).toBe(35000);
        expect(r.ventes_creance.nb).toBe(2);
        expect(r.total).toBe(135000);
    });

    test('les remboursements diminuent le solde', () => {
        const r = construireCreancesClient({
            soldeOuverture: 100000,
            dateOuverture: '2026-08-01',
            ventesCreance: [v('2026-08-05', 20000)],
            remboursements: [v('2026-08-06', 50000)]
        });
        expect(r.remboursements.montant).toBe(50000);
        expect(r.total).toBe(70000);
    });

    test('un solde peut redevenir negatif si les remboursements depassent le flux connu', () => {
        // Pas d'erreur ni de plancher a zero: un total negatif est le signal
        // que le solde d'ouverture etait sous-estime, pas une valeur a masquer.
        const r = construireCreancesClient({
            soldeOuverture: 10000,
            dateOuverture: '2026-08-01',
            ventesCreance: [],
            remboursements: [v('2026-08-06', 15000)]
        });
        expect(r.total).toBe(-5000);
    });

    test('sans date d ouverture, le resultat est marque non fiable', () => {
        const r = construireCreancesClient({
            soldeOuverture: 0,
            dateOuverture: null,
            ventesCreance: [v('2026-08-05', 20000)],
            remboursements: []
        });
        expect(r.fiable).toBe(false);
        // Le calcul continue de tourner (l'appelant decide quoi faire de
        // fiable=false), il ne s'arrete pas.
        expect(r.total).toBe(20000);
    });

    test('les montants sont arrondis a 2 decimales', () => {
        const r = construireCreancesClient({
            soldeOuverture: 100.006,
            dateOuverture: '2026-08-01',
            ventesCreance: [v('2026-08-05', 0.006)],
            remboursements: []
        });
        expect(r.solde_ouverture).toBe(100.01);
        expect(r.total).toBe(100.02);
    });
});
