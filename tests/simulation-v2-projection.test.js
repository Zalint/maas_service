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

describe('jours d ouverture: les dimanches se retirent des deux cotes', () => {
    test('aout 2026 compte 5 dimanches', () => {
        const tous = P.joursEntre('2026-08-01', '2026-08-31');
        const ouvres = P.joursOuvres('2026-08-01', '2026-08-31', true);
        expect(tous).toHaveLength(31);
        expect(ouvres).toHaveLength(26);
        expect(ouvres.filter(P.estDimanche)).toHaveLength(0);
    });

    test('le rythme se calcule par jour OUVRE, pas par jour calendaire', () => {
        // 7 journees VENDUES, dont le dimanche 2 aout. Il faut lui donner une
        // vente: depuis que les journees sans vente sortent du denominateur,
        // un dimanche a zero en sortait de toute facon et les deux branches
        // rendaient le meme compte - le test ne testait plus son intention.
        const ca = {};
        P.joursEntre('2026-08-02', '2026-08-08').forEach((j) => { ca[j] = 1000; });
        const avec = P.rythmeParType(ca, '2026-08-02', '2026-08-08', false);
        const sans = P.rythmeParType(ca, '2026-08-02', '2026-08-08', true);
        expect(P.estDimanche('2026-08-02')).toBe(true);
        expect(avec.jours.P1 + avec.jours.P2).toBe(7);
        expect(sans.jours.P1 + sans.jours.P2).toBe(6);
    });

    test('les jours restants ne comptent que les jours ouvres', () => {
        const avec = P.projeterCA({
            caParJour: { '2026-08-01': 1000 }, debutMois: '2026-08-01',
            dateAnalyse: '2026-08-01', histo: null, coeff: 1.3, exclureDimanche: false
        });
        const sans = P.projeterCA({
            caParJour: { '2026-08-01': 1000 }, debutMois: '2026-08-01',
            dateAnalyse: '2026-08-01', histo: null, coeff: 1.3, exclureDimanche: true
        });
        expect(avec.restants.P1 + avec.restants.P2).toBe(30);
        // 30 jours restants, moins les 5 dimanches d'aout 2026.
        expect(sans.restants.P1 + sans.restants.P2).toBe(25);
    });

    test('une analyse UN DIMANCHE ne perd pas un jour ouvre', () => {
        // Le piege du slice(1): quand l'analyse tombe un dimanche exclu, le
        // premier jour de la liste est deja le lundi - le retirer aurait
        // supprime une vraie journee.
        expect(P.estDimanche('2026-08-30')).toBe(true);
        const r = P.projeterCA({
            caParJour: {}, debutMois: '2026-08-01', dateAnalyse: '2026-08-30',
            histo: null, coeff: 1.3, exclureDimanche: true
        });
        // Il reste le 31 seulement, et ce n'est pas un dimanche.
        expect(r.restants.P1 + r.restants.P2).toBe(1);
    });
});

