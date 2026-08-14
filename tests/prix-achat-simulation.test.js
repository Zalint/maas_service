/**
 * Resolveur de prix d'achat propre a Simulation 2.0.
 *
 * Ce module ne doit RIEN changer au module de base: le PL, Cash et Stock et la
 * marge du Centre de Decoupe en dependent. Depuis que la resolution est
 * centralisee dans lib/prix-achat-date.js - qui lit le Mapping produits - il
 * n'ajoute plus qu'une chose: il NOMME les produits sans cout.
 *
 * @jest-environment node
 */

jest.mock('../lib/prix-achat-date', () => ({ creerResolveurPrixAchat: jest.fn() }));

const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');
const { creerResolveurPrixAchatSimulation } = require('../lib/prix-achat-simulation');

/**
 * Faux resolveur de base. Il decide seul de ce qui a un cout: c'est LUI qui
 * porte desormais le mapping, et ce test ne doit pas
 * redire sa logique - sinon il testerait sa propre copie.
 */
function poserBase(couts = { boeuf: 3835, jarret: 1917.5 }) {
    creerResolveurPrixAchat.mockResolvedValue({
        avertissements: ['avertissement du module de base'],
        pourDate: () => ({
            prixAchat: (produit) => {
                const n = String(produit).toLowerCase();
                if (/^(boeuf|veau)/.test(n)) return couts.boeuf;
                if (n === 'jarret') return couts.jarret;   // mappe, coefficient 0,5
                return null;                                // ni prix propre ni mapping
            },
            origine: (produit) => {
                const n = String(produit).toLowerCase();
                if (/^(boeuf|veau)/.test(n)) return 'prix propre';
                if (n === 'jarret') return 'mappé vers Boeuf × 0,5';
                return null;
            },
            prixAchatDefaut: { bovin: couts.boeuf, ovin: 4500 },
            origineBoeuf: 'catalogue fournisseur'
        }),
        resumePrixBoeuf: () => ['resume'],
        statsPrixBoeuf: () => ({ min: 3735, max: 4435 })
    });
}

const creer = () => creerResolveurPrixAchatSimulation({ dateMax: '2026-07-31' });

beforeEach(() => { jest.clearAllMocks(); });

describe('la couche ne fait que RELAYER le module de base', () => {
    test('un cout connu passe tel quel', async () => {
        poserBase();
        const p = (await creer()).pourDate('2026-07-31');
        expect(p.prixAchat('Boeuf en détail')).toBe(3835);
        // Le Jarret vaut la moitie: le mapping l'a resolu vers « Boeuf » avec
        // un coefficient de 0,5, parce qu'il se vend a la piece.
        expect(p.prixAchat('Jarret')).toBe(1917.5);
    });

    test('les avertissements du module de base sont CONSERVES', async () => {
        // Le tableau est reutilise, pas copie: le module de base en pousse
        // pendant la resolution, pas seulement au chargement.
        poserBase();
        const r = await creer();
        expect(r.avertissements).toContain('avertissement du module de base');
    });

    test('resumePrixBoeuf et statsPrixBoeuf sont RELAYES', async () => {
        // Sans eux, l'ecran de simulation perdrait le prix retenu que le PL
        // affiche, et les deux sensibilites de cout du boeuf.
        poserBase();
        const r = await creer();
        expect(r.resumePrixBoeuf()).toEqual(['resume']);
        expect(r.statsPrixBoeuf()).toEqual({ min: 3735, max: 4435 });
    });

    test('le module de base n est appele qu UNE fois, pas par journee', async () => {
        poserBase();
        const r = await creer();
        for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) r.pourDate(d);
        expect(creerResolveurPrixAchat).toHaveBeenCalledTimes(1);
        expect(creerResolveurPrixAchat).toHaveBeenCalledWith('2026-07-31');
    });
});

describe('un cout inconnu est NOMME, jamais invente', () => {
    test('le produit et le geste correctif sont dans l avertissement', async () => {
        // « le cout de X est inconnu » laisse chercher; nommer le mapping se
        // traite en trente secondes.
        poserBase();
        const r = await creer();
        expect(r.pourDate('2026-07-31').prixAchat('Poivre Sachet 100')).toBeNull();
        const a = r.avertissements.join(' ');
        expect(a).toMatch(/Poivre Sachet 100/);
        expect(a).toMatch(/Mappé vers/);
    });

    test('AUCUN repli numerique: null, jamais un montant choisi d avance', async () => {
        // Un cout invente produit une marge d'apparence calculee, qui entre
        // dans les classements et declenche des recommandations sans que rien
        // ne dise d'ou elle vient. Un cout absent, lui, se voit.
        poserBase();
        const p = (await creer()).pourDate('2026-07-31');
        expect(p.prixAchat('Poulet en détail')).toBeNull();
        expect(p.origine('Poulet en détail')).toBeNull();
    });

    test('le produit n est nomme QU UNE fois sur toute la periode', async () => {
        // pourDate est appele une fois par journee: sans deduplication, le
        // meme produit apparaitrait trente fois.
        poserBase();
        const r = await creer();
        for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) {
            r.pourDate(d).prixAchat('Poivre Sachet 100');
        }
        expect(r.avertissements.filter((a) => /Poivre Sachet 100/.test(a))).toHaveLength(1);
    });

    test('la casse et les accents ne creent pas deux entrees', async () => {
        // Meme normalisation que la resolution des prix: sans elle, « Poivre »
        // et « POIVRE » se signaleraient deux fois pour le meme produit.
        poserBase();
        const r = await creer();
        const p = r.pourDate('2026-07-31');
        p.prixAchat('Poivre Sachet 100');
        p.prixAchat('POIVRE SACHET 100');
        expect(r.avertissements.filter((a) => /achet 100/i.test(a))).toHaveLength(1);
    });

    test('un cout NUL compte comme inconnu, pas comme gratuit', async () => {
        // Zero rendrait une marge egale au prix de vente - le produit le plus
        // rentable de l'ecran, par accident.
        poserBase({ boeuf: 0, jarret: 0 });
        const p = (await creer()).pourDate('2026-07-31');
        expect(p.prixAchat('Boeuf en détail')).toBeNull();
    });
});

describe('origine', () => {
    test('la phrase du module de base est RELAYEE telle quelle', async () => {
        // La source appartient au module de base, seul a connaitre la
        // resolution. La reconstituer ici en ferait une seconde definition,
        // libre de diverger du calcul qu'elle pretend decrire - et l'ecran
        // nommerait alors une provenance que le cout n'a pas suivie.
        poserBase();
        const p = (await creer()).pourDate('2026-07-31');
        expect(p.origine('Boeuf en détail')).toBe('prix propre');
        expect(p.origine('Jarret')).toBe('mappé vers Boeuf × 0,5');
        expect(p.origine('Poivre Sachet 100')).toBeNull();
    });

    test('un cout NUL n a pas d origine a nommer', async () => {
        // La regle du zero appartient a CETTE couche: le module de base rend
        // une source pour un prix de zero, qu'elle tient pour gratuit. Sans ce
        // filtre, l'ecran afficherait « prix propre » sur une ligne sans
        // cout - une provenance pour un chiffre qui n'existe pas.
        poserBase({ boeuf: 0, jarret: 0 });
        const p = (await creer()).pourDate('2026-07-31');
        expect(p.prixAchat('Boeuf en détail')).toBeNull();
        expect(p.origine('Boeuf en détail')).toBeNull();
    });
});
