/**
 * Tests des formules métier de la réconciliation.
 *
 * La logique d'agrégation et de calcul vit dans script.js (calcReconPV) et
 * reconciliationManager.js (rendu des cellules). Ces tests verrouillent les
 * formules purement mathématiques utilisées par la PV, sans dépendre du DOM
 * ni de fetch.
 *
 * Mirroir des bouts de code source. À garder synchronisé.
 */

// =============== Mirroirs des formules ===============

/** Ventes théoriques = stockMatin - stockSoir + transferts */
function calculVentesTheoriques(data) {
    const sm = Number(data.stockMatin) || 0;
    const ss = Number(data.stockSoir) || 0;
    const tr = Number(data.transferts) || 0;
    return sm - ss + tr;
}

/** Écart = Ventes théoriques - Ventes saisies */
function calculEcart(data) {
    return calculVentesTheoriques(data) - (Number(data.ventesSaisies) || 0);
}

/** % Écart = écart / venteTheoriques * 100 (0 si VT = 0). */
function calculPourcentageEcart(data) {
    const vt = calculVentesTheoriques(data);
    if (vt === 0) return 0;
    return (calculEcart(data) / vt) * 100;
}

/** Écart cash = cashPayment - ventesSaisies */
function calculEcartCash(data) {
    return (Number(data.cashPayment) || 0) - (Number(data.ventesSaisies) || 0);
}

/** Sévérité visuelle de l'écart % (utilisé pour la coloration de cellule) */
function severitePourcentage(pct) {
    const abs = Math.abs(pct);
    if (abs > 10.5) return 'danger';     // rouge
    if (abs > 8) return 'warning';        // orange
    if (abs > 0) return 'success';        // vert
    return null;
}

// =============== Tests ===============

describe('calculVentesTheoriques', () => {
    test('formule de base SM=1000, SS=400, T=0 → 600', () => {
        expect(calculVentesTheoriques({
            stockMatin: 1000, stockSoir: 400, transferts: 0
        })).toBe(600);
    });

    test('avec transferts positifs', () => {
        // SM=1000, SS=400 → ventes locales 600. Transferts +200 (PV reçoit
        // 200 de stock supplémentaire intra-jour) → ventes théo = 800.
        expect(calculVentesTheoriques({
            stockMatin: 1000, stockSoir: 400, transferts: 200
        })).toBe(800);
    });

    test('avec transferts négatifs (PV qui envoie)', () => {
        expect(calculVentesTheoriques({
            stockMatin: 1000, stockSoir: 400, transferts: -200
        })).toBe(400);
    });

    test('cas dégénéré: SM=SS=T=0 → 0', () => {
        expect(calculVentesTheoriques({
            stockMatin: 0, stockSoir: 0, transferts: 0
        })).toBe(0);
    });

    test('valeurs absentes traitées comme 0', () => {
        expect(calculVentesTheoriques({})).toBe(0);
    });

    test('strings coercées', () => {
        expect(calculVentesTheoriques({
            stockMatin: '1000', stockSoir: '400', transferts: '0'
        })).toBe(600);
    });

    test('NaN → 0 (defensive)', () => {
        expect(calculVentesTheoriques({
            stockMatin: 'abc', stockSoir: 100, transferts: 0
        })).toBe(-100);
    });
});

describe('calculEcart', () => {
    test('écart positif (réel > saisi → vol/perte)', () => {
        expect(calculEcart({
            stockMatin: 1000, stockSoir: 400, transferts: 0,
            ventesSaisies: 500
        })).toBe(100);
    });

    test('écart négatif (saisi > réel → erreur de saisie)', () => {
        expect(calculEcart({
            stockMatin: 1000, stockSoir: 400, transferts: 0,
            ventesSaisies: 700
        })).toBe(-100);
    });

    test('écart nul (parfait)', () => {
        expect(calculEcart({
            stockMatin: 1000, stockSoir: 400, transferts: 0,
            ventesSaisies: 600
        })).toBe(0);
    });

    test('ventes saisies seules (pas de stock) → écart = -saisies', () => {
        expect(calculEcart({
            ventesSaisies: 5000
        })).toBe(-5000);
    });
});

describe('calculPourcentageEcart', () => {
    test('écart 100 / VT 600 = 16.67%', () => {
        const pct = calculPourcentageEcart({
            stockMatin: 1000, stockSoir: 400, transferts: 0,
            ventesSaisies: 500
        });
        expect(pct).toBeCloseTo(16.67, 1);
    });

    test('écart négatif → % négatif', () => {
        const pct = calculPourcentageEcart({
            stockMatin: 1000, stockSoir: 400, transferts: 0,
            ventesSaisies: 700
        });
        expect(pct).toBeCloseTo(-16.67, 1);
    });

    test('VT = 0 → pourcentage 0 (pas de division par zéro)', () => {
        expect(calculPourcentageEcart({
            stockMatin: 0, stockSoir: 0, transferts: 0,
            ventesSaisies: 100
        })).toBe(0);
    });

    test('écart nul → 0%', () => {
        expect(calculPourcentageEcart({
            stockMatin: 1000, stockSoir: 400, transferts: 0,
            ventesSaisies: 600
        })).toBe(0);
    });
});