describe('rythmes journaliers', () => {
    test('les jours SANS vente sont EXCLUS du denominateur', () => {
        // Regle inversee le 19/08/2026, sur backtest de 16 projections a
        // cheval sur deux sites (juin et juillet 2026): en les comptant,
        // l'erreur sur le niveau du CA projete valait 43,4 % pour un biais de
        // -41,4 %; en les excluant, 17,5 % pour -10,8 %. Gain confirme
        // separement sur chaque site. Une boucherie ouverte qui ne vend rien
        // de la journee n'existe pas: ces jours sont des fermetures ou des
        // saisies manquantes, et chacun divisait le rythme sans rien apporter
        // au numerateur.
        const ca = { '2026-08-01': 1000, '2026-08-02': 1000 };
        const r = P.rythmeParType(ca, '2026-08-01', '2026-08-10');
        // 2 journees ACTIVES, pas 10 ecoulees.
        expect(r.P1).toBeCloseTo(1000, 10);
        expect(r.jours.P1).toBe(2);
    });

    test('les journees ecartees sont NOMMEES, pas escamotees', () => {
        // L'ecran doit pouvoir dire lesquelles: fermeture reelle ou saisie
        // manquante, ce n'est pas la meme conversation avec l'exploitant.
        const ca = { '2026-08-01': 1000, '2026-08-02': 1000 };
        const r = P.rythmeParType(ca, '2026-08-01', '2026-08-05');
        expect(r.joursExclus).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
    });

    test('aucune vente du tout: rythme null, jamais zero', () => {
        const r = P.rythmeParType({}, '2026-08-01', '2026-08-10');
        expect(r.P1).toBeNull();
        expect(r.jours.P1).toBe(0);
        expect(r.joursExclus).toHaveLength(10);
    });
    test('aout 2026: 17 jours P1, 14 jours P2 quand tous sont actifs', () => {
        // Le decoupage calendaire: jours 1-10 et 25-31 en P1 (17), 11-24 en
        // P2 (14). Toutes les journees portent une vente, sinon elles
        // sortiraient du denominateur et ce n'est pas ce qu'on teste ici.
        const ca = {};
        P.joursEntre('2026-08-01', '2026-08-31').forEach((j) => { ca[j] = 1; });
        const r = P.rythmeParType(ca, '2026-08-01', '2026-08-31');
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

    test('le CA est projete par le TAUX DE MARGE, pas par les avances', () => {
        // La regle a change, et c'est le coeur du correctif.
        //
        // AVANT: les avances etaient extrapolees comme un cout (x2 avec le CA)
        // pendant que le stock qu'elles creent restait fige. Tout l'achat du
        // mois passait donc pour consomme. Mesure sur aout 2026: la marge
        // implicite tombait a 0,5 % du CA quand la marge reelle vaut 10,4 %,
        // et le PL projete affichait -341 053 F pour une activite benificiaire.
        //
        // APRES: on projette le TAUX DE MARGE constate. Avances, paiements et
        // stock sont dans le cout des ventes et suivent donc le volume
        // ensemble, ce qui est leur nature - ce sont trois faces d'un meme
        // achat.
        const d = P.projeterPL({
            postes: POSTES, caRealise: 10000, caCible: 20000,
            chargesMensuel: 500, stockOption: 'garder'
        });
        // cout realise = avances + paiements - stock = 1000 + 80 - 200 = 880
        // taux de marge = (10000 - 880) / 10000 = 91,2 %
        expect(d.tauxMarge).toBeCloseTo(0.912, 10);
        expect(d.marge).toBeCloseTo(20000 * 0.912, 10);
        expect(d.commission).toBeCloseTo(600, 10);    // x2, suit l'activite
        expect(d.margeCdc).toBeCloseTo(200, 10);      // x2
        expect(d.depenses).toBe(50);                  // realise, acte ponctuel
        expect(d.charges).toBe(500);                  // mois complet
        expect(d.pl).toBeCloseTo(18240 - 600 + 200 - 500 - 50, 10);
        expect(d.margeNette).toBeCloseTo(d.pl / 20000, 10);
    });

    test('le taux rendu par le SERVEUR prime sur le taux reconstitue', () => {
        // Le serveur calcule taux_marge sur les memes postes, mais sans
        // l'arrondi des champs intermediaires. Le repli local n'existe que
        // pour un PL fige AVANT l'ajout du champ.
        const d = P.projeterPL({
            postes: Object.assign({}, POSTES, { taux_marge: 25 }),
            caRealise: 10000, caCible: 20000, chargesMensuel: 500, stockOption: 'garder'
        });
        expect(d.tauxMarge).toBeCloseTo(0.25, 10);
        expect(d.marge).toBeCloseTo(5000, 10);
    });
    test('depenses extrapolees au prorata des JOURS, pas du CA', () => {
        // 12 jours ecoules sur 31: une depense courante court aussi les jours
        // creux, son facteur ne doit donc rien devoir au chiffre d'affaires.
        const d = P.projeterPL({
            postes: POSTES, caRealise: 10000, caCible: 40000,
            chargesMensuel: 0, depensesOption: 'jours',
            jours: { ecoules: 12, mois: 31 }
        });
        expect(d.depensesFacteur).toBeCloseTo(31 / 12, 10);
        expect(d.depenses).toBeCloseTo(50 * 31 / 12, 10);
        // Le CA a quadruple: si le facteur en dependait, il vaudrait 4.
        expect(d.depensesFacteur).not.toBeCloseTo(4, 3);
    });
    test("l option 'ca' fait suivre les depenses a l activite", () => {
        const d = P.projeterPL({
            postes: POSTES, caRealise: 10000, caCible: 20000,
            chargesMensuel: 0, depensesOption: 'ca', jours: { ecoules: 12, mois: 31 }
        });
        expect(d.depenses).toBeCloseTo(100, 10); // 50 x 2
    });
    test('les paiements fournisseur ne sont JAMAIS extrapoles', () => {
        // L'argent sorti revient en marchandise, donc en variation de stock:
        // l'extrapoler compterait la meme sortie deux fois.
        ['realise', 'jours', 'ca'].forEach((opt) => {
            const d = P.projeterPL({
                postes: POSTES, caRealise: 10000, caCible: 40000,
                chargesMensuel: 0, depensesOption: opt, jours: { ecoules: 12, mois: 31 }
            });
            expect(d.paiements).toBe(80);
        });
    });
    test('sans jours exploitables, l extrapolation ne divise pas par zero', () => {
        const d = P.projeterPL({
            postes: POSTES, caRealise: 10000, caCible: 10000,
            chargesMensuel: 0, depensesOption: 'jours', jours: { ecoules: 0, mois: 31 }
        });
        expect(d.depensesFacteur).toBe(1);
        expect(d.depenses).toBe(50);
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
    test("l extrapolation par les jours reste fixe d un scenario a l autre", () => {
        // Elle depend du calendrier, pas du CA: les trois scenarios doivent
        // porter la MEME depense, sinon le facteur a fuite vers le CA.
        const s = P.scenarios(Object.assign({}, ARGS, {
            depensesOption: 'jours', jours: { ecoules: 12, mois: 31 }
        }));
        expect(s.prudent.depenses).toBeCloseTo(50 * 31 / 12, 10);
        expect(s.central.depenses).toBeCloseTo(50 * 31 / 12, 10);
        expect(s.haut.depenses).toBeCloseTo(50 * 31 / 12, 10);
    });
    test("l option 'ca' fait au contraire varier les depenses par scenario", () => {
        const s = P.scenarios(Object.assign({}, ARGS, { depensesOption: 'ca' }));
        expect(s.prudent.depenses).toBeCloseTo(50 * 1.8, 10);
        expect(s.haut.depenses).toBeCloseTo(50 * 2.2, 10);
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

    test('le classement suit genres, pas le libelle affiche', () => {
        // Le defaut que `genres` corrige: reformuler une phrase a l'ecran
        // deplacait le niveau de confiance en silence. Ici le libelle est
        // volontairement meconnaissable, le genre reste lisible.
        const c = P.confiance(Object.assign({}, base, {
            rythmes: {
                genres: { P1: 'melange', P2: 'converti' },
                sources: { P1: 'peu importe', P2: 'formulation totalement réécrite' }
            }
        }));
        expect(c.niveau).toBe('faible');
        expect(c.notes.join(' ')).toMatch(/conversion/);
    });

    test('bout en bout: la sortie reelle de rythmesRetenus alimente confiance', () => {
        // Les tests precedents fabriquent des rythmes a la main; celui-ci
        // branche les deux fonctions, seul moyen d'attraper une divergence
        // entre ce que l'une produit et ce que l'autre attend.
        const ca = {};
        for (let j = 1; j <= 12; j++) ca['2026-08-' + String(j).padStart(2, '0')] = 100000;
        const r = P.rythmesRetenus({
            caParJour: ca, debutMois: '2026-08-01', dateAnalyse: '2026-08-12',
            histo: null, coeff: 1.3
        });
        // P1 observe (12 j), P2 non observe -> converti depuis P1.
        expect(r.genres.P1).toBe('reel_seul');
        expect(r.genres.P2).toBe('converti');
        const c = P.confiance({
            rythmes: r, restants: { P1: 7, P2: 12 },
            sourcesFiables: true, histoDisponible: false
        });
        expect(c.niveau).toBe('faible');
    });
});

describe('plan d equilibre: ce qu il reste a faire avant la fin du mois', () => {
    // Volumes du mois ecoule; le CA projete vaut le double du realise, donc
    // on attend encore autant qu'on a deja vendu: volumeRestant = quantite.
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 1000, ca: 5000000 },
        { nom: 'Boeuf en gros', quantite: 500, ca: 2400000 },
        { nom: 'Agneau', quantite: 200, ca: 1000000 },
        { nom: 'Poulet en détail', quantite: 100, ca: 350000 },
        { nom: 'Yell', quantite: 50, ca: 150000 },
        { nom: 'Sans marge', quantite: 400, ca: 400000 }
    ];
    const MARGES = {
        'Boeuf en détail': 900, 'Boeuf en gros': 700, 'Agneau': 500,
        'Poulet en détail': 300, 'Yell': 200, 'Sans marge': null
    };
    const margeDe = (p) => MARGES[p.nom];
    // 13 jours ecoules sur 31: le rythme mensuel vaut donc 31/13 fois le
    // realise, et le plafond par defaut trois fois ce rythme.
    const BASE = {
        produits: PRODUITS, margeDe: margeDe,
        caRealise: 8900000, caProjete: 17800000, joursRestants: 18,
        jours: { ecoules: 13, mois: 31 }
    };
    const MOIS = 31 / 13;

    test('les leviers portent sur le volume RESTANT, pas sur le mois ecoule', () => {
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        // caRestant / caRealise = 1 -> on attend encore 1 000 u de boeuf.
        expect(r.seul.volumeRestant).toBeCloseTo(1000, 6);
        expect(r.seul.nom).toBe('Boeuf en détail');
        expect(r.joursRestants).toBe(18);
    });

    test('a volume inchange: la marge au kilo requise, et son montant', () => {
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        // 450 000 a combler sur 1 000 u -> +450 F/u, soit 1 350 F/u.
        expect(r.seul.hausseMarge).toBeCloseTo(450, 6);
        expect(r.seul.margeRequise).toBeCloseTo(1350, 6);
        expect(r.seul.montantMarge).toBeCloseTo(450000, 6);
        // Controle: la hausse appliquee au volume restant rend bien le manque.
        expect(r.seul.hausseMarge * r.seul.volumeRestant).toBeCloseTo(450000, 6);
    });

    test('a marge inchangee: le volume a vendre, au total et par jour', () => {
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        // 450 000 / 900 = 500 u de plus.
        expect(r.seul.volumeAdditionnel).toBeCloseTo(500, 6);
        expect(r.seul.volumeTotal).toBeCloseTo(1500, 6);
        expect(r.seul.hausseVolumePct).toBeCloseTo(50, 6);
        expect(r.seul.parJour).toBeCloseTo(500 / 18, 6);
        expect(r.seul.volumeAdditionnel * r.seul.marge).toBeCloseTo(450000, 6);
    });

    test('le plan cumule comble EXACTEMENT le manque, et pas davantage', () => {
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        const somme = r.plan.reduce((s, x) => s + x.part, 0);
        expect(somme).toBeCloseTo(450000, 4);
        // Chaque part vaut bien ses unites x sa marge.
        r.plan.forEach((x) => {
            expect(x.volumeAdditionnel * x.marge).toBeCloseTo(x.part, 4);
        });
    });

    test('les produits sont pris par MARGE unitaire, pas par volume', () => {
        // Yell (200 F/u, 50 u) doit passer devant un gros volume a faible
        // marge s'il en existait: c'est la marge qui classe, jamais marge x
        // volume - sinon on redesigne les produits qui se vendent deja.
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        // Le principal reste en tete, le reste par marge decroissante.
        expect(r.plan.map((x) => x.nom)).toEqual([
            'Boeuf en détail', 'Boeuf en gros', 'Agneau', 'Poulet en détail', 'Yell'
        ]);
        const suite = r.plan.slice(1).map((x) => x.marge);
        expect(suite).toEqual([...suite].sort((a, b) => b - a));
    });

    test('les fortes marges rapportent plus a effort egal en unites', () => {
        // Manque modeste: aucun produit n'atteint son plafond, les unites
        // s'egalisent donc et l'argent suit la marge sans explication.
        const r = P.planEquilibre(Object.assign({ plCentral: -26000 }, BASE));
        const somme = 900 + 700 + 500 + 300 + 200;
        expect(r.unitesCommunes).toBeCloseTo(26000 / somme, 6);
        r.plan.forEach((x) => {
            expect(x.plafonne).toBe(false);
            expect(x.volumeAdditionnel).toBeCloseTo(r.unitesCommunes, 6);
            expect(x.part).toBeCloseTo(r.unitesCommunes * x.marge, 4);
        });
        // Le plan est trie par apport: la plus forte marge en tete.
        expect(r.plan[0].nom).toBe('Boeuf en détail');
        expect(r.plan[0].part).toBeGreaterThan(r.plan[4].part);
    });

    test('le plafond vient du RYTHME MENSUEL, pas du volume restant', () => {
        // Yell: 50 u vendues en 13 j -> 119,2 u sur le mois -> plafond du mois
        // 357,7 u. Plafonner sur le volume restant aurait puni un produit
        // observe tot, dont le reliquat de mois est court.
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        const yell = r.plan.filter((x) => x.nom === 'Yell')[0];
        expect(yell.volumeMois).toBeCloseTo(50 * MOIS, 6);
        expect(yell.plafondMois).toBeCloseTo(50 * MOIS * 3, 6);
        // Le plafond borne le TOTAL du mois: ce qui reste vendable en retire
        // ce qui est deja vendu, et l'effort ce qui est deja attendu.
        expect(yell.plafondReste).toBeCloseTo(50 * MOIS * 3 - 50, 6);
        expect(yell.plafond).toBeCloseTo(50 * MOIS * 3 - 50 - yell.volumeRestant, 6);
    });

    test('le total a vendre ne depasse JAMAIS le plafond du total', () => {
        // La contradiction que ce plafond corrige: un total affiche au-dessus
        // du plafond cense le contenir.
        [-450000, -2000000, -9000000].forEach((pl) => {
            const r = P.planEquilibre(Object.assign({ plCentral: pl }, BASE));
            r.plan.forEach((x) => {
                expect(x.volumeRestant + x.volumeAdditionnel).toBeLessThanOrEqual(x.plafondReste + 1e-9);
            });
        });
    });

    test('le facteur du plafond est un parametre, pas une constante', () => {
        const un = P.planEquilibre(Object.assign({ plCentral: -450000, facteurMax: 1 }, BASE));
        const dix = P.planEquilibre(Object.assign({ plCentral: -450000, facteurMax: 10 }, BASE));
        const yellUn = un.plan.filter((x) => x.nom === 'Yell')[0];
        const yellDix = dix.plan.filter((x) => x.nom === 'Yell')[0];
        // Le plafond du MOIS suit le facteur exactement.
        expect(yellDix.plafondMois).toBeCloseTo(yellUn.plafondMois * 10, 6);
        expect(un.facteurMax).toBe(1);
        expect(dix.facteurMax).toBe(10);
        // Un plafond plus large laisse porter davantage aux petits produits.
        expect(yellDix.volumeAdditionnel).toBeGreaterThanOrEqual(yellUn.volumeAdditionnel);
    });

    test('le compte tombe juste, plafonds compris', () => {
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        expect(r.plan.reduce((s, x) => s + x.part, 0)).toBeCloseTo(450000, 3);
        r.plan.forEach((x) => {
            expect(x.volumeAdditionnel).toBeLessThanOrEqual(x.plafond + 1e-9);
        });
        expect(r.atteignable).toBe(true);
        expect(r.resteACouvrir).toBe(0);
    });

    test('un produit qui ne se vend presque pas reste borne par son rythme', () => {
        // 0,5 u en 13 jours = 1,19 u sur le mois, donc au plus 3,58 u
        // demandees. Le classement par marge seule en aurait fait le pilier du
        // plan avec 172 u.
        const r = P.planEquilibre(Object.assign({}, BASE, {
            plCentral: -450000,
            produits: BASE.produits.concat([{ nom: 'Rarissime', quantite: 0.5, ca: 5000 }]),
            margeDe: (p) => (p.nom === 'Rarissime' ? 5000 : MARGES[p.nom])
        }));
        const rare = r.plan.filter((x) => x.nom === 'Rarissime')[0];
        // 0,5 u vendue -> 1,19 u sur le mois -> plafond du mois 3,58 u, dont
        // 0,5 deja vendue et 0,5 deja attendue: l'effort ne peut valoir que
        // le reliquat.
        expect(rare.plafondMois).toBeCloseTo(0.5 * MOIS * 3, 6);
        expect(rare.plafonne).toBe(true);
        expect(rare.volumeRestant + rare.volumeAdditionnel)
            .toBeCloseTo(rare.plafondReste, 6);
    });

    test('sans calendrier exploitable, le plafond retombe sur le volume attendu', () => {
        const r = P.planEquilibre(Object.assign({}, BASE, {
            plCentral: -450000, jours: { ecoules: 0, mois: 31 }, facteurMax: 1
        }));
        const yell = r.plan.filter((x) => x.nom === 'Yell')[0];
        expect(yell.volumeMois).toBeNull();
        // Repli: deja vendu + volume attendu x facteur, donc le total
        // vendable d'ici la fin vaut le volume attendu.
        expect(yell.plafondReste).toBeCloseTo(yell.volumeRestant, 6);
        expect(yell.plafond).toBe(0);
    });

    test('un produit sans marge connue, nulle ou negative ne porte rien', () => {
        const r = P.planEquilibre(Object.assign({ plCentral: -450000 }, BASE));
        expect(r.plan.map((x) => x.nom)).not.toContain('Sans marge');
        expect(r.plan).toHaveLength(5);
        expect(r.plan[0].nom).toBe('Boeuf en détail');
    });

    test('un manque hors de portee du volume laisse un reste, et le dit', () => {
        // L'effort maximal d'un produit vaut plafondMois - deja vendu - deja
        // attendu. Ici quantite et volume attendu sont egaux (proportion 1),
        // donc effortMax = q x (3 x MOIS - 2).
        const margeFoisQ = 900 * 1000 + 700 * 500 + 500 * 200 + 300 * 100 + 200 * 50;
        const capacite = margeFoisQ * (3 * MOIS - 2);
        const r = P.planEquilibre(Object.assign({ plCentral: -(capacite + 1000000) }, BASE));
        expect(r.capaciteTotale).toBeCloseTo(capacite, 3);
        expect(r.atteignable).toBe(false);
        expect(r.resteACouvrir).toBeCloseTo(1000000, 3);
        r.plan.forEach((x) => { expect(x.plafonne).toBe(true); });
    });

    test('un plafond plus serre peut rendre le meme manque inatteignable', () => {
        // Le facteur decide de ce qui est jouable: a 3x le rythme mensuel les
        // 2 000 000 F passent, a 1x ils ne passent plus.
        const large = P.planEquilibre(Object.assign({ plCentral: -2000000 }, BASE));
        expect(large.atteignable).toBe(true);
        const serre = P.planEquilibre(Object.assign({ plCentral: -2000000, facteurMax: 1 }, BASE));
        expect(serre.capaciteTotale).toBeCloseTo(1390000 * (MOIS - 2), 3);
        expect(serre.atteignable).toBe(false);
    });

    test('un resultat deja positif ne demande aucun effort', () => {
        expect(P.planEquilibre(Object.assign({ plCentral: 1 }, BASE))).toBeNull();
        expect(P.planEquilibre(Object.assign({ plCentral: 0 }, BASE))).toBeNull();
    });

    test('un mois deja fini n a plus de volume a vendre: pas de plan', () => {
        const r = P.planEquilibre(Object.assign({}, BASE, {
            plCentral: -450000, caProjete: 8900000, joursRestants: 0
        }));
        expect(r).toBeNull();
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
        // Le nombre SUIVI de « u », pas un 100 quelconque: la chaine contient
        // deja « 69 100 F », donc /100/ passait meme si le calcul etait faux.
        expect(volume.detail).toMatch(/\b100\s*u\b/); // 69 100 / 691 = 100 u
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
    test('un client bimensuel muet depuis 8 jours n est PAS en retard', () => {
        // Le defaut que ce calcul corrige: un seuil fixe de 7 jours relancait
        // ce client-la alors qu'il vient tous les 15 jours.
        const c = {
            nom: 'Bimensuel', ca_fenetre: 500000,
            passages: [
                { date: '2026-06-05', ca: 100000 }, { date: '2026-06-20', ca: 100000 },
                { date: '2026-07-05', ca: 100000 }, { date: '2026-07-20', ca: 100000 },
                { date: '2026-08-04', ca: 100000 }
            ]
        };
        const h = P.habitude(c.passages, '2026-08-12');
        expect(h.intervalleMedian).toBe(15);
        expect(h.silence).toBe(8);
        expect(h.retardRelatif).toBeCloseTo(8 / 15, 6);
        expect(P.clientsARelancer({ clients: [c], dateAnalyse: '2026-08-12' })).toHaveLength(0);
    });

    test('un client hebdomadaire muet depuis 15 jours EST en retard', () => {
        // Le silence est plus court en jours que le cas precedent une fois
        // rapporte a l'habitude... non: il vaut 2 rendez-vous manques.
        const c = {
            nom: 'Hebdo', ca_fenetre: 300000,
            passages: [
                { date: '2026-07-07', ca: 60000 }, { date: '2026-07-14', ca: 60000 },
                { date: '2026-07-21', ca: 60000 }, { date: '2026-07-28', ca: 60000 }
            ]
        };
        const h = P.habitude(c.passages, '2026-08-11');
        expect(h.intervalleMedian).toBe(7);
        expect(h.retardRelatif).toBeCloseTo(14 / 7, 6);
        const r = P.clientsARelancer({ clients: [c], dateAnalyse: '2026-08-11' });
        expect(r).toHaveLength(1);
        expect(r[0].nom).toBe('Hebdo');
    });

    test('la mediane resiste a une longue absence isolee', () => {
        // Moyenne = (7+7+40+7)/4 = 15,25 j, mediane = 7 j. Avec la moyenne, ce
        // client regulier passerait pour un client mensuel.
        const passages = [
            { date: '2026-06-01' }, { date: '2026-06-08' }, { date: '2026-06-15' },
            { date: '2026-07-25' }, { date: '2026-08-01' }
        ];
        expect(P.habitude(passages, '2026-08-02').intervalleMedian).toBe(7);
    });

    test('deux achats le meme jour comptent pour UNE visite', () => {
        const h = P.habitude([
            { date: '2026-08-01' }, { date: '2026-08-01' }, { date: '2026-08-08' }
        ], '2026-08-08');
        expect(h.nbVisites).toBe(2);
        expect(h.intervalleMedian).toBe(7);
    });

    test('moins de trois visites: aucune habitude affirmee', () => {
        const h = P.habitude([{ date: '2026-08-01' }, { date: '2026-08-08' }], '2026-08-20');
        expect(h.habitudeEtablie).toBe(false);
        expect(h.retardRelatif).toBeNull();
        expect(P.clientsARelancer({
            clients: [{ nom: 'Inconnu', ca_fenetre: 999999, passages: [{ date: '2026-08-01' }, { date: '2026-08-08' }] }],
            dateAnalyse: '2026-08-30'
        })).toHaveLength(0);
    });

    describe('gros clients du mois dernier, muets ce mois-ci', () => {
        const CLIENTS = [
            {
                nom: 'Gros parti', ca_fenetre: 900000,
                passages: [
                    { date: '2026-07-03', ca: 300000 }, { date: '2026-07-10', ca: 300000 },
                    { date: '2026-07-17', ca: 300000 }
                ]
            },
            {
                nom: 'Petit parti', ca_fenetre: 50000,
                passages: [{ date: '2026-07-05', ca: 50000 }]
            },
            {
                nom: 'Toujours la', ca_fenetre: 800000,
                passages: [
                    { date: '2026-07-10', ca: 400000 }, { date: '2026-08-05', ca: 400000 }
                ]
            }
        ];

        test('classe par le CA du mois dernier, et exclut ceux revenus', () => {
            const r = P.clientsPerdus({ clients: CLIENTS, dateAnalyse: '2026-08-12' });
            expect(r.map((x) => x.nom)).toEqual(['Gros parti', 'Petit parti']);
            expect(r[0].caMoisDernier).toBe(900000);
        });

        test('un rythme plus long que le mois entame vaut « pas encore en retard »', () => {
            // Client mensuel: au 12, 12 jours ecoules < 30 j d'habitude.
            const mensuel = {
                nom: 'Mensuel', ca_fenetre: 600000,
                passages: [
                    { date: '2026-05-15', ca: 200000 }, { date: '2026-06-14', ca: 200000 },
                    { date: '2026-07-14', ca: 200000 }
                ]
            };
            const r = P.clientsPerdus({ clients: [mensuel], dateAnalyse: '2026-08-12' });
            expect(r[0].premature).toBe(true);
            // Au 25, les 30 jours sont largement depasses.
            expect(P.clientsPerdus({ clients: [mensuel], dateAnalyse: '2026-08-25' })[0].premature).toBe(false);
        });

        test('sans habitude etablie, on ne conclut ni dans un sens ni dans l autre', () => {
            // Un seul passage, 36 jours de silence: on ne PEUT pas dire s'il
            // est en retard. premature reste vrai (pas d'alarme), mais
            // habitudeEtablie dit a l'ecran de ne pas affirmer le contraire.
            const r = P.clientsPerdus({
                clients: [{ nom: 'Vu une fois', ca_fenetre: 84000, passages: [{ date: '2026-07-08', ca: 84000 }] }],
                dateAnalyse: '2026-08-13'
            });
            expect(r[0].habitudeEtablie).toBe(false);
            expect(r[0].silence).toBe(36);
            expect(r[0].intervalle).toBeNull();
        });

        test('le passage de janvier remonte bien a decembre de l annee d avant', () => {
            const c = {
                nom: 'Nouvel an', ca_fenetre: 100000,
                passages: [
                    { date: '2025-12-05', ca: 50000 }, { date: '2025-12-12', ca: 30000 },
                    { date: '2025-12-19', ca: 20000 }
                ]
            };
            const r = P.clientsPerdus({ clients: [c], dateAnalyse: '2026-01-20' });
            expect(r).toHaveLength(1);
            expect(r[0].caMoisDernier).toBe(100000);
        });
    });

    test('la relance sort du rythme de chaque client, pas d un seuil fixe', () => {
        // Les deux se taisent depuis 14 jours. Seul l'hebdomadaire est en
        // retard - deux rendez-vous manques; pour l'autre, c'est a peine la
        // moitie de son cycle. Un seuil unique en jours les aurait tous les
        // deux relances, ou aucun.
        const hebdo = {
            nom: 'Hebdo', ca_fenetre: 400000,
            passages: [
                { date: '2026-07-10', ca: 100000 }, { date: '2026-07-17', ca: 100000 },
                { date: '2026-07-24', ca: 100000 }, { date: '2026-07-31', ca: 100000 }
            ]
        };
        const mensuel = {
            nom: 'Mensuel', ca_fenetre: 400000,
            passages: [
                { date: '2026-05-31', ca: 130000 }, { date: '2026-06-30', ca: 130000 },
                { date: '2026-07-31', ca: 140000 }
            ]
        };
        const r = P.recommandations({
            plCentral: 100, produits: [], margeDe: () => null,
            clientsHistorique: [hebdo, mensuel],
            dateAnalyse: '2026-08-14'
        });
        const relances = r.filter((x) => x.type === 'client');
        expect(relances).toHaveLength(1);
        expect(relances[0].titre).toMatch(/Hebdo/);
        expect(relances[0].detail).toMatch(/tous les 7 jours/);
    });

    test('sans historique de clients, aucune relance inventee', () => {
        const r = P.recommandations({
            plCentral: 100, produits: [], margeDe: () => null, dateAnalyse: '2026-08-12'
        });
        expect(r.filter((x) => x.type === 'client')).toHaveLength(0);
    });
});

describe('volumesProjetes: la marchandise que la projection suppose', () => {
    // Le melange de Mbao au 15-08-2026: le detail pese 80,9 % des kilos, le
    // gros 19,1 %. Marges nettes apres commission induite.
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 390 },
        { nom: 'Boeuf en gros', quantite: 92.25 }
    ];
    const MARGES = { 'Boeuf en détail': 968, 'Boeuf en gros': 668 };
    const margeDe = (p) => (p.nom in MARGES ? MARGES[p.nom] : null);

    test('les volumes suivent la proportion des jours restants', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe, plCentral: -15920
        });
        expect(v.lignes[0].reste).toBeCloseTo(390 * 0.9085, 2);
        expect(v.lignes[0].mois).toBeCloseTo(390 * 1.9085, 2);
        // Les totaux sont des CUMULS, pas des derivations.
        expect(v.totaux.vendu).toBeCloseTo(482.25, 2);
        expect(v.totaux.mois).toBeCloseTo(v.totaux.vendu + v.totaux.reste, 6);
    });

    test('le delta comble exactement le trou, et se repartit au prorata', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe, plCentral: -15920
        });
        // La moyenne est PONDEREE par les quantites, pas une moyenne simple:
        // une moyenne simple donnerait 818 F et surestimerait de 12 % les
        // kilos demandes.
        const attendue = (390 * 968 + 92.25 * 668) / 482.25;
        expect(v.margeMoyenne).toBeCloseTo(attendue, 6);
        expect(v.deltaTotal).toBeCloseTo(15920 / attendue, 6);
        // Le trou est comble: kilos x marge = manque.
        expect(v.totaux.delta * attendue).toBeCloseTo(15920, 4);
        // Chaque part suit le poids du produit, et les parts SOMMENT au total.
        expect(v.lignes[0].delta / v.totaux.delta).toBeCloseTo(390 / 482.25, 6);
        expect(v.lignes[0].delta + v.lignes[1].delta).toBeCloseTo(v.totaux.delta, 6);
        expect(v.lignes[0].equilibre).toBeCloseTo(v.lignes[0].mois + v.lignes[0].delta, 6);
    });

    test('un PL POSITIF rend un delta negatif: le coussin, en kilos', () => {
        // Le plan d'equilibre se tait quand le PL est positif - il n'a rien a
        // combler. Le volume, lui, dit encore quelque chose: de combien on
        // peut se permettre de vendre moins.
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5, margeDe, plCentral: 45000
        });
        expect(v.raison).toBeNull();
        expect(v.deltaTotal).toBeLessThan(0);
        expect(v.totaux.equilibre).toBeLessThan(v.totaux.mois);
    });

    test('sans PL, la raison est SANS_PL et non une marge en cause', () => {
        // Les deux silences ne se disent pas pareil: accuser la marge quand
        // c'est le PL qui manque est un diagnostic economique inverse.
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5, margeDe, plCentral: null
        });
        expect(v.raison).toBe('sans_pl');
        expect(v.deltaTotal).toBeNull();
        expect(v.lignes[0].delta).toBeNull();
        // Les volumes, eux, restent chiffres: ils ne dependent pas du PL.
        expect(v.lignes[0].mois).toBeCloseTo(585, 2);
    });

    test('une marge non positive ne se comble pas en vendant plus', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5,
            margeDe: () => -10, plCentral: -15920
        });
        expect(v.raison).toBe('marge_non_positive');
        expect(v.deltaTotal).toBeNull();
    });

    test('un produit sans marge est exclu du partage, pas compte a zero', () => {
        // L'inclure au denominateur diluerait la moyenne et gonflerait les
        // kilos demandes, sur un chiffre qu'on ne sait pas etablir.
        const v = P.volumesProjetes({
            produits: PRODUITS.concat([{ nom: 'Veau', quantite: 100 }]),
            proportion: 0.9085, margeDe, plCentral: -15920
        });
        expect(v.nbSansMarge).toBe(1);
        const veau = v.lignes.find((l) => l.nom === 'Veau');
        expect(veau.delta).toBeNull();
        expect(veau.mois).toBeCloseTo(190.85, 2);   // son volume reste chiffre
        // La moyenne ignore le veau: elle vaut celle des deux autres.
        expect(v.margeMoyenne).toBeCloseTo((390 * 968 + 92.25 * 668) / 482.25, 6);
        expect(v.totaux.delta).toBeCloseTo(v.deltaTotal, 6);
    });

    test('sans produit ou sans jours restants, rien a projeter', () => {
        expect(P.volumesProjetes({ produits: [], proportion: 0.5, margeDe, plCentral: -1 }))
            .toBeNull();
        expect(P.volumesProjetes({ produits: PRODUITS, proportion: 0, margeDe, plCentral: -1 }))
            .toBeNull();
    });
});

