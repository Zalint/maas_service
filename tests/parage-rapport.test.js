/**
 * @jest-environment node
 *
 * Le rapport de parage d'un mois (lib/parage-rapport.js): meme discipline que
 * lib/parage-periode.js - un taux de GROUPE est pondere au kilo, jamais une
 * moyenne de pourcentages journaliers, et une journee non mesurable (rien a
 * peser) n'entre dans aucun cumul.
 */

const { construireRapportParage, correlationPearson, semaineIso } = require('../lib/parage-rapport');

const j = (date, theorique, vendu, aLivraison) => ({
    date, theorique, vendu, a_livraison: !!aLivraison
});

describe('construireRapportParage', () => {
    test('sans aucun jour mesurable, rend null (categorie sans volume)', () => {
        expect(construireRapportParage({ jours: [] })).toBeNull();
        expect(construireRapportParage({ jours: [j('2026-08-01', 0, 0, true)] })).toBeNull();
    });

    test('avec/sans livraison: taux PONDERE au kilo, pas une moyenne de %', () => {
        // Jour 1 (livraison): 100 kg theorique, 90 vendu -> 10% de perte.
        // Jour 2 (livraison): 10 kg theorique, 5 vendu -> 50% de perte.
        // Une moyenne de % donnerait 30%; pondere au kilo: perte totale 15 kg
        // sur 110 kg theorique = 13,6%.
        const r = construireRapportParage({
            jours: [
                j('2026-08-01', 100, 90, true),
                j('2026-08-02', 10, 5, true),
                j('2026-08-03', 50, 49, false)
            ]
        });
        expect(r.avec_livraison.n_jours).toBe(2);
        expect(r.avec_livraison.kg_theorique).toBe(110);
        expect(r.avec_livraison.taux_pondere_pct).toBeCloseTo(13.6, 1);
        expect(r.sans_livraison.n_jours).toBe(1);
        expect(r.sans_livraison.taux_pondere_pct).toBeCloseTo(2, 1);
    });

    test('les jours non mesurables sont exclus avant tout calcul', () => {
        const r = construireRapportParage({
            jours: [
                j('2026-08-01', 100, 90, true),
                j('2026-08-02', 0, 0, true) // rien a peser ce jour-la
            ]
        });
        expect(r.ensemble.n_jours).toBe(1);
    });

    test('jours_notables: tries par kg PERDU decroissant, pas par taux %', () => {
        // Jour A: 20% de perte mais sur un tout petit volume (2 kg perdus).
        // Jour B: 10% de perte mais sur un gros volume (10 kg perdus) -
        // le plus gros perdant en kilos doit sortir en tete, pas le plus fort %.
        const r = construireRapportParage({
            jours: [
                j('2026-08-01', 10, 8, true),   // 20%, 2 kg perdus
                j('2026-08-02', 100, 90, true)  // 10%, 10 kg perdus
            ]
        });
        expect(r.jours_notables[0].date).toBe('2026-08-02');
        expect(r.jours_notables[0].kg_perte).toBe(10);
        expect(r.jours_notables[1].kg_perte).toBe(2);
    });

    test('jours_notables se limite a 5 lignes', () => {
        const jours = [];
        for (let i = 1; i <= 8; i++) {
            jours.push(j(`2026-08-0${i}`, 100, 100 - i, true));
        }
        const r = construireRapportParage({ jours });
        expect(r.jours_notables.length).toBe(5);
    });

    test('enjeu: kg gagnables x prix = FCFA/mois, x12 = FCFA/an', () => {
        // Taux d'ensemble a 20% (perte de 20 kg sur 100), cible 5%: l'ecart
        // de 15 points vaut 15% de 100 kg = 15 kg gagnables.
        const r = construireRapportParage({
            jours: [j('2026-08-01', 100, 80, true)],
            cible: 5,
            prixParKg: 3000
        });
        expect(r.enjeu.ecart_pct).toBeCloseTo(15, 1);
        expect(r.enjeu.kg_gagnables_mois).toBeCloseTo(15, 1);
        expect(r.enjeu.fcfa_mois).toBe(45000);
        expect(r.enjeu.fcfa_an).toBe(540000);
    });

    test('enjeu sans prix connu: FCFA a null, jamais un chiffre invente', () => {
        const r = construireRapportParage({ jours: [j('2026-08-01', 100, 80, true)] });
        expect(r.enjeu.fcfa_mois).toBeNull();
        expect(r.enjeu.fcfa_an).toBeNull();
    });

    test('deja au taux cible ou meilleur: aucun kg gagnable, jamais negatif', () => {
        const r = construireRapportParage({
            jours: [j('2026-08-01', 100, 97, true)], // 3% de perte, sous la cible 5%
            cible: 5,
            prixParKg: 3000
        });
        expect(r.enjeu.ecart_pct).toBe(0);
        expect(r.enjeu.kg_gagnables_mois).toBe(0);
        expect(r.enjeu.fcfa_mois).toBe(0);
    });
});

describe('semaineIso', () => {
    test('deux dates du meme lundi-dimanche partagent le meme numero', () => {
        const lundi = semaineIso('2026-08-03'); // un lundi
        const dimanche = semaineIso('2026-08-09'); // le dimanche suivant
        expect(lundi.numero).toBe(dimanche.numero);
        expect(lundi.debut).toBe('2026-08-03');
        expect(dimanche.fin).toBe('2026-08-09');
    });

    test('le lundi suivant change de semaine', () => {
        const s1 = semaineIso('2026-08-09');
        const s2 = semaineIso('2026-08-10');
        expect(s2.numero).toBe(s1.numero + 1);
    });
});

describe('correlationPearson', () => {
    test('correlation parfaite positive vaut 1', () => {
        expect(correlationPearson([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    });

    test('correlation parfaite negative vaut -1', () => {
        expect(correlationPearson([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    });

    test('une relation symetrique (parabole) a une correlation LINEAIRE nulle', () => {
        // y = x^2: parfaitement determine par x, mais sans direction lineaire -
        // exactement le cas ou "correlation nulle" ne veut pas dire "independant".
        expect(correlationPearson([-2, -1, 0, 1, 2], [4, 1, 0, 1, 4])).toBe(0);
    });

    test('moins de 2 points ou variance nulle: null, pas une division par zero', () => {
        expect(correlationPearson([5], [10])).toBeNull();
        expect(correlationPearson([5, 5, 5], [1, 2, 3])).toBeNull();
    });
});
