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
        // 6 jours a 1 000 F, dont un dimanche ferme a 0. Compter le dimanche
        // divise par 6 au lieu de 5 et sous-estime le rythme de 17 %.
        const ca = {};
        P.joursEntre('2026-08-03', '2026-08-08').forEach((j) => { ca[j] = 1000; });
        const avec = P.rythmeParType(ca, '2026-08-02', '2026-08-08', false);
        const sans = P.rythmeParType(ca, '2026-08-02', '2026-08-08', true);
        expect(P.estDimanche('2026-08-02')).toBe(true);
        expect(avec.P1 !== null || avec.P2 !== null).toBe(true);
        // 6 jours vendus sur 7 calendaires contre 6 sur 6 ouvres.
        const joursAvec = avec.jours.P1 + avec.jours.P2;
        const joursSans = sans.jours.P1 + sans.jours.P2;
        expect(joursAvec).toBe(7);
        expect(joursSans).toBe(6);
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