describe('PL cible: l equilibre n est qu une cible a zero', () => {
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 390, prix_moyen: 5400 },
        { nom: 'Boeuf en gros', quantite: 92.25, prix_moyen: 4800 }
    ];
    const MARGES = { 'Boeuf en détail': 968, 'Boeuf en gros': 668 };
    const margeDe = (p) => (p.nom in MARGES ? MARGES[p.nom] : null);
    const plan = (plCentral, cible) => P.planEquilibre({
        plCentral, cible, produits: PRODUITS, margeDe,
        caRealise: 2853150, caProjete: 5445304, joursRestants: 13,
        jours: { ecoules: 13, mois: 26 }, facteurMax: 3,
        principal: 'Boeuf en détail', nbProduits: 5
    });

    test('sans cible, le comportement d avant: le manque est le PL negatif', () => {
        expect(plan(-15920, undefined).manque).toBeCloseTo(15920, 6);
        expect(plan(-15920, 0).manque).toBeCloseTo(15920, 6);
    });

    test('un PL POSITIF sous la cible redonne un plan', () => {
        // C'est le cas de la PROD: le plan se taisait des que le PL passait
        // au-dessus de zero, alors qu'un objectif de 100 000 F demande encore
        // un effort. 45 000 realises sur 100 000 vises: il en manque 55 000.
        expect(plan(45000, 0)).toBeNull();
        const p = plan(45000, 100000);
        expect(p).not.toBeNull();
        expect(p.manque).toBeCloseTo(55000, 6);
    });

    test('cible atteinte: aucun plan, jamais un effort negatif', () => {
        // Un manque negatif se lirait comme une consigne de vendre moins.
        expect(plan(120000, 100000)).toBeNull();
        expect(plan(100000, 100000)).toBeNull();
    });

    test('une cible NEGATIVE est un arbitrage, pas une erreur', () => {
        // Accepter de perdre 50 000 ce mois-ci se saisit; il reste alors
        // 30 000 a combler depuis -80 000.
        const p = plan(-80000, -50000);
        expect(p.manque).toBeCloseTo(30000, 6);
    });

    test('le volume requis suit la cible, pas seulement le signe du PL', () => {
        const bas = plan(-15920, 0).seul.volumeAdditionnel;
        const haut = plan(-15920, 100000).seul.volumeAdditionnel;
        // 115 920 F a combler au lieu de 15 920: l'effort suit exactement.
        expect(haut / bas).toBeCloseTo(115920 / 15920, 6);
    });

    test('volumesProjetes vise la MEME cible que le plan', () => {
        // Deux cibles differentes sur le meme ecran se contrediraient.
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe,
            plCentral: 45000, cible: 100000
        });
        const margeMoy = (390 * 968 + 92.25 * 668) / 482.25;
        expect(v.deltaTotal).toBeCloseTo(55000 / margeMoy, 6);
        expect(v.totaux.delta * margeMoy).toBeCloseTo(55000, 4);
    });

    test('au-dessus de la cible, le delta reste negatif: le coussin', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe,
            plCentral: 150000, cible: 100000
        });
        expect(v.deltaTotal).toBeLessThan(0);
        expect(v.raison).toBeNull();
    });
});

