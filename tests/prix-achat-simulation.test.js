/**
 * Resolveur de prix d'achat propre a Simulation 2.0.
 *
 * Ce module ne doit RIEN changer au module de base: le PL, Cash et Stock et la
 * marge du Centre de Decoupe en dependent. Il n'ajoute qu'une couche de repli.
 *
 * @jest-environment node
 */

jest.mock('../lib/prix-achat-date', () => ({ creerResolveurPrixAchat: jest.fn() }));

const { creerResolveurPrixAchat } = require('../lib/prix-achat-date');
const { creerResolveurPrixAchatSimulation } = require('../lib/prix-achat-simulation');

// Faux resolveur de base: 'Boeuf' a un prix, 'Poulet' aussi, les declinaisons
// n'en ont aucun. C'est exactement l'etat mesure en production.
function poserBase({ poulet = 3000, boeuf = 3835 } = {}) {
    creerResolveurPrixAchat.mockResolvedValue({
        avertissements: ['avertissement du module de base'],
        pourDate: () => ({
            prixAchat: (produit) => {
                const n = String(produit).toLowerCase();
                if (/^(boeuf|veau)/.test(n)) return boeuf;
                if (n === 'poulet') return poulet;
                if (n === 'cuisse de poulet') return 1800;
                if (n === 'agneau') return 4500;
                return null;
            },
            prixAchatDefaut: { bovin: boeuf, ovin: 4500 },
            origineBoeuf: 'catalogue fournisseur'
        })
    });
}

const REGLAGES = { famillePoulet: ['Poulet en détail', 'Poulet en gros'], prixPouletDefaut: 3000 };
const creer = (reglages) => creerResolveurPrixAchatSimulation({ dateMax: '2026-07-31', reglages });

beforeEach(() => { jest.clearAllMocks(); });

test('la famille poulet donne un cout aux declinaisons qui n en avaient pas', async () => {
    poserBase();
    const p = (await creer(REGLAGES)).pourDate('2026-07-31');
    expect(p.prixAchat('Poulet en détail')).toBe(3000);
    expect(p.prixAchat('Poulet en gros')).toBe(3000);
    expect(p.origine('Poulet en détail')).toBe('famille_poulet');
});

test('les accents et la casse ne comptent pas', async () => {
    poserBase();
    const p = (await creer(REGLAGES)).pourDate('2026-07-31');
    expect(p.prixAchat('POULET EN DETAIL')).toBe(3000);
    expect(p.prixAchat('Poulet En Détail')).toBe(3000);
});

test('un produit qui a DEJA un cout garde le sien', async () => {
    poserBase();
    // Meme mise dans la famille par erreur, 'Cuisse de poulet' porte son
    // propre prix (1 800 F, hors Mata): le repli ne doit pas l'ecraser.
    const p = (await creer({ famillePoulet: ['Cuisse de poulet'], prixPouletDefaut: 3000 })).pourDate('2026-07-31');
    expect(p.prixAchat('Cuisse de poulet')).toBe(1800);
    expect(p.origine('Cuisse de poulet')).toBe('propre');
});

test('un produit HORS famille reste sans cout', async () => {
    poserBase();
    const p = (await creer(REGLAGES)).pourDate('2026-07-31');
    // 'Merguez poulet' existe vraiment au catalogue de vente: un motif sur le
    // mot "poulet" l'aurait avale, la liste explicite ne le touche pas.
    expect(p.prixAchat('Merguez poulet')).toBeNull();
    expect(p.origine('Merguez poulet')).toBeNull();
    expect(p.prixAchat('Yell')).toBeNull();
});

test('le repli configurable ne sert QUE si le catalogue est muet', async () => {
    poserBase({ poulet: null });
    const r = await creer({ famillePoulet: ['Poulet en détail'], prixPouletDefaut: 2750 });
    const p = r.pourDate('2026-07-31');
    expect(p.prixAchat('Poulet en détail')).toBe(2750);
    expect(p.origine('Poulet en détail')).toBe('repli_poulet');
    expect(r.avertissements.join(' ')).toMatch(/repli de 2750/);
});

test('sans catalogue ni repli, le cout reste inconnu plutot que zero', async () => {
    poserBase({ poulet: null });
    const p = (await creer({ famillePoulet: ['Poulet en détail'], prixPouletDefaut: 0 })).pourDate('2026-07-31');
    expect(p.prixAchat('Poulet en détail')).toBeNull();
});

test('une famille vide rend exactement le module de base', async () => {
    poserBase();
    const p = (await creer({ famillePoulet: [], prixPouletDefaut: 3000 })).pourDate('2026-07-31');
    expect(p.prixAchat('Poulet en détail')).toBeNull();
    expect(p.prixAchat('Boeuf en détail')).toBe(3835);
});

test('les avertissements du module de base sont conserves', async () => {
    poserBase();
    const r = await creer(REGLAGES);
    expect(r.avertissements).toContain('avertissement du module de base');
});

test("l'avertissement de repli n'est emis QU'UNE fois", async () => {
    poserBase({ poulet: null });
    const r = await creer({ famillePoulet: ['Poulet en détail'], prixPouletDefaut: 3000 });
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) {
        r.pourDate(d).prixAchat('Poulet en détail');
    }
    expect(r.avertissements.filter((a) => /repli de 3000/.test(a)).length).toBe(1);
});

test('le module de base n est appele qu UNE fois, pas par journee', async () => {
    poserBase();
    const r = await creer(REGLAGES);
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) r.pourDate(d);
    expect(creerResolveurPrixAchat).toHaveBeenCalledTimes(1);
});

test('sans reglages, aucune famille ne s applique et le module de base decide seul', () => {
    // La signature accepte un objet de reglages absent: la famille est alors
    // vide et le repli inexistant, donc le comportement est exactement celui
    // de lib/prix-achat-date.js.
    poserBase();
    return creerResolveurPrixAchatSimulation({ dateMax: '2026-07-31' }).then((r) => {
        const p = r.pourDate('2026-07-31');
        expect(p.prixAchat('Poulet en détail')).toBeNull();
        expect(p.origine('Poulet en détail')).toBeNull();
        expect(p.prixAchat('Boeuf en détail')).toBe(3835);
        expect(p.origine('Boeuf en détail')).toBe('propre');
    });
});