describe('calculEcartCash', () => {
    test('cash > saisies → trop perçu (admin a déposé plus)', () => {
        expect(calculEcartCash({ cashPayment: 5500, ventesSaisies: 5000 })).toBe(500);
    });

    test('cash < saisies → manquant', () => {
        expect(calculEcartCash({ cashPayment: 4500, ventesSaisies: 5000 })).toBe(-500);
    });

    test('cash = saisies → OK (0)', () => {
        expect(calculEcartCash({ cashPayment: 5000, ventesSaisies: 5000 })).toBe(0);
    });

    test('cash absent → -saisies', () => {
        expect(calculEcartCash({ ventesSaisies: 5000 })).toBe(-5000);
    });
});

describe('severitePourcentage (coloration cellule)', () => {
    test('|écart| > 10.5% → danger (rouge)', () => {
        expect(severitePourcentage(11)).toBe('danger');
        expect(severitePourcentage(-15)).toBe('danger');
        expect(severitePourcentage(50)).toBe('danger');
    });

    test('|écart| entre 8% et 10.5% → warning (orange)', () => {
        expect(severitePourcentage(9)).toBe('warning');
        expect(severitePourcentage(-10)).toBe('warning');
        expect(severitePourcentage(10.5)).toBe('warning');
    });

    test('|écart| entre 0% et 8% → success (vert)', () => {
        expect(severitePourcentage(5)).toBe('success');
        expect(severitePourcentage(-2)).toBe('success');
        expect(severitePourcentage(8)).toBe('success');
    });

    test('écart 0% → null (pas de coloration)', () => {
        expect(severitePourcentage(0)).toBeNull();
    });

    test('seuils de transition exacts', () => {
        // 10.5 inclus dans warning (> 8 mais pas > 10.5)
        expect(severitePourcentage(10.5)).toBe('warning');
        // 10.51 → danger
        expect(severitePourcentage(10.51)).toBe('danger');
        // 8 inclus dans success (> 0 mais pas > 8)
        expect(severitePourcentage(8)).toBe('success');
        // 8.01 → warning
        expect(severitePourcentage(8.01)).toBe('warning');
    });
});

describe('Scénario complet: réconciliation Mbao 30/04', () => {
    // Cas réel inspiré du jeu de données du PR (mockReconciliationData
    // dans tests/reconciliation.test.js).
    const mbao = {
        stockMatin: 762200,
        stockSoir: 508800,
        transferts: 0,
        ventesSaisies: 226400,
        cashPayment: 220000
    };

    test('Ventes théoriques = 253 400', () => {
        expect(calculVentesTheoriques(mbao)).toBe(253400);
    });

    test('Écart = 27 000', () => {
        expect(calculEcart(mbao)).toBe(27000);
    });

    test('Pourcentage écart ≈ 10.66%', () => {
        expect(calculPourcentageEcart(mbao)).toBeCloseTo(10.66, 1);
    });

    test('Sévérité = warning (10.5 < 10.66 < 10.5 → danger)', () => {
        // 10.66 > 10.5 → danger
        expect(severitePourcentage(calculPourcentageEcart(mbao))).toBe('danger');
    });

    test('Écart cash = -6400 (manquant)', () => {
        expect(calculEcartCash(mbao)).toBe(-6400);
    });
});

describe('Sommation totale (ligne TOTAL du tableau)', () => {
    function totalize(rows) {
        return rows.reduce((acc, row) => {
            acc.stockMatin += Number(row.stockMatin) || 0;
            acc.stockSoir += Number(row.stockSoir) || 0;
            acc.transferts += Number(row.transferts) || 0;
            acc.ventesSaisies += Number(row.ventesSaisies) || 0;
            acc.commandesInterPV += Number(row.commandesInterPV) || 0;
            return acc;
        }, { stockMatin: 0, stockSoir: 0, transferts: 0, ventesSaisies: 0, commandesInterPV: 0 });
    }

    test('totaux sur 3 PV', () => {
        const rows = [
            { stockMatin: 1000, stockSoir: 400, transferts: 0, ventesSaisies: 600, commandesInterPV: 100 },
            { stockMatin: 2000, stockSoir: 800, transferts: -200, ventesSaisies: 1000, commandesInterPV: 0 },
            { stockMatin: 500, stockSoir: 100, transferts: 200, ventesSaisies: 600, commandesInterPV: 200 }
        ];
        expect(totalize(rows)).toEqual({
            stockMatin: 3500, stockSoir: 1300, transferts: 0,
            ventesSaisies: 2200, commandesInterPV: 300
        });
    });

    test('totaux préservent additivité de la formule (somme des VT = VT du total)', () => {
        const rows = [
            { stockMatin: 1000, stockSoir: 400, transferts: 0 },
            { stockMatin: 2000, stockSoir: 800, transferts: -200 }
        ];
        const total = totalize(rows);
        const sumVT = rows.reduce((s, r) => s + calculVentesTheoriques(r), 0);
        expect(calculVentesTheoriques(total)).toBe(sumVT);
    });
});
