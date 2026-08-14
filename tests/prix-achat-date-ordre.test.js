/**
 * L'ORDRE de resolution du prix d'achat (lib/prix-achat-date.js).
 *
 * Ce module ne sert pas qu'a la simulation: le PL, Cash et Stock et la marge
 * du Centre de Decoupe lisent tous pourDate().prixAchat. Changer l'ordre des
 * trois regles change donc des chiffres comptables, en silence et sans qu'une
 * seule ligne de calcul soit touchee - c'est exactement ce qui est arrive:
 * la famille bovine avait glisse au troisieme rang, et « Boeuf » cessait de
 * lire le prix du lot MATA pour prendre le nombre fige du catalogue.
 *
 * D'ou ce fichier, qui verrouille l'ordre lui-meme plutot que ses effets.
 *
 * @jest-environment node
 */

const mockModeles = {
    FournisseurPrix: { findAll: jest.fn() },
    PrixAchatHistory: { findAll: jest.fn() },
    ProduitAlias: { findAll: jest.fn() }
};
jest.mock('../db/models', () => mockModeles);

// Le prix « du marche », celui que DATA renvoie pour le lot du jour. Il DOIT
// l'emporter sur le nombre fige du catalogue: c'est la raison d'etre de la
// case « Prix API (DATA) ».
const PRIX_LOT = 4057;
jest.mock('../lib/achats-boeuf-client', () => ({
    getBoeufPrixAchatResolver: jest.fn(async () => ({ atDate: () => 4057 }))
}));

const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');

/**
 * @param {object} o
 * @param {boolean} o.dynamique  la case « Prix API (DATA) » sur la ligne Boeuf
 * @param {Array}   o.catalogue  lignes fournisseur_prix
 * @param {Array}   o.alias      lignes produit_alias
 */
function poser({ dynamique = false, catalogue = [], alias = [] } = {}) {
    mockModeles.FournisseurPrix.findAll.mockResolvedValue(
        catalogue.map((c) => ({
            produit: c.produit,
            prix_achat: c.prix_achat,
            prix_achat_dynamique: c.produit.toLowerCase() === 'boeuf' ? dynamique : false
        }))
    );
    mockModeles.PrixAchatHistory.findAll.mockResolvedValue([]);
    mockModeles.ProduitAlias.findAll.mockResolvedValue(alias);
}

const CATALOGUE = [
    // « Boeuf » PORTE un prix propre au catalogue. C'est le piege: sans l'ordre
    // correct, ce nombre masque le prix du lot.
    { produit: 'Boeuf', prix_achat: 4500 },
    { produit: 'Veau', prix_achat: 4035 },
    { produit: 'Foie', prix_achat: 2500 },
    { produit: 'Poulet', prix_achat: 3000 }
];

const resoudre = async (options) => {
    poser(options);
    const r = await creerResolveurPrixAchat('2026-08-13');
    return r.pourDate('2026-08-13');
};

beforeEach(() => { jest.clearAllMocks(); });