describe('les trois lectures visent la MEME cible', () => {
    const PRODUITS = [{ nom: 'Foie', quantite: 17, prix_moyen: 4000 }];
    const margeDe = () => 1380;

    test('les recommandations chiffrent l ecart vers la cible, pas vers zero', () => {
        const r = P.recommandations({
            plCentral: -15920, cible: 100000, produits: PRODUITS, margeDe,
            dateAnalyse: '2026-08-16'
        });
        const vol = r.find((x) => x.type === 'volume');
        // fmt() separe les milliers par une espace fine insecable (U+202F):
        // une assertion sur une espace ordinaire ne correspondrait jamais.
        expect(vol.detail).toMatch(/écart de 115\s?920/);
        expect(vol.detail).not.toMatch(/écart de 15\s?920/);
        expect(vol.detail).toMatch(/environ 84 u/);   // 115 920 / 1 380
    });

    test('cible atteinte: aucune consigne de volume sous un bandeau de succes', () => {
        // Le defaut vu a l'ecran: le bandeau annoncait l'objectif atteint et
        // les conseils juste dessous reclamaient encore de combler 15 920 F.
        const r = P.recommandations({
            plCentral: -15920, cible: -50000, produits: PRODUITS, margeDe,
            dateAnalyse: '2026-08-16'
        });
        expect(r.filter((x) => x.type === 'volume')).toHaveLength(0);
    });

    test('sans cible, le comportement d avant est preserve', () => {
        const r = P.recommandations({
            plCentral: -15920, produits: PRODUITS, margeDe, dateAnalyse: '2026-08-16'
        });
        expect(r.find((x) => x.type === 'volume').detail).toMatch(/écart de 15\s?920/);
    });
});

