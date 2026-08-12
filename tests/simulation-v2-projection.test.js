/**
 * Projection du PL de fin de mois — la methode du document "Estimation du
 * P&L de fin de mois", verifiee regle par regle.
 *
 * Les valeurs attendues sont recalculees par des expressions independantes,
 * jamais en appelant le module: un test qui compare le module a lui-meme ne
 * teste rien.
 *
 * @jest-environment node
 */

const P = require('../js/simulation-v2-projection.js');

// Un mois synthetique aux rythmes CONNUS: 1 300 F par jour P1, 1 000 F par
// jour P2 - coefficient vrai de 1,3. Des valeurs commodes ici sont un choix:
// c'est la CLASSIFICATION des jours qu'on teste, pas les arrondis.
function moisSynthetique(annee, mois, p1, p2) {
    const ca = {};
    const prefixe = annee + '-' + String(mois).padStart(2, '0') + '-';
    const fin = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
    for (let j = 1; j <= fin; j++) {
        const iso = prefixe + String(j).padStart(2, '0');
        ca[iso] = P.typeJour(iso) === 'P1' ? p1 : p2;
    }
    return ca;
}

describe('classification des jours: P1 = 1-10 et 25-fin, P2 = 11-24', () => {
    test.each([
        ['2026-08-01', 'P1'], ['2026-08-10', 'P1'], ['2026-08-11', 'P2'],
        ['2026-08-24', 'P2'], ['2026-08-25', 'P1'], ['2026-08-31', 'P1']
    ])('%s est %s', (iso, attendu) => {
        expect(P.typeJour(iso)).toBe(attendu);
    });
    test('fin de mois: 31 jours, fevrier, bissextile', () => {
        expect(P.finDuMois('2026-08-12')).toBe('2026-08-31');
        expect(P.finDuMois('2026-02-15')).toBe('2026-02-28');
        expect(P.finDuMois('2028-02-01')).toBe('2028-02-29');
    });
});

describe('rythmes journaliers', () => {
    test('les jours sans vente comptent ZERO, ils ne sont pas ignores', () => {
        // 2 jours P1 vendus sur 10 ecoules: le rythme est dilue d'autant.
        const ca = { '2026-08-01': 1000, '2026-08-02': 1000 };
        const r = P.rythmeParType(ca, '2026-08-01', '2026-08-10');
        expect(r.P1).toBeCloseTo(2000 / 10, 10);
    });
    test('aout 2026: 17 jours P1, 14 jours P2', () => {
        const r = P.rythmeParType({}, '2026-08-01', '2026-08-31');
        expect(r.jours.P1).toBe(17);
        expect(r.jours.P2).toBe(14);
    });
});

describe('calibration du coefficient sur l historique du tenant', () => {
    test('un historique aux rythmes connus rend leur rapport', () => {
        const histo = {
            ca_par_jour: moisSynthetique(2026, 7, 1300, 1000),
            debut: '2026-07-01', fin: '2026-07-31'
        };
        expect(P.calibrerCoeff(histo)).toBeCloseTo(1.3, 10);
    });
    test('moins de 28 jours, ou un P2 nul: pas de calibration sur du vide', () => {
        expect(P.calibrerCoeff({ ca_par_jour: {}, debut: '2026-08-01', fin: '2026-08-20' })).toBeNull();
        const p2nul = { ca_par_jour: moisSynthetique(2026, 7, 1300, 0), debut: '2026-07-01', fin: '2026-07-31' };
        expect(P.calibrerCoeff(p2nul)).toBeNull();
    });
    test('les coefficients de reference du document sont embarques', () => {
        expect(P.COEFFS_DOCUMENT.mbao).toBeCloseTo(1.243, 6);
        expect(P.COEFFS_DOCUMENT.o_foire).toBeCloseTo(1.336, 6);
    });
});

