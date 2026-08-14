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
// atDate DOIT dependre de la date. Un stub constant - `() => 4057` - laissait
// passer deux mutations graves: appeler atDate() SANS argument (le vrai client
// rend alors null, donc tout le mois retombe sur le catalogue pendant que
// l'ecran affiche le prix MATA), et atDate(dateMax) (tout le mois value au
// prix du dernier jour, exactement l'ecart de 40% que ce module existe pour
// eviter). Le vrai resolveur rend aussi `count`.
//
// La table est ECRITE DANS la fabrique: jest.mock est hisse au-dessus des
// declarations du fichier, donc une constante externe y serait undefined.
jest.mock('../lib/achats-boeuf-client', () => ({
    getBoeufPrixAchatResolver: jest.fn(async () => ({
        atDate: (d) => ({ '2026-08-11': 3990, '2026-08-12': 4100, '2026-08-13': 4057 }[d] ?? null),
        count: 3
    }))
}));

const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');

/**
 * @param {object} o
 * @param {boolean} o.dynamique  la case « Prix API (DATA) » sur la ligne Boeuf
 * @param {Array}   o.catalogue  lignes fournisseur_prix
 * @param {Array}   o.alias      lignes produit_alias
 */
function poser({ dynamique = false, catalogue = [], alias = [], historique = [] } = {}) {
    // DECIMAL(12,2) et DECIMAL(10,4) reviennent de Postgres en CHAINES
    // ("4500.00", "0.5000"), pas en nombres. Nourrir les mocks avec des
    // nombres rendait six parseFloat() du code supprimables sans qu'aucun test
    // ne tombe - et sans l'un d'eux, Number.isFinite("4500.00") est faux et le
    // catalogue se vide ENTIEREMENT en production. Les mocks mentent donc ici
    // comme la base dit vrai.
    const dec = (v, n) => (v == null ? null : Number(v).toFixed(n));
    mockModeles.FournisseurPrix.findAll.mockResolvedValue(
        catalogue.map((c) => ({
            produit: c.produit,
            prix_achat: dec(c.prix_achat, 2),
            prix_achat_dynamique: c.produit.toLowerCase() === 'boeuf' ? dynamique : false,
            // Le produit se compte A LA PIECE (bete sur pied). Propriete
            // DECLAREE de la ligne, la ou un motif sur le libelle rangeait
            // « Boeuf sur pied » avec les kilos de carcasse.
            vendu_a_l_unite: c.a_l_unite === true
        }))
    );
    mockModeles.PrixAchatHistory.findAll.mockResolvedValue(
        historique.map((h) => ({
            produit: h.produit,
            prix_achat: dec(h.prix_achat, 2),
            created_at: h.created_at
        }))
    );
    mockModeles.ProduitAlias.findAll.mockResolvedValue(
        alias.map((a) => ({
            alias_produit: a.alias_produit,
            produit_catalog: a.produit_catalog,
            coefficient: dec(a.coefficient, 4)
        }))
    );
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

describe('PLUS AUCUNE regle de nommage', () => {
    // Une regex /^(boeuf|veau)/ decidait naguere quels libelles partagent le
    // cout de la carcasse. Elle tranchait au mauvais endroit dans les DEUX
    // sens, et c'est ce bloc qui l'empeche de revenir.

    test('« Boeuf abc » n est plus attrape par son prefixe', async () => {
        // Le contre-exemple qui a fait tomber la regle: n'importe quel libelle
        // commencant par « boeuf » heritait du prix de la carcasse, sans que
        // personne ne l'ait declare.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf abc')).toBeNull();
        expect(p.origine('Boeuf abc')).toBeNull();
    });

    test('une decoupe NON declaree n a pas de cout, elle n en herite pas', async () => {
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf en détail')).toBeNull();
    });

    test("l'ordre des mots ne decide plus de rien", async () => {
        // « Boeuf en détail » et « Filet De Boeuf » viennent du meme animal.
        // La regex attrapait le premier et laissait filer le second, au seul
        // motif que le nom y figure en dernier. Non declares, ils sont
        // desormais traites PAREIL.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf en détail')).toBe(p.prixAchat('Filet De Boeuf'));
    });
});

describe('1er rang : le MAPPING, ligne declaree et relisible', () => {
    const AVEC_MAPPING = [
        { alias_produit: 'Veau', produit_catalog: 'Boeuf', coefficient: 1 },
        { alias_produit: 'Boeuf en détail', produit_catalog: 'Boeuf', coefficient: 1 }
    ];

    test('une decoupe declaree suit la carcasse, au prix du JOUR', async () => {
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE, alias: AVEC_MAPPING });
        expect(p.prixAchat('Boeuf en détail')).toBe(PRIX_LOT);
        expect(p.origine('Boeuf en détail')).toBe('mappé vers Boeuf');
    });

    test('le VEAU suit le BOEUF, et le mapping BAT son prix propre', async () => {
        // Le one-off confirme par le proprietaire du produit: le veau coute ce
        // que coute la carcasse. Sa ligne au catalogue porte pourtant 4 035 -
        // un nombre qui ne doit jamais servir de cout. C'est la ligne de
        // mapping qui le dit, et c'est elle qui gagne.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE, alias: AVEC_MAPPING });
        expect(p.prixAchat('Veau')).toBe(PRIX_LOT);
        expect(p.origine('Veau')).toBe('mappé vers Boeuf');
    });

    test('sans DATA, la cible retombe sur le catalogue', async () => {
        const p = await resoudre({ dynamique: false, catalogue: CATALOGUE, alias: AVEC_MAPPING });
        expect(p.prixAchat('Boeuf en détail')).toBe(4500);
    });
});

