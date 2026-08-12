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