describe('un PL inconnu n est pas un PL a zero', () => {
    // projeterPL declare pl nullable (pl = marge === null ? null : ...) et
    // margeNette s'en garde. Le convertir en zero ferait chiffrer un ecart
    // vers la cible depuis un equilibre suppose.
    const PRODUITS = [{ nom: 'Boeuf en détail', quantite: 390 }];
    const margeDe = () => 968;

    test('plCentral null rend sans_pl, pas un delta depuis zero', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5, margeDe,
            plCentral: null, cible: 100000
        });
        expect(v.raison).toBe('sans_pl');
        expect(v.deltaTotal).toBeNull();
    });

    test('un PL a zero, lui, se chiffre bien vers la cible', () => {
        // La distinction porte: zero est une valeur, null est une absence.
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5, margeDe,
            plCentral: 0, cible: 100000
        });
        expect(v.raison).toBeNull();
        expect(v.deltaTotal).toBeCloseTo(100000 / 968, 6);
    });

    test('planEquilibre refuse aussi de projeter depuis un PL absent', () => {
        expect(P.planEquilibre({
            plCentral: null, cible: 100000, produits: PRODUITS, margeDe,
            caRealise: 2853150, caProjete: 5445304, joursRestants: 13
        })).toBeNull();
    });
});

describe('volumesProjetes: le prix requis par produit, meme manque que les kilos', () => {
    // Memes fixtures que le bloc precedent, avec un prix_moyen par produit -
    // le mix (390/92.25) reste le ratio reel/historique confirme par
    // l'utilisateur pour repartir l'effort.
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 390, prix_moyen: 5400 },
        { nom: 'Boeuf en gros', quantite: 92.25, prix_moyen: 5200 }
    ];
    const MARGES = { 'Boeuf en détail': 968, 'Boeuf en gros': 668 };
    const margeDe = (p) => (p.nom in MARGES ? MARGES[p.nom] : null);

    test('sans manque (cible = PL), le prix requis EGALE le prix actuel', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe, plCentral: -15920, cible: -15920
        });
        v.lignes.forEach((l) => expect(l.prixRequis).toBeCloseTo(l.prixMoyen, 6));
    });

    test('le manque se repartit au MEME ratio que le delta en kilos', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe, plCentral: -15920, cible: 0
        });
        const detail = v.lignes.find((l) => l.nom === 'Boeuf en détail');
        const gros = v.lignes.find((l) => l.nom === 'Boeuf en gros');
        // manque total 15 920, reparti 390/482.25 et 92.25/482.25.
        const manqueDetail = 15920 * (390 / 482.25);
        const manqueGros = 15920 * (92.25 / 482.25);
        expect(detail.prixRequis).toBeCloseTo(5400 + manqueDetail / detail.reste, 4);
        expect(gros.prixRequis).toBeCloseTo(5200 + manqueGros / gros.reste, 4);
        // Le prix requis augmente quand il manque de la marge.
        expect(detail.prixRequis).toBeGreaterThan(5400);
        expect(gros.prixRequis).toBeGreaterThan(5200);
    });

    test('un PL au-dessus de la cible fait BAISSER le prix requis', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe, plCentral: 45000, cible: 0
        });
        const detail = v.lignes.find((l) => l.nom === 'Boeuf en détail');
        expect(detail.prixRequis).toBeLessThan(detail.prixMoyen);
    });

    test('sans prix_moyen connu, le prix requis reste null', () => {
        const sans = [{ nom: 'Boeuf en détail', quantite: 390 }];
        const v = P.volumesProjetes({
            produits: sans, proportion: 0.9085, margeDe, plCentral: -15920, cible: 0
        });
        expect(v.lignes[0].prixRequis).toBeNull();
        expect(v.lignes[0].prixMoyen).toBeNull();
    });

    test('sans PL (raison sans_pl), le prix requis reste null - pas de manque a chiffrer', () => {
        const v = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.9085, margeDe, plCentral: null, cible: 0
        });
        v.lignes.forEach((l) => expect(l.prixRequis).toBeNull());
    });
});

describe('tauxMargeCourant: projeter aux prix du jour, pas a la moyenne du mois', () => {
    // Le defaut corrige: `taux_marge` du serveur est constate depuis le 1er et
    // melange les journees ou la carcasse etait a 3 835 F a celles ou elle est
    // a 4 500. Projeter dessus suppose que les jours restants se paieront au
    // prix moyen du PASSE.
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 100, ca: 540000, prix_moyen: 5400 },
        { nom: 'Boeuf en gros', quantite: 50, ca: 255000, prix_moyen: 5100 }
    ];

    test('le taux vaut la marge rapportee au CA des memes volumes aux memes prix', () => {
        // Marges unitaires posees a la main: 1 000 et 800. Ici ca = prix x
        // quantite, donc l'assiette aux derniers prix egale le CA constate.
        const margeDe = (p) => (p.nom === 'Boeuf en détail' ? 1000 : 800);
        const r = P.tauxMargeCourant({ produits: PRODUITS, margeDe });
        const attendu = (100 * 1000 + 50 * 800) / (540000 + 255000);
        expect(r.taux).toBeCloseTo(attendu, 10);
        expect(r.couverture).toBeCloseTo(1, 10);
        expect(r.utilisable).toBe(true);
    });

    test('quand les prix ont monte, le denominateur suit: pas de taux hybride', () => {
        // Vendu a 5 000 sur la periode (ca = 500 000), dernier prix 5 400.
        // L'hybride divisait la marge aux prix de demain par le CA d'hier et
        // rendait 1000/5000 = 20 %; le vrai taux des jours restants est
        // 1000/5400 = 18,52 %.
        const produits = [{ nom: 'Boeuf', quantite: 100, ca: 500000, prix_moyen: 5400 }];
        const r = P.tauxMargeCourant({ produits, margeDe: () => 1000 });
        expect(r.taux).toBeCloseTo(1000 / 5400, 10);
        expect(r.ca_derniers).toBeCloseTo(540000, 2);
        // La couverture, elle, reste sur le CA constate.
        expect(r.ca_chiffre).toBeCloseTo(500000, 2);
        expect(r.couverture).toBeCloseTo(1, 10);
    });

    test('un cout qui MONTE fait BAISSER le taux', () => {
        // C'est la question posee: un cout qui monte ne peut pas faire gagner
        // du PL. Le taux doit donc baisser, et le PL avec lui.
        const bas = P.tauxMargeCourant({ produits: PRODUITS, margeDe: () => 1000 });
        const haut = P.tauxMargeCourant({ produits: PRODUITS, margeDe: () => 700 });
        expect(haut.taux).toBeLessThan(bas.taux);
    });

    test('un produit sans cout est EXCLU, pas compte a marge pleine', () => {
        // L'inclure a marge inconnue gonflerait le taux; le compter a zero le
        // diluerait. On l'ecarte et on le NOMME.
        const margeDe = (p) => (p.nom === 'Boeuf en gros' ? null : 1000);
        const r = P.tauxMargeCourant({ produits: PRODUITS, margeDe });
        expect(r.sans_cout).toEqual(['Boeuf en gros']);
        // Le taux se rapporte au CA CHIFFRABLE (540 000), pas au total.
        expect(r.taux).toBeCloseTo((100 * 1000) / 540000, 10);
        expect(r.ca_chiffre).toBeCloseTo(540000, 2);
        expect(r.ca_total).toBeCloseTo(795000, 2);
    });

    test('une couverture trop faible rend le taux INUTILISABLE', () => {
        // 540 000 sur 795 000 = 68 %: en dessous du seuil de 80 %, le taux
        // decrit une minorite de l'activite et ne doit pas piloter le PL.
        const margeDe = (p) => (p.nom === 'Boeuf en gros' ? null : 1000);
        const r = P.tauxMargeCourant({ produits: PRODUITS, margeDe });
        expect(r.couverture).toBeCloseTo(540000 / 795000, 6);
        expect(r.utilisable).toBe(false);
    });

    test('projeterPL utilise le taux COURANT quand il est utilisable', () => {
        const postes = {
            total_avances: 0, commission_maas: 0, marge_cdc: 0,
            depenses_periode: 0, paiements_fournisseur: 0,
            stock_variation_nette: 0, taux_marge: 20
        };
        // caCible = 2 x caRealise: la moitie du mois reste a vendre.
        const base = {
            postes, caRealise: 1000000, caCible: 2000000,
            chargesMensuel: 0, stockOption: 'zero', depensesOption: 'realise'
        };
        const constate = P.projeterPL(base);
        expect(constate.tauxMargeOrigine).toBe('constate');
        expect(constate.marge).toBeCloseTo(2000000 * 0.20, 2);

        // Ce test affirmait `marge = caCible x taux courant`, c'est-a-dire le
        // taux courant applique a TOUT le mois - passe compris. Il encodait le
        // defaut: une vente deja faite au prix d'hier etait recomptee au prix
        // du jour. La regle est desormais une DECOMPOSITION.
        const courant = P.projeterPL(Object.assign({}, base, {
            tauxCourant: { taux: 0.12, utilisable: true, marge_totale: 120000 }
        }));
        expect(courant.tauxMargeOrigine).toBe('courant');
        // 200 000 (realise au taux constate) + 120 000 (restant aux prix du jour)
        expect(courant.marge).toBeCloseTo(200000 + 120000, 2);
        // La marge unitaire courante etant plus basse que la constatee, le PL
        // baisse: un cout qui monte ne fait pas gagner du PL.
        expect(courant.pl).toBeLessThan(constate.pl);
    });

    test('un taux courant INUTILISABLE laisse le taux constate en place', () => {
        const postes = {
            total_avances: 0, commission_maas: 0, marge_cdc: 0,
            depenses_periode: 0, paiements_fournisseur: 0,
            stock_variation_nette: 0, taux_marge: 20
        };
        const r = P.projeterPL({
            postes, caRealise: 1000000, caCible: 1000000,
            chargesMensuel: 0, stockOption: 'zero', depensesOption: 'realise',
            tauxCourant: { taux: 0.12, utilisable: false }
        });
        expect(r.tauxMargeOrigine).toBe('constate');
        expect(r.marge).toBeCloseTo(200000, 2);
    });
});

