/**
 * Retrouver une entree de stock quelle que soit la forme de sa cle.
 *
 * Ce fichier existe a cause d'un cas mesure en production le 15/08/2026: le
 * stock matin, recopie du 14 au soir par le cron, ARRIVAIT au navigateur -
 * 108,3 kg de boeuf, visibles dans la reponse reseau - et la grille affichait
 * zero. Deux producteurs ecrivaient deux formats de cle, un seul lecteur en
 * connaissait un. Rien ne le signalait: la grille tombait dans sa branche
 * « pas de donnees » et prenait le prix du catalogue, ce qui donnait une ligne
 * d'apparence normale avec une quantite nulle.
 *
 * @jest-environment node
 */

const idx = require('../lib/stock-index');

// Le format ecrit par la SAISIE et par le repli base du serveur.
const FORMAT_SAISIE = {
    'Mbao-Boeuf': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 108.3, PU: 5400 },
    'Mbao-Cuisse de poulet': { 'Point de Vente': 'Mbao', Produit: 'Cuisse de poulet', Nombre: 2.4, PU: 2500 }
};

// Le format ecrit par le repli base du CRON, tel qu'observe en production:
// suffixe « -stock-<type>-<index> » et espaces remplaces par des underscores.
const FORMAT_CRON = {
    'Mbao-Boeuf-stock-matin-4': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 108.3, PU: 5400 },
    'Mbao-Cuisse_de_poulet-stock-matin-16': { 'Point de Vente': 'Mbao', Produit: 'Cuisse de poulet', Nombre: 2.4, PU: 2500 }
};

const chercher = (donnees, pv, prod) =>
    idx.trouver(donnees, idx.construire(donnees), pv, prod);

describe('les deux formats de cle se lisent', () => {
    test('format de la saisie: la cle exacte suffit', () => {
        expect(chercher(FORMAT_SAISIE, 'Mbao', 'Boeuf').Nombre).toBe(108.3);
        expect(chercher(FORMAT_SAISIE, 'Mbao', 'Cuisse de poulet').Nombre).toBe(2.4);
    });

    test('format du cron: le suffixe ET les underscores sont rattrapes', () => {
        // C'est LE cas de production. Un correctif qui ne traiterait que le
        // suffixe laisserait « Cuisse_de_poulet » de cote.
        expect(chercher(FORMAT_CRON, 'Mbao', 'Boeuf').Nombre).toBe(108.3);
        expect(chercher(FORMAT_CRON, 'Mbao', 'Cuisse de poulet').Nombre).toBe(2.4);
    });

    test('un produit absent rend null, jamais une autre ligne', () => {
        expect(chercher(FORMAT_CRON, 'Mbao', 'Agneau')).toBeNull();
        expect(chercher(FORMAT_CRON, 'Keur Massar', 'Boeuf')).toBeNull();
    });
});

