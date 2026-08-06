/**
 * Agregation du parage et de la marge sur une periode.
 *
 * Deux pieges du projet se jouent ici: les quatre formats de date qui
 * cohabitent en base, et la regle de cumul qui doit rester identique a celle
 * de l'ecran - sinon l'API et le tableau donnent deux chiffres pour la meme
 * grandeur, et plus personne ne sait lequel croire.
 */
const {
    parseDateIso, datesJusquA, formesDeDate, isoDepuisForme,
    grouperParDate, cumulerMois, cumulerMarge, agregerPointsDeVente
} = require('../lib/parage-periode');

describe('lecture de la date', () => {
    test('YYYYMMDD et YYYY-MM-DD sont acceptes', () => {
        expect(parseDateIso('20260731')).toBe('2026-07-31');
        expect(parseDateIso('2026-07-31')).toBe('2026-07-31');
        expect(parseDateIso('  20260731 ')).toBe('2026-07-31');
    });

    // '28072026' satisfait la regex et deviendrait '2807-20-26'. Sans controle
    // d'existence, l'appelant recevrait un resultat VIDE au lieu d'une erreur -
    // et conclurait qu'il n'y a pas eu de vente ce jour-la.
    test('une date JJMMAAAA saisie par erreur est refusee', () => {
        expect(parseDateIso('28072026')).toBeNull();
    });

    test('une date qui n existe pas est refusee', () => {
        expect(parseDateIso('20260231')).toBeNull();   // 31 fevrier
        expect(parseDateIso('20261345')).toBeNull();   // mois 13
        expect(parseDateIso('20260230')).toBeNull();   // 30 fevrier
    });

    test('le 29 fevrier est accepte une annee bissextile, refuse sinon', () => {
        expect(parseDateIso('20240229')).toBe('2024-02-29');
        expect(parseDateIso('20260229')).toBeNull();
    });

    test('entrees absurdes', () => {
        for (const v of ['', null, undefined, 'hier', '2026-7-3', 42]) {
            expect(parseDateIso(v)).toBeNull();
        }
    });
});

describe('perimetre du mois', () => {
    // Cumul A DATE et non mois calendaire: appelee le 12, l'API decrit le mois
    // tel qu'il est, pas un mois dont les deux tiers n'existent pas encore.
    test('du 1er a la date fournie, incluse', () => {
        expect(datesJusquA('2026-07-05')).toEqual([
            '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'
        ]);
    });

    test('le 1er du mois ne donne qu une journee', () => {
        expect(datesJusquA('2026-07-01')).toEqual(['2026-07-01']);
    });

    test('le dernier jour donne le mois entier', () => {
        expect(datesJusquA('2026-07-31')).toHaveLength(31);
        expect(datesJusquA('2026-02-28')).toHaveLength(28);
    });
});

describe('formats de date en base', () => {
    // ventes = YYYY-MM-DD, stocks et transferts = DD-MM-YYYY, et des DD/MM/YYYY
    // trainent. Interroger une seule forme ferait tomber le numerateur a zero
    // en gardant le denominateur, soit 100% de parage affiche.
    test('les trois formes sont produites', () => {
        expect(formesDeDate('2026-07-31')).toEqual(['2026-07-31', '31-07-2026', '31/07/2026']);
    });

    test('toutes se ramenent a l ISO', () => {
        for (const v of ['2026-07-31', '31-07-2026', '31/07/2026', '2026-07-31T10:00:00Z']) {
            expect(isoDepuisForme(v)).toBe('2026-07-31');
        }
    });

    test('une valeur illisible ne casse pas le regroupement', () => {
        expect(isoDepuisForme('n importe quoi')).toBeNull();
        const par = grouperParDate([
            { date: '31-07-2026', x: 1 }, { date: 'bidon', x: 2 }, { date: '2026-07-31', x: 3 }
        ]);
        expect(par['2026-07-31']).toHaveLength(2);
        expect(Object.keys(par)).toEqual(['2026-07-31']);
    });
});

const jour = (bovin) => ({
    bovin: Object.assign({ matin: 0, transferts: 0, soir: 0, theorique: 0, vendu: 0, ratio: null, parProduit: {} }, bovin),
    ovin: { matin: 0, transferts: 0, soir: 0, theorique: 0, vendu: 0, ratio: null, parProduit: {} }
});

