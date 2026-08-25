/**
 * @jest-environment node
 *
 * Le cash theorique du mois, et le rapprochement depot Mata / remboursement.
 *
 * Le point delicat est le rapprochement. L'argent depose chez Mata sort de la
 * caisse ET revient presque toujours cote partenaire comme remboursement: le
 * soustraire des deux cotes creuserait un trou qui n'existe pas. Mesure sur
 * aout 2026 a Mbao: les huit depots retrouves le sont TOUS au lendemain,
 * jamais le jour meme - le decalage d'un jour est la regle, pas l'exception.
 *
 * Deux facons de ne pas retrouver un depot, qu'il ne faut pas confondre:
 *   - FRANC     : aucun versement du meme montant dans la fenetre;
 *   - DISPUTE   : le versement existait mais un autre depot du meme montant
 *                 l'a pris avant. Le montant est alors peut-etre soustrait a
 *                 tort, et l'ecran doit pouvoir le dire.
 */

const { apparierDepots, construireCashTheorique } = require('../lib/cash-theorique');

const d = (date, montant) => ({ date, montant });

describe('rapprochement depot / remboursement', () => {
    test('le lendemain prime sur le jour meme', () => {
        // Deux candidats possibles: le meme jour et le lendemain. C'est le
        // lendemain qui doit gagner, parce que c'est ce que disent les donnees.
        const r = apparierDepots(
            [d('2026-08-10', 200000)],
            [d('2026-08-10', 200000), d('2026-08-11', 200000)]
        );
        expect(r.appariements[0].decalage).toBe(1);
        expect(r.appariements[0].date_remboursement).toBe('2026-08-11');
        // Deux versements libres du meme montant dans la fenetre: le choix
        // etait arbitraire, et cela doit se voir.
        expect(r.appariements[0].ambigu).toBe(true);
    });

    test('le jour meme et la veille restent acceptes', () => {
        expect(apparierDepots([d('2026-08-10', 5000)], [d('2026-08-10', 5000)])
            .appariements[0].decalage).toBe(0);
        expect(apparierDepots([d('2026-08-10', 5000)], [d('2026-08-09', 5000)])
            .appariements[0].decalage).toBe(-1);
    });

    test('au-dela de la tolerance, rien n est apparie', () => {
        const r = apparierDepots([d('2026-08-08', 150000)], [d('2026-08-10', 150000)]);
        expect(r.nb_apparies).toBe(0);
        expect(r.total_non_apparie).toBe(150000);
        // Aucun versement dans la fenetre: orphelin FRANC, pas dispute.
        expect(r.appariements[0].dispute).toBe(false);
    });

    test('un montant different ne s apparie jamais, meme le bon jour', () => {
        const r = apparierDepots([d('2026-08-10', 200000)], [d('2026-08-11', 199999)]);
        expect(r.nb_apparies).toBe(0);
    });

    test('un remboursement ne sert qu une fois', () => {
        // Deux depots de 200 000 les 10 et 11, UN seul versement le 11.
        const r = apparierDepots(
            [d('2026-08-10', 200000), d('2026-08-11', 200000)],
            [d('2026-08-11', 200000)]
        );
        expect(r.nb_apparies).toBe(1);
        expect(r.total_non_apparie).toBe(200000);
    });

    test('un orphelin par CONTENTION se distingue d un orphelin franc', () => {
        const r = apparierDepots(
            [d('2026-08-10', 200000), d('2026-08-11', 200000)],
            [d('2026-08-11', 200000)]
        );
        const perdant = r.appariements.find((a) => !a.apparie);
        // Le versement existait dans sa fenetre: c'est une dispute, pas une
        // absence. Le confondre ferait passer un conflit pour un manque.
        expect(perdant.dispute).toBe(true);
        expect(r.nb_disputes).toBe(1);
    });

    test('les remboursements sans depot sont comptes, pas ignores', () => {
        // Tout ne passe pas par la caisse: virement, versement direct.
        const r = apparierDepots(
            [d('2026-08-10', 200000)],
            [d('2026-08-11', 200000), d('2026-08-01', 500000), d('2026-08-03', 200000)]
        );
        expect(r.nb_apparies).toBe(1);
        expect(r.nb_remboursements_sans_depot).toBe(2);
    });

    test('aucun depot rend un rapprochement vide, pas une erreur', () => {
        const r = apparierDepots([], [d('2026-08-01', 500000)]);
        expect(r.appariements).toEqual([]);
        expect(r.total_non_apparie).toBe(0);
        expect(r.nb_remboursements_sans_depot).toBe(1);
    });

    test('une tolerance de 0 exige le jour exact', () => {
        expect(apparierDepots([d('2026-08-10', 5000)], [d('2026-08-11', 5000)], 0)
            .nb_apparies).toBe(0);
        expect(apparierDepots([d('2026-08-10', 5000)], [d('2026-08-10', 5000)], 0)
            .nb_apparies).toBe(1);
    });

    test('une date illisible ne fait pas tomber le rapprochement', () => {
        const r = apparierDepots([d('pas-une-date', 5000)], [d('2026-08-10', 5000)]);
        expect(r.nb_apparies).toBe(0);
        expect(Number.isFinite(r.total_non_apparie)).toBe(true);
    });
});

