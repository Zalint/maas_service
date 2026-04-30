/**
 * Tests des helpers ajoutés à script.js par le PR maas_service:
 * - Conversion de date DD/MM/YYYY → YYYY-MM-DD avant fetch /api/decoupe/sum-*
 *   (calcReconPV + chargerVentes)
 * - Calcul du total combiné Ventes + Découpe pour la card Visualisation
 *
 * Mirroir des bouts inline de script.js (à garder synchronisé).
 */

// Mirror de la conversion de date dans calcReconPV (script.js:6624-6625)
function convertDateToISO(dateSelectionnee) {
    const m = String(dateSelectionnee).match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : dateSelectionnee;
}

// Mirror de formatDateForApi dans chargerVentes (script.js:3702)
function formatDateForApi(dateStr) {
    if (!dateStr) return '';
    const [jour, mois, annee] = dateStr.split('/');
    let year = parseInt(annee);
    let month = parseInt(mois);
    let day = parseInt(jour);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Mirror du calcul des cards Visualisation
function buildVisualisationCards({ montantTotal, totalDecoupe }) {
    const safe = (v) => Number(v) || 0;
    const ventes = safe(montantTotal);
    const decoupe = safe(totalDecoupe);
    return {
        montantTotal: ventes,
        totalDecoupe: decoupe,
        totalCombine: ventes + decoupe
    };
}

describe('convertDateToISO (calcReconPV → /api/decoupe/sum-by-pv)', () => {
    test('DD/MM/YYYY → YYYY-MM-DD', () => {
        expect(convertDateToISO('30/04/2026')).toBe('2026-04-30');
    });

    test('DD-MM-YYYY (avec tirets) → YYYY-MM-DD', () => {
        expect(convertDateToISO('30-04-2026')).toBe('2026-04-30');
    });

    test('formats déjà ISO retournés tels quels', () => {
        // Le mirroir actuel ne re-vérifie PAS l'ISO, donc passe-through
        expect(convertDateToISO('2026-04-30')).toBe('2026-04-30');
    });

    test('chaîne invalide passe-through (le serveur la rejettera)', () => {
        expect(convertDateToISO('hier')).toBe('hier');
        expect(convertDateToISO('')).toBe('');
    });

    test('mois et jour à un chiffre supportés (10 chars exact requis)', () => {
        // Avec deux digits forcés par le regex \d{2}, "5/4/2026" ne matche pas
        // → passe-through. C'est cohérent avec calcReconPV qui reçoit toujours
        // de l'input HTML date avec padding zéro.
        expect(convertDateToISO('5/4/2026')).toBe('5/4/2026');
        expect(convertDateToISO('05/04/2026')).toBe('2026-04-05');
    });

    test('null/undefined → passe-through de la valeur originale', () => {
        // Comportement: String(null)="null" pour le match, mais retour
        // utilise dateSelectionnee originel (null) en cas de no-match.
        // L'appelant ne passe jamais null en pratique mais on documente.
        expect(convertDateToISO(null)).toBeNull();
        expect(convertDateToISO(undefined)).toBeUndefined();
    });
});

describe('formatDateForApi (chargerVentes → /api/decoupe/sum-range)', () => {
    test('DD/MM/YYYY → YYYY-MM-DD avec padding', () => {
        expect(formatDateForApi('30/04/2026')).toBe('2026-04-30');
    });

    test('jour et mois à un chiffre paddés', () => {
        expect(formatDateForApi('5/4/2026')).toBe('2026-04-05');
    });

    test('chaîne vide → vide', () => {
        expect(formatDateForApi('')).toBe('');
    });

    test('null/undefined → vide', () => {
        expect(formatDateForApi(null)).toBe('');
        expect(formatDateForApi(undefined)).toBe('');
    });

    test('format du résultat compatible avec /api/decoupe/sum-range', () => {
        const out = formatDateForApi('15/03/2026');
        expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('buildVisualisationCards (3 cards)', () => {
    test('total combiné = ventes + découpe', () => {
        expect(buildVisualisationCards({
            montantTotal: 100000,
            totalDecoupe: 25000
        })).toEqual({
            montantTotal: 100000,
            totalDecoupe: 25000,
            totalCombine: 125000
        });
    });

    test('decoupe à 0 → total combiné = ventes', () => {
        const out = buildVisualisationCards({ montantTotal: 50000, totalDecoupe: 0 });
        expect(out.totalCombine).toBe(50000);
    });

    test('ventes à 0 → total combiné = découpe', () => {
        const out = buildVisualisationCards({ montantTotal: 0, totalDecoupe: 7200 });
        expect(out.totalCombine).toBe(7200);
    });

    test('valeurs invalides traitées comme 0 (defensive)', () => {
        expect(buildVisualisationCards({
            montantTotal: 'abc',
            totalDecoupe: null
        })).toEqual({
            montantTotal: 0,
            totalDecoupe: 0,
            totalCombine: 0
        });
    });

    test('strings coercées en number', () => {
        expect(buildVisualisationCards({
            montantTotal: '50000',
            totalDecoupe: '10000'
        }).totalCombine).toBe(60000);
    });

    test('NaN évité même avec champ manquant', () => {
        const out = buildVisualisationCards({});
        expect(Number.isNaN(out.totalCombine)).toBe(false);
        expect(out.totalCombine).toBe(0);
    });
});

describe('PV filter pour /api/decoupe/sum-range', () => {
    // Mirror de la logique côté chargerVentes:
    //   if (pointVente && pointVente !== 'tous') params.append('pointVente', pointVente);
    function shouldAppendPV(pointVente) {
        return !!(pointVente && pointVente !== 'tous');
    }

    test('PV nommé → ajouté au query', () => {
        expect(shouldAppendPV('Mbao')).toBe(true);
    });

    test('PV "tous" → pas ajouté', () => {
        expect(shouldAppendPV('tous')).toBe(false);
    });

    test('PV vide / null → pas ajouté', () => {
        expect(shouldAppendPV('')).toBe(false);
        expect(shouldAppendPV(null)).toBe(false);
        expect(shouldAppendPV(undefined)).toBe(false);
    });
});
