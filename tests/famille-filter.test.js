/**
 * Tests des helpers de filtre famille (admin.js — Produits Généraux + Inventaire).
 *
 * Mirroir des fonctions admin.js (à garder synchronisé avec la source).
 */

// =============== Mirror Produits Généraux ===============
const inventaireFamilleDefauts = {
    'Viandes': 'Boucherie',
    'Abats et Sous-produits': 'Boucherie',
    'Produits sur Pieds': 'Boucherie',
    'Œufs et Produits Laitiers': 'Epicerie',
    'Déchets': 'Autres',
    'Autres': 'Autres'
};

function familleDeCategorie(meta, nom) {
    const m = meta[nom];
    return m && m.famille ? m.famille : 'Autres';
}

function familleDeCategorieInventaire(overrides, nom) {
    if (overrides && overrides[nom]) return overrides[nom];
    return inventaireFamilleDefauts[nom] || 'Autres';
}

function filtrerCategoriesParFamille(categories, currentFilter, lookup) {
    if (currentFilter === 'Tous') return categories.slice();
    return categories.filter((cat) => lookup(cat) === currentFilter);
}

describe('familleDeCategorie (Produits Généraux)', () => {
    const meta = {
        Bovin: { id: 4, famille: 'Boucherie', ordre: 1 },
        Ovin: { id: 5, famille: 'Boucherie', ordre: 2 },
        Pack: { id: 6, famille: 'Epicerie', ordre: 3 },
        Conserve: { id: 7, famille: 'Autres', ordre: 4 }
    };

    test('lit la famille depuis meta', () => {
        expect(familleDeCategorie(meta, 'Bovin')).toBe('Boucherie');
        expect(familleDeCategorie(meta, 'Pack')).toBe('Epicerie');
    });

    test('catégorie absente de meta → Autres', () => {
        expect(familleDeCategorie(meta, 'Inconnue')).toBe('Autres');
    });

    test('meta sans champ famille → Autres', () => {
        expect(familleDeCategorie({ X: { id: 1 } }, 'X')).toBe('Autres');
    });

    test('meta vide → Autres', () => {
        expect(familleDeCategorie({}, 'Bovin')).toBe('Autres');
    });
});

describe('familleDeCategorieInventaire', () => {
    test('Viandes par défaut → Boucherie', () => {
        expect(familleDeCategorieInventaire({}, 'Viandes')).toBe('Boucherie');
    });

    test('Abats par défaut → Boucherie', () => {
        expect(familleDeCategorieInventaire({}, 'Abats et Sous-produits')).toBe('Boucherie');
    });

    test('Œufs par défaut → Epicerie', () => {
        expect(familleDeCategorieInventaire({}, 'Œufs et Produits Laitiers')).toBe('Epicerie');
    });

    test('Déchets par défaut → Autres', () => {
        expect(familleDeCategorieInventaire({}, 'Déchets')).toBe('Autres');
    });

    test('catégorie custom inconnue → Autres', () => {
        expect(familleDeCategorieInventaire({}, 'Conserve')).toBe('Autres');
    });

    test('override prend précédence sur défaut', () => {
        expect(familleDeCategorieInventaire(
            { 'Viandes': 'Autres' }, 'Viandes'
        )).toBe('Autres');
    });

    test('override pour catégorie custom', () => {
        expect(familleDeCategorieInventaire(
            { 'Conserve': 'Epicerie' }, 'Conserve'
        )).toBe('Epicerie');
    });

    test('overrides null/undefined → utilise les défauts', () => {
        expect(familleDeCategorieInventaire(null, 'Viandes')).toBe('Boucherie');
        expect(familleDeCategorieInventaire(undefined, 'Viandes')).toBe('Boucherie');
    });

    test('seed exhaustif: les 6 catégories standard ont une famille connue', () => {
        const standards = [
            'Viandes', 'Abats et Sous-produits', 'Produits sur Pieds',
            'Œufs et Produits Laitiers', 'Déchets', 'Autres'
        ];
        for (const cat of standards) {
            expect(familleDeCategorieInventaire({}, cat)).toMatch(/^(Boucherie|Epicerie|Autres)$/);
        }
    });
});

describe('filtrerCategoriesParFamille', () => {
    const meta = {
        Bovin: { famille: 'Boucherie' },
        Ovin: { famille: 'Boucherie' },
        Pack: { famille: 'Epicerie' },
        Conserve: { famille: 'Autres' }
    };
    const categories = ['Bovin', 'Ovin', 'Pack', 'Conserve'];
    const lookup = (cat) => familleDeCategorie(meta, cat);

    test('"Tous" retourne toutes les catégories', () => {
        expect(filtrerCategoriesParFamille(categories, 'Tous', lookup))
            .toEqual(categories);
    });

    test('"Boucherie" filtre correctement', () => {
        expect(filtrerCategoriesParFamille(categories, 'Boucherie', lookup))
            .toEqual(['Bovin', 'Ovin']);
    });

    test('"Epicerie" filtre correctement', () => {
        expect(filtrerCategoriesParFamille(categories, 'Epicerie', lookup))
            .toEqual(['Pack']);
    });

    test('"Autres" filtre correctement', () => {
        expect(filtrerCategoriesParFamille(categories, 'Autres', lookup))
            .toEqual(['Conserve']);
    });

    test('famille sans match → tableau vide', () => {
        expect(filtrerCategoriesParFamille(categories, 'Pirate', lookup))
            .toEqual([]);
    });

    test('catégorie sans meta → famille Autres', () => {
        const cats = ['Bovin', 'CatInconnue'];
        expect(filtrerCategoriesParFamille(cats, 'Autres', lookup))
            .toEqual(['CatInconnue']);
    });

    test('"Tous" retourne une copie (ne mute pas l\'original)', () => {
        const arr = ['A', 'B'];
        const out = filtrerCategoriesParFamille(arr, 'Tous', () => 'X');
        out.push('mutated');
        expect(arr).toEqual(['A', 'B']);
    });
});
