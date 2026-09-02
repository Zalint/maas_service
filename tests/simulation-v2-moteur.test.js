/**
 * Moteur de calcul de Simulation 2.0.
 *
 * Les fixtures sont les chiffres REELS de juillet 2026 (tenant mbao, copie de
 * production), pas des nombres ronds: un test sur des valeurs commodes rate
 * les erreurs d'arrondi et de ponderation que les vraies quantites exposent.
 *
 * Les valeurs attendues sont recalculees ICI par des expressions
 * independantes, jamais en appelant le moteur: un test qui compare le moteur
 * a lui-meme ne teste rien.
 *
 * @jest-environment node
 */

const M = require('../js/simulation-v2-moteur.js');

// Juillet 2026, tenant mbao.
const PM_DETAIL = 3981290 / 842.05;   // 4 728,09
const PM_GROS = 1391600 / 311;        // 4 474,60
const PRODUITS = [
    { nom: 'Boeuf en détail', quantite: 842.05, ca: 3981290, prix_moyen: PM_DETAIL, prix_achat: 3835 },
    { nom: 'Boeuf en gros', quantite: 311, ca: 1391600, prix_moyen: PM_GROS, prix_achat: 3835 },
    { nom: 'Poulet en détail', quantite: 104, ca: 347000, prix_moyen: 347000 / 104, prix_achat: 3000 },
    { nom: 'Poulet en gros', quantite: 35, ca: 122500, prix_moyen: 3500, prix_achat: 3000 },
    { nom: 'Agneau', quantite: 0, ca: 0, prix_moyen: null, prix_achat: 4500 }
];
// Prix de VENTE catalogue des carcasses: l'assiette de la commission MaaS.
const PV = { bovin: 4800, ovin: 5300, volaille: 3500 };
const CONTEXTE = {
    varBovin: 13480, varOvin: -6200, varAutre: 0,
    parageBase: 5, boeuf: { matin: 46, soir: 62 },
    commission: 194138.55, commissionPct: 3, pv: PV
};
const DONNEES = { produits: PRODUITS, contexte: CONTEXTE };
const QB = 842.05 + 311; // unites bovines vendues

const S = (leviers, globaux) => ({
    leviers: leviers || {},
    globaux: Object.assign(
        { charges: 0, dep: 0, com: 3, parBov: 5, parOvi: 5, dPa: 0 },
        globaux || {}
    )
});

describe('familles', () => {
    test('bovine par prefixe, veau compris, accents et casse ignores', () => {
        expect(M.estBoeuf({ nom: 'Boeuf en détail' })).toBe(true);
        expect(M.estBoeuf({ nom: 'VEAU EN GROS' })).toBe(true);
        expect(M.estBoeuf({ nom: 'Poulet en détail' })).toBe(false);
    });
    test('ovine: agneau et mouton, par PREFIXE comme la famille bovine', () => {
        expect(M.estOvin({ nom: 'Agneau' })).toBe(true);
        expect(M.estOvin({ nom: 'Mouton entier' })).toBe(true);
        // Limite assumee et identique a la regle bovine (Yell, Foie...):
        // une decoupe nommee sans le prefixe n'est pas rattachee.
        expect(M.estOvin({ nom: 'Patte de Mouton' })).toBe(false);
        expect(M.estOvin({ nom: 'Boeuf en gros' })).toBe(false);
    });
});

describe('marge nette de parage', () => {
    test('bovin: prix moyen − carcasse/(1−parage)', () => {
        const m = M.margeAvec(PRODUITS[0], S(), CONTEXTE);
        expect(m).toBeCloseTo(PM_DETAIL - 3835 / 0.95, 6);
        // ~691 F nets contre 893 F bruts: l'ecart n'est pas un detail.
        expect(m).toBeGreaterThan(690);
        expect(m).toBeLessThan(PM_DETAIL - 3835);
    });
    test('le prix d achat du scenario s applique a la famille bovine seulement', () => {
        const s = S({}, { dPa: -400 });
        expect(M.margeAvec(PRODUITS[0], s, CONTEXTE)).toBeCloseTo(PM_DETAIL - 3435 / 0.95, 6);
        expect(M.margeAvec(PRODUITS[2], s, CONTEXTE)).toBeCloseTo(347000 / 104 - 3000, 6);
    });
    test('le parage boeuf du scenario ne touche pas la volaille', () => {
        const m5 = M.margeAvec(PRODUITS[2], S({}, { parBov: 5 }), CONTEXTE);
        const m10 = M.margeAvec(PRODUITS[2], S({}, { parBov: 10 }), CONTEXTE);
        expect(m5).toBe(m10);
    });
    test('null quand un terme est inconnu ou le parage absurde, jamais zero', () => {
        expect(M.margeAvec(PRODUITS[4], S(), CONTEXTE)).toBeNull();           // prix_moyen null
        expect(M.margeAvec({ nom: 'Yell', prix_moyen: 3000, prix_achat: null }, S(), CONTEXTE)).toBeNull();
        expect(M.margeAvec(PRODUITS[0], S({}, { parBov: 100 }), CONTEXTE)).toBeNull();
    });
});

