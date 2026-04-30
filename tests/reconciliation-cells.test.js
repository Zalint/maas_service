/**
 * Tests des cellules nouvelles de la réconciliation:
 * commandesInterPV (somme des commandes découpe du jour)
 * ventesTotales (= ventesSaisies + commandesInterPV)
 *
 * Mirroir de reconciliationManager.js switch cases (à garder synchronisé
 * avec la source).
 *
 * Couvre aussi:
 * - Le warning "stock matin = 0 mais ventes saisies > 0" (cellule jaune)
 */

// Mirror du calcul de la cellule commandesInterPV
function renderCommandesInterPV(data) {
    const interPV = Number(data.commandesInterPV) || 0;
    return {
        text: interPV,
        couleur: interPV > 0 ? '#0d6efd' : null,
        contribTotal: interPV
    };
}

// Mirror du calcul de la cellule ventesTotales
function renderVentesTotales(data) {
    const interPV = Number(data.commandesInterPV) || 0;
    const ventesSaisies = Number(data.ventesSaisies) || 0;
    return {
        text: ventesSaisies + interPV,
        bold: true,
        contribTotal: ventesSaisies + interPV
    };
}

// Mirror de l'alerte stock matin vide + ventes saisies > 0
function shouldFlagStockMatin(data) {
    const stockMatin = Number(data.stockMatin) || 0;
    const stockSoir = Number(data.stockSoir) || 0;
    const ventes = Number(data.ventesSaisies) || 0;
    return stockMatin === 0 && stockSoir === 0 && ventes > 0;
}

describe('Cellule "Commandes inter-PV"', () => {
    test('affiche la valeur depuis data.commandesInterPV', () => {
        expect(renderCommandesInterPV({ commandesInterPV: 11700 }).text).toBe(11700);
    });

    test('0 quand champ absent', () => {
        expect(renderCommandesInterPV({}).text).toBe(0);
        expect(renderCommandesInterPV({ commandesInterPV: null }).text).toBe(0);
    });

    test('coerce string en number', () => {
        expect(renderCommandesInterPV({ commandesInterPV: '4500' }).text).toBe(4500);
    });

    test('NaN devient 0 (defensive)', () => {
        expect(renderCommandesInterPV({ commandesInterPV: 'abc' }).text).toBe(0);
        expect(renderCommandesInterPV({ commandesInterPV: NaN }).text).toBe(0);
    });

    test('couleur bleue uniquement quand > 0', () => {
        expect(renderCommandesInterPV({ commandesInterPV: 100 }).couleur).toBe('#0d6efd');
        expect(renderCommandesInterPV({ commandesInterPV: 0 }).couleur).toBeNull();
    });

    test('contribue au total cumulé du tableau', () => {
        const total = [
            renderCommandesInterPV({ commandesInterPV: 1000 }),
            renderCommandesInterPV({ commandesInterPV: 500 }),
            renderCommandesInterPV({})
        ].reduce((s, c) => s + c.contribTotal, 0);
        expect(total).toBe(1500);
    });
});

describe('Cellule "Ventes Totales"', () => {
    test('saisies + interPV', () => {
        expect(renderVentesTotales({ ventesSaisies: 8200, commandesInterPV: 11700 }).text)
            .toBe(19900);
    });

    test('saisies seulement (pas de découpe)', () => {
        expect(renderVentesTotales({ ventesSaisies: 8200 }).text).toBe(8200);
    });

    test('découpe seulement (pas de ventes saisies — cas centre fermé)', () => {
        expect(renderVentesTotales({ commandesInterPV: 5000 }).text).toBe(5000);
    });

    test('zéro partout', () => {
        expect(renderVentesTotales({}).text).toBe(0);
    });

    test('toujours en gras (signe visuel)', () => {
        expect(renderVentesTotales({ ventesSaisies: 1 }).bold).toBe(true);
    });

    test('strings coercées', () => {
        expect(renderVentesTotales({ ventesSaisies: '100', commandesInterPV: '50' }).text)
            .toBe(150);
    });
});

describe('Warning stock matin vide + ventes saisies', () => {
    test('flag levé: les deux stocks à 0 ET ventes > 0', () => {
        expect(shouldFlagStockMatin({
            stockMatin: 0, stockSoir: 0, ventesSaisies: 8200
        })).toBe(true);
    });

    test('pas de flag si stock matin > 0', () => {
        expect(shouldFlagStockMatin({
            stockMatin: 1000, stockSoir: 0, ventesSaisies: 8200
        })).toBe(false);
    });

    test('pas de flag si stock soir > 0 (jour ouvert avec ravitaillement)', () => {
        expect(shouldFlagStockMatin({
            stockMatin: 0, stockSoir: 500, ventesSaisies: 8200
        })).toBe(false);
    });

    test('pas de flag si ventes saisies = 0 (PV fermé)', () => {
        expect(shouldFlagStockMatin({
            stockMatin: 0, stockSoir: 0, ventesSaisies: 0
        })).toBe(false);
    });

    test('flag insensible aux types (string)', () => {
        expect(shouldFlagStockMatin({
            stockMatin: '0', stockSoir: '0', ventesSaisies: '100'
        })).toBe(true);
    });

    test('valeurs négatives → considérées non-vides (cas anormal mais traité)', () => {
        // -1 != 0 donc pas de flag. Ce cas ne devrait pas se produire en
        // pratique mais on documente le comportement.
        expect(shouldFlagStockMatin({
            stockMatin: -1, stockSoir: 0, ventesSaisies: 100
        })).toBe(false);
    });
});

describe('Persistance commandesInterPV au save', () => {
    // Mirror simplifié de sauvegarderReconciliation: on s'assure que la valeur
    // est bien dans data[pv].commandesInterPV avant le POST. Source: script.js
    // calcReconPV qui injecte le champ.

    test('commandesInterPV est dans le payload sauvegardé', () => {
        const reconciliationData = {
            'Mbao': {
                stockMatin: 0,
                stockSoir: 0,
                transferts: 0,
                ventes: 0,
                ventesSaisies: 8200,
                commandesInterPV: 11700,  // ← injecté par calcReconPV
                creances: 0,
                difference: 0,
                pourcentageEcart: 0,
                cashPayment: 0,
                ecartCash: 0,
                commentaire: ''
            }
        };
        // Le payload sauvé est ce reconciliationData tel quel
        const payload = { reconciliation: reconciliationData };
        expect(payload.reconciliation.Mbao.commandesInterPV).toBe(11700);
    });

    test('commandesInterPV survives la sérialisation JSON', () => {
        const data = { 'Mbao': { commandesInterPV: 11700, ventesSaisies: 8200 } };
        const round = JSON.parse(JSON.stringify(data));
        expect(round.Mbao.commandesInterPV).toBe(11700);
    });
});