describe('le cas reel: Mbao, aout 2026', () => {
    const DEPOTS = [
        ['2026-08-07', 250000], ['2026-08-08', 150000], ['2026-08-10', 200000],
        ['2026-08-11', 200000], ['2026-08-12', 450000], ['2026-08-13', 200000],
        ['2026-08-14', 250000], ['2026-08-15', 300000], ['2026-08-17', 300000],
        ['2026-08-18', 200000]
    ].map(([a, b]) => d(a, b));
    const REMB = [
        ['2026-08-01', 500000], ['2026-08-03', 200000], ['2026-08-05', 550000],
        ['2026-08-07', 450000], ['2026-08-08', 250000], ['2026-08-10', 150000],
        ['2026-08-11', 200000], ['2026-08-13', 450000], ['2026-08-14', 200000],
        ['2026-08-15', 250000], ['2026-08-16', 300000], ['2026-08-18', 300000],
        ['2026-08-19', 200000], ['2026-08-21', 200000], ['2026-08-22', 200000]
    ].map(([a, b]) => d(a, b));

    test('huit depots sur dix, tous au lendemain', () => {
        const r = apparierDepots(DEPOTS, REMB);
        expect(r.nb_apparies).toBe(8);
        const decalages = r.appariements.filter((a) => a.apparie).map((a) => a.decalage);
        // AUCUN le jour meme: c'est le fait qui justifie l'ordre d'essai.
        expect(decalages).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    test('les deux orphelins ne sont pas de meme nature', () => {
        const r = apparierDepots(DEPOTS, REMB);
        const parDate = Object.fromEntries(r.appariements.map((a) => [a.date, a]));
        // 08/08 est un SAMEDI: son versement ressort le lundi 10, a D+2.
        expect(parDate['2026-08-08'].dispute).toBe(false);
        // 11/08: le versement du 11 avait ete pris par le depot du 10.
        expect(parDate['2026-08-11'].dispute).toBe(true);
        expect(r.total_non_apparie).toBe(350000);
    });

    test('sept remboursements n ont aucun depot en face', () => {
        // 4 400 000 rembourses contre 2 500 000 deposes: l'ecart part par
        // d'autres canaux, et le bloc ne doit pas laisser croire l'inverse.
        expect(apparierDepots(DEPOTS, REMB).nb_remboursements_sans_depot).toBe(7);
    });
});

describe('le total', () => {
    const BASE = {
        cashDepart: 300000, cashDepartDate: '2026-07-31',
        ventes: 1000000, ventesCreance: 0, nbVentesCreance: 0,
        depenses: 50000, paiementsFournisseur: 100000, remboursements: 400000,
        depots: [], operationsRemboursement: []
    };

    test('additionne et soustrait dans le bon sens', () => {
        const r = construireCashTheorique(BASE);
        expect(r.total).toBe(300000 + 1000000 - 50000 - 100000 - 400000);
    });

    test('un depot retrouve n est PAS soustrait une seconde fois', () => {
        const r = construireCashTheorique(Object.assign({}, BASE, {
            depots: [d('2026-08-10', 200000)],
            operationsRemboursement: [d('2026-08-11', 200000)]
        }));
        expect(r.lignes.find((l) => l.cle === 'depots').montant).toBe(0);
        expect(r.total).toBe(750000);
        expect(r.commentaire).toMatch(/ne sont PAS soustraits/);
    });

    test('un depot non retrouve EST soustrait, et le commentaire le dit', () => {
        const r = construireCashTheorique(Object.assign({}, BASE, {
            depots: [d('2026-08-10', 200000)],
            operationsRemboursement: [d('2026-08-20', 200000)]
        }));
        expect(r.lignes.find((l) => l.cle === 'depots').montant).toBe(200000);
        expect(r.total).toBe(550000);
        expect(r.commentaire).toMatch(/soustraits en plus/);
        // Le montant doit etre lisible DANS la phrase: groupe par milliers,
        // pas '200000' qu'il faut relire deux fois pour compter les zeros.
        expect(r.commentaire).toContain((200000).toLocaleString('fr-FR') + ' FCFA');
    });

    test('le commentaire signale une soustraction peut-etre a tort', () => {
        const r = construireCashTheorique(Object.assign({}, BASE, {
            depots: [d('2026-08-10', 200000), d('2026-08-11', 200000)],
            operationsRemboursement: [d('2026-08-11', 200000)]
        }));
        expect(r.commentaire).toMatch(/peut-être soustrait à tort/);
    });

    test('sans aucun depot, le commentaire ne parle pas de rapprochement', () => {
        expect(construireCashTheorique(BASE).commentaire).toMatch(/Aucun dépôt/);
    });

    test('les creances sont rendues a part, jamais dans le total', () => {
        const r = construireCashTheorique(Object.assign({}, BASE, {
            ventesCreance: 75000, nbVentesCreance: 3
        }));
        expect(r.creances).toEqual({ montant: 75000, nb: 3 });
        // Le total ne bouge pas: une vente a credit n'entre pas en caisse.
        expect(r.total).toBe(750000);
    });

    test('des entrees absentes valent zero, pas NaN', () => {
        const r = construireCashTheorique({});
        expect(r.total).toBe(0);
        expect(r.lignes.every((l) => Number.isFinite(l.montant))).toBe(true);
    });
});