describe('le mois se coupe en deux: realise au prix passe, restant au prix courant', () => {
    // Le defaut corrige: appliquer un taux unique a caCible traitait tout le
    // mois pareil. Avec le taux courant, cela REEVALUAIT le passe deja vendu a
    // des prix qu'il n'a pas eus - une vente faite a 5 282 F recomptee 5 400.
    const postes = {
        total_avances: 0, commission_maas: 0, marge_cdc: 0,
        depenses_periode: 0, paiements_fournisseur: 0,
        stock_variation_nette: 0, taux_marge: 10
    };
    const base = {
        postes, caRealise: 1000000, chargesMensuel: 0,
        stockOption: 'zero', depensesOption: 'realise'
    };

    test('la marge du REALISE reste au taux constate, jamais reevaluee', () => {
        // caCible = caRealise: il ne reste rien a vendre, donc la marge doit
        // valoir exactement celle du realise - le taux courant ne doit rien
        // changer.
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 1000000,
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        }));
        expect(r.marge).toBeCloseTo(1000000 * 0.10, 2);
        expect(r.tauxMarge).toBeCloseTo(0.10, 6);
    });

    test('les jours restants portent la marge unitaire COURANTE', () => {
        // caCible = 2 x caRealise: il reste autant a vendre que de deja vendu,
        // donc proportion = 1 et la marge restante vaut marge_totale entiere.
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 2000000,
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        }));
        // 100 000 (realise au taux constate) + 200 000 (restant au prix courant)
        expect(r.marge).toBeCloseTo(100000 + 200000, 2);
        // Et le taux EFFECTIF rendu est celui que cette marge represente.
        expect(r.tauxMarge).toBeCloseTo(300000 / 2000000, 6);
        expect(r.tauxMargeOrigine).toBe('courant');
    });

    test('un cout qui monte fait BAISSER le PL, meme decompose', () => {
        const cher = P.projeterPL(Object.assign({}, base, {
            caCible: 2000000,
            tauxCourant: { utilisable: true, taux: 0.10, marge_totale: 100000 }
        }));
        const bonMarche = P.projeterPL(Object.assign({}, base, {
            caCible: 2000000,
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        }));
        expect(cher.pl).toBeLessThan(bonMarche.pl);
    });

    test('un scenario SOUS le realise ne cree pas de marge negative', () => {
        // Pas de vente negative: le plancher est « plus rien vendu ».
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 800000,
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        }));
        expect(r.marge).toBeCloseTo(100000, 2);   // le realise seul
    });

    test('sans taux courant utilisable, le taux constate porte tout le mois', () => {
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 2000000,
            tauxCourant: { utilisable: false, taux: 0.20, marge_totale: 200000 }
        }));
        expect(r.marge).toBeCloseTo(2000000 * 0.10, 2);
        expect(r.tauxMargeOrigine).toBe('constate');
    });

    test('le taux constate reste rendu a part, pour l affichage', () => {
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 2000000,
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        }));
        expect(r.tauxMargeConstate).toBeCloseTo(0.10, 6);
        expect(r.tauxMarge).not.toBeCloseTo(0.10, 6);
    });
});

describe('revue: la saisie manuelle doit traverser TOUT le calcul', () => {
    // Cinq defauts trouves en revue le 19/08/2026, tous de la meme famille:
    // la saisie etait branchee sur l'affichage des lignes mais pas sur ce qui
    // en derive. Ces tests les epinglent un par un.

    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 400, prix_moyen: 5400 },
        { nom: 'Boeuf en gros', quantite: 100, prix_moyen: 5100 }
    ];

    test('volumesProjetes accepte des restes fournis du dehors', () => {
        // Sans cette entree, le tableau affichait 200 en « reste a vendre »
        // mais calculait son delta d equilibre et son prix conseille sur les
        // 50 du mix - deux volumes sur la meme ligne.
        const vp = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5,
            restes: { 'boeuf en gros': 200 },
            cleDe: (n) => String(n).trim().toLowerCase(),
            margeDe: () => 500, plCentral: 0, cible: 0
        });
        const gros = vp.lignes.find((l) => l.nom === 'Boeuf en gros');
        const detail = vp.lignes.find((l) => l.nom === 'Boeuf en détail');
        expect(gros.reste).toBe(200);
        expect(gros.mois).toBe(300);
        // La ligne non fournie garde le mix.
        expect(detail.reste).toBeCloseTo(200, 10);
    });

    test('le TOTAL somme bien la colonne affichee', () => {
        // Le defaut: la ligne « Total boeuf » lisait vp.totaux calcule sur le
        // mix pendant que les lignes affichaient les restes saisis.
        const vp = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5,
            restes: { 'boeuf en gros': 200 },
            cleDe: (n) => String(n).trim().toLowerCase(),
            margeDe: () => 500, plCentral: 0, cible: 0
        });
        const sommeLignes = vp.lignes.reduce((a, l) => a + l.reste, 0);
        expect(vp.totaux.reste).toBeCloseTo(sommeLignes, 10);
        expect(vp.totaux.mois).toBeCloseTo(vp.lignes.reduce((a, l) => a + l.mois, 0), 10);
    });

    test('le prix requis se calcule sur le reste REEL, pas sur celui du mix', () => {
        // prixPourCombler divise le manque par les kilos restants: se tromper
        // de volume dimensionne le prix conseille sur un mois different.
        const avec = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5,
            restes: { 'boeuf en gros': 200 },
            cleDe: (n) => String(n).trim().toLowerCase(),
            margeDe: () => 500, plCentral: -100000, cible: 0
        });
        const sans = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5,
            margeDe: () => 500, plCentral: -100000, cible: 0
        });
        const g1 = avec.lignes.find((l) => l.nom === 'Boeuf en gros');
        const g2 = sans.lignes.find((l) => l.nom === 'Boeuf en gros');
        // Meme manque a combler, 4 fois plus de kilos pour le porter: le prix
        // requis doit etre PLUS BAS.
        expect(g1.prixRequis).toBeLessThan(g2.prixRequis);
    });

    test('sans restes fournis, volumesProjetes est INCHANGE', () => {
        const a = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5, margeDe: () => 500,
            plCentral: 0, cible: 0
        });
        const b = P.volumesProjetes({
            produits: PRODUITS, proportion: 0.5, restes: {}, cleDe: (n) => n,
            margeDe: () => 500, plCentral: 0, cible: 0
        });
        expect(b.lignes.map((l) => l.reste)).toEqual(a.lignes.map((l) => l.reste));
        expect(b.totaux.reste).toBeCloseTo(a.totaux.reste, 10);
    });

    const postes = {
        total_avances: 0, commission_maas: 0, marge_cdc: 0,
        depenses_periode: 0, paiements_fournisseur: 0,
        stock_variation_nette: 0, taux_marge: 10
    };

    test('la saisie s applique MEME si le taux courant est inutilisable', () => {
        // Le defaut: margeRestanteDirecte etait lue a l'interieur du test sur
        // tc.utilisable. Sur un site dont plus de 20 % du CA n'a pas de prix
        // d'achat, la saisie n'avait AUCUN effet sur le PL, en silence.
        const base = {
            postes, caRealise: 1000000, caCible: 2000000, chargesMensuel: 0,
            stockOption: 'zero', depensesOption: 'realise',
            tauxCourant: { utilisable: false, taux: 0.20, marge_totale: 200000 }
        };
        const sans = P.projeterPL(base);
        expect(sans.margeOrigine).toBe('proportion');
        expect(sans.marge).toBeCloseTo(2000000 * 0.10, 2);

        const avec = P.projeterPL(Object.assign({}, base, { margeRestanteDirecte: 150000 }));
        expect(avec.margeOrigine).toBe('produits');
        expect(avec.marge).toBeCloseTo(1000000 * 0.10 + 150000, 2);
    });

    test('sans tauxCourant du tout, la saisie s applique encore', () => {
        const r = P.projeterPL({
            postes, caRealise: 1000000, caCible: 2000000, chargesMensuel: 0,
            stockOption: 'zero', depensesOption: 'realise',
            margeRestanteDirecte: 150000
        });
        expect(r.margeOrigine).toBe('produits');
        expect(r.marge).toBeCloseTo(100000 + 150000, 2);
    });

    test('sans taux constate, la saisie ne peut RIEN sauver', () => {
        // Le realise n'a pas de marge connue: la decomposition n'a pas de
        // premier terme, on ne l'invente pas.
        const r = P.projeterPL({
            postes: Object.assign({}, postes, {
                taux_marge: null, total_avances: 900000, paiements_fournisseur: 0,
                stock_variation_nette: 0
            }),
            caRealise: 1000000, caCible: 2000000, chargesMensuel: 0,
            stockOption: 'zero', depensesOption: 'realise',
            margeRestanteDirecte: 150000
        });
        // taux_marge null -> repli reconstitue depuis les postes, donc non nul.
        expect(r.margeOrigine).toBe('produits');
        expect(r.marge).not.toBeNull();
    });

    test('rythmeParType distingue journees ACTIVES et journees OUVERTES', () => {
        // Le seuil des 5 journees observees compte les actives, deliberement.
        // Mais l'ecran doit pouvoir dire « 2 actives sur 10 ouvertes ».
        const ca = { '2026-08-01': 1000, '2026-08-02': 1000 };
        const r = P.rythmeParType(ca, '2026-08-01', '2026-08-10');
        expect(r.jours.P1).toBe(2);
        expect(r.joursOuverts.P1).toBe(10);
        expect(r.joursExclus).toHaveLength(8);
        // Les deux comptes coincident quand toutes les journees sont actives.
        const plein = {};
        P.joursEntre('2026-08-01', '2026-08-10').forEach((j) => { plein[j] = 1; });
        const r2 = P.rythmeParType(plein, '2026-08-01', '2026-08-10');
        expect(r2.jours.P1).toBe(r2.joursOuverts.P1);
    });
});