describe('leviers par produit', () => {
    test('scenario vide: effet strictement nul', () => {
        expect(M.effetTotal(DONNEES, S())).toBe(0);
    });
    test('prix +100 F sur le detail: 100 x 842,05, sans commission induite', () => {
        // Le levier PRIX ne change pas les quantites livrees: la commission
        // de ce PL est assise sur le prix catalogue fournisseur, pas sur le
        // prix de vente du tenant.
        const s = S({ 'Boeuf en détail': { prix: 100, unite: 'F', vol: 0 } });
        expect(M.effetTotal(DONNEES, s)).toBeCloseTo(84205, 6);
    });
    test('prix +10 %: un dixieme du chiffre d affaires', () => {
        const s = S({ 'Boeuf en détail': { prix: 10, unite: '%', vol: 0 } });
        expect(M.effetTotal(DONNEES, s)).toBeCloseTo(398129, 6);
    });
    test('volume +50: marge nette x 50, MOINS la commission sur la carcasse livree', () => {
        // Vendre 50 de plus fait livrer 50/0,95 de carcasse, commissionnee a
        // 3 % du prix catalogue (4 800). L'oublier surestimait le levier
        // volume d'environ 20 %.
        const s = S({ 'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 } });
        const attendu = (PM_DETAIL - 3835 / 0.95) * 50 - 0.03 * 4800 * (50 / 0.95);
        expect(M.effetTotal(DONNEES, s)).toBeCloseTo(attendu, 6);
    });
    test('prix et volume ensemble: le terme croise est compte', () => {
        const s = S({ 'Boeuf en détail': { prix: 100, unite: 'F', vol: 50 } });
        const attendu = 84205 + (PM_DETAIL - 3835 / 0.95) * 50 + 100 * 50
            - 0.03 * 4800 * (50 / 0.95);
        expect(M.effetTotal(DONNEES, s)).toBeCloseTo(attendu, 6);
    });
    test('volume sur un produit a marge inconnue: levier INERTE, commission comprise', () => {
        // Ni effet volume (marge inconnue), ni commission induite: facturer
        // la livraison d'une vente qu'on refuse de chiffrer serait pire.
        const s = S({ 'Agneau': { prix: 0, unite: 'F', vol: 100 } });
        expect(M.effetTotal(DONNEES, s)).toBe(0);
    });
});

describe('taux de parage: le cout des ventes est le canal dominant', () => {
    // "un taux de parage a 10 % doit avoir beaucoup de perte" - constat
    // utilisateur, exact. La version qui ne comptait que le stock rendait
    // -674 F; le cout des ventes en rend ~-258 600.
    const coutVentes = (taux) => -(QB * (3835 / (1 - taux / 100) - 3835 / 0.95));

    test('10 % de parage: environ -259 000 sur pab, pas -674', () => {
        const g = M.effetsGlobaux(DONNEES, S({}, { parBov: 10 }));
        expect(g.det.cvParageB).toBeCloseTo(coutVentes(10), 4);
        expect(g.det.stB).toBeCloseTo(-(5 / 100) * 13480, 6);
        expect(g.pab).toBeCloseTo(coutVentes(10) - 674, 4);
        expect(g.pab).toBeLessThan(-250000);
    });
    test('10 % de parage: la carcasse supplementaire est aussi commissionnee', () => {
        // 67,4 u de carcasse livree en plus, a 3 % du prix catalogue.
        const g = M.effetsGlobaux(DONNEES, S({}, { parBov: 10 }));
        const addB = QB * (1 / 0.90 - 1 / 0.95);
        expect(g.det.addB).toBeCloseTo(addB, 6);
        expect(g.det.coInduite).toBeCloseTo(-0.03 * 4800 * addB, 4);
        expect(g.co).toBeCloseTo(-0.03 * 4800 * addB, 4);
    });
    test('0 % de parage: une economie massive, symetrique', () => {
        const g = M.effetsGlobaux(DONNEES, S({}, { parBov: 0 }));
        expect(g.pab).toBeCloseTo(coutVentes(0) + 674, 4);
        expect(g.pab).toBeGreaterThan(230000);
    });
    test('agneau sans vente: seul le stock joue, et son signe surprend', () => {
        // varOvin est NEGATIF en juillet: augmenter le parage agneau AMELIORE
        // le resultat. C'est contre-intuitif et c'est correct.
        const g = M.effetsGlobaux(DONNEES, S({}, { parOvi: 8 }));
        expect(g.det.cvParageO).toBe(0); // 0 unite ovine vendue
        expect(g.pao).toBeCloseTo(-(3 / 100) * -6200, 6);
        expect(g.pao).toBeGreaterThan(0);
    });
    test('au taux de base, effet strictement nul', () => {
        const g = M.effetsGlobaux(DONNEES, S({}, { parBov: 5, parOvi: 5 }));
        expect(g.pab).toBe(0);
        expect(g.pao).toBe(0);
        expect(g.co).toBe(0);
    });
});

describe('prix d achat du boeuf: toutes les unites vendues, pas le seul stock', () => {
    test('-400 F: l economie porte sur la carcasse des ventes, via 1/(1-parage)', () => {
        const g = M.effetsGlobaux(DONNEES, S({}, { dPa: -400 }));
        expect(g.det.cvDPa).toBeCloseTo(QB * 400 / 0.95, 4);
        // Stock NET (hypothese "niveau de prix"): le surplus de 16 u est
        // achete 400 F moins cher ET revalorise a 95 % - net 5 % de l'ecart.
        expect(g.det.stPa).toBeCloseTo(400 * 16 * 0.05, 6);
        expect(g.pb).toBeCloseTo(QB * 400 / 0.95 + 320, 4);
    });
    test('prix bovin INCONNU: le levier garde son signe et son ordre de grandeur', () => {
        // Regression jugee majeure par la revue: cvDPa exigeait le prix de
        // base et tombait a 0, ne laissant que l'effet stock - le levier
        // affichait -6 080 pour une economie reelle de +485 000. Or
        // (pa+d)/x - pa/x = d/x: le prix de base n'est pas necessaire.
        const sansPa = {
            produits: PRODUITS.map((p) => M.estBoeuf(p) ? Object.assign({}, p, { prix_achat: null }) : p),
            contexte: CONTEXTE
        };
        const g = M.effetsGlobaux(sansPa, S({}, { dPa: -400 }));
        expect(g.det.cvDPa).toBeCloseTo(QB * 400 / 0.95, 4);
        expect(g.pb).toBeGreaterThan(400000);
    });
    test('le scenario de l utilisateur: vol +30 % et dPa -400 rend le PL positif', () => {
        const vol = 842.05 * 0.30;
        const s = S({ 'Boeuf en détail': { prix: 0, unite: 'F', vol: vol } }, { dPa: -400 });
        const margeEff = PM_DETAIL - 3435 / 0.95;
        const attendu = QB * 400 / 0.95 + 320 + margeEff * vol
            - 0.03 * 4800 * (vol / 0.95);
        const total = M.effetTotal(DONNEES, s);
        expect(total).toBeCloseTo(attendu, 4);
        // PL de reference -379 568,55: le scenario le rend largement positif.
        expect(-379568.55 + total).toBeGreaterThan(300000);
    });
    test('l attribution parage/prix ne compte rien deux fois', () => {
        // pab + pb doit valoir la variation totale du cout des ventes plus
        // les deux effets stock, recalcules ici INDEPENDAMMENT.
        const g = M.effetsGlobaux(DONNEES, S({}, { parBov: 10, dPa: -400 }));
        const coutTotal = QB * ((3835 - 400) / 0.90 - 3835 / 0.95);
        const stB = -(5 / 100) * 13480;
        const stPa = 400 * 16 * 0.10; // au parage du SCENARIO, pas de base
        expect(g.pab + g.pb).toBeCloseTo(-coutTotal + stB + stPa, 4);
    });
    test('la revalorisation du stock suit le parage du scenario', () => {
        // Mutation ciblee par la revue: stPa lisant le taux de BASE au lieu
        // de celui du scenario ne faisait rougir aucun test.
        const g = M.effetsGlobaux(DONNEES, S({}, { parBov: 12, dPa: -400 }));
        expect(g.det.stPa).toBeCloseTo(400 * 16 * 0.12, 6);
    });
});

describe('famille ovine avec des ventes: les branches que juillet laissait mortes', () => {
    // La revue a montre que qO = 0 dans les fixtures laissait cvParageO et la
    // marge ovine sans AUCUNE contrainte: deux mutations survivaient.
    const AGNEAU = { nom: 'Agneau', quantite: 40, ca: 212000, prix_moyen: 5300, prix_achat: 4500 };
    const D2 = { produits: PRODUITS.map((p) => M.estOvin(p) ? AGNEAU : p), contexte: CONTEXTE };

    test('marge ovine nette du parage OVIN du scenario', () => {
        const m = M.margeAvec(AGNEAU, S({}, { parOvi: 8 }), CONTEXTE);
        expect(m).toBeCloseTo(5300 - 4500 / 0.92, 6);
    });
    test('le parage agneau paie la carcasse ovine des ventes', () => {
        const g = M.effetsGlobaux(D2, S({}, { parOvi: 8 }));
        expect(g.det.cvParageO).toBeCloseTo(-(40 * 4500 / 0.92 - 40 * 4500 / 0.95), 4);
        expect(g.pao).toBeCloseTo(g.det.cvParageO + -(3 / 100) * -6200, 4);
    });
    test('un volume agneau est commissionne au prix catalogue ovin', () => {
        const s = S({ 'Agneau': { prix: 0, unite: 'F', vol: 10 } });
        const g = M.effetsGlobaux(D2, s);
        expect(g.det.addO).toBeCloseTo(10 / 0.95, 6);
        expect(g.det.coInduite).toBeCloseTo(-0.03 * 5300 * (10 / 0.95), 4);
    });
});

describe('leviers simples', () => {
    test('commission: le changement de taux est mis a l echelle du montant reel', () => {
        const g = M.effetsGlobaux(DONNEES, S({}, { com: 4 }));
        expect(g.det.coTaux).toBeCloseTo(-(194138.55 * (4 / 3 - 1)), 6);
        expect(g.co).toBeCloseTo(g.det.coTaux, 6);
    });
    test('charges et depenses: franc pour franc, en moins', () => {
        const g = M.effetsGlobaux(DONNEES, S({}, { charges: 50000, dep: 20000 }));
        expect(g.ch).toBe(-50000);
        expect(g.dp).toBe(-20000);
    });
    test('prix catalogue inconnu: la commission induite reste non chiffree, et nommee', () => {
        const sansPv = { produits: PRODUITS, contexte: Object.assign({}, CONTEXTE, { pv: {} }) };
        const s = S({ 'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 } });
        const g = M.effetsGlobaux(sansPv, s);
        expect(g.det.coInduite).toBe(0);
        expect(g.det.pvManquants).toContain('bovin');
        const ex = M.expliquer(sansPv, s);
        const ligne = ex.lignes.filter((l) => /part non chiffrée/.test(l.libelle))[0];
        expect(ligne.formule).toMatch(/prix catalogue inconnu/);
        expect(ligne.valeur).toBe(0);
    });

    test('cas MIXTE: une espece chiffree et une autre non, les deux sont dites', () => {
        // Le defaut corrige: la condition !coInduite taisait l'avertissement
        // des qu'UNE espece avait son prix catalogue. L'ecran annoncait alors
        // une commission induite « au prix catalogue » en omettant en silence
        // la part de l'autre espece.
        // L'Agneau des fixtures ne se vend pas: sans quantite ovine, le levier
        // de parage n'induit aucune livraison ovine et le cas mixte ne peut
        // pas se produire. On lui donne donc un volume vendu.
        const mixte = {
            produits: PRODUITS.map((p) => (p.nom === 'Agneau'
                ? { nom: 'Agneau', quantite: 200, ca: 1060000, prix_moyen: 5300, prix_achat: 4500 }
                : p)),
            contexte: Object.assign({}, CONTEXTE, { pv: { bovin: 4800 } }) // ovin ABSENT
        };
        const s = S(
            { 'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 } },
            { parBov: 10, parOvi: 10 }
        );
        const g = M.effetsGlobaux(mixte, s);
        // Les deux etats coexistent: c'est toute la question.
        expect(g.det.coInduite).not.toBe(0);
        expect(g.det.pvManquants).toContain('ovin');

        const ex = M.expliquer(mixte, s);
        const chiffree = ex.lignes.filter((l) => l.libelle === 'Commission · achats induits');
        const manquante = ex.lignes.filter((l) => /part non chiffrée/.test(l.libelle));
        expect(chiffree).toHaveLength(1);
        expect(manquante).toHaveLength(1);
        expect(manquante[0].valeur).toBe(0);
        // La ligne d'avertissement vaut zero: le bouclage doit tenir.
        expect(ex.controle.ok).toBe(true);
    });

    test('un scenario sans taux de commission decrit un taux INCHANGE', () => {
        // globaux vide: nb(undefined) valait 0, donc coTaux rendait
        // -(commission x (0/3 - 1)) = +commission, soit un gain fantome de
        // +194 139 F sur ces fixtures. Atteignable depuis l'ecran par le
        // bouton Reinitialiser.
        expect(M.effetTotal(DONNEES, { leviers: {}, globaux: {} })).toBe(0);
        expect(M.effetsGlobaux(DONNEES, { leviers: {}, globaux: {} }).co).toBe(0);
        // Et la formule affichee ne doit pas imprimer « undefined ».
        const ex = M.expliquer(DONNEES, { leviers: {}, globaux: {} });
        expect(JSON.stringify(ex.lignes)).not.toMatch(/undefined/);
        // Le meme scenario, taux ecrit explicitement, donne le meme resultat.
        expect(M.effetTotal(DONNEES, S({}, {}))).toBe(0);
    });
});

describe('expliquer: ce qui est montre est ce qui est calcule', () => {
    test('le bouclage tient sur un scenario composite', () => {
        const s = S({
            'Boeuf en détail': { prix: 150, unite: 'F', vol: 80 },
            'Poulet en détail': { prix: 5, unite: '%', vol: 20 }
        }, { charges: 100000, dep: 15000, com: 4.5, parBov: 8, parOvi: 3, dPa: -250 });
        const ex = M.expliquer(DONNEES, s);
        expect(ex.controle.ok).toBe(true);
        expect(ex.total).toBeCloseTo(M.effetTotal(DONNEES, s), 9);
        ex.lignes.forEach((l) => {
            expect(l.libelle.length).toBeGreaterThan(0);
            expect(l.formule.length).toBeGreaterThan(0);
            expect(typeof l.valeur).toBe('number');
        });
    });
    test('scenario vide: aucune ligne, total nul, bouclage vrai', () => {
        const ex = M.expliquer(DONNEES, S());
        expect(ex.lignes).toHaveLength(0);
        expect(ex.total).toBe(0);
        expect(ex.controle.ok).toBe(true);
    });
    test('les canaux apparaissent en lignes distinctes, formules en toutes lettres', () => {
        const ex = M.expliquer(DONNEES, S({ 'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 } }, { parBov: 10 }));
        const libs = ex.lignes.map((l) => l.libelle);
        expect(libs).toContain('Parage bœuf · coût des ventes');
        expect(libs).toContain('Parage bœuf · stock');
        expect(libs).toContain('Commission · achats induits');
        // La formule du parage montre la carcasse aux deux taux, pas une
        // notation compacte qui a deja du etre expliquee.
        const parage = ex.lignes.filter((l) => l.libelle === 'Parage bœuf · coût des ventes')[0];
        expect(parage.formule).toMatch(/carcasse pour/);
        // Le separateur de milliers de fr-FR est une espace insecable etroite
        // (U+202F) sous Node: le test accepte toute espace entre 1 et 153.
        expect(parage.formule).toMatch(/1[\s  ]153/);
    });
});

describe('parage MESURE par espece, a la place du parametre fixe', () => {
    // Le diviseur de la marge utilisait stock_pertes_decoupe_pct, fige a 5 %
    // chez tous les tenants. Le parage reellement mesure change le SIGNE du
    // resultat, donc la conclusion qu'on en tire.
    const boeuf = { nom: 'Boeuf en détail', prix_moyen: 5400, prix_achat: 4520, quantite: 23.5, ca: 126900 };
    const agneau = { nom: 'Agneau', prix_moyen: 6000, prix_achat: 4500, quantite: 5.25, ca: 31500 };
    const vide = { leviers: {}, globaux: {} };

    test('le taux mesure de l espece prime sur le parametre', () => {
        const ctx = { parageBase: 5, parageBovin: 17.5, parageOvin: 3 };
        // 5400 − 4520/0,825 = −79 : la marge devient NEGATIVE.
        expect(Math.round(M.margeAvec(boeuf, vide, ctx))).toBe(-79);
        // 6000 − 4500/0,97 = 1361, et non 1263 comme a 5 %.
        expect(Math.round(M.margeAvec(agneau, vide, ctx))).toBe(1361);
    });

    test('bovin et ovin ont chacun LEUR taux', () => {
        const ctx = { parageBase: 5, parageBovin: 20, parageOvin: 0 };
        expect(M.diviseurParage(boeuf, vide, ctx)).toBeCloseTo(0.80, 6);
        expect(M.diviseurParage(agneau, vide, ctx)).toBeCloseTo(1, 6);
    });

    test('sans taux mesure, le parametre reprend la main', () => {
        // Un mois dont aucune journee n'est mesurable ne doit rien changer au
        // comportement d'avant.
        const avant = M.margeAvec(boeuf, vide, { parageBase: 5 });
        for (const ctx of [
            { parageBase: 5 },
            { parageBase: 5, parageBovin: null, parageOvin: null },
            { parageBase: 5, parageBovin: undefined }
        ]) {
            expect(M.margeAvec(boeuf, vide, ctx)).toBeCloseTo(avant, 6);
        }
        expect(Math.round(avant)).toBe(642);
    });

    test('la volaille reste hors parage', () => {
        const poulet = { nom: 'Poulet en détail', prix_moyen: 3500, prix_achat: 3000 };
        const ctx = { parageBase: 5, parageBovin: 17.5, parageOvin: 3 };
        expect(M.diviseurParage(poulet, vide, ctx)).toBe(1);
        expect(M.margeAvec(poulet, vide, ctx)).toBe(500);
    });

    test('AUCUN effet de parage sur un scenario pose au taux mesure', () => {
        // L'invariant qui justifie d'avoir separe la reference par espece:
        // si le defaut des leviers bougeait sans que la reference du moteur
        // bouge avec lui, l'ecran aurait affiche un effet de parage sur un
        // scenario que personne n'a touche - le meme fantome que la
        // commission a deja produit ici.
        const ctx = {
            parageBase: 5, parageBovin: 17.5, parageOvin: 3,
            commission: 1000, commissionPct: 3, varBovin: 5000, varOvin: 100,
            boeuf: { matin: 1, soir: 2 }, pv: { bovin: 4800, ovin: 5300 }
        };
        const auRepos = { leviers: {}, globaux: { charges: 0, dep: 0, com: 3, parBov: 17.5, parOvi: 3, dPa: 0 } };
        const e = M.effetsGlobaux({ produits: [boeuf, agneau], contexte: ctx }, auRepos);
        expect(e.pab).toBe(0);
        expect(e.pao).toBe(0);
        expect(e.total).toBe(0);
    });

    test('un levier de parage se mesure DEPUIS le taux mesure', () => {
        const ctx = {
            parageBase: 5, parageBovin: 20, parageOvin: 5,
            commission: 0, commissionPct: 0, varBovin: 0, varOvin: 0,
            boeuf: { matin: 0, soir: 0 }, pv: {}
        };
        // Ramener le parage bovin de 20 % a 15 % doit RAPPORTER: la carcasse
        // necessaire aux memes ventes coute moins cher.
        const s = { leviers: {}, globaux: { charges: 0, dep: 0, com: 0, parBov: 15, parOvi: 5, dPa: 0 } };
        const e = M.effetsGlobaux({ produits: [boeuf], contexte: ctx }, s);
        expect(e.pab).toBeGreaterThan(0);
        // Et le detail expose la reference par espece, pas le parametre.
        expect(e.det.parageRefB).toBe(20);
        expect(e.det.parageRefO).toBe(5);
    });
});

describe('la volaille se NOMME, elle n est pas le reste du monde', () => {
    // L'assiette de la commission disait « bovin, sinon ovin, sinon VOLAILLE ».
    // Ce `else` rangeait d'office dans le poulet tout ce qu'il ne reconnaissait
    // pas: le Laxass, vendu 200 F, se voyait commissionne sur les 3 500 F de la
    // carcasse de poulet - 105 F l'unite - et ressortait a -62 F de marge nette
    // quand il en gagne 37. Un produit declare a perte, c'est un produit qu'on
    // arrete.
    test.each([
        ['Poulet en détail', true], ['Poulet en gros', true], ['Volaille', true],
        ['Laxass', false], ['Foie', false], ['Cuisse de poulet', false],
        ['Boeuf en détail', false], ['Agneau', false], ['Dorade', false]
    ])('%s -> volaille: %s', (nom, attendu) => {
        expect(M.estVolaille({ nom })).toBe(attendu);
    });

    test('les trois familles restent exclusives', () => {
        for (const nom of ['Boeuf en détail', 'Veau', 'Agneau', 'Mouton', 'Poulet en gros']) {
            const p = { nom };
            const n = [M.estBoeuf(p), M.estOvin(p), M.estVolaille(p)].filter(Boolean).length;
            expect(n).toBe(1);
        }
    });

    test('l assiette rend le prix ET la ligne de catalogue qui le porte', () => {
        // Les deux ensemble, parce que c'est sur CETTE ligne que se pose la
        // question « son prix contient-il deja la commission ? ». Les resoudre
        // separement laisserait le montant venir d'une ligne et la reponse
        // d'une autre.
        const ctx = { pv: { bovin: 4800, ovin: 5300, volaille: 3500, par_produit: { laxass: 200 } } };
        expect(M.assietteCommission({ nom: 'Boeuf en détail' }, ctx))
            .toEqual({ prix: 4800, cle: 'boeuf' });
        expect(M.assietteCommission({ nom: 'Agneau' }, ctx))
            .toEqual({ prix: 5300, cle: 'agneau' });
        expect(M.assietteCommission({ nom: 'Poulet en gros' }, ctx))
            .toEqual({ prix: 3500, cle: 'poulet' });
        // Sa PROPRE ligne prime sur la carcasse de l'espece.
        expect(M.assietteCommission({ nom: 'Laxass' }, ctx))
            .toEqual({ prix: 200, cle: 'laxass' });
        // Hors catalogue: rien, et surtout pas le repli volaille d'autrefois.
        expect(M.assietteCommission({ nom: 'Dorade' }, ctx))
            .toEqual({ prix: null, cle: null });
    });

    test('normaliserNom est expose et accorde avec le serveur', () => {
        // Le client cherche le prix catalogue par nom normalise; une
        // normalisation divergente ferait echouer le lookup en silence et
        // ramenerait le repli par famille.
        const { normaliserNom } = require('../lib/parage');
        for (const nom of ['Laxass', 'Déchet 400', 'Cuisse de poulet', 'Boeuf']) {
            expect(M.normaliserNom(nom)).toBe(normaliserNom(nom));
        }
    });
});

describe('commission integree: le prix d achat la porte deja', () => {
    // Le reglage « commission integree » (lib/commission-integree.js) dit
    // quels produits sont ACHETES commission comprise. Le serveur cesse alors
    // de la facturer sur leurs livraisons; ce moteur, qui la REDERIVE par
    // produit a partir du prix catalogue, doit cesser aussi - sinon la
    // simulation et le PL disent deux choses du meme mois.
    // Les taux PAR ESPECE, comme preparer() et construireContexte() les
    // posent toujours: c'est le contexte reel, et le seul ou la commission
    // par unite se divise par le meme parage que la marge.
    const CTX = Object.assign({}, CONTEXTE, { parageBovin: 5, parageOvin: 5 });
    const CI = (ci) => Object.assign({}, CTX, { commissionIntegree: ci });
    const BOEUF = PRODUITS[0];
    // Les entrees du catalogue reellement en jeu dans ce bloc. Il n'y a plus
    // de « tous »: DATA nomme les produits dont le prix porte la commission,
    // et un produit absent de la liste la paie.
    const TOUT_INTEGRE = { disponible: true, produits: ['Boeuf', 'Boeuf en détail', 'Agneau'] };
    const SAUF_BOEUF = { disponible: true, produits: ['Agneau'] };
    const parageNet = PM_DETAIL - 3835 / 0.95;      // marge nette de parage
    const ponction = 0.03 * 4800 / 0.95;            // commission par unite

    describe('la reponse, entree de catalogue par entree de catalogue', () => {
        test('contexte muet: PERSONNE n est integre, comportement inchange', () => {
            // Un champ absent veut dire « payload d'avant », pas « tout est
            // integre »: supposer l'inverse effacerait la commission de toutes
            // les marges d'un coup, sur la foi d'une absence.
            expect(M.commissionIntegree('boeuf', {})).toBe(false);
            expect(M.commissionIntegree('boeuf', { commissionIntegree: null })).toBe(false);
            expect(M.commissionIntegree('boeuf', undefined)).toBe(false);
        });
        test('DATA muet (disponible faux): personne n est integre', () => {
            // On ne sait pas, et le serveur a facture partout dans ce cas-la:
            // la simulation doit deduire la commission comme lui.
            const c = { commissionIntegree: { disponible: false, produits: ['Boeuf'] } };
            expect(M.commissionIntegree('boeuf', c)).toBe(false);
        });
        test('liste explicite: seules les entrees citees', () => {
            const c = { commissionIntegree: { disponible: true, produits: ['Boeuf'] } };
            expect(M.commissionIntegree('boeuf', c)).toBe(true);
            expect(M.commissionIntegree('agneau', c)).toBe(false);
        });
        test('la comparaison ignore accents et casse, comme le serveur', () => {
            const c = { commissionIntegree: { disponible: true, produits: ['Viande Hachée'] } };
            expect(M.commissionIntegree('viande hachee', c)).toBe(true);
        });
        test('L EXCEPTION BŒUF: absent de la liste, il PAIE', () => {
            // Case « Prix API (DATA) » cochee mais DATA muet pour la periode:
            // le prix reellement utilise est celui du CATALOGUE, qui ne porte
            // pas la commission - elle reste donc due. C'est le serveur qui
            // tranche, et il l'ecrit en n'inscrivant pas le boeuf ici.
            const c = { commissionIntegree: { disponible: true, produits: ['Agneau'] } };
            expect(M.commissionIntegree('boeuf', c)).toBe(false);
            expect(M.commissionIntegree('agneau', c)).toBe(true);
        });
    });

    describe('marge apres commission', () => {
        test('non integre: la ponction est deduite, au diviseur de l espece', () => {
            expect(M.margeApresCommission(BOEUF, CTX)).toBeCloseTo(parageNet - ponction, 6);
        });
        test('integre: la marge nette de parage, SANS seconde ponction', () => {
            const m = M.margeApresCommission(BOEUF, CI(TOUT_INTEGRE));
            expect(m).toBeCloseTo(parageNet, 6);
            // L'ecart vaut exactement la commission qu'on ne compte plus.
            expect(m - M.margeApresCommission(BOEUF, CTX)).toBeCloseTo(ponction, 6);
        });
        test('l exception bœuf remet la ponction, et sur le bœuf seul', () => {
            const c = CI(SAUF_BOEUF);
            expect(M.margeApresCommission(BOEUF, c)).toBeCloseTo(parageNet - ponction, 6);
            // L'agneau, lui, reste integre: pas de ponction sur sa marge.
            const agneau = { nom: 'Agneau', prix_moyen: 5300, prix_achat: 4500 };
            expect(M.margeApresCommission(agneau, c)).toBeCloseTo(5300 - 4500 / 0.95, 6);
        });
        test('marge inconnue et prix catalogue inconnu: inchanges', () => {
            expect(M.margeApresCommission(PRODUITS[4], CONTEXTE)).toBeNull();
            const sansPv = Object.assign({}, CTX, { pv: {} });
            expect(M.margeApresCommission(BOEUF, sansPv)).toBeCloseTo(parageNet, 6);
        });
        test('SANS scenario: le panneau des leviers ne deplace pas ces marges', () => {
            // Recommandations et plan d'equilibre decrivent la realite du
            // moment, pas l'hypothese en cours de test. La fonction ne prend
            // donc pas de scenario: le verrouiller ici dit que c'est un choix.
            expect(M.margeApresCommission.length).toBe(2);
        });
    });

    describe('commission INDUITE par un levier', () => {
        test('bovin integre: un levier volume bœuf n induit plus rien', () => {
            const s = S({ 'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 } });
            const d = { produits: PRODUITS, contexte: CI(TOUT_INTEGRE) };
            const g = M.effetsGlobaux(d, s);
            expect(g.det.addB).toBeCloseTo(50 / 0.95, 6);  // la livraison a bien lieu
            expect(g.det.assiette).toBe(0);                // mais elle est deja payee
            expect(g.det.coInduite).toBe(0);
            expect(g.det.famillesIntegrees).toEqual(['bovin']);
            // Zero DIT, pas zero confondu avec un prix catalogue manquant.
            expect(g.det.pvManquants).toEqual([]);
            // Et l'effet total tombe a la marge nette de parage, sans ponction.
            expect(M.effetTotal(d, s)).toBeCloseTo(parageNet * 50, 6);
        });
        test('l exception bœuf: le levier redevient commissionne', () => {
            const s = S({ 'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 } });
            const d = { produits: PRODUITS, contexte: CI(SAUF_BOEUF) };
            const g = M.effetsGlobaux(d, s);
            expect(g.det.coInduite).toBeCloseTo(-0.03 * 4800 * (50 / 0.95), 4);
            expect(g.det.famillesIntegrees).toEqual([]);
        });
        test('un levier de PARAGE bovin n induit plus de commission non plus', () => {
            // Parer plus fait livrer plus de carcasse; si cette carcasse est
            // achetee commission comprise, il n'y a rien a refacturer dessus.
            const d = { produits: PRODUITS, contexte: CI(TOUT_INTEGRE) };
            const g = M.effetsGlobaux(d, S({}, { parBov: 10 }));
            expect(g.det.addB).toBeCloseTo(QB * (1 / 0.90 - 1 / 0.95), 6);
            expect(g.det.coInduite).toBe(0);
            // Le cout des ventes du parage, lui, ne bouge pas: il vit dans le
            // prix d'achat, pas dans la commission.
            expect(g.det.cvParageB).toBeCloseTo(-(QB * (3835 / 0.90 - 3835 / 0.95)), 4);
        });
        test('le levier de TAUX de commission reste intact', () => {
            // coTaux part de commission_maas, deja corrige par le serveur:
            // le rederiver ici le corrigerait une seconde fois.
            const d = { produits: PRODUITS, contexte: CI(TOUT_INTEGRE) };
            const g = M.effetsGlobaux(d, S({}, { com: 4 }));
            expect(g.det.coTaux).toBeCloseTo(-(194138.55 * (4 / 3 - 1)), 6);
        });
        test('familles MELANGEES: chacune suit SA ligne de catalogue', () => {
            const AGNEAU = { nom: 'Agneau', quantite: 200, ca: 1060000, prix_moyen: 5300, prix_achat: 4500 };
            const d = {
                produits: PRODUITS.map((p) => (p.nom === 'Agneau' ? AGNEAU : p)),
                contexte: CI({ disponible: true, produits: ['Boeuf'] })
            };
            const s = S({
                'Boeuf en détail': { prix: 0, unite: 'F', vol: 50 },
                'Agneau': { prix: 0, unite: 'F', vol: 10 }
            });
            const g = M.effetsGlobaux(d, s);
            // Seul l'ovin alimente l'assiette.
            expect(g.det.assiette).toBeCloseTo(5300 * (10 / 0.95), 6);
            expect(g.det.famillesIntegrees).toEqual(['bovin']);
        });
    });

    describe('expliquer: le zero est DIT', () => {
        const d = { produits: PRODUITS, contexte: CI(TOUT_INTEGRE) };
        const s = S({ 'Boeuf en détail': { prix: 120, unite: 'F', vol: 50 } }, { parBov: 8, dPa: -250 });

        test('une ligne nomme les familles deja commissionnees a l achat', () => {
            const ex = M.expliquer(d, s);
            const l = ex.lignes.filter((x) => /déjà dans le prix/.test(x.libelle))[0];
            expect(l).toBeDefined();
            expect(l.formule).toMatch(/bovin/);
            expect(l.valeur).toBe(0);
            // Et surtout PAS la ligne « part non chiffrée »: les deux zeros ne
            // se lisent pas pareil, l'un est un renoncement, l'autre un fait.
            expect(ex.lignes.filter((x) => /part non chiffrée/.test(x.libelle))).toHaveLength(0);
        });
        test('le bouclage tient: la ligne informative vaut zero', () => {
            const ex = M.expliquer(d, s);
            expect(ex.controle.ok).toBe(true);
            expect(ex.total).toBeCloseTo(M.effetTotal(d, s), 9);
        });
    });
});
