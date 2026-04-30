/**
 * Tests des transformations sur les données de stock inventaire.
 *
 * Logique mirroirée depuis script.js (calcul de montant par ligne, agrégation
 * par PV, parsing des clés "PV-Produit"). À garder synchronisé.
 */

// =============== Mirroirs ===============

/** Calcul du montant d'une ligne de stock = quantite × prixUnitaire */
function calculMontantLigne(item) {
    const q = parseFloat(item.Quantite || item.Nombre || item.quantite || 0);
    const pu = parseFloat(item.PU || item.prixUnitaire || 0);
    if (item.Montant !== undefined) return parseFloat(item.Montant);
    if (item.total !== undefined) return parseFloat(item.total);
    return q * pu;
}

/** Parse une clé "PV-Produit" en {pv, produit}. Gère les noms produits avec tirets. */
function parseStockKey(key) {
    const [pv, ...rest] = String(key).split('-');
    return { pv, produit: rest.join('-') };
}

/** Agrège un objet stock {key: item} en {pv: total} pour les PV passés en allowList */
function agregerStockParPV(stockObj, pointsVente) {
    const totaux = {};
    for (const pv of pointsVente) totaux[pv] = 0;
    for (const [key, item] of Object.entries(stockObj || {})) {
        const { pv } = parseStockKey(key);
        if (pointsVente.includes(pv)) {
            totaux[pv] = (totaux[pv] || 0) + calculMontantLigne(item);
        }
    }
    return totaux;
}

/** Filtre les lignes du stock selon le filtre PV/produit/quantité non-zéro */
function filtrerLignesStock(lignes, filtres) {
    const { pointVente, produit, masquerZero } = filtres;
    return lignes.filter((row) => {
        if (pointVente !== 'tous' && row.pv !== pointVente) return false;
        if (produit !== 'tous' && row.produit !== produit) return false;
        if (masquerZero && (Number(row.quantite) || 0) === 0) return false;
        return true;
    });
}

// =============== Tests ===============

describe('calculMontantLigne', () => {
    test('Quantite × PU (clés majuscules)', () => {
        expect(calculMontantLigne({ Quantite: 10, PU: 100 })).toBe(1000);
    });

    test('Nombre × PU (alias historique)', () => {
        expect(calculMontantLigne({ Nombre: 5, PU: 200 })).toBe(1000);
    });

    test('quantite × prixUnitaire (camelCase)', () => {
        expect(calculMontantLigne({ quantite: 3, prixUnitaire: 500 })).toBe(1500);
    });

    test('Montant explicite prend précédence', () => {
        expect(calculMontantLigne({ Quantite: 10, PU: 100, Montant: 1500 }))
            .toBe(1500);
    });

    test('total explicite (alias) prend précédence aussi', () => {
        expect(calculMontantLigne({ Quantite: 10, PU: 100, total: 999 }))
            .toBe(999);
    });

    test('valeurs string parsées', () => {
        expect(calculMontantLigne({ Quantite: '5', PU: '100' })).toBe(500);
    });

    test('item vide → 0', () => {
        expect(calculMontantLigne({})).toBe(0);
    });

    test('quantité décimale (kg) — pesée', () => {
        expect(calculMontantLigne({ Quantite: 2.5, PU: 4400 })).toBe(11000);
    });
});

describe('parseStockKey (PV-Produit)', () => {
    test('clé simple', () => {
        expect(parseStockKey('Mbao-Boeuf')).toEqual({ pv: 'Mbao', produit: 'Boeuf' });
    });

    test('produit avec tiret (ne casse pas)', () => {
        expect(parseStockKey('Mbao-Boeuf-en-détail'))
            .toEqual({ pv: 'Mbao', produit: 'Boeuf-en-détail' });
    });

    test('PV multi-mot (avec espace)', () => {
        expect(parseStockKey('Sacre Coeur-Foie'))
            .toEqual({ pv: 'Sacre Coeur', produit: 'Foie' });
    });

    test('clé sans tiret', () => {
        expect(parseStockKey('Mbao')).toEqual({ pv: 'Mbao', produit: '' });
    });

    test('clé vide', () => {
        expect(parseStockKey('')).toEqual({ pv: '', produit: '' });
    });
});

