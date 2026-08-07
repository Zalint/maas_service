/**
 * @jest-environment node
 *
 * La cle d'agregation du stock soir automatique doit etre NORMALISEE, comme le
 * test d'appartenance qui la precede.
 *
 * Les deux ont diverge: le filtre normalisait (`autoSet.has(normaliserNom(...))`)
 * pendant que la cle gardait le nom brut (`${pv}|${produit}`). Les deux graphies
 * d'un meme produit passaient donc le filtre puis tombaient dans DEUX seaux:
 * le matin sous "Poulet en detail", les ventes sous "Poulet En Detail". Le
 * recalcul ecrivait alors deux lignes de stock soir pour un seul produit, l'une
 * a +50 et l'autre a -30.
 *
 * Ce n'etait pas theorique: 1 211 groupes (date, type, point de vente, produit)
 * portent plusieurs graphies d'un produit automatique sur le tenant mbao. Et la
 * ligne negative ainsi fabriquee est lue en aval comme un stock non fiable, ce
 * qui fait ecarter du PL le comptage legitime du matin.
 */

const mockProduit = { findAll: jest.fn() };
const mockStock = { findAll: jest.fn(), create: jest.fn() };
const mockTransfert = { findAll: jest.fn() };
const mockVente = { findAll: jest.fn() };

jest.mock('../db/models', () => ({
    Produit: mockProduit,
    Stock: mockStock,
    Transfert: mockTransfert,
    Vente: mockVente
}));
jest.mock('../db/index', () => ({
    sequelize: { transaction: jest.fn(), query: jest.fn() }
}));

const { computeStockSoirAutoValues } = require('../db/utils');

describe('stock soir automatique et graphies divergentes', () => {
    beforeEach(() => {
        mockProduit.findAll.mockReset();
        mockStock.findAll.mockReset();
        mockTransfert.findAll.mockReset();
        mockVente.findAll.mockReset();
    });

    test('deux graphies du meme produit ne font qu une seule entree', async () => {
        mockProduit.findAll.mockResolvedValueOnce([{ nom: 'Poulet en détail', prix_defaut: 1000 }]);
        mockStock.findAll.mockResolvedValueOnce([
            { pointVente: 'Mbao', produit: 'Poulet en détail', quantite: 50 }
        ]);
        mockTransfert.findAll.mockResolvedValueOnce([]);
        // La vente est saisie sous une AUTRE graphie.
        mockVente.findAll.mockResolvedValueOnce([
            { pointVente: 'Mbao', produit: 'POULET EN DETAIL', nombre: 30 }
        ]);

        const { calcByKey, nomCanonique } = await computeStockSoirAutoValues('07-01-2026');

        expect(calcByKey.size).toBe(1);
        const [[cle, valeur]] = [...calcByKey.entries()];
        expect(valeur).toBe(20);                       // 50 - 30, et non 50 puis -30
        expect(cle).toBe('Mbao|poulet en detail');     // cle normalisee
        // Le nom a ECRIRE est celui du catalogue, pas celui de la derniere saisie.
        expect(nomCanonique.get('poulet en detail')).toBe('Poulet en détail');
    });

    test('les transferts se rapprochent aussi malgre la casse', async () => {
        mockProduit.findAll.mockResolvedValueOnce([{ nom: 'Carotte', prix_defaut: 500 }]);
        mockStock.findAll.mockResolvedValueOnce([
            { pointVente: 'Mbao', produit: 'Carotte', quantite: 10 }
        ]);
        mockTransfert.findAll.mockResolvedValueOnce([
            { pointVente: 'Mbao', produit: 'CAROTTE', impact: 1, quantite: 5 }
        ]);
        mockVente.findAll.mockResolvedValueOnce([
            { pointVente: 'Mbao', produit: 'carotte', nombre: 3 }
        ]);

        const { calcByKey } = await computeStockSoirAutoValues('07-01-2026');

        expect(calcByKey.size).toBe(1);
        expect(calcByKey.get('Mbao|carotte')).toBe(12);   // 10 + 5 - 3
    });

    test('deux points de vente restent distincts', async () => {
        mockProduit.findAll.mockResolvedValueOnce([{ nom: 'Carotte', prix_defaut: 500 }]);
        mockStock.findAll.mockResolvedValueOnce([
            { pointVente: 'Mbao', produit: 'Carotte', quantite: 10 },
            { pointVente: 'O.Foire', produit: 'CAROTTE', quantite: 7 }
        ]);
        mockTransfert.findAll.mockResolvedValueOnce([]);
        mockVente.findAll.mockResolvedValueOnce([]);

        const { calcByKey } = await computeStockSoirAutoValues('07-01-2026');

        expect(calcByKey.size).toBe(2);
        expect(calcByKey.get('Mbao|carotte')).toBe(10);
        expect(calcByKey.get('O.Foire|carotte')).toBe(7);
    });

    test('un produit hors mode automatique reste ignore', async () => {
        mockProduit.findAll.mockResolvedValueOnce([]);   // aucun produit auto
        const { calcByKey } = await computeStockSoirAutoValues('07-01-2026');
        expect(calcByKey.size).toBe(0);
        // Les tables de stock ne sont meme pas interrogees.
        expect(mockStock.findAll).not.toHaveBeenCalled();
    });
});