describe('rythmes retenus: la regle 70/30 du document', () => {
    const HISTO = {
        ca_par_jour: moisSynthetique(2026, 7, 1300, 1000),
        debut: '2026-07-01', fin: '2026-07-31'
    };

    test('periode assez observee: 70 % du reel + 30 % de l historique', () => {
        // 10 jours P1 observes a 1 500 F/j reels.
        const ca = {};
        for (let j = 1; j <= 10; j++) ca['2026-08-' + String(j).padStart(2, '0')] = 1500;
        const r = P.rythmesRetenus({
            caParJour: ca, debutMois: '2026-08-01', dateAnalyse: '2026-08-10',
            histo: HISTO, coeff: 1.3
        });
        expect(r.P1).toBeCloseTo(0.7 * 1500 + 0.3 * 1300, 6);
        expect(r.sources.P1).toMatch(/70 % réel/);
    });
    test('periode trop peu observee: historique seul', () => {
        const ca = { '2026-08-11': 900, '2026-08-12': 900 }; // 2 jours P2 < 5
        const r = P.rythmesRetenus({
            caParJour: ca, debutMois: '2026-08-01', dateAnalyse: '2026-08-12',
            histo: HISTO, coeff: 1.3
        });
        expect(r.P2).toBeCloseTo(1000, 6);
        expect(r.sources.P2).toMatch(/historique/);
    });
    test('sans historique: conversion via le coefficient, et la source le dit', () => {
        // Analyse au 5: aucun jour P2 observe, pas d'historique.
        const ca = { '2026-08-01': 1300, '2026-08-02': 1300, '2026-08-03': 1300, '2026-08-04': 1300, '2026-08-05': 1300 };
        const r = P.rythmesRetenus({
            caParJour: ca, debutMois: '2026-08-01', dateAnalyse: '2026-08-05',
            histo: null, coeff: 1.3
        });
        expect(r.P1).toBeCloseTo(1300, 6);
        expect(r.P2).toBeCloseTo(1300 / 1.3, 6);
        expect(r.sources.P2).toMatch(/converti depuis P1/);
    });
});

describe('projection du CA', () => {
    test('au 12 aout: 12 jours realises, 12 jours P2 et 7 jours P1 restants', () => {
        const ca = moisSynthetique(2026, 8, 1300, 1000);
        // Ne garder que les 12 premiers jours comme "realises".
        const realise = {};
        Object.keys(ca).forEach((j) => { if (j <= '2026-08-12') realise[j] = ca[j]; });
        const p = P.projeterCA({
            caParJour: realise, debutMois: '2026-08-01', dateAnalyse: '2026-08-12',
            histo: { ca_par_jour: moisSynthetique(2026, 7, 1300, 1000), debut: '2026-07-01', fin: '2026-07-31' },
            coeff: 1.3
        });
        expect(p.finMois).toBe('2026-08-31');
        expect(p.restants).toEqual({ P1: 7, P2: 12 });
        expect(p.caRealise).toBeCloseTo(10 * 1300 + 2 * 1000, 6);
        // Rythmes: P1 10 j observes -> 70/30 de (1300,1300) = 1300; P2 2 j
        // observes < 5 -> historique 1000.
        expect(p.caProjete).toBeCloseTo(15000 + 12 * 1000 + 7 * 1300, 6);
    });
    test('mois deja complet: rien a projeter, zero jour restant', () => {
        const p = P.projeterCA({
            caParJour: moisSynthetique(2026, 8, 1300, 1000),
            debutMois: '2026-08-01', dateAnalyse: '2026-08-31',
            histo: null, coeff: 1.3
        });
        expect(p.restants).toEqual({ P1: 0, P2: 0 });
        expect(p.caProjete).toBeCloseTo(p.caRealise, 6);
    });
});

describe('PL projete: chaque poste suit sa regle, jamais une autre', () => {
    const POSTES = {
        total_avances: 1000, commission_maas: 300, marge_cdc: 100,
        depenses_periode: 50, paiements_fournisseur: 80, stock_variation_nette: 200
    };

    test('les postes d activite suivent le CA, les actes ponctuels non', () => {
        const d = P.projeterPL({
            postes: POSTES, caRealise: 10000, caCible: 20000,
            chargesMensuel: 500, stockOption: 'garder'
        });
        expect(d.avances).toBeCloseTo(2000, 10);      // x2 avec le CA
        expect(d.commission).toBeCloseTo(600, 10);    // x2
        expect(d.margeCdc).toBeCloseTo(200, 10);      // x2
        expect(d.depenses).toBe(50);                  // realise, pas extrapole
        expect(d.paiements).toBe(80);                 // realise
        expect(d.charges).toBe(500);                  // mois complet
        expect(d.stock).toBe(200);                    // photo conservee
        expect(d.pl).toBeCloseTo(20000 - 2000 - 600 + 200 - 500 - 50 - 80 + 200, 10);
        expect(d.margeNette).toBeCloseTo(d.pl / 20000, 10);
    });
    test("l option stock 'zero' retire la photo du resultat", () => {
        const d = P.projeterPL({
            postes: POSTES, caRealise: 10000, caCible: 10000,
            chargesMensuel: 500, stockOption: 'zero'
        });
        expect(d.stock).toBe(0);
    });
    test('CA realise nul: pas de projection inventee, regle du document', () => {
        expect(P.projeterPL({ postes: POSTES, caRealise: 0, caCible: 100, chargesMensuel: 0 })).toBeNull();
    });
});