describe('cumul du mois', () => {
    test('somme des kilos, pas moyenne des taux journaliers', () => {
        // 2 kg vendus sur 4 (50%) et 200 sur 200 (0%). La moyenne des taux
        // donnerait 25%; le cumul donne 1 - 202/204 = 0,98%.
        const t = cumulerMois([
            jour({ theorique: 4, vendu: 2, ratio: 0.5 }),
            jour({ theorique: 200, vendu: 200, ratio: 1 })
        ]);
        expect(t.bovin.theorique).toBe(204);
        expect(t.bovin.vendu).toBe(202);
        expect(t.bovin.perte).toBeCloseTo(1 - 202 / 204, 10);
        expect(t.bovin.joursMesures).toBe(2);
    });

    // Une journee a theorique nul apporterait des kilos vendus sans
    // denominateur: le taux du mois deriverait, jusqu'au negatif.
    test('une journee non mesurable n entre ni au numerateur ni au denominateur', () => {
        const t = cumulerMois([
            jour({ theorique: 100, vendu: 95, ratio: 0.95 }),
            jour({ theorique: 0, vendu: 10, ratio: null })
        ]);
        expect(t.bovin.theorique).toBe(100);
        expect(t.bovin.vendu).toBe(95);
        expect(t.bovin.joursMesures).toBe(1);
    });

    test('aucune journee mesurable: pas de taux, jamais zero', () => {
        const t = cumulerMois([jour({ theorique: 0, vendu: 0, ratio: null })]);
        expect(t.bovin.perte).toBeNull();
        expect(t.bovin.joursMesures).toBe(0);
    });

    test('le detail par produit est cumule lui aussi', () => {
        const t = cumulerMois([
            jour({ theorique: 10, vendu: 9, ratio: 0.9, parProduit: { Boeuf: { theorique: 10, vendu: 9, venduDirect: 9, venduPack: 0, matin: 10, transferts: 0, soir: 0 } } }),
            jour({ theorique: 20, vendu: 18, ratio: 0.9, parProduit: { Boeuf: { theorique: 20, vendu: 18, venduDirect: 15, venduPack: 3, matin: 20, transferts: 0, soir: 0 } } })
        ]);
        expect(t.bovin.parProduit.Boeuf.theorique).toBe(30);
        expect(t.bovin.parProduit.Boeuf.venduPack).toBe(3);
    });
});