describe('repartirRestes: la saisie manuelle des quantites restantes', () => {
    // Le backtest a montre qu'un estimateur par produit degrade le PL. Ce qui
    // manque au modele n'est pas de la statistique, c'est l'information que
    // l'exploitant a et que les donnees n'ont pas: une grosse commande de gros
    // annoncee. D'ou une surcharge, dont la propriete cardinale est de ne RIEN
    // changer tant qu'on ne s'en sert pas.
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 400, prix_moyen: 5400 },
        { nom: 'Boeuf en gros', quantite: 100, prix_moyen: 5100 }
    ];
    // caPlein = 400 x 5400 + 100 x 5100 = 2 160 000 + 510 000 = 2 670 000
    // proportion 0,5 -> cible CA de la suite = 1 335 000

    test('SANS surcharge, le resultat est l hypothese de mix, au flottant pres', () => {
        const r = P.repartirRestes({ produits: PRODUITS, proportion: 0.5 });
        expect(r.actif).toBe(false);
        expect(r.lignes[0].reste).toBeCloseTo(200, 10);
        expect(r.lignes[1].reste).toBeCloseTo(50, 10);
        expect(r.lignes.every((l) => l.source === 'mix')).toBe(true);
        // Et c'est exactement ce que volumesProjetes pose: q x proportion.
        r.lignes.forEach((l) => expect(l.reste).toBeCloseTo(l.quantite * 0.5, 10));
    });

    test('mode atelier: une saisie REDISTRIBUE, le CA de la suite ne bouge pas', () => {
        // On annonce 200 u de gros au lieu des 50 du mix: +150 u a 5 100 =
        // 765 000 F pris aux autres lignes.
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5,
            surcharges: { 'boeuf en gros': { reste: 200 } }
        });
        expect(r.actif).toBe(true);
        expect(r.lignes[1].reste).toBe(200);
        expect(r.lignes[1].source).toBe('saisie');
        // CA total de la suite inchange: c'est la definition du mode atelier.
        expect(r.ca_suite).toBeCloseTo(r.ca_suite_mix, 6);
        expect(r.ca_suite).toBeCloseTo(1335000, 6);
        // Le detail absorbe: (1 335 000 - 1 020 000) / 5 400 = 58,33 u
        expect(r.lignes[0].reste).toBeCloseTo((1335000 - 200 * 5100) / 5400, 6);
        expect(r.facteur).toBeLessThan(1);
    });

    test('mode ajout: la saisie s ajoute, le CA de la suite grossit', () => {
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5, mode: 'ajout',
            surcharges: { 'boeuf en gros': { reste: 200 } }
        });
        expect(r.lignes[0].reste).toBeCloseTo(200, 10);   // le detail ne bouge pas
        expect(r.lignes[1].reste).toBe(200);
        expect(r.ca_suite).toBeGreaterThan(r.ca_suite_mix);
        expect(r.ca_suite - r.ca_suite_mix).toBeCloseTo(150 * 5100, 6);
        expect(r.facteur).toBeNull();
    });

    test('une saisie EGALE au mix ne deplace rien', () => {
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5,
            surcharges: { 'boeuf en gros': { reste: 50 } }
        });
        expect(r.facteur).toBeCloseTo(1, 10);
        expect(r.lignes[0].reste).toBeCloseTo(200, 6);
        expect(r.sature).toBe(false);
    });

    test('une saisie qui depasse le CA projete sature, sans rendre de negatif', () => {
        // 300 u de gros = 1 530 000 > 1 335 000 de cible.
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5,
            surcharges: { 'boeuf en gros': { reste: 300 } }
        });
        expect(r.sature).toBe(true);
        expect(r.notes).toContain('saisies_au_dela_du_ca');
        expect(r.lignes[0].reste).toBe(0);          // plancher, jamais negatif
        expect(r.lignes[1].reste).toBe(300);        // la saisie n est pas rognee
        expect(r.ca_suite).toBeGreaterThan(r.ca_suite_mix);
    });

    test('une saisie negative est ramenee a zero', () => {
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5,
            surcharges: { 'boeuf en détail': { reste: -50 } },
            cleDe: (n) => String(n).trim().toLowerCase()
        });
        const detail = r.lignes.find((l) => l.cle === 'boeuf en détail');
        expect(detail.reste).toBe(0);
        expect(detail.source).toBe('saisie');
    });

    test('zero est une saisie LEGITIME, pas une absence de saisie', () => {
        // « on ne vendra plus de gros ce mois-ci » doit s ecrire.
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5,
            surcharges: { 'boeuf en gros': { reste: 0 } }
        });
        expect(r.lignes[1].reste).toBe(0);
        expect(r.lignes[1].source).toBe('saisie');
        expect(r.actif).toBe(true);
        // Tout le CA revient au detail, le total tient toujours.
        expect(r.ca_suite).toBeCloseTo(1335000, 6);
    });

    test('la normalisation des cles est celle qu on lui passe', () => {
        // L application fusionne « Boeuf En Gros » et « Boeuf en gros » via
        // normaliserNom (accents retires, minuscules). La surcharge doit
        // suivre la MEME cle, sinon elle rate sa cible.
        const sansAccent = (n) => String(n || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        const r = P.repartirRestes({
            produits: [{ nom: 'Boeuf En Détail', quantite: 400, prix_moyen: 5400 }],
            proportion: 0.5, mode: 'ajout',
            surcharges: { 'boeuf en detail': { reste: 123 } },
            cleDe: sansAccent
        });
        expect(r.lignes[0].reste).toBe(123);
    });

    test('un produit sans prix ne casse pas la redistribution', () => {
        const r = P.repartirRestes({
            produits: [
                { nom: 'Boeuf en gros', quantite: 100, prix_moyen: 5100 },
                { nom: 'Poivre', quantite: 10, prix_moyen: null }
            ],
            proportion: 0.5,
            surcharges: { 'boeuf en gros': { reste: 60 } }
        });
        expect(Number.isFinite(r.lignes[1].reste)).toBe(true);
        expect(Number.isFinite(r.ca_suite)).toBe(true);
    });

    test('proportion nulle: rien a repartir, mais une saisie reste possible', () => {
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0,
            surcharges: { 'boeuf en gros': { reste: 30 } }
        });
        expect(r.lignes[1].reste).toBe(30);
        expect(r.sature).toBe(true);   // la cible vaut 0, la saisie la depasse
    });

    test('margeDesRestes somme les marges unitaires sur les restes', () => {
        const r = P.repartirRestes({
            produits: PRODUITS, proportion: 0.5,
            surcharges: { 'boeuf en gros': { reste: 200 } }
        });
        const margeDe = (p) => (p.cle === 'boeuf en gros' ? 400 : 700);
        const m = P.margeDesRestes(r.lignes, margeDe);
        expect(m.marge).toBeCloseTo(r.lignes[0].reste * 700 + 200 * 400, 6);
        expect(m.sans_marge).toEqual([]);
    });

    test('margeDesRestes nomme les produits sans marge au lieu de les compter zero', () => {
        const r = P.repartirRestes({ produits: PRODUITS, proportion: 0.5 });
        const margeDe = (p) => (p.cle === 'boeuf en gros' ? null : 700);
        const m = P.margeDesRestes(r.lignes, margeDe);
        expect(m.sans_marge).toEqual(['Boeuf en gros']);
        expect(m.marge).toBeCloseTo(200 * 700, 6);
    });

    test('SANS saisie, margeDesRestes egale proportion x marge du mix', () => {
        // L invariant qui garantit l absence de regression: c est exactement
        // ce que projeterPL calcule aujourd hui.
        const r = P.repartirRestes({ produits: PRODUITS, proportion: 0.5 });
        const margeDe = () => 700;
        const m = P.margeDesRestes(r.lignes, margeDe);
        const margeMix = PRODUITS.reduce((acc, p) => acc + 700 * p.quantite, 0);
        expect(m.marge).toBeCloseTo(0.5 * margeMix, 6);
    });

    test('projeterPL: margeRestanteDirecte prime et se declare', () => {
        const postes = {
            total_avances: 0, commission_maas: 0, marge_cdc: 0,
            depenses_periode: 0, paiements_fournisseur: 0,
            stock_variation_nette: 0, taux_marge: 10
        };
        const base = {
            postes, caRealise: 1000000, caCible: 2000000, chargesMensuel: 0,
            stockOption: 'zero', depensesOption: 'realise',
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        };
        const sans = P.projeterPL(base);
        expect(sans.marge).toBeCloseTo(100000 + 200000, 2);
        expect(sans.margeOrigine).toBe('proportion');

        const avec = P.projeterPL(Object.assign({}, base, { margeRestanteDirecte: 150000 }));
        expect(avec.marge).toBeCloseTo(100000 + 150000, 2);
        expect(avec.margeOrigine).toBe('produits');
        expect(avec.pl).toBeLessThan(sans.pl);
    });

    test('la saisie vaut dans les TROIS scenarios, et ils restent monotones', () => {
        // Une commande annoncee ne retrecit pas parce qu on regarde le
        // scenario prudent. Le callback est evalue a la cible de chaque
        // scenario: la saisie reste ferme, les lignes libres absorbent.
        const postes = {
            total_avances: 0, commission_maas: 0, marge_cdc: 0,
            depenses_periode: 0, paiements_fournisseur: 0,
            stock_variation_nette: 0, taux_marge: 10
        };
        const vus = [];
        const scen = P.scenarios({
            postes, caRealise: 1000000, caProjete: 2000000,
            chargesMensuel: 0, stockOption: 'zero', depensesOption: 'realise',
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 },
            // Marge de la suite qui suit la cible, comme le fera l ecran en
            // recalculant la repartition a la proportion du scenario.
            margeRestanteDe: (cible) => { vus.push(cible); return (cible - 1000000) * 0.15; }
        });
        // Les trois scenarios ont bien interroge le callback.
        expect(vus.map(Math.round)).toEqual([1800000, 2000000, 2200000]);
        expect(scen.central.margeOrigine).toBe('produits');
        expect(scen.prudent.margeOrigine).toBe('produits');
        expect(scen.haut.margeOrigine).toBe('produits');
        // Monotonie retablie: c est le point que la premiere ecriture cassait.
        expect(scen.prudent.pl).toBeLessThan(scen.central.pl);
        expect(scen.haut.pl).toBeGreaterThan(scen.central.pl);
    });

    test('sans callback, les trois scenarios gardent la proportion', () => {
        const postes = {
            total_avances: 0, commission_maas: 0, marge_cdc: 0,
            depenses_periode: 0, paiements_fournisseur: 0,
            stock_variation_nette: 0, taux_marge: 10
        };
        const scen = P.scenarios({
            postes, caRealise: 1000000, caProjete: 2000000,
            chargesMensuel: 0, stockOption: 'zero', depensesOption: 'realise',
            tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
        });
        ['prudent', 'central', 'haut'].forEach((k) => {
            expect(scen[k].margeOrigine).toBe('proportion');
        });
        expect(scen.prudent.pl).toBeLessThan(scen.central.pl);
        expect(scen.haut.pl).toBeGreaterThan(scen.central.pl);
    });
});

