/**
 * @jest-environment node
 *
 * L'agregation des commandes du jour par marge.
 *
 * Le point le plus delicat est le TAUX. Il divisait une marge PARTIELLE (les
 * produits sans prix d'achat n'en portent aucune) par le CA COMPLET, donc un
 * numerateur et un denominateur qui ne parlaient pas de la meme marchandise.
 * Cas extreme mesure: une commande entierement sans cout connu affichait
 * "0,0 %", ce qui se lit comme une marge nulle averee alors qu'elle est
 * simplement inconnue. Le denominateur est desormais le CA chiffre, et
 * l'absence de CA chiffre rend null - pas zero.
 */

const { agregerCommandes } = require('../lib/commandes-marge');

// Un catalogue minuscule: le Boeuf a un cout et se pare, le Poivre a un cout
// et ne se pare pas, le Mystere n'a aucun cout connu.
const COUTS = { Boeuf: 3000, Poivre: 100 };
const prixAchatDe = (p) => (p in COUTS ? COUTS[p] : NaN);
const estBoucherie = (p) => p === 'Boeuf';

const agreger = (lignes, paragePct) => agregerCommandes({
    lignes, prixAchatDe, estBoucherie,
    paragePct: paragePct === undefined ? 5 : paragePct
});

describe('taux de marge par commande', () => {
    test('une commande sans aucun cout connu rend null, pas zero', () => {
        const r = agreger([
            { produit: 'Mystere', nombre: 2, montant: 5000, commande_id: 'C1' }
        ]);
        const c = r.commandes[0];
        expect(c.marge).toBe(0);
        expect(c.ca).toBe(5000);
        expect(c.ca_chiffre).toBe(0);
        // Le point du correctif: null se lit "inconnu", 0 se lisait "nul".
        expect(c.taux_pct).toBeNull();
        expect(c.sans_cout).toEqual(['Mystere']);
        expect(r.ca_sans_cout).toBe(5000);
    });

    test('le taux ne compte que le CA chiffre, pas le CA total', () => {
        // Boeuf: 1 kg vendu 5 000, cout 3 000 / 0,95 = 3 157,89 -> marge 1 842,11
        // Mystere: 10 000 de CA sans cout, qui ne doit PAS diluer le taux.
        const r = agreger([
            { produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1' },
            { produit: 'Mystere', nombre: 1, montant: 10000, commande_id: 'C1' }
        ]);
        const c = r.commandes[0];
        expect(c.ca).toBe(15000);
        expect(c.ca_chiffre).toBe(5000);
        expect(c.marge).toBeCloseTo(1842.11, 1);
        // Sur le CA chiffre: 36,8 %. Sur le CA total ce serait 12,3 % - un
        // taux qui ne decrit aucune marchandise reelle.
        expect(c.taux_pct).toBeCloseTo(36.84, 1);
        expect(c.taux_pct).not.toBeCloseTo(12.28, 1);
    });

    test('sans ligne sans cout, le taux reste celui du CA complet', () => {
        const r = agreger([
            { produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1' }
        ]);
        const c = r.commandes[0];
        expect(c.ca).toBe(c.ca_chiffre);
        // taux_pct est arrondi au centieme, comme tous les taux rendus
        // par ce module: on compare a l'arrondi, pas au ratio brut.
        expect(c.taux_pct).toBe(Math.round((c.marge / c.ca) * 10000) / 100);
    });

    test('le total rend aussi son CA chiffre, pour un taux global coherent', () => {
        const r = agreger([
            { produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1' },
            { produit: 'Mystere', nombre: 1, montant: 10000, commande_id: 'C2' }
        ]);
        expect(r.total_ca).toBe(15000);
        expect(r.total_ca_chiffre).toBe(5000);
        expect(r.total_marge).toBeCloseTo(1842.11, 1);
    });
});

describe('parage', () => {
    test('ne s applique qu a la boucherie', () => {
        // Poivre: 1 unite vendue 150, cout 100, hors boucherie -> marge 50.
        const r = agreger([
            { produit: 'Poivre', nombre: 1, montant: 150, commande_id: 'C1' }
        ]);
        expect(r.commandes[0].marge).toBeCloseTo(50, 6);
    });

    test('un parage aberrant retombe sur 5 %, jamais sur un diviseur nul', () => {
        for (const mauvais of [100, 150, -3, NaN, null, undefined, 'abc']) {
            const r = agreger([
                { produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1' }
            ], mauvais);
            expect(r.parage_pct).toBe(5);
            expect(Number.isFinite(r.commandes[0].marge)).toBe(true);
        }
    });

    test('un parage de 0 est legitime et se distingue du repli', () => {
        const r = agreger([
            { produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1' }
        ], 0);
        expect(r.parage_pct).toBe(0);
        expect(r.commandes[0].marge).toBeCloseTo(2000, 6);
    });
});

describe('regroupement', () => {
    test('commande_id prime, puis le client, puis le comptoir', () => {
        const r = agreger([
            { produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1', nom_client: 'Awa' },
            { produit: 'Boeuf', nombre: 1, montant: 5000, nom_client: 'Awa' },
            { produit: 'Boeuf', nombre: 1, montant: 5000 },
            { produit: 'Boeuf', nombre: 1, montant: 4000 }
        ]);
        expect(r.commandes).toHaveLength(3);
        // Les deux lignes anonymes forment UNE ligne de comptoir, pas deux.
        const comptoir = r.commandes.find((c) => !c.commande_id && !c.client);
        expect(comptoir.lignes).toBe(2);
        expect(comptoir.ca).toBe(9000);
    });

    test('classe par marge decroissante', () => {
        const r = agreger([
            { produit: 'Boeuf', nombre: 1, montant: 3000, commande_id: 'PERTE' },
            { produit: 'Boeuf', nombre: 1, montant: 6000, commande_id: 'GAIN' }
        ]);
        expect(r.commandes.map((c) => c.commande_id)).toEqual(['GAIN', 'PERTE']);
        expect(r.commandes[1].marge).toBeLessThan(0);
    });

    test('un produit sans cout n est nomme qu une fois par commande', () => {
        const r = agreger([
            { produit: 'Mystere', nombre: 1, montant: 100, commande_id: 'C1' },
            { produit: 'Mystere', nombre: 1, montant: 100, commande_id: 'C1' }
        ]);
        expect(r.commandes[0].sans_cout).toEqual(['Mystere']);
        expect(r.commandes[0].lignes).toBe(2);
    });
});

describe('robustesse', () => {
    test('aucune ligne rend des totaux a zero, pas NaN', () => {
        const r = agreger([]);
        expect(r.commandes).toEqual([]);
        expect(r.total_ca).toBe(0);
        expect(r.total_ca_chiffre).toBe(0);
        expect(r.total_marge).toBe(0);
        expect(r.ca_sans_cout).toBe(0);
    });

    test('une quantite nulle retombe sur prix_unit sans diviser par zero', () => {
        const r = agreger([
            { produit: 'Boeuf', nombre: 0, montant: 0, prix_unit: 5000, commande_id: 'C1' }
        ]);
        expect(Number.isFinite(r.commandes[0].marge)).toBe(true);
        // q = 0 annule la contribution: le prix sert au calcul, pas au montant.
        expect(r.commandes[0].marge).toBe(0);
    });

    test('un cout nul ou negatif compte comme inconnu, pas comme gratuit', () => {
        const r = agregerCommandes({
            lignes: [{ produit: 'Boeuf', nombre: 1, montant: 5000, commande_id: 'C1' }],
            prixAchatDe: () => 0,
            estBoucherie: () => true,
            paragePct: 5
        });
        expect(r.commandes[0].sans_cout).toEqual(['Boeuf']);
        expect(r.commandes[0].taux_pct).toBeNull();
    });
});

/**
 * LES CLIENTS DE LA PERIODE, cumules.
 *
 * L'unite change: une ligne n'est plus une commande mais un CLIENT. Deux
 * commandes du meme client dans le mois font UNE ligne et deux commandes -
 * c'est tout l'interet de cumuler, et c'est ce que compte la colonne dediee.
 */
const { agregerClients } = require('../lib/commandes-marge');

const L = (date, client, cmd, produit, q, m) => ({
    date, nom_client: client, commande_id: cmd, produit, nombre: q, montant: m
});

describe('clients de la periode', () => {
    const PRIX = (p, d) => (p === 'Boeuf' ? (d < '2026-08-10' ? 4480 : 4520)
        : p === 'Yell' ? 2000 : NaN);
    const faire = (lignes) => agregerClients({
        lignes, prixAchatDe: PRIX, estBoucherie: () => true, paragePct: 5
    });

    test('deux commandes du meme client font UNE ligne', () => {
        const r = faire([
            L('2026-08-03', 'Mme Ndiaye', 'C1', 'Boeuf', 1, 5000),
            L('2026-08-20', 'Mme Ndiaye', 'C2', 'Boeuf', 1, 5000)
        ]);
        expect(r.clients).toHaveLength(1);
        expect(r.clients[0].nb_commandes).toBe(2);
        expect(r.clients[0].ca).toBe(10000);
        expect(r.clients[0].lignes).toBe(2);
    });

    test('le prix d achat suit la DATE de chaque vente', () => {
        // Le meme produit, deux dates, deux prix: 4 480 puis 4 520. Valoriser
        // les deux au dernier prix deplacerait la marge du debut de mois.
        const avant = faire([L('2026-08-03', 'A', 'C1', 'Boeuf', 1, 5000)]);
        const apres = faire([L('2026-08-20', 'A', 'C2', 'Boeuf', 1, 5000)]);
        expect(avant.clients[0].marge).toBeCloseTo(5000 - 4480 / 0.95, 1);
        expect(apres.clients[0].marge).toBeCloseTo(5000 - 4520 / 0.95, 1);
        expect(avant.clients[0].marge).toBeGreaterThan(apres.clients[0].marge);
    });

    test('le comptoir SORT du classement des clients', () => {
        // Cumule, il pesait 399 commandes et 41 % du CA: il prenait la
        // premiere ligne d'un tableau qui s'appelle « les meilleurs clients ».
        const r = faire([
            L('2026-08-05', 'Mme Ndiaye', 'C1', 'Boeuf', 1, 5000),
            L('2026-08-05', null, 'K1', 'Boeuf', 1, 5000),
            L('2026-08-06', null, 'K2', 'Boeuf', 1, 5000)
        ]);
        expect(r.clients.map((c) => c.client)).toEqual(['Mme Ndiaye']);
        expect(r.comptoir.nb_commandes).toBe(2);
    });

    test('le comptoir est detaille par COMMANDE, pas cumule', () => {
        const r = faire([
            L('2026-08-05', null, 'K1', 'Boeuf', 1, 5000),
            L('2026-08-05', null, 'K1', 'Yell', 1, 2000),
            L('2026-08-06', null, 'K2', 'Boeuf', 1, 5000)
        ]);
        expect(r.comptoir.nb_commandes).toBe(2);
        const k1 = r.comptoir.commandes.find((c) => c.commande_id === 'K1');
        expect(k1.lignes).toBe(2);
        expect(k1.ca).toBe(7000);
    });

    test('une vente anonyme SANS identifiant compte par journee', () => {
        const r = faire([
            L('2026-08-05', null, null, 'Boeuf', 1, 5000),
            L('2026-08-05', null, null, 'Yell', 1, 2000),
            L('2026-08-06', null, null, 'Boeuf', 1, 5000)
        ]);
        // Deux JOURNEES: deux passages, pas trois produits.
        expect(r.comptoir.nb_commandes).toBe(2);
    });

    test('la liste du comptoir est bornee, et dit ce qu elle cache', () => {
        // Une liste tronquee qui se tait passe pour une liste complete.
        const lignes = [];
        for (let i = 1; i <= 25; i++) {
            lignes.push(L('2026-08-05', null, 'K' + i, 'Boeuf', 1, 5000 + i));
        }
        const r = agregerClients({
            lignes, prixAchatDe: PRIX, estBoucherie: () => true,
            paragePct: 5, limiteComptoir: 20
        });
        expect(r.comptoir.nb_commandes).toBe(25);
        expect(r.comptoir.commandes).toHaveLength(20);
        expect(r.comptoir.nb_masquees).toBe(5);
        // Ce sont les PLUS GROSSES marges qui restent.
        expect(r.comptoir.commandes[0].ca).toBe(5025);
    });

    test('classe par marge decroissante', () => {
        const r = faire([
            L('2026-08-03', 'Petit', 'C1', 'Boeuf', 1, 4800),
            L('2026-08-03', 'Gros', 'C2', 'Boeuf', 2, 12000)
        ]);
        expect(r.clients.map((c) => c.client)).toEqual(['Gros', 'Petit']);
    });

    test('le taux ne compte que le CA chiffre', () => {
        const r = faire([
            L('2026-08-03', 'A', 'C1', 'Boeuf', 1, 5000),
            L('2026-08-03', 'A', 'C1', 'Mystere', 1, 10000)
        ]);
        const c = r.clients[0];
        expect(c.ca).toBe(15000);
        expect(c.ca_chiffre).toBe(5000);
        expect(c.sans_cout).toEqual(['Mystere']);
        expect(c.taux_pct).toBeCloseTo((c.marge / 5000) * 100, 1);
    });

    test('un client sans aucun cout connu rend null, pas zero', () => {
        const r = faire([L('2026-08-03', 'A', 'C1', 'Mystere', 1, 10000)]);
        expect(r.clients[0].taux_pct).toBeNull();
        expect(r.clients[0].marge).toBe(0);
    });

    test('les totaux clients + comptoir couvrent tout le CA', () => {
        // Le partage ne doit rien perdre: mesure sur aout 2026 a Mbao,
        // 2 756 075 + 1 927 575 = 4 683 650, le total_ventes du PL.
        const r = faire([
            L('2026-08-03', 'Mme Ndiaye', 'C1', 'Boeuf', 1, 5000),
            L('2026-08-03', null, 'K1', 'Boeuf', 1, 3000)
        ]);
        expect(r.nb_clients).toBe(1);
        expect(r.total_ca + r.comptoir.total_ca).toBe(8000);
    });

    test('aucune ligne rend des totaux a zero, pas NaN', () => {
        const r = faire([]);
        expect(r.clients).toEqual([]);
        expect(r.total_ca).toBe(0);
        expect(r.total_commandes).toBe(0);
    });
});

/**
 * LE PARAGE PAR ESPECE, branche sur les deux agregations.
 *
 * Il etait un taux UNIQUE applique au boeuf, au veau et a l'agneau. Il vient
 * desormais de la mesure quand elle tient debout - aout 2026 a Mbao: bovin
 * 3,96 % sur 23 jours, ovin au parametre faute de jours. Effet mesure sur le
 * mois: +39 129 F de marge, clients et comptoir confondus.
 */
describe('parage par espece', () => {
    const LIGNES = [
        { date: '2026-08-03', nom_client: 'A', commande_id: 'C1',
            produit: 'Boeuf', nombre: 1, montant: 5000 },
        { date: '2026-08-03', nom_client: 'A', commande_id: 'C1',
            produit: 'Poivre', nombre: 1, montant: 500 }
    ];
    const COMMUN = {
        prixAchatDe: (p) => ({ Boeuf: 4500, Poivre: 400 }[p] ?? NaN),
        estBoucherie: (p) => p !== 'Poivre'
    };

    test('paragePour prime sur paragePct', () => {
        const auParametre = agregerClients(Object.assign({}, COMMUN,
            { lignes: LIGNES, paragePct: 5 }));
        const aLaMesure = agregerClients(Object.assign({}, COMMUN,
            { lignes: LIGNES, paragePct: 5, paragePour: () => 3.96 }));
        // Moins de parage = cout plus bas = marge plus haute.
        expect(aLaMesure.clients[0].marge).toBeGreaterThan(auParametre.clients[0].marge);
        expect(aLaMesure.clients[0].marge).toBeCloseTo(
            (5000 - 4500 / (1 - 0.0396)) + (500 - 400), 1);
    });

    test('deux especes, deux taux, dans la MEME commande', () => {
        const lignes = [
            { date: '2026-08-03', nom_client: 'A', commande_id: 'C1',
                produit: 'Boeuf', nombre: 1, montant: 5000 },
            { date: '2026-08-03', nom_client: 'A', commande_id: 'C1',
                produit: 'Agneau', nombre: 1, montant: 6000 }
        ];
        const r = agregerClients({
            lignes,
            prixAchatDe: (p) => ({ Boeuf: 4500, Agneau: 5000 }[p] ?? NaN),
            estBoucherie: () => true,
            paragePour: (p) => (p === 'Boeuf' ? 3.96 : 1.4)
        });
        expect(r.clients[0].marge).toBeCloseTo(
            (5000 - 4500 / (1 - 0.0396)) + (6000 - 5000 / (1 - 0.014)), 1);
    });

    test('hors boucherie: aucun parage, quel que soit le taux', () => {
        const r = agregerClients(Object.assign({}, COMMUN, {
            lignes: [LIGNES[1]], paragePour: () => 40
        }));
        // 500 - 400, pas 500 - 400/0,6.
        expect(r.clients[0].marge).toBeCloseTo(100, 6);
    });

    test('un taux aberrant retombe sur 5, jamais sur un diviseur nul', () => {
        for (const mauvais of [100, 150, -3, NaN]) {
            const r = agregerClients(Object.assign({}, COMMUN, {
                lignes: [LIGNES[0]], paragePour: () => mauvais
            }));
            expect(r.clients[0].marge).toBeCloseTo(5000 - 4500 / 0.95, 1);
        }
    });

    test('agregerCommandes suit la meme regle', () => {
        const a = agregerCommandes(Object.assign({}, COMMUN, { lignes: LIGNES, paragePct: 5 }));
        const b = agregerCommandes(Object.assign({}, COMMUN,
            { lignes: LIGNES, paragePour: () => 3.96 }));
        expect(b.commandes[0].marge).toBeGreaterThan(a.commandes[0].marge);
    });
});