describe('2e rang : le prix PROPRE', () => {
    test('la CARCASSE elle-meme prend le lot du jour', async () => {
        // « Boeuf » n'est mappe vers rien - c'est la cible, pas un alias. Son
        // prix dynamique vit sur SA LIGNE, pas dans une regle de famille:
        // c'est ce qui permet de supprimer la regex sans perdre le prix de
        // revient reel. Le catalogue dit 4 500, le lot dit 4 057.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Boeuf')).toBe(PRIX_LOT);
        expect(p.origine('Boeuf')).toBe('prix propre');
    });

    test('Foie garde son prix parce qu il n est mappe NULLE PART', async () => {
        // Foie et Yell sont achetes separement de la carcasse. Ils ne sont
        // proteges par aucune regle: ils le sont parce qu'aucune ligne ne
        // parle d'eux. C'est la protection la plus solide - elle se verifie
        // a l'ecran.
        const p = await resoudre({ dynamique: true, catalogue: CATALOGUE });
        expect(p.prixAchat('Foie')).toBe(2500);
        expect(p.origine('Foie')).toBe('prix propre');
    });

    test('mapper Foie serait un ACTE, et il gagnerait', async () => {
        // Le revers assume de la regle: une ligne de mapping est deliberee,
        // visible, et son origine s'affiche. Elle l'emporte donc.
        const p = await resoudre({
            dynamique: true,
            catalogue: CATALOGUE,
            alias: [{ alias_produit: 'Foie', produit_catalog: 'Boeuf', coefficient: 0.5 }]
        });
        expect(p.prixAchat('Foie')).toBe(PRIX_LOT * 0.5);
        expect(p.origine('Foie')).toBe('mappé vers Boeuf × 0,5');
    });
});

