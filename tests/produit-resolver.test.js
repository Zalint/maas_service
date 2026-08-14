/**
 * Resolveur produit vente -> catalogue fournisseur (lib/produit-resolver.js).
 *
 * Module PARTAGE entre le calcul des creances (commission) et l'UI Mapping:
 * c'est lui qui porte le drapeau hors_mata jusqu'a la boucle de commission.
 * Aucun test n'existait; on verrouille au passage les quatre statuts de
 * resolution, car une regression ici fausse la commission en silence.
 */
const { resolveProduit, buildResolverMaps } = require('../lib/produit-resolver');

const CATALOGUE = [
    { produit: 'Boeuf', prix_vente: 4800, prix_achat: 4500, prix_vente_cdc: null, hors_mata: false },
    { produit: 'Laxass', prix_vente: 300, prix_achat: 200, prix_vente_cdc: null, hors_mata: true },
    // Ligne d'avant la migration: la colonne n'existe pas encore.
    { produit: 'Veau', prix_vente: 5000, prix_achat: 4035, prix_vente_cdc: null }
];
const ALIASES = [
    { alias_produit: 'Laxass moulu', produit_catalog: 'Laxass' }
];

const maps = buildResolverMaps(CATALOGUE, ALIASES);

describe('statuts de resolution', () => {
    test('match exact, casse ignoree', () => {
        const r = resolveProduit('boeuf', maps);
        expect(r.statut).toBe('exact');
        expect(r.resolved).toBe('Boeuf');
        expect(r.value.prix_vente).toBe(4800);
    });

    test('alias explicite', () => {
        const r = resolveProduit('Laxass moulu', maps);
        expect(r.statut).toBe('alias');
        expect(r.resolved).toBe('Laxass');
    });

    test('prefixe en dernier recours', () => {
        const r = resolveProduit('Boeuf en gros', maps);
        expect(r.statut).toBe('prefix');
        expect(r.resolved).toBe('Boeuf');
    });

    test('aucun match: unmapped, valeur null', () => {
        const r = resolveProduit('Poisson braise', maps);
        expect(r.statut).toBe('unmapped');
        expect(r.value).toBeNull();
    });
});

describe('drapeau hors_mata', () => {
    // La boucle de commission (routes/finance-creances.js) saute les
    // transferts dont le produit resolu porte hors_mata: le drapeau doit
    // traverser buildResolverMaps sans se perdre.
    test('porte par la valeur resolue', () => {
        expect(resolveProduit('Laxass', maps).value.hors_mata).toBe(true);
        expect(resolveProduit('Boeuf', maps).value.hors_mata).toBe(false);
    });

    test('suit les alias: exclure Laxass exclut aussi ses graphies mappees', () => {
        expect(resolveProduit('Laxass moulu', maps).value.hors_mata).toBe(true);
    });

    test('colonne absente (ligne d avant migration) = dans le circuit Mata', () => {
        expect(resolveProduit('Veau', maps).value.hors_mata).toBe(false);
    });

    // Le prix d'achat doit RESTER porte par la valeur resolue meme hors
    // Mata: c'est lui qui valorise le stock (cash-stock, PL).
    test('le prix d achat reste disponible pour la valorisation du stock', () => {
        expect(resolveProduit('Laxass', maps).value.prix_achat).toBe(200);
    });
});

describe('coefficient : une CONVERSION D UNITE, jamais une imputation', () => {
    // Le Jarret vient de la meme carcasse que le boeuf, achetee UNE fois sous
    // « Boeuf » et facturee UNE fois en commission. Ce qui differe est
    // l'unite: le boeuf se compte au kilo, le jarret a la piece, et une piece
    // pese environ 500 g. D'ou 0,5 - pas un demi-achat, un demi-kilo.
    const avecCoef = buildResolverMaps(CATALOGUE, [
        { alias_produit: 'Jarret', produit_catalog: 'Boeuf', coefficient: 0.5 },
        { alias_produit: 'Laxass moulu', produit_catalog: 'Laxass', coefficient: 1 },
        // Ligne posee AVANT la colonne: elle doit valoir 1, c'est-a-dire se
        // comporter exactement comme avant la migration.
        { alias_produit: 'Boeuf haché', produit_catalog: 'Boeuf' }
    ]);

    test('porte par la resolution, a cote du prix', () => {
        const r = resolveProduit('Jarret', avecCoef);
        expect(r.statut).toBe('alias');
        expect(r.resolved).toBe('Boeuf');
        expect(r.coefficient).toBe(0.5);
    });

    test('une ligne d avant la migration vaut 1', () => {
        expect(resolveProduit('Boeuf haché', avecCoef).coefficient).toBe(1);
    });

    test('une valeur ABSURDE retombe sur 1, elle n annule pas le cout', () => {
        // Zero, negatif, texte: un coefficient nul rendrait un cout et une
        // commission de zero - un produit gratuit, en tete de tous les
        // classements de marge. Le repli doit etre neutre, pas destructeur.
        for (const c of [0, -1, 'abc', null, undefined, NaN]) {
            const m = buildResolverMaps(CATALOGUE, [
                { alias_produit: 'Jarret', produit_catalog: 'Boeuf', coefficient: c }
            ]);
            expect(resolveProduit('Jarret', m).coefficient).toBe(1);
        }
    });

    test('exact, prefixe et unmapped valent TOUJOURS 1', () => {
        // Une resolution exacte designe le meme produit, donc la meme unite.
        // Un prefixe ne dit RIEN de l'unite: « Boeuf en gros » commence par
        // « Boeuf » et se compte au kilo comme lui, mais rien ne le garantit.
        // Un coefficient autre que 1 exige donc un alias EXPLICITE - le prix a
        // payer pour ne jamais deviner une conversion.
        expect(resolveProduit('Boeuf', avecCoef).coefficient).toBe(1);
        expect(resolveProduit('Boeuf en gros', avecCoef).coefficient).toBe(1);
        expect(resolveProduit('Poisson braise', avecCoef).coefficient).toBe(1);
    });

    test('une map construite A LA MAIN, en chaines, reste lisible', () => {
        // Des appelants et des tests bâtissent leur aliasMap sans passer par
        // buildResolverMaps. Les casser tous pour ajouter un champ optionnel
        // serait un mauvais echange: la forme chaine reste acceptee et vaut 1.
        const m = {
            catalogMap: avecCoef.catalogMap,
            catalogKeyToOriginal: avecCoef.catalogKeyToOriginal,
            aliasMap: new Map([['jarret', 'Boeuf']])
        };
        const r = resolveProduit('Jarret', m);
        expect(r.statut).toBe('alias');
        expect(r.resolved).toBe('Boeuf');
        expect(r.coefficient).toBe(1);
    });
});
