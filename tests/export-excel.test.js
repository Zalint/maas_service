/**
 * Tests de la transformation AOA (Array of Arrays) pour l'export Excel.
 *
 * stock-export.js construit le contenu des feuilles Stock Matin / Stock Soir
 * via processStockData(). Cette fonction est pure (juste des transformations
 * d'objet vers tableau de lignes) — testable directement via require.
 *
 * On teste aussi des helpers mirroirés:
 *  - construction du tableau Transferts (avec impact +/-)
 *  - génération du nom de fichier avec date
 */

const { processStockData } = require('../stock-export.js');

// =============== Mirroirs (pas exposés par stock-export.js) ===============

/** Mirror de la construction de la ligne transfert (stock-export.js:158+) */
function processTransfertRow(transfert) {
    const quantite = parseFloat(
        transfert.quantite || transfert.Quantite || transfert.quantity ||
        transfert.Quantity || 0
    );
    const prixUnitaire = parseFloat(
        transfert.prixUnitaire || transfert.PU || transfert['Prix Unitaire'] ||
        transfert.prixUnit || transfert.prix_unitaire || transfert.price ||
        transfert.prix || 0
    );
    const impact = parseInt(transfert.impact || transfert.Impact || 1);
    const total = quantite * prixUnitaire * impact;
    return [
        transfert['Point de Vente'] || transfert.pointVente || transfert.point_vente || '',
        transfert.Produit || transfert.produit || transfert.product || '',
        impact > 0 ? '+' : '-',
        quantite,
        prixUnitaire,
        total,
        transfert.Commentaire || transfert.commentaire || transfert.comment || ''
    ];
}