describe('CA aux derniers prix: la methode volumes x derniers prix', () => {
    // La regle demandee par le proprietaire du produit: le CA restant se
    // calcule en quantites estimees a vendre x dernier prix de vente. Le
    // parage n'y entre pas - il ne touche que le cout, via le diviseur de la
    // marge unitaire. L'identite qui doit en decouler, exactement:
    //   Sigma(qte restante x dernier PV) = CA projete - CA realise.

    test('caAuxDerniersPrix: Sigma(quantite x prix_moyen), sans besoin de cout', () => {
        const total = P.caAuxDerniersPrix([
            { nom: 'Boeuf', prix_moyen: 5400, quantite: 100 },
            { nom: 'Poulet', prix_moyen: 3500, quantite: 20 },
            // Sans prix de vente: ne compte pas - un CA sans prix n'existe pas.
            { nom: 'Mystere', prix_moyen: null, quantite: 50 },
            // Prix nul ou negatif: pareil.
            { nom: 'Gratuit', prix_moyen: 0, quantite: 10 }
        ]);
        expect(total).toBeCloseTo(5400 * 100 + 3500 * 20, 6);
    });

    test('caAuxDerniersPrix: vide ou absent rend zero', () => {
        expect(P.caAuxDerniersPrix([])).toBe(0);
        expect(P.caAuxDerniersPrix(null)).toBe(0);
    });

    const postes = {
        total_avances: 500000, commission_maas: 30000, marge_cdc: 0,
        depenses_periode: 0, paiements_fournisseur: 0,
        stock_variation_nette: 0, taux_marge: 10
    };
    const base = {
        postes, caRealise: 1000000, chargesMensuel: 0,
        stockOption: 'zero', depensesOption: 'realise',
        tauxCourant: { utilisable: true, taux: 0.20, marge_totale: 200000 }
    };

    test('avec caPleinDerniersPrix, la proportion est en VOLUME', () => {
        // Les prix ont monte: le mois-equivalent aux derniers prix vaut
        // 1 100 000 la ou le CA realise vaut 1 000 000. Un CA cible de
        // 1 550 000 contient donc 550 000 de suite aux prix nouveaux, soit
        // 550 000 / 1 100 000 = 0,5 de volume - pas 0,55.
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 1550000, caPleinDerniersPrix: 1100000
        }));
        expect(r.proportion).toBeCloseTo(0.5, 10);
        // Et la marge suit le volume: realise + 0,5 x marge_totale.
        expect(r.marge).toBeCloseTo(1000000 * 0.10 + 0.5 * 200000, 2);
    });

    test('l identite du proprietaire: caCible - caRealise = proportion x caPlein', () => {
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 1550000, caPleinDerniersPrix: 1100000
        }));
        expect(r.proportion * r.caPleinDerniersPrix)
            .toBeCloseTo(1550000 - 1000000, 6);
    });

    test('les postes volumetriques suivent le volume, pas le CA repricie', () => {
        // La commission se calcule sur le prix CATALOGUE des livraisons: une
        // hausse du prix de VENTE ne l'augmente pas. Facteur 1 + proportion
        // (1,5), pas r = caCible/caRealise (1,55).
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 1550000, caPleinDerniersPrix: 1100000
        }));
        expect(r.commission).toBeCloseTo(30000 * 1.5, 6);
        expect(r.avances).toBeCloseTo(500000 * 1.5, 6);
    });

    test('sans caPleinDerniersPrix, RIEN ne change: methode rythmes intacte', () => {
        const avec = P.projeterPL(Object.assign({}, base, { caCible: 1550000 }));
        // proportion legacy = (1 550 000 - 1 000 000) / 1 000 000 = 0,55
        expect(avec.proportion).toBeCloseTo(0.55, 10);
        expect(avec.caPleinDerniersPrix).toBeNull();
        expect(avec.commission).toBeCloseTo(30000 * 1.55, 6);
        expect(avec.marge).toBeCloseTo(1000000 * 0.10 + 0.55 * 200000, 2);
    });

    test('quand les prix n ont pas bouge, les deux methodes coincident', () => {
        // caPlein = caRealise: derniers prix = prix de la periode. La methode
        // volumes doit alors rendre exactement la methode rythmes.
        const rythmes = P.projeterPL(Object.assign({}, base, { caCible: 1550000 }));
        const volumes = P.projeterPL(Object.assign({}, base, {
            caCible: 1550000, caPleinDerniersPrix: 1000000
        }));
        expect(volumes.marge).toBeCloseTo(rythmes.marge, 6);
        expect(volumes.commission).toBeCloseTo(rythmes.commission, 6);
        expect(volumes.proportion).toBeCloseTo(rythmes.proportion, 10);
    });

    test('scenario sous le realise: plancher volume a zero, commission au realise', () => {
        const r = P.projeterPL(Object.assign({}, base, {
            caCible: 800000, caPleinDerniersPrix: 1100000
        }));
        expect(r.proportion).toBe(0);
        expect(r.marge).toBeCloseTo(100000, 2);       // le realise seul
        expect(r.commission).toBeCloseTo(30000, 6);    // rien de plus a livrer
    });

    test('scenarios() propage l assiette aux trois scenarios', () => {
        const scen = P.scenarios({
            postes, caRealise: 1000000, caProjete: 1550000,
            chargesMensuel: 0, stockOption: 'zero', depensesOption: 'realise',
            tauxCourant: base.tauxCourant, caPleinDerniersPrix: 1100000
        });
        expect(scen.central.caPleinDerniersPrix).toBe(1100000);
        expect(scen.prudent.caPleinDerniersPrix).toBe(1100000);
        expect(scen.haut.caPleinDerniersPrix).toBe(1100000);
        // Le prudent vise 0,9 x 1 550 000 = 1 395 000: proportion en volume
        // (1 395 000 - 1 000 000) / 1 100 000.
        expect(scen.prudent.proportion).toBeCloseTo(395000 / 1100000, 10);
    });
});

describe('tauxMargeCourant: la marge absolue, et non plus seulement le taux', () => {
    // marge_totale est desormais ce qui pilote la projection: le taux ne sert
    // plus qu'a l'affichage. Il doit donc etre rendu, et juste.
    const PRODUITS = [
        { nom: 'Boeuf en détail', quantite: 100, ca: 540000, prix_moyen: 5400 },
        { nom: 'Boeuf en gros', quantite: 50, ca: 255000, prix_moyen: 5100 }
    ];

    test('marge_totale vaut la somme des marges unitaires x quantites', () => {
        const margeDe = (p) => (p.nom === 'Boeuf en détail' ? 1000 : 800);
        const r = P.tauxMargeCourant({ produits: PRODUITS, margeDe });
        expect(r.marge_totale).toBeCloseTo(100 * 1000 + 50 * 800, 6);
    });

    test('un produit sans cout ne contribue PAS a marge_totale', () => {
        const margeDe = (p) => (p.nom === 'Boeuf en gros' ? null : 1000);
        const r = P.tauxMargeCourant({ produits: PRODUITS, margeDe });
        expect(r.marge_totale).toBeCloseTo(100 * 1000, 6);
        expect(r.sans_cout).toEqual(['Boeuf en gros']);
    });

    test('marge_totale et taux restent coherents entre eux', () => {
        const margeDe = () => 900;
        const r = P.tauxMargeCourant({ produits: PRODUITS, margeDe });
        // taux = marge_totale / CA aux derniers prix, par construction.
        expect(r.taux).toBeCloseTo(r.marge_totale / r.ca_derniers, 10);
    });
});