describe('scenarios: prudent -10 %, central, haut +10 %', () => {
    const ARGS = {
        postes: {
            total_avances: 1000, commission_maas: 300, marge_cdc: 0,
            depenses_periode: 50, paiements_fournisseur: 0, stock_variation_nette: 0
        },
        caRealise: 10000, caProjete: 20000, chargesMensuel: 500, stockOption: 'garder'
    };
    test('les postes variables sont recalcules, les fixes identiques', () => {
        const s = P.scenarios(ARGS);
        expect(s.prudent.ca).toBeCloseTo(18000, 10);
        expect(s.haut.ca).toBeCloseTo(22000, 10);
        // Variable: la commission suit chaque scenario.
        expect(s.prudent.commission).toBeCloseTo(300 * 1.8, 10);
        expect(s.central.commission).toBeCloseTo(300 * 2.0, 10);
        expect(s.haut.commission).toBeCloseTo(300 * 2.2, 10);
        // Fixe: charges et depenses ne bougent pas entre scenarios.
        expect(s.prudent.charges).toBe(500);
        expect(s.haut.charges).toBe(500);
        expect(s.prudent.depenses).toBe(50);
        expect(s.haut.depenses).toBe(50);
    });
});

describe('confiance: bon, moyen ou faible - et pourquoi', () => {
    const base = {
        restants: { P1: 7, P2: 12 },
        sourcesFiables: true, histoDisponible: true
    };
    test('tout observe et lisse: bon', () => {
        const c = P.confiance(Object.assign({}, base, {
            rythmes: { sources: { P1: '70 % réel + 30 % historique', P2: '70 % réel + 30 % historique' } }
        }));
        expect(c.niveau).toBe('bon');
    });
    test('un rythme pris sur l historique: moyen', () => {
        const c = P.confiance(Object.assign({}, base, {
            rythmes: { sources: { P1: '70 % réel + 30 % historique', P2: 'historique (2 j observés < 5)' } }
        }));
        expect(c.niveau).toBe('moyen');
    });
    test('un rythme converti, ou une source du PL muette: faible', () => {
        const c1 = P.confiance(Object.assign({}, base, {
            rythmes: { sources: { P1: '70 % réel + 30 % historique', P2: 'converti depuis P1 ÷ coefficient 1.300' } }
        }));
        expect(c1.niveau).toBe('faible');
        const c2 = P.confiance(Object.assign({}, base, {
            sourcesFiables: false,
            rythmes: { sources: { P1: '70 % réel + 30 % historique', P2: '70 % réel + 30 % historique' } }
        }));
        expect(c2.niveau).toBe('faible');
    });
    test('une periode terminee n abaisse pas la confiance', () => {
        const c = P.confiance(Object.assign({}, base, {
            restants: { P1: 7, P2: 0 },
            rythmes: { sources: { P1: '70 % réel + 30 % historique', P2: 'converti depuis P1 ÷ coefficient 1.300' } }
        }));
        expect(c.niveau).toBe('bon');
    });
});