describe('1er rang : la famille bovine, et le prix du JOUR', () => {
    test('« Boeuf » prend le prix du lot MATA, PAS son prix de catalogue', async () => {
        // La regression exacte: le catalogue dit 4 500, le lot du jour dit
        // 4 057. Rendre 4 500 fausse le PL de 443 F par kilo de carcasse, et
        // l'ecran continue d'AFFICHER 4 057 comme prix retenu.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf')).toBe(PRIX_LOT);
        expect(p.origine('Boeuf')).toBe('famille bovine');
    });

    test('les decoupes bovines suivent la carcasse', async () => {
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf en détail')).toBe(PRIX_LOT);
        expect(p.prixAchat('Boeuf en gros')).toBe(PRIX_LOT);
    });

    test('le VEAU prend le prix du BOEUF, malgre son propre prix', async () => {
        // Regle metier documentee en tete de module: le veau est un boeuf
        // vendu plus cher - meme carcasse, meme cout, la prime se voit cote
        // vente. Sa ligne au catalogue porte pourtant 4 035.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Veau')).toBe(PRIX_LOT);
        expect(p.origine('Veau')).toBe('famille bovine');
    });

    test('un mapping ne peut PAS detourner un produit bovin', async () => {
        // La famille est une identite d'espece: elle passe avant un reglage
        // de point de vente, sinon un mapping malencontreux ferait valoriser
        // du boeuf au prix du poulet dans le PL.
        const p = await resoudre({
            dynamique: true,
            catalogue: CATALOGUE,
            alias: [{ alias_produit: 'Boeuf en gros', produit_catalog: 'Poulet', coefficient: 1 }]
        });
        expect(p.prixAchat('Boeuf en gros')).toBe(PRIX_LOT);
    });

    test('sans DATA, la famille retombe sur le catalogue', async () => {
        const p = await resoudre({ dynamique: false, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf en détail')).toBe(4500);
    });
});

describe('2e rang : le prix PROPRE, avant tout mapping', () => {
    test('Foie garde son prix, meme mappe vers Boeuf', async () => {
        // Foie et Yell sont achetes SEPAREMENT de la carcasse. Leur ligne au
        // catalogue est la verite, et aucun mapping ne doit la couvrir.
        const p = await resoudre({
            dynamique: true,
            catalogue: CATALOGUE,
            alias: [{ alias_produit: 'Foie', produit_catalog: 'Boeuf', coefficient: 0.5 }]
        });
        expect(p.prixAchat('Foie')).toBe(2500);
        expect(p.origine('Foie')).toBe('prix propre');
    });
});

describe('3e rang : le mapping, avec son coefficient', () => {
    test('Jarret vaut la MOITIE de la carcasse du jour', async () => {
        // Vendu a la piece, environ 500 g. Le cout suit le prix du lot, pas
        // un nombre fige: c'est tout l'interet de passer par la cible.
        const p = await resoudre({
            dynamique: true,
            catalogue: CATALOGUE,
            alias: [{ alias_produit: 'Jarret', produit_catalog: 'Boeuf', coefficient: 0.5 }]
        });
        expect(p.prixAchat('Jarret')).toBe(PRIX_LOT * 0.5);
        expect(p.origine('Jarret')).toBe('mappé vers Boeuf × 0,5');
    });

    test('un coefficient de 1 ne s affiche pas dans l origine', async () => {
        const p = await resoudre({
            dynamique: true,
            catalogue: CATALOGUE,
            alias: [{ alias_produit: 'Poulet en gros', produit_catalog: 'Poulet', coefficient: 1 }]
        });
        expect(p.prixAchat('Poulet en gros')).toBe(3000);
        expect(p.origine('Poulet en gros')).toBe('mappé vers Poulet');
    });

    test('la casse et les accents ne font pas rater le mapping', async () => {
        const p = await resoudre({
            dynamique: true,
            catalogue: CATALOGUE,
            alias: [{ alias_produit: 'Poulet en détail', produit_catalog: 'Poulet', coefficient: 1 }]
        });
        expect(p.prixAchat('POULET EN DETAIL')).toBe(3000);
    });

    test('une cible SANS prix ne donne pas de cout, elle n invente rien', async () => {
        const p = await resoudre({
            dynamique: true,
            catalogue: [{ produit: 'Boeuf', prix_achat: 4500 }, { produit: 'Poulet', prix_achat: null }],
            alias: [{ alias_produit: 'Poulet en gros', produit_catalog: 'Poulet', coefficient: 1 }]
        });
        expect(p.prixAchat('Poulet en gros')).toBeNull();
        expect(p.origine('Poulet en gros')).toBeNull();
    });
});

describe('rien ne correspond : le cout reste INCONNU', () => {
    test('ni famille, ni prix propre, ni mapping', async () => {
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Poivre Sachet 100')).toBeNull();
        expect(p.origine('Poivre Sachet 100')).toBeNull();
    });

    test('un mapping illisible ne prive pas le PL de ses couts bovins', async () => {
        // La base peut refuser produit_alias - table absente sur un tenant pas
        // encore migre. Le PL doit continuer a valoriser la carcasse.
        poser({ dynamique: true, catalogue: CATALOGUE });
        mockModeles.ProduitAlias.findAll.mockRejectedValue(new Error('relation inexistante'));
        const r = await creerResolveurPrixAchat('2026-08-13');
        const p = r.pourDate('2026-08-13');
        expect(p.prixAchat('Boeuf en détail')).toBe(PRIX_LOT);
        expect(p.prixAchat('Foie')).toBe(2500);
        expect(r.avertissements.join(' ')).toMatch(/Mapping produits illisible/);
    });
});
