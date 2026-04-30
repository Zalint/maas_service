/**
 * Tests des helpers frontend pure (échappement, format date, lecture
 * defensive). Couvre les zones où des bugs concrets ont été observés:
 *  - escAttr: XSS-via-admin sur les noms de catégorie/produit
 *  - formatLocalYMD: filtre date inter-PV (timezone safe)
 *  - rowCreatedAt: lecture defensive createdAt vs created_at
 *  - detection produit auto via badge ⚡ (filtrerStock)
 *
 * Les helpers ne sont pas exportés depuis admin.js / pos.js (script tag
 * inclus dans le HTML, pas un module). On les ré-implémente ici en miroir
 * et on garde une note: si la source change, ces tests doivent suivre.
 */

/**
 * Mirror de admin.js → escAttr. Échappe les caractères qui peuvent casser
 * un attribut HTML (et au passage la séquence < > pour le contenu).
 */
function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Mirror de pos.js → formatLocalYMD. */
function formatLocalYMD(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** Mirror de pos.js → rowCreatedAt: lecture defensive camelCase ou snake_case. */
function rowCreatedAt(row) {
    return (row && (row.createdAt || row.created_at)) || null;
}

describe('escAttr (XSS-via-admin)', () => {
    test('chaîne simple inchangée', () => {
        expect(escAttr('Bovin')).toBe('Bovin');
        expect(escAttr('Boeuf en détail')).toBe('Boeuf en détail');
    });

    test('échappe les apostrophes (cassait l\'ancien handler inline)', () => {
        expect(escAttr("L'agneau")).toBe('L&#39;agneau');
    });

    test('échappe les guillemets', () => {
        expect(escAttr('Categorie "spéciale"')).toBe('Categorie &quot;spéciale&quot;');
    });

    test('échappe les chevrons (anti-XSS HTML)', () => {
        expect(escAttr('<script>alert(1)</script>'))
            .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('échappe & en premier (sinon double-encode)', () => {
        expect(escAttr('A&B')).toBe('A&amp;B');
        // Critical: '&' doit être encodé AVANT les autres pour éviter
        // que '<' soit transformé en '&lt;' puis le '&' suivant produise '&amp;lt;'
        expect(escAttr('A & B < C')).toBe('A &amp; B &lt; C');
    });

    test('null/undefined retournent chaîne vide', () => {
        expect(escAttr(null)).toBe('');
        expect(escAttr(undefined)).toBe('');
    });

    test('nombres sont stringifiés', () => {
        expect(escAttr(42)).toBe('42');
        expect(escAttr(0)).toBe('0');
    });

    test('séquence d\'attaque réelle: nom de catégorie tentant de casser un attribut', () => {
        const malicieux = `Bovin" onclick="alert('xss')`;
        const echappe = escAttr(malicieux);
        // Ne contient plus de quote brut qui sortirait de l'attribut
        expect(echappe).not.toMatch(/[^&]"/);
        expect(echappe).toContain('&quot;');
        // L'apostrophe est aussi échappée
        expect(echappe).toContain('&#39;');
    });
});

describe('formatLocalYMD (filtre date inter-PV)', () => {
    test('format YYYY-MM-DD avec padding', () => {
        const d = new Date(2026, 3, 5); // 5 avril 2026 (mois 0-indexed)
        expect(formatLocalYMD(d)).toBe('2026-04-05');
    });

    test('janvier (mois=0) padded en 01', () => {
        const d = new Date(2026, 0, 1);
        expect(formatLocalYMD(d)).toBe('2026-01-01');
    });

    test('décembre 31 padded correctement', () => {
        const d = new Date(2026, 11, 31);
        expect(formatLocalYMD(d)).toBe('2026-12-31');
    });

    test('utilise getDate (local) pas getUTCDate', () => {
        // Construction depuis un timestamp UTC près de minuit local.
        // Le test ne peut pas vraiment vérifier la TZ runtime mais peut
        // confirmer que getDate/getMonth/getFullYear sont utilisés (donc
        // local time, pas UTC).
        const d = new Date(2026, 3, 30, 12, 0, 0); // midi local, sans ambiguïté
        expect(formatLocalYMD(d)).toBe('2026-04-30');
    });

    test('matche le format de <input type="date">.value', () => {
        // Le HTML date input renvoie toujours YYYY-MM-DD. Vérifions que notre
        // helper produit une chaîne compatible pour l'égalité directe.
        const inputValue = '2026-04-30';
        const fromDate = formatLocalYMD(new Date(2026, 3, 30, 14, 30, 0));
        expect(fromDate === inputValue).toBe(true);
    });
});

describe('rowCreatedAt (lecture defensive)', () => {
    test('lit createdAt (camelCase Sequelize default)', () => {
        const row = { createdAt: '2026-04-30T10:00:00.000Z' };
        expect(rowCreatedAt(row)).toBe('2026-04-30T10:00:00.000Z');
    });

    test('lit created_at en fallback (snake_case)', () => {
        const row = { created_at: '2026-04-30T10:00:00.000Z' };
        expect(rowCreatedAt(row)).toBe('2026-04-30T10:00:00.000Z');
    });

    test('createdAt prioritaire sur created_at quand les deux sont présents', () => {
        const row = {
            createdAt: '2026-04-30T10:00:00.000Z',
            created_at: '2025-01-01T00:00:00.000Z'
        };
        expect(rowCreatedAt(row)).toBe('2026-04-30T10:00:00.000Z');
    });

    test('row null/undefined → null (pas de crash)', () => {
        expect(rowCreatedAt(null)).toBeNull();
        expect(rowCreatedAt(undefined)).toBeNull();
    });

    test('row sans aucune des deux clés → null', () => {
        expect(rowCreatedAt({ id: 1, ref: 'X' })).toBeNull();
    });

    test('valeur falsy mais légitime (chaîne vide) → traitée comme absente', () => {
        // Comportement actuel: || considère '' comme falsy et passe au suivant.
        // Acceptable parce qu'une chaîne vide n'est pas une date valide.
        expect(rowCreatedAt({ createdAt: '', created_at: '2026-04-30T10:00:00.000Z' }))
            .toBe('2026-04-30T10:00:00.000Z');
    });
});

describe('Detection produit auto (filtrerStock)', () => {
    /**
     * Reproduit la détection de filtrerStock côté pos.js: une cellule
     * contient le badge ⚡ via <span class="badge bg-primary">⚡</span>.
     */
    function isAutoRow(produitCellHtml) {
        // jsdom est disponible via testEnvironment: 'jsdom' dans jest.config.js
        const div = document.createElement('div');
        div.innerHTML = `<table><tbody><tr><td>${produitCellHtml}</td></tr></tbody></table>`;
        const cell = div.querySelector('td');
        return !!(cell && cell.querySelector('.badge.bg-primary'));
    }

    test('cellule avec badge bg-primary détectée comme auto', () => {
        expect(isAutoRow('<span class="badge bg-primary">⚡</span><select><option>Boeuf</option></select>'))
            .toBe(true);
    });

    test('cellule sans badge → non auto', () => {
        expect(isAutoRow('<select><option>Boeuf en détail</option></select>'))
            .toBe(false);
    });

    test('cellule avec un autre badge n\'est pas considérée auto', () => {
        expect(isAutoRow('<span class="badge bg-success">OK</span>Boeuf'))
            .toBe(false);
    });

    test('texte "Auto" sans le badge n\'est pas considéré auto', () => {
        // Bug historique: la première version cherchait /\bAuto\b/ dans le
        // texte, qui ne matchait pas le badge ⚡ (et faussement matchait
        // un produit nommé "Sauce Auto"). Le fix utilise la classe CSS.
        expect(isAutoRow('<select><option>Sauce Auto</option></select>'))
            .toBe(false);
    });
});