describe('cumul de la marge', () => {
    // Aucun cas de ce bloc n'a de produit sans prix ni de theorique negatif:
    // tous les kilos theoriques sont donc coutes. kg_coutes est derive plutot
    // que recopie a chaque appel, pour que cette invariante reste vraie meme
    // quand un cas de test change de chiffres.
    const base = (v) => Object.assign(
        { vendu_kg: 0, ca_vendu: 0, cout_theorique: 0, theorique_kg: 0, kg_sans_prix_achat: 0,
            details: { hors_pack: { vendu_kg: 0, ca_vendu: 0 }, pack: { vendu_kg: 0, ca_vendu: 0 } },
            hypotheses: [], produits_sans_prix_achat: [] },
        v,
        { kg_coutes: (v && v.kg_coutes !== undefined) ? v.kg_coutes : ((v && v.theorique_kg) || 0) }
    );
    const m = (v) => ({ bovin: base(v), ovin: base() });

    // Le defaut trouve en appelant l'API: le parage ecartait une journee que
    // la marge comptait, et vendu_kg differait de 10 kg entre deux champs de
    // la MEME reponse.
    test('la marge ignore exactement les memes journees que le parage', () => {
        const parages = [
            jour({ theorique: 100, vendu: 95, ratio: 0.95 }),
            jour({ theorique: 0, vendu: 10, ratio: null })
        ];
        const marges = [
            m({ vendu_kg: 95, ca_vendu: 475000, cout_theorique: 383500, theorique_kg: 100,
                details: { hors_pack: { vendu_kg: 95, ca_vendu: 475000 }, pack: { vendu_kg: 0, ca_vendu: 0 } } }),
            m({ vendu_kg: 10, ca_vendu: 50000, cout_theorique: 0, theorique_kg: 0,
                details: { hors_pack: { vendu_kg: 10, ca_vendu: 50000 }, pack: { vendu_kg: 0, ca_vendu: 0 } } })
        ];
        const t = cumulerMarge(marges, parages);
        expect(t.bovin.vendu_kg).toBe(95);
        expect(t.bovin.ca_vendu).toBe(475000);
        // Les kilos de la marge doivent egaler ceux du parage.
        expect(t.bovin.vendu_kg).toBe(cumulerMois(parages).bovin.vendu);
    });

    test('les prix moyens sont recalcules sur les cumuls', () => {
        const parages = [jour({ theorique: 10, vendu: 10, ratio: 1 }), jour({ theorique: 100, vendu: 100, ratio: 1 })];
        const marges = [
            m({ vendu_kg: 10, ca_vendu: 100000, cout_theorique: 40000, theorique_kg: 10,
                details: { hors_pack: { vendu_kg: 10, ca_vendu: 100000 }, pack: { vendu_kg: 0, ca_vendu: 0 } } }),
            m({ vendu_kg: 100, ca_vendu: 400000, cout_theorique: 350000, theorique_kg: 100,
                details: { hors_pack: { vendu_kg: 100, ca_vendu: 400000 }, pack: { vendu_kg: 0, ca_vendu: 0 } } })
        ];
        const t = cumulerMarge(marges, parages);
        // 500000 / 110, et surtout PAS (10000 + 4000) / 2.
        expect(t.bovin.prix_vente_moyen).toBeCloseTo(500000 / 110, 6);
        expect(t.bovin.prix_achat_moyen).toBeCloseTo(390000 / 110, 6);
        expect(t.bovin.marge).toBe(500000 - 390000);
    });

    // Defaut trouve en revue: le mois rendait marge:0 sur des ventes reelles.
    // En aout, aucun stock du matin n'ayant ete saisi, le parage n'etait
    // mesurable AUCUN jour - et la marge ecartait les journees entieres, leur
    // chiffre d'affaires compris. Le gerant lisait "marge du mois : 0 F" sur
    // 258 693 F encaisses.
    test('une journee ecartee garde son chiffre d affaires visible', () => {
        const parages = [
            jour({ theorique: 0, vendu: 34.75, ratio: null }),
            jour({ theorique: 0, vendu: 18.25, ratio: null })
        ];
        const marges = [
            m({ vendu_kg: 34.75, ca_vendu: 169958.96, theorique_kg: 0 }),
            m({ vendu_kg: 18.25, ca_vendu: 88734.38, theorique_kg: 0 })
        ];
        const t = cumulerMarge(marges, parages).bovin;
        expect(t.jours_ignores).toBe(2);
        expect(t.ca_ignore).toBeCloseTo(169958.96 + 88734.38, 2);
        expect(t.vendu_kg_ignore).toBeCloseTo(53, 6);
        // La marge est INCONNUE, pas nulle: le cout n'a pas pu etre calcule.
        expect(t.marge).toBeNull();
        expect(t.marge).not.toBe(0);
        // Et rien n'a fui dans les totaux mesures.
        expect(t.vendu_kg).toBe(0);
        expect(t.ca_vendu).toBe(0);
    });

    test('des journees mesurables ET ecartees: les deux sont rendues', () => {
        const parages = [
            jour({ theorique: 100, vendu: 95, ratio: 0.95 }),
            jour({ theorique: 0, vendu: 10, ratio: null })
        ];
        const marges = [
            m({ vendu_kg: 95, ca_vendu: 475000, cout_theorique: 383500, theorique_kg: 100,
                details: { hors_pack: { vendu_kg: 95, ca_vendu: 475000 }, pack: { vendu_kg: 0, ca_vendu: 0 } } }),
            m({ vendu_kg: 10, ca_vendu: 50000, theorique_kg: 0 })
        ];
        const t = cumulerMarge(marges, parages).bovin;
        expect(t.vendu_kg).toBe(95);
        expect(t.ca_vendu).toBe(475000);
        expect(t.marge).toBe(475000 - 383500);
        expect(t.jours_ignores).toBe(1);
        expect(t.ca_ignore).toBe(50000);
    });

    test('aucune journee ecartee: les compteurs restent a zero', () => {
        const parages = [jour({ theorique: 100, vendu: 95, ratio: 0.95 })];
        const marges = [m({ vendu_kg: 95, ca_vendu: 475000, cout_theorique: 383500, theorique_kg: 100 })];
        const t = cumulerMarge(marges, parages).bovin;
        expect(t.jours_ignores).toBe(0);
        expect(t.ca_ignore).toBe(0);
        expect(t.marge).toBe(475000 - 383500);
    });

    test('les hypotheses de prix sont dedoublonnees', () => {
        const parages = [jour({ theorique: 10, vendu: 10, ratio: 1 }), jour({ theorique: 10, vendu: 10, ratio: 1 })];
        const h = { produit: 'Foie', prix_vente: 4000, prix_achat_estime: 3600, methode: 'deduit' };
        const marges = [m({ theorique_kg: 10, hypotheses: [h] }), m({ theorique_kg: 10, hypotheses: [h] })];
        expect(cumulerMarge(marges, parages).bovin.hypotheses).toHaveLength(1);
    });
});

describe('agregation des points de vente', () => {
    const pv = (theorique, vendu) => ({
        bovin: { matin: theorique, transferts: 0, soir: 0, theorique, vendu, parProduit: { Boeuf: { theorique, vendu, matin: theorique, transferts: 0, soir: 0, venduDirect: vendu, venduPack: 0 } } },
        ovin: { matin: 0, transferts: 0, soir: 0, theorique: 0, vendu: 0, parProduit: {} }
    });

    test('les points de vente s additionnent', () => {
        const t = agregerPointsDeVente({ Mbao: pv(100, 95), Touba: pv(50, 48) });
        expect(t.bovin.theorique).toBe(150);
        expect(t.bovin.vendu).toBe(143);
        expect(t.bovin.perte).toBeCloseTo(1 - 143 / 150, 10);
    });

    test('le filtre ne garde qu un point de vente', () => {
        const t = agregerPointsDeVente({ Mbao: pv(100, 95), Touba: pv(50, 48) }, 'Touba');
        expect(t.bovin.theorique).toBe(50);
        expect(t.bovin.vendu).toBe(48);
    });

    // Meme seuil qu'en lib/parage.js: un residu de virgule flottante ne doit
    // pas produire un parage de 100% sur une journee immobile.
    test('un residu sous le gramme ne donne pas de taux', () => {
        const t = agregerPointsDeVente({ Mbao: pv(5.551115123125783e-17, 0) });
        expect(t.bovin.theorique).toBeGreaterThan(0);
        expect(t.bovin.perte).toBeNull();
    });
});