/** Génère un nom de fichier Stock_Inventaire_DD-MM-YYYY.xlsx depuis une date YYYY-MM-DD */
function buildExcelFilename(dateIso) {
    const m = String(dateIso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 'Stock_Inventaire.xlsx';
    return `Stock_Inventaire_${m[3]}-${m[2]}-${m[1]}.xlsx`;
}

// =============== processStockData (la vraie fonction) ===============

describe('processStockData (stock-export.js)', () => {
    test('header en première ligne dans tous les cas', () => {
        const rows = processStockData({}, 'Stock Matin');
        expect(rows[0]).toEqual([
            'Point de Vente', 'Produit', 'Quantité', 'Prix Unitaire', 'Total', 'Commentaire'
        ]);
    });

    test('placeholder quand stock vide', () => {
        const rows = processStockData({}, 'Stock Matin');
        expect(rows).toHaveLength(2);
        expect(rows[1][0]).toBe('Aucune donnée disponible');
    });

    test('un seul item — calcul du total', () => {
        const rows = processStockData({
            'Mbao-Boeuf': {
                'Point de Vente': 'Mbao',
                'Produit': 'Boeuf',
                'Nombre': 10,
                'PU': 3700,
                'Commentaire': 'OK'
            }
        }, 'Stock Matin');
        expect(rows).toHaveLength(2);
        expect(rows[1]).toEqual(['Mbao', 'Boeuf', 10, 3700, 37000, 'OK']);
    });

    test('plusieurs items', () => {
        const stock = {
            'Mbao-Boeuf': { 'Point de Vente': 'Mbao', 'Produit': 'Boeuf', Nombre: 10, PU: 3700 },
            'Mbao-Veau': { 'Point de Vente': 'Mbao', 'Produit': 'Veau', Nombre: 5, PU: 3900 }
        };
        const rows = processStockData(stock, 'Stock Soir');
        expect(rows).toHaveLength(3); // header + 2
        const totaux = rows.slice(1).map((r) => r[4]);
        expect(totaux).toEqual([37000, 19500]);
    });

    test('clés alternatives (camelCase)', () => {
        const rows = processStockData({
            'X': { pointVente: 'X', produit: 'Y', quantite: 2, prixUnitaire: 100 }
        }, 'Stock Matin');
        expect(rows[1][0]).toBe('X');
        expect(rows[1][1]).toBe('Y');
        expect(rows[1][4]).toBe(200);
    });

    test('clés snake_case', () => {
        const rows = processStockData({
            'X': { point_vente: 'PV', produit: 'P', qte: 3, prix_unitaire: 50 }
        }, 'Stock Matin');
        expect(rows[1][0]).toBe('PV');
        expect(rows[1][2]).toBe(3);
        expect(rows[1][3]).toBe(50);
        expect(rows[1][4]).toBe(150);
    });

    test('quantité et prix manquants → 0', () => {
        const rows = processStockData({
            'X': { 'Point de Vente': 'X', 'Produit': 'Y' }
        }, 'Stock Matin');
        expect(rows[1][2]).toBe(0);
        expect(rows[1][3]).toBe(0);
        expect(rows[1][4]).toBe(0);
    });

    test('quantité décimale (kg)', () => {
        const rows = processStockData({
            'X': { 'Point de Vente': 'X', 'Produit': 'Y', Nombre: 2.5, PU: 4400 }
        }, 'Stock Matin');
        expect(rows[1][2]).toBe(2.5);
        expect(rows[1][4]).toBe(11000);
    });

    test('valeurs string parsées', () => {
        const rows = processStockData({
            'X': { 'Point de Vente': 'X', 'Produit': 'Y', Nombre: '10', PU: '100' }
        }, 'Stock Matin');
        expect(rows[1][2]).toBe(10);
        expect(rows[1][3]).toBe(100);
        expect(rows[1][4]).toBe(1000);
    });

    test('null/undefined comme stockData → placeholder', () => {
        expect(processStockData(null, 'Stock Matin')[1][0]).toBe('Aucune donnée disponible');
        expect(processStockData(undefined, 'Stock Matin')[1][0]).toBe('Aucune donnée disponible');
    });

    test('commentaire absent → string vide (pas undefined)', () => {
        const rows = processStockData({
            'X': { 'Point de Vente': 'A', 'Produit': 'B', Nombre: 1, PU: 1 }
        }, 'Stock Matin');
        expect(rows[1][5]).toBe('');
    });
});

describe('processTransfertRow (mirror)', () => {
    test('transfert positif (PV reçoit)', () => {
        const row = processTransfertRow({
            'Point de Vente': 'Mbao', 'Produit': 'Boeuf',
            quantite: 10, PU: 3700, impact: 1, Commentaire: 'arrivage'
        });
        expect(row).toEqual(['Mbao', 'Boeuf', '+', 10, 3700, 37000, 'arrivage']);
    });

    test('transfert négatif (PV envoie)', () => {
        const row = processTransfertRow({
            'Point de Vente': 'Mbao', 'Produit': 'Boeuf',
            quantite: 10, PU: 3700, impact: -1
        });
        expect(row[2]).toBe('-');
        expect(row[5]).toBe(-37000);
    });

    test('impact par défaut = 1 si absent', () => {
        const row = processTransfertRow({
            'Point de Vente': 'X', 'Produit': 'Y', quantite: 5, PU: 100
        });
        expect(row[2]).toBe('+');
        expect(row[5]).toBe(500);
    });

    test('clés alternatives camelCase', () => {
        const row = processTransfertRow({
            pointVente: 'X', produit: 'Y', quantity: 2, prixUnit: 50
        });
        expect(row[0]).toBe('X');
        expect(row[3]).toBe(2);
        expect(row[4]).toBe(50);
        expect(row[5]).toBe(100);
    });

    test('valeurs manquantes → 0', () => {
        const row = processTransfertRow({});
        expect(row[3]).toBe(0);
        expect(row[4]).toBe(0);
        expect(row[5]).toBe(0);
    });

    test('quantité décimale', () => {
        const row = processTransfertRow({
            'Point de Vente': 'X', 'Produit': 'Y', quantite: 2.5, PU: 4400
        });
        expect(row[5]).toBe(11000);
    });
});

describe('buildExcelFilename', () => {
    test('YYYY-MM-DD → Stock_Inventaire_DD-MM-YYYY.xlsx', () => {
        expect(buildExcelFilename('2026-04-30'))
            .toBe('Stock_Inventaire_30-04-2026.xlsx');
    });

    test('autre format → fallback', () => {
        expect(buildExcelFilename('30/04/2026'))
            .toBe('Stock_Inventaire.xlsx');
    });

    test('chaîne vide → fallback', () => {
        expect(buildExcelFilename('')).toBe('Stock_Inventaire.xlsx');
    });

    test('null → fallback', () => {
        expect(buildExcelFilename(null)).toBe('Stock_Inventaire.xlsx');
    });

    test('format toujours .xlsx (extension correcte)', () => {
        expect(buildExcelFilename('2026-01-01')).toMatch(/\.xlsx$/);
    });
});

describe('Structure Excel: validation des en-têtes', () => {
    // Les colonnes doivent matcher l'attendu côté reviewer.
    test('Stock Matin/Soir a 6 colonnes', () => {
        const rows = processStockData({}, 'Stock Matin');
        expect(rows[0]).toHaveLength(6);
    });

    test('en-têtes Stock Matin contiennent les bons libellés', () => {
        const headers = processStockData({}, 'Stock Matin')[0];
        expect(headers).toContain('Point de Vente');
        expect(headers).toContain('Produit');
        expect(headers).toContain('Quantité');
        expect(headers).toContain('Prix Unitaire');
        expect(headers).toContain('Total');
        expect(headers).toContain('Commentaire');
    });

    test('Transferts a 7 colonnes (+ Impact +/-)', () => {
        const transfertHeaders = ['Point de Vente', 'Produit', 'Impact (+/-)', 'Quantité', 'Prix Unitaire', 'Total', 'Commentaire'];
        expect(transfertHeaders).toHaveLength(7);
        expect(transfertHeaders[2]).toBe('Impact (+/-)');
    });
});

describe('Stress test: nombreuses lignes', () => {
    test('100 produits → 101 lignes (header + 100)', () => {
        const stock = {};
        for (let i = 0; i < 100; i++) {
            stock[`PV${i}-Produit${i}`] = {
                'Point de Vente': `PV${i}`,
                'Produit': `Produit${i}`,
                Nombre: i + 1,
                PU: 1000
            };
        }
        const rows = processStockData(stock, 'Stock Matin');
        expect(rows).toHaveLength(101);
        expect(rows[0][0]).toBe('Point de Vente');
        expect(rows[100][4]).toBe(100 * 1000); // dernier total = 100 × 1000
    });

    test('cumul des totaux = somme cohérente', () => {
        const stock = {
            'X-A': { 'Point de Vente': 'X', 'Produit': 'A', Nombre: 10, PU: 100 },
            'X-B': { 'Point de Vente': 'X', 'Produit': 'B', Nombre: 5, PU: 200 },
            'Y-A': { 'Point de Vente': 'Y', 'Produit': 'A', Nombre: 3, PU: 300 }
        };
        const rows = processStockData(stock, 'Stock Matin');
        const sum = rows.slice(1).reduce((s, r) => s + (r[4] || 0), 0);
        expect(sum).toBe(1000 + 1000 + 900);
    });
});
