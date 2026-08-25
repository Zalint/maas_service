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