describe('les betes SUR PIED se comptent a la TETE, jamais au kilo', () => {
    // « Boeuf sur pied » entre en stock en nombre de tetes. La regex le
    // rangeait dans la famille bovine et lui imposait le prix d'un KILO de
    // carcasse - une tete valorisee au prix d'un kilo de viande, sans qu'aucun
    // reglage ne puisse le corriger.
    const CAT_PIED = CATALOGUE.concat([
        { produit: 'Boeuf sur pied', prix_achat: 400000, a_l_unite: true }
    ]);

    test('elle prend SON prix par tete, pas celui de la carcasse', async () => {
        const p = await resoudre({ dynamique: true, catalogue: CAT_PIED });
        expect(p.prixAchat('Boeuf sur pied')).toBe(400000);
        expect(p.origine('Boeuf sur pied')).toBe('prix propre');
    });

    test('la mapper vers un produit au kilo est REFUSE, et signale', async () => {
        // Le rendement d'abattage n'est pas une conversion d'unite: c'est une
        // transformation. Un coefficient ne doit pas faire payer la bete au
        // prix de ce qu'elle deviendra.
        poser({
            dynamique: true,
            catalogue: CAT_PIED,
            alias: [{ alias_produit: 'Boeuf sur pied', produit_catalog: 'Boeuf', coefficient: 0.55 }]
        });
        const r = await creerResolveurPrixAchat('2026-08-13');
        const p = r.pourDate('2026-08-13');
        expect(p.prixAchat('Boeuf sur pied')).toBe(400000);
        expect(r.avertissements.join(' ')).toMatch(/Mapping ignoré/);
        expect(r.avertissements.join(' ')).toMatch(/à la pièce/);
    });

    test('le refus vaut dans les DEUX sens', async () => {
        // Mapper un produit au kilo vers une tete est tout aussi faux.
        poser({
            dynamique: true,
            catalogue: CAT_PIED,
            alias: [{ alias_produit: 'Jarret', produit_catalog: 'Boeuf sur pied', coefficient: 1 }]
        });
        const r = await creerResolveurPrixAchat('2026-08-13');
        expect(r.pourDate('2026-08-13').prixAchat('Jarret')).toBeNull();
        expect(r.avertissements.join(' ')).toMatch(/Mapping ignoré/);
    });

    test('le refus n est signale QU UNE fois', async () => {
        poser({
            dynamique: true,
            catalogue: CAT_PIED,
            alias: [{ alias_produit: 'Boeuf sur pied', produit_catalog: 'Boeuf', coefficient: 0.55 }]
        });
        const r = await creerResolveurPrixAchat('2026-08-13');
        for (const d of ['2026-08-11', '2026-08-12', '2026-08-13']) {
            r.pourDate(d).prixAchat('Boeuf sur pied');
        }
        expect(r.avertissements.filter((a) => /Mapping ignoré/.test(a))).toHaveLength(1);
    });

    test('piece vers piece reste licite', async () => {
        const p = await resoudre({
            dynamique: true,
            catalogue: CAT_PIED.concat([{ produit: 'Veau sur pied', prix_achat: 0, a_l_unite: true }]),
            alias: [{ alias_produit: 'Veau sur pied', produit_catalog: 'Boeuf sur pied', coefficient: 0.6 }]
        });
        expect(p.prixAchat('Veau sur pied')).toBe(400000 * 0.6);
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

    test('un mapping illisible coute les couts MAPPES, et le DIT', async () => {
        // Le prix a payer pour avoir supprime la regle implicite, et il faut
        // le regarder en face: quand produit_alias est illisible - table
        // absente sur un tenant pas encore migre - les produits qui tenaient
        // leur cout d'une ligne de mapping le perdent. Avant, une regex les
        // rattrapait en silence.
        //
        // C'est le bon compromis: le manque est SIGNALE, la ou la regex
        // donnait un chiffre sans dire d'ou il venait. Et ce qui ne depend
        // d'aucune ligne - la carcasse, les produits a prix propre - continue
        // de valoriser le PL.
        poser({ dynamique: true, catalogue: CATALOGUE });
        mockModeles.ProduitAlias.findAll.mockRejectedValue(new Error('relation inexistante'));
        const r = await creerResolveurPrixAchat('2026-08-13');
        const p = r.pourDate('2026-08-13');
        expect(p.prixAchat('Boeuf')).toBe(PRIX_LOT);   // la carcasse tient
        expect(p.prixAchat('Foie')).toBe(2500);         // le prix propre tient
        expect(p.prixAchat('Boeuf en détail')).toBeNull();  // le mappe tombe
        expect(r.avertissements.join(' ')).toMatch(/Mapping produits illisible/);
    });
});

describe('le prix suit la DATE, pas la borne de la periode', () => {
    // Tout ce bloc couvrait un angle mort complet: PrixAchatHistory etait
    // moque a [] dans CHAQUE test du depot, et le stub du lot etait constant.
    // La resolution point-in-time - la raison d'etre du module, « jusqu'a 40%
    // d'ecart sur la marge du mois » - n'etait donc jamais executee.

    test('le lot du jour change d un jour a l autre', async () => {
        poser({ dynamique: true, catalogue: CATALOGUE });
        const r = await creerResolveurPrixAchat('2026-08-13');
        expect(r.pourDate('2026-08-11').prixAchat('Boeuf')).toBe(3990);
        expect(r.pourDate('2026-08-12').prixAchat('Boeuf')).toBe(4100);
        expect(r.pourDate('2026-08-13').prixAchat('Boeuf')).toBe(4057);
    });

    test('une journee sans lot retombe sur le catalogue, et le DIT', async () => {
        poser({ dynamique: true, catalogue: CATALOGUE });
        const r = await creerResolveurPrixAchat('2026-08-13');
        expect(r.pourDate('2026-08-01').prixAchat('Boeuf')).toBe(4500);
        expect(r.avertissements.join(' ')).toMatch(/aucun lot/i);
    });

    test('l historique donne la DERNIERE valeur <= la date', async () => {
        poser({
            catalogue: [{ produit: 'Foie', prix_achat: 2500 }],
            historique: [
                { produit: 'Foie', prix_achat: 2000, created_at: '2026-08-01T10:00:00.000Z' },
                { produit: 'Foie', prix_achat: 2300, created_at: '2026-08-10T10:00:00.000Z' }
            ]
        });
        const r = await creerResolveurPrixAchat('2026-08-13');
        // Avant toute ecriture: le catalogue courant, faute de mieux.
        expect(r.pourDate('2026-07-31').prixAchat('Foie')).toBe(2500);
        expect(r.pourDate('2026-08-05').prixAchat('Foie')).toBe(2000);
        expect(r.pourDate('2026-08-12').prixAchat('Foie')).toBe(2300);
    });

    test("une ecriture POSTERIEURE ne remonte pas dans le passe", async () => {
        // Le `break` de la boucle: sans lui, le prix du 10 aout valoriserait
        // aussi le 5, et tout le mois finirait au dernier prix connu.
        poser({
            catalogue: [{ produit: 'Foie', prix_achat: 2500 }],
            historique: [
                { produit: 'Foie', prix_achat: 2000, created_at: '2026-08-01T10:00:00.000Z' },
                { produit: 'Foie', prix_achat: 9999, created_at: '2026-08-20T10:00:00.000Z' }
            ]
        });
        const r = await creerResolveurPrixAchat('2026-08-31');
        expect(r.pourDate('2026-08-05').prixAchat('Foie')).toBe(2000);
    });

    test("une ecriture le jour MEME compte, meme tard le soir", async () => {
        // La borne est a 23:59:59.999: un prix saisi a 22 h doit valoir pour
        // sa propre journee, sinon la saisie du soir ne prend effet que le
        // lendemain sans que personne ne l'ait decide.
        poser({
            catalogue: [{ produit: 'Foie', prix_achat: 2500 }],
            historique: [{ produit: 'Foie', prix_achat: 2100, created_at: '2026-08-05T22:00:00.000Z' }]
        });
        const r = await creerResolveurPrixAchat('2026-08-31');
        expect(r.pourDate('2026-08-05').prixAchat('Foie')).toBe(2100);
    });

    test("l historique d un AUTRE produit ne deteint pas", async () => {
        poser({
            catalogue: [{ produit: 'Foie', prix_achat: 2500 }, { produit: 'Yell', prix_achat: 2500 }],
            historique: [{ produit: 'Yell', prix_achat: 1200, created_at: '2026-08-01T10:00:00.000Z' }]
        });
        const r = await creerResolveurPrixAchat('2026-08-31');
        expect(r.pourDate('2026-08-05').prixAchat('Foie')).toBe(2500);
        expect(r.pourDate('2026-08-05').prixAchat('Yell')).toBe(1200);
    });

    test('un prix de catalogue a ZERO est inconnu, pas gratuit', async () => {
        // Zero rendrait une marge egale au prix de vente: le produit le plus
        // rentable de l'ecran, par accident.
        poser({ catalogue: [{ produit: 'Foie', prix_achat: 0 }] });
        const r = await creerResolveurPrixAchat('2026-08-13');
        expect(r.pourDate('2026-08-13').prixAchat('Foie')).toBeNull();
    });
});
