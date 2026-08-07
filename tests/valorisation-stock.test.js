/**
 * Valorisation du stock au prix d'achat, avec repli sur le prix de vente.
 *
 * Les chiffres sont calculables de tete, pour qu'une regression se lise sans
 * deboguer.
 */
const { valoriserLignes } = require('../lib/valorisation-stock');

// Le catalogue reel au 2026-08: seuls Boeuf, Veau, Agneau et Laxass ont un prix
// d'achat. Poulet en est depourvu alors qu'il pese 8 M F de stock.
const ACHAT = { Boeuf: 3835, Veau: 4035, Laxass: 200 };
const prixAchat = (p) => ACHAT[p] || null;

describe('valorisation du stock', () => {
    test('un produit avec prix d achat est revalorise, pas resomme', () => {
        // 10 kg saisis a 4800 (prix de vente) = 48 000 stockes.
        const r = valoriserLignes({
            lignes: [{ produit: 'Boeuf', quantite: 10, total: 48000, prix_unitaire: 4800 }],
            prixAchat
        });
        expect(r.valeur).toBe(38350);                 // 10 x 3835, et non 48 000
        expect(r.valeur_au_prix_achat).toBe(38350);
        expect(r.valeur_au_prix_vente).toBe(0);
        expect(r.produits_au_prix_de_vente).toEqual([]);
    });

    // Le cas qui decide si la fonctionnalite est utilisable: sans prix d'achat,
    // valoriser a zero ferait chuter le stock de 35% en silence.
    test('sans prix d achat, la valeur saisie est CONSERVEE et le produit nomme', () => {
        const r = valoriserLignes({
            lignes: [{ produit: 'Poulet', quantite: 2296, total: 8036000, prix_unitaire: 3500 }],
            prixAchat
        });
        expect(r.valeur).toBe(8036000);               // et surtout pas 0
        expect(r.valeur_au_prix_achat).toBe(0);
        expect(r.produits_au_prix_de_vente).toEqual(['Poulet']);
    });

    test('les deux bases coexistent et sont comptees separement', () => {
        const r = valoriserLignes({
            lignes: [
                { produit: 'Boeuf', quantite: 10, total: 48000, prix_unitaire: 4800 },
                { produit: 'Poulet', quantite: 4, total: 14000, prix_unitaire: 3500 },
                { produit: 'Laxass', quantite: 5, total: 1000, prix_unitaire: 200 }
            ],
            prixAchat
        });
        // 10x3835 + 5x200 = 39 350 au prix d'achat ; 14 000 au prix de vente.
        expect(r.valeur_au_prix_achat).toBe(39350);
        expect(r.valeur_au_prix_vente).toBe(14000);
        expect(r.valeur).toBe(53350);
        expect(r.produits_au_prix_de_vente).toEqual(['Poulet']);
    });

    // Une quantite nulle ne peut pas etre revalorisee: quantite x prix vaudrait
    // zero et effacerait une valeur qui existe bel et bien en base.
    test('une quantite nulle avec un total non nul ne perd pas sa valeur', () => {
        const r = valoriserLignes({
            lignes: [{ produit: 'Boeuf', quantite: 0, total: 12000, prix_unitaire: 4800 }],
            prixAchat
        });
        expect(r.valeur).toBe(12000);
        expect(r.lignes_incoherentes).toEqual([{ produit: 'Boeuf', total: 12000 }]);
        expect(r.produits_au_prix_de_vente).toEqual(['Boeuf']);
    });

    test('une ligne entierement vide ne signale rien', () => {
        const r = valoriserLignes({
            lignes: [{ produit: 'Oeuf', quantite: 0, total: 0, prix_unitaire: 0 }],
            prixAchat
        });
        expect(r.valeur).toBe(0);
        expect(r.lignes_incoherentes).toEqual([]);
        expect(r.produits_au_prix_de_vente).toEqual([]);
    });

    test('un prix d achat nul ou negatif est ignore, pas applique', () => {
        const r = valoriserLignes({
            lignes: [{ produit: 'Poulet', quantite: 4, total: 14000, prix_unitaire: 3500 }],
            prixAchat: () => 0
        });
        expect(r.valeur).toBe(14000);
        expect(r.produits_au_prix_de_vente).toEqual(['Poulet']);
    });

    test('sans resolveur du tout, rien ne change: on reste sur le stocke', () => {
        const r = valoriserLignes({
            lignes: [{ produit: 'Boeuf', quantite: 10, total: 48000, prix_unitaire: 4800 }]
        });
        expect(r.valeur).toBe(48000);
        expect(r.produits_au_prix_de_vente).toEqual(['Boeuf']);
    });

    test('un produit nomme deux fois n apparait qu une fois dans la liste', () => {
        const r = valoriserLignes({
            lignes: [
                { produit: 'Poulet', quantite: 2, total: 7000, prix_unitaire: 3500 },
                { produit: 'Poulet', quantite: 2, total: 7000, prix_unitaire: 3500 }
            ],
            prixAchat
        });
        expect(r.valeur).toBe(14000);
        expect(r.produits_au_prix_de_vente).toEqual(['Poulet']);
    });

    test('aucune ligne: tout est a zero, rien n est signale', () => {
        const r = valoriserLignes({ lignes: [], prixAchat });
        expect(r.valeur).toBe(0);
        expect(r.produits_au_prix_de_vente).toEqual([]);
        expect(r.lignes_incoherentes).toEqual([]);
    });
});

describe('stock negatif et ventilation boucherie', () => {
    // Un stock derive (matin + transferts - ventes) devient negatif des que les
    // entrees ne sont pas saisies. Le sommer retrancherait de la valeur du
    // point de vente une marchandise qui n'existe pas.
    test('une ligne negative est ecartee, pas soustraite', () => {
        const r = valoriserLignes({
            lignes: [
                { produit: 'Boeuf', quantite: 10, total: 48000, prix_unitaire: 4800 },
                { produit: 'Carotte', quantite: -95, total: -28500, prix_unitaire: 300 }
            ],
            prixAchat
        });
        expect(r.valeur).toBe(38350);              // 10 x 3835, la carotte est ignoree
        expect(r.valeur_negative_ignoree).toBe(-28500);
        expect(r.lignes_negatives).toEqual([{ produit: 'Carotte', quantite: -95, total: -28500 }]);
    });

    test('sans estBoucherie, tout est compte comme boucherie', () => {
        const r = valoriserLignes({
            lignes: [{ produit: 'Boeuf', quantite: 10, total: 48000, prix_unitaire: 4800 }],
            prixAchat
        });
        expect(r.valeur_boucherie).toBe(38350);
        expect(r.valeur_hors_boucherie).toBe(0);
    });

    // Le coefficient de pertes de decoupe ne doit porter que sur la viande:
    // on ne pare pas un sachet d'epicerie.
    test('la ventilation separe la viande du reste', () => {
        const r = valoriserLignes({
            lignes: [
                { produit: 'Boeuf', quantite: 10, total: 48000, prix_unitaire: 4800 },
                { produit: 'Spaghetti', quantite: 4, total: 1200, prix_unitaire: 300 }
            ],
            prixAchat,
            estBoucherie: (p) => p === 'Boeuf'
        });
        expect(r.valeur_boucherie).toBe(38350);    // au prix d'achat
        expect(r.valeur_hors_boucherie).toBe(1200); // sans prix d'achat: valeur saisie
        expect(r.valeur).toBe(39550);
        expect(r.valeur_boucherie + r.valeur_hors_boucherie).toBe(r.valeur);
    });
});