describe('recommandations: des gestes chiffres, pas des generalites', () => {
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 800, ca: 3800000 },
        { nom: 'Poulet en détail', quantite: 100, ca: 340000 },
        { nom: 'Yell', quantite: 40, ca: 120000 }
    ];
    const MARGES = { 'Boeuf en détail': 691, 'Poulet en détail': -50, 'Yell': null };
    const margeDe = (p) => MARGES[p.nom];

    test('un PL negatif devient des unites a vendre et une hausse de prix', () => {
        const r = P.recommandations({
            plCentral: -69100, produits: PRODUITS, margeDe: margeDe,
            topClients: [], dateAnalyse: '2026-08-12'
        });
        const volume = r.filter((x) => x.type === 'volume')[0];
        expect(volume.titre).toMatch(/Boeuf en détail/);
        expect(volume.detail).toMatch(/100/); // 69 100 / 691 = 100 u
        const prix = r.filter((x) => x.type === 'prix' && /ajuster/.test(x.titre))[0];
        expect(prix.detail).toMatch(/86/); // 69 100 / 800 = 86,4 F par unite
    });
    test('une marge negative et un cout inconnu sont nommes', () => {
        const r = P.recommandations({
            plCentral: 100, produits: PRODUITS, margeDe: margeDe,
            topClients: [], dateAnalyse: '2026-08-12'
        });
        expect(r.filter((x) => /vend à perte/.test(x.titre))[0].titre).toMatch(/Poulet/);
        expect(r.filter((x) => /Coût inconnu/.test(x.titre))[0].titre).toMatch(/Yell/);
    });
    test('les commandes sont classees par MARGE, pas par chiffre d affaires', () => {
        const margeDe = (p) => ({ 'Boeuf en détail': 691, 'Foie': null, 'Poulet en détail': 300 }[p.nom]);
        const commandes = [
            // Grosse par le CA, mais du Foie au cout inconnu: marge 0, exclue.
            { id: 1, client: 'A', date: '2026-08-10', ca: 900000, lignes: [{ produit: 'Foie', quantite: 300, ca: 900000 }] },
            { id: 2, client: 'B', date: '2026-08-11', ca: 480000, lignes: [{ produit: 'Boeuf en détail', quantite: 100, ca: 480000 }] },
            { id: 3, client: 'C', date: '2026-08-12', ca: 350000, lignes: [{ produit: 'Poulet en détail', quantite: 100, ca: 350000 }] }
        ];
        const r = P.commandesRentables({ commandes: commandes, margeDe: margeDe });
        expect(r.map((c) => c.id)).toEqual([2, 3]); // 69 100 F puis 30 000 F; la n°1 exclue
        expect(r[0].marge).toBeCloseTo(69100, 6);
    });
    test('la couverture dit la part du panier au cout connu', () => {
        const margeDe = (p) => (p.nom === 'Boeuf en détail' ? 691 : null);
        const r = P.commandesRentables({
            commandes: [{
                id: 1, client: 'A', date: '2026-08-10', ca: 1000,
                lignes: [
                    { produit: 'Boeuf en détail', quantite: 1, ca: 750 },
                    { produit: 'Foie', quantite: 1, ca: 250 }
                ]
            }],
            margeDe: margeDe
        });
        expect(r[0].couverture).toBeCloseTo(0.75, 10);
    });
    test('un client recidiviste est repere pour securiser la recurrence', () => {
        const margeDe = () => 100;
        const r = P.commandesRentables({
            commandes: [
                { id: 1, client: 'Awa', ca: 100, lignes: [{ produit: 'X', quantite: 5, ca: 100 }] },
                { id: 2, client: 'awa ', ca: 100, lignes: [{ produit: 'X', quantite: 4, ca: 100 }] },
                { id: 3, client: 'Ba', ca: 100, lignes: [{ produit: 'X', quantite: 3, ca: 100 }] }
            ],
            margeDe: margeDe
        });
        expect(r.filter((c) => c.id === 1)[0].commandesClient).toBe(2); // 'Awa' = 'awa '
        expect(r.filter((c) => c.id === 3)[0].commandesClient).toBe(1);
    });
    test('un gros client disparu depuis 7 jours ou plus est a relancer', () => {
        const r = P.recommandations({
            plCentral: 100, produits: [], margeDe: () => null,
            topClients: [
                { nom: 'Client A', ca: 500000, dernier: '2026-08-01' },
                { nom: 'Client B', ca: 400000, dernier: '2026-08-11' }
            ],
            dateAnalyse: '2026-08-12'
        });
        const relances = r.filter((x) => x.type === 'client');
        expect(relances).toHaveLength(1);
        expect(relances[0].titre).toMatch(/Client A/);
    });
});
