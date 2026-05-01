/**
 * Tests des helpers du modal Centre de Découpe (pos.js).
 *
 * Mirroir des fonctions pos.js (à garder synchronisé):
 * - calcul du total panier
 * - validation client-side avant envoi
 * - construction du payload depuis le cart
 */

// Mirror du calcul de total panier (rendrePanierDecoupe → total)
function calculerTotalPanier(cart) {
    if (!Array.isArray(cart)) return 0;
    return cart.reduce((s, item) => {
        const price = Number(item.price) || 0;
        const qty = Number(item.quantity) || 0;
        return s + price * qty;
    }, 0);
}

// Mirror de la construction du payload depuis le cart (envoyerCommandeDecoupe)
function buildDecoupePayload({ cart, pointVente, centre, client }) {
    return {
        point_vente: pointVente,
        point_vente_executant: centre,
        produits: cart.map((item) => ({
            categorie: item.category,
            produit: item.name,
            prixUnit: item.price,
            nombre: item.quantity,
            montant: (item.price || 0) * (item.quantity || 0)
        })),
        montant_total: calculerTotalPanier(cart),
        nom_client: client.nom,
        numero_client: client.numero,
        adresse_client: client.adresse,
        instructions_client: client.instructions
    };
}

// Mirror de la validation client-side
function validateDecoupeForm({ cart, centre, nom, numero }) {
    const errors = [];
    if (!Array.isArray(cart) || cart.length === 0) {
        errors.push('Panier vide.');
    }
    if (!centre) {
        errors.push('Sélectionne un centre de découpe.');
    }
    if (!nom || !nom.trim()) {
        errors.push('Nom du client requis.');
    }
    if (!numero || !numero.trim()) {
        errors.push('Téléphone du client requis.');
    }
    return errors;
}

describe('calculerTotalPanier', () => {
    test('panier vide → 0', () => {
        expect(calculerTotalPanier([])).toBe(0);
    });

    test('non-array → 0 (defensive)', () => {
        expect(calculerTotalPanier(null)).toBe(0);
        expect(calculerTotalPanier(undefined)).toBe(0);
        expect(calculerTotalPanier({})).toBe(0);
    });

    test('un seul item', () => {
        expect(calculerTotalPanier([
            { name: 'Boeuf', price: 3700, quantity: 2 }
        ])).toBe(7400);
    });

    test('plusieurs items', () => {
        expect(calculerTotalPanier([
            { price: 3700, quantity: 2 },
            { price: 3500, quantity: 1 },
            { price: 4500, quantity: 3 }
        ])).toBe(7400 + 3500 + 13500);
    });

    test('item sans price ou quantity → 0', () => {
        expect(calculerTotalPanier([
            { price: 100, quantity: 5 },
            { name: 'X' }, // pas de price/quantity
            { price: 200 } // pas de quantity
        ])).toBe(500);
    });

    test('coerce strings', () => {
        expect(calculerTotalPanier([
            { price: '100', quantity: '3' }
        ])).toBe(300);
    });

    test('valeurs invalides ne plantent pas (NaN évité)', () => {
        expect(calculerTotalPanier([
            { price: 'abc', quantity: 'def' },
            { price: 100, quantity: 2 }
        ])).toBe(200);
    });

    test('quantité décimale (kg)', () => {
        expect(calculerTotalPanier([
            { price: 4400, quantity: 2.5 }
        ])).toBe(11000);
    });
});

describe('buildDecoupePayload', () => {
    test('construit un payload Mata-compatible', () => {
        const out = buildDecoupePayload({
            cart: [
                { category: 'Bovin', name: 'Boeuf en détail', price: 3700, quantity: 2 }
            ],
            pointVente: 'Mbao',
            centre: 'Centre de Découpe Dakar',
            client: {
                nom: 'Test Client',
                numero: '770000000',
                adresse: 'Dakar',
                instructions: 'RAS'
            }
        });
        expect(out.point_vente).toBe('Mbao');
        expect(out.point_vente_executant).toBe('Centre de Découpe Dakar');
        expect(out.montant_total).toBe(7400);
        expect(out.produits).toHaveLength(1);
        expect(out.produits[0]).toEqual({
            categorie: 'Bovin',
            produit: 'Boeuf en détail',
            prixUnit: 3700,
            nombre: 2,
            montant: 7400
        });
        expect(out.nom_client).toBe('Test Client');
        expect(out.numero_client).toBe('770000000');
    });

    test('multiples produits', () => {
        const out = buildDecoupePayload({
            cart: [
                { category: 'Bovin', name: 'A', price: 1000, quantity: 1 },
                { category: 'Bovin', name: 'B', price: 2000, quantity: 2 }
            ],
            pointVente: 'Mbao',
            centre: 'Centre de Découpe Banlieue',
            client: { nom: 'X', numero: '1', adresse: '', instructions: '' }
        });
        expect(out.produits).toHaveLength(2);
        expect(out.montant_total).toBe(1000 + 4000);
    });

    test('cart vide → payload avec produits=[] et total=0', () => {
        const out = buildDecoupePayload({
            cart: [], pointVente: 'Mbao', centre: 'C',
            client: { nom: 'X', numero: '1' }
        });
        expect(out.produits).toEqual([]);
        expect(out.montant_total).toBe(0);
    });

    test('item sans price/quantity → montant 0 dans le produit', () => {
        const out = buildDecoupePayload({
            cart: [{ category: 'X', name: 'Y' }],
            pointVente: 'Mbao', centre: 'C',
            client: { nom: 'X', numero: '1' }
        });
        expect(out.produits[0].montant).toBe(0);
    });
});

describe('validateDecoupeForm', () => {
    const validCart = [{ name: 'X', price: 100, quantity: 1 }];

    test('formulaire complet → aucune erreur', () => {
        expect(validateDecoupeForm({
            cart: validCart, centre: 'Centre A', nom: 'X', numero: '1'
        })).toEqual([]);
    });

    test('panier vide rapporté', () => {
        const errors = validateDecoupeForm({
            cart: [], centre: 'C', nom: 'X', numero: '1'
        });
        expect(errors).toContain('Panier vide.');
    });

    test('cart non-array rapporté', () => {
        const errors = validateDecoupeForm({
            cart: null, centre: 'C', nom: 'X', numero: '1'
        });
        expect(errors).toContain('Panier vide.');
    });

    test('centre vide rapporté', () => {
        const errors = validateDecoupeForm({
            cart: validCart, centre: '', nom: 'X', numero: '1'
        });
        expect(errors).toContain('Sélectionne un centre de découpe.');
    });

    test('nom vide rapporté', () => {
        const errors = validateDecoupeForm({
            cart: validCart, centre: 'C', nom: '', numero: '1'
        });
        expect(errors).toContain('Nom du client requis.');
    });

    test('nom whitespace seulement rapporté', () => {
        const errors = validateDecoupeForm({
            cart: validCart, centre: 'C', nom: '   ', numero: '1'
        });
        expect(errors).toContain('Nom du client requis.');
    });

    test('téléphone vide rapporté', () => {
        const errors = validateDecoupeForm({
            cart: validCart, centre: 'C', nom: 'X', numero: ''
        });
        expect(errors).toContain('Téléphone du client requis.');
    });

    test('cumule plusieurs erreurs', () => {
        const errors = validateDecoupeForm({
            cart: [], centre: '', nom: '', numero: ''
        });
        expect(errors).toHaveLength(4);
    });
});
