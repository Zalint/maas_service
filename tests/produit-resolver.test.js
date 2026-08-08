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