describe('le rapprochement ne confond pas deux produits voisins', () => {
    const VOISINS = {
        'a': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 100 },
        'b': { 'Point de Vente': 'Mbao', Produit: 'Boeuf en gros', Nombre: 20 },
        'c': { 'Point de Vente': 'Mbao', Produit: 'Boeuf en détail', Nombre: 30 }
    };

    test('« Boeuf » ne recupere pas le stock de « Boeuf en gros »', () => {
        // Un rapprochement par prefixe - startsWith sur la cle - aurait fait
        // exactement cette erreur.
        expect(chercher(VOISINS, 'Mbao', 'Boeuf').Nombre).toBe(100);
        expect(chercher(VOISINS, 'Mbao', 'Boeuf en gros').Nombre).toBe(20);
        expect(chercher(VOISINS, 'Mbao', 'Boeuf en détail').Nombre).toBe(30);
    });

    test('les ACCENTS distinguent deux produits, ils ne sont pas effaces', () => {
        // « Boeuf en détail » et « Boeuf en detail » coexistent au catalogue de
        // ce tenant. Les confondre afficherait le stock de l'un sur l'autre.
        const d = {
            'a': { 'Point de Vente': 'Mbao', Produit: 'Boeuf en détail', Nombre: 30 },
            'b': { 'Point de Vente': 'Mbao', Produit: 'Boeuf en detail', Nombre: 7 }
        };
        expect(chercher(d, 'Mbao', 'Boeuf en détail').Nombre).toBe(30);
        expect(chercher(d, 'Mbao', 'Boeuf en detail').Nombre).toBe(7);
    });

    test('la CASSE, elle, est ignoree', () => {
        // Les ventes portent « Boeuf en gros » et « Boeuf En Gros » pour le
        // meme produit: le stock doit se retrouver dans les deux graphies.
        const d = { 'x': { 'Point de Vente': 'MBAO', Produit: 'BOEUF EN GROS', Nombre: 20 } };
        expect(chercher(d, 'Mbao', 'Boeuf en gros').Nombre).toBe(20);
    });

    test('les espaces en trop ne cassent rien', () => {
        const d = { 'x': { 'Point de Vente': ' Mbao ', Produit: 'Cuisse  de   poulet', Nombre: 2.4 } };
        expect(chercher(d, 'Mbao', 'Cuisse de poulet').Nombre).toBe(2.4);
    });

    test('des UNDERSCORES dans le CHAMP se rapprochent des espaces', () => {
        // Test ecrit apres une mutation qui a SURVECU: retirer « _ » de la
        // normalisation ne cassait rien, parce que les autres cas ne portent
        // d'underscores que dans la CLE - jamais dans les champs, puisqu'on
        // indexe sur le contenu. La regle ne vaut donc que si un producteur
        // ecrit un jour « Cuisse_de_poulet » dans le champ lui-meme, ce que le
        // repli du cron faisait deja pour construire sa cle. On le verrouille
        // ici plutot que de garder une normalisation que rien n'exerce.
        const d = { 'x': { 'Point de Vente': 'Mbao', Produit: 'Cuisse_de_poulet', Nombre: 2.4 } };
        expect(chercher(d, 'Mbao', 'Cuisse de poulet').Nombre).toBe(2.4);
        // ... et dans l'autre sens.
        const d2 = { 'y': { 'Point de Vente': 'Keur_Massar', Produit: 'Boeuf', Nombre: 8 } };
        expect(chercher(d2, 'Keur Massar', 'Boeuf').Nombre).toBe(8);
    });
});

describe('robustesse', () => {
    test('un dictionnaire vide, nul ou non-objet ne leve pas', () => {
        for (const d of [null, undefined, {}, 'x', 42, []]) {
            expect(idx.construire(d).size).toBe(0);
            expect(idx.trouver(d, idx.construire(d), 'Mbao', 'Boeuf')).toBeNull();
        }
    });

    test('les entrees sans produit ou sans point de vente sont ignorees', () => {
        const d = {
            'a': { 'Point de Vente': 'Mbao' },
            'b': { Produit: 'Boeuf' },
            'c': null,
            'd': 'pas un objet',
            'e': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 5 }
        };
        expect(idx.construire(d).size).toBe(1);
        expect(chercher(d, 'Mbao', 'Boeuf').Nombre).toBe(5);
    });

    test('les noms de champs en minuscules sont acceptes aussi', () => {
        // Le repli base du serveur emploie « Point de Vente »/« Produit »,
        // d'anciens dumps portent « pointVente »/« produit ».
        const d = { 'x': { pointVente: 'Mbao', produit: 'Boeuf', Nombre: 9 } };
        expect(chercher(d, 'Mbao', 'Boeuf').Nombre).toBe(9);
    });

    test('un doublon garde la PREMIERE occurrence, sans dependre de l ordre', () => {
        // Deux entrees pour un meme couple sont une anomalie de donnees. En
        // remplacer une par l'autre ferait dependre l'affichage de l'ordre des
        // cles, donc du producteur du fichier.
        const d = {
            'aaa': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 108.3 },
            'zzz': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 0 }
        };
        expect(chercher(d, 'Mbao', 'Boeuf').Nombre).toBe(108.3);
    });

    test('la cle EXACTE prime sur l index', () => {
        // Si les deux existent, on prend l'exacte: c'est celle que le
        // producteur a voulue.
        const d = {
            'Mbao-Boeuf': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 1 },
            'Mbao-Boeuf-stock-matin-4': { 'Point de Vente': 'Mbao', Produit: 'Boeuf', Nombre: 2 }
        };
        expect(chercher(d, 'Mbao', 'Boeuf').Nombre).toBe(1);
    });
});