describe('agregerStockParPV', () => {
    test('cas standard 1 PV 2 produits', () => {
        const stock = {
            'Mbao-Boeuf': { Quantite: 10, PU: 100 },         // 1000
            'Mbao-Veau': { Quantite: 5, PU: 200 }            // 1000
        };
        expect(agregerStockParPV(stock, ['Mbao'])).toEqual({ Mbao: 2000 });
    });

    test('plusieurs PV', () => {
        const stock = {
            'Mbao-Boeuf': { Quantite: 10, PU: 100 },
            'Sacre Coeur-Foie': { Quantite: 2, PU: 500 }
        };
        expect(agregerStockParPV(stock, ['Mbao', 'Sacre Coeur'])).toEqual({
            Mbao: 1000, 'Sacre Coeur': 1000
        });
    });

    test('PV non listé → ignoré (pas dans allowList)', () => {
        const stock = {
            'Mbao-Boeuf': { Quantite: 10, PU: 100 },
            'IntrusPV-Boeuf': { Quantite: 999, PU: 999 }
        };
        expect(agregerStockParPV(stock, ['Mbao'])).toEqual({ Mbao: 1000 });
    });

    test('PV listé mais sans données → 0', () => {
        expect(agregerStockParPV({}, ['Mbao', 'Keur Massar']))
            .toEqual({ Mbao: 0, 'Keur Massar': 0 });
    });

    test('stock null/undefined ne crash pas', () => {
        expect(agregerStockParPV(null, ['Mbao'])).toEqual({ Mbao: 0 });
        expect(agregerStockParPV(undefined, ['Mbao'])).toEqual({ Mbao: 0 });
    });
});

describe('filtrerLignesStock', () => {
    const lignes = [
        { pv: 'Mbao', produit: 'Boeuf', quantite: 10 },
        { pv: 'Mbao', produit: 'Veau', quantite: 0 },
        { pv: 'Sacre Coeur', produit: 'Boeuf', quantite: 5 },
        { pv: 'Sacre Coeur', produit: 'Foie', quantite: 0 }
    ];

    test('"tous" PV → toutes les lignes', () => {
        expect(filtrerLignesStock(lignes, {
            pointVente: 'tous', produit: 'tous', masquerZero: false
        })).toHaveLength(4);
    });

    test('filtre PV exact', () => {
        const out = filtrerLignesStock(lignes, {
            pointVente: 'Mbao', produit: 'tous', masquerZero: false
        });
        expect(out).toHaveLength(2);
        expect(out.every((r) => r.pv === 'Mbao')).toBe(true);
    });

    test('filtre produit exact', () => {
        const out = filtrerLignesStock(lignes, {
            pointVente: 'tous', produit: 'Boeuf', masquerZero: false
        });
        expect(out).toHaveLength(2);
        expect(out.every((r) => r.produit === 'Boeuf')).toBe(true);
    });

    test('masquer quantité = 0', () => {
        const out = filtrerLignesStock(lignes, {
            pointVente: 'tous', produit: 'tous', masquerZero: true
        });
        expect(out).toHaveLength(2);
        expect(out.every((r) => r.quantite > 0)).toBe(true);
    });

    test('combinaison tous filtres', () => {
        const out = filtrerLignesStock(lignes, {
            pointVente: 'Mbao', produit: 'Boeuf', masquerZero: true
        });
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ pv: 'Mbao', produit: 'Boeuf', quantite: 10 });
    });

    test('quantité string traitée comme nombre', () => {
        const out = filtrerLignesStock(
            [{ pv: 'X', produit: 'Y', quantite: '0' }, { pv: 'X', produit: 'Y', quantite: '5' }],
            { pointVente: 'tous', produit: 'tous', masquerZero: true }
        );
        expect(out).toHaveLength(1);
        expect(out[0].quantite).toBe('5');
    });
});

describe('Scénario inventaire complet (script.js calcReconPV)', () => {
    test('agrégation stock matin Mbao avec mix de produits', () => {
        const stockMatin = {
            'Mbao-Boeuf en gros': { Quantite: 100, PU: 3500 },         // 350000
            'Mbao-Boeuf en détail': { Quantite: 50, PU: 3700 },        // 185000
            'Mbao-Foie': { Quantite: 20, PU: 3000 },                   // 60000
            'Mbao-Yell': { Quantite: 10, PU: 2500 },                   // 25000
            'IntrusPV-X': { Quantite: 999, PU: 999 }                   // ignoré
        };
        const totaux = agregerStockParPV(stockMatin, ['Mbao']);
        expect(totaux.Mbao).toBe(620000);
    });

    test('scénario stock vide pour PV → 0 (filet de sécurité réconciliation)', () => {
        const totaux = agregerStockParPV({}, ['Mbao', 'Keur Massar']);
        expect(totaux.Mbao).toBe(0);
        expect(totaux['Keur Massar']).toBe(0);
    });
});
