/**
 * Derniere journee de la periode sans vente saisie.
 *
 * Une date de fin posee au-dela de la derniere saisie rend un PL qui a l'air
 * COMPLET: meme nombre de jours, memes charges proratisees, un total
 * simplement plus bas. Le defaut n'est pas le chiffre, c'est le silence.
 *
 * Ces tests portent sur la REGLE de detection, reproduite ici a l'identique
 * depuis routes/finance.js. Le contrat de sortie est verifie separement en
 * lisant la source, comme tests/simulation-v2-contrat.test.js.
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

// La meme normalisation que le serveur: ventes.date est du TEXTE en deux
// graphies (ISO et JJ-MM-AAAA), une comparaison brute a dateFin raterait la
// moitie des lignes.
function parseDateVersISO(s) {
    const v = String(s == null ? '' : s).trim();
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
}

/** Extrait de routes/finance.js — compte les LIGNES, jamais le montant. */
function detecter(ventes, dateFin) {
    let nbLignesDateFin = 0;
    let montantDateFin = 0;
    let derniereDateAvecVente = null;
    for (const v of ventes) {
        const iso = parseDateVersISO(v.date);
        if (!iso) continue;
        if (iso === dateFin) {
            nbLignesDateFin += 1;
            montantDateFin += parseFloat(v.montant) || 0;
        }
        if (!derniereDateAvecVente || iso > derniereDateAvecVente) derniereDateAvecVente = iso;
    }
    return {
        date: dateFin,
        nb_lignes: nbLignesDateFin,
        montant: Math.round(montantDateFin * 100) / 100,
        aucune_vente: nbLignesDateFin === 0,
        derniere_date_avec_vente: derniereDateAvecVente
    };
}

describe('detection de la derniere journee sans vente', () => {
    test('des ventes le dernier jour: rien a signaler', () => {
        const r = detecter(
            [{ date: '2026-08-11', montant: 1000 }, { date: '2026-08-12', montant: 500 }],
            '2026-08-12'
        );
        expect(r.aucune_vente).toBe(false);
        expect(r.nb_lignes).toBe(1);
        expect(r.montant).toBe(500);
    });

    test('aucune vente le dernier jour: signale, avec la derniere journee utile', () => {
        const r = detecter(
            [{ date: '2026-08-10', montant: 900 }, { date: '2026-08-11', montant: 1000 }],
            '2026-08-12'
        );
        expect(r.aucune_vente).toBe(true);
        expect(r.nb_lignes).toBe(0);
        expect(r.derniere_date_avec_vente).toBe('2026-08-11');
    });

    test('les deux graphies de date comptent, pas seulement l ISO', () => {
        // ventes.date melange 'YYYY-MM-DD' et 'JJ-MM-AAAA'. Comparer la chaine
        // brute a dateFin manquerait toutes les lignes de la seconde forme, et
        // une journee pleine serait annoncee vide.
        const r = detecter([{ date: '12-08-2026', montant: 700 }], '2026-08-12');
        expect(r.aucune_vente).toBe(false);
        expect(r.montant).toBe(700);
    });

    test('une journee dont les ventes s annulent a zero a bien ete saisie', () => {
        // Un avoir qui compense une vente: le montant du jour vaut 0, mais des
        // lignes existent. Compter le montant plutot que les lignes ferait
        // crier au trou de saisie sur une journee correctement saisie.
        const r = detecter(
            [{ date: '2026-08-12', montant: 500 }, { date: '2026-08-12', montant: -500 }],
            '2026-08-12'
        );
        expect(r.aucune_vente).toBe(false);
        expect(r.nb_lignes).toBe(2);
        expect(r.montant).toBe(0);
    });

    test('periode entierement vide: signale, sans derniere date a proposer', () => {
        const r = detecter([], '2026-08-12');
        expect(r.aucune_vente).toBe(true);
        expect(r.derniere_date_avec_vente).toBeNull();
    });

    test('une date illisible ne fait pas passer la journee pour pleine', () => {
        const r = detecter([{ date: 'n/a', montant: 999 }], '2026-08-12');
        expect(r.aucune_vente).toBe(true);
        expect(r.derniere_date_avec_vente).toBeNull();
    });
});

describe('contrat serveur <-> ecrans', () => {
    const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

    test('le champ expose par le serveur est celui que les deux ecrans lisent', () => {
        // Renommer ventes_date_fin cote serveur sans toucher aux ecrans les
        // laisserait muets EN SILENCE: exactement le defaut que ce bandeau
        // existe pour corriger.
        expect(lire('routes/finance.js')).toContain('ventes_date_fin');
        expect(lire('js/finance.js')).toContain('ventes_date_fin');
        expect(lire('js/simulation-v2.js')).toContain('ventes_date_fin');
        ['aucune_vente', 'derniere_date_avec_vente'].forEach((k) => {
            expect(lire('routes/finance.js')).toContain(k);
            expect(lire('js/finance.js')).toContain(k);
            expect(lire('js/simulation-v2.js')).toContain(k);
        });
    });

    test("la requete des ventes remonte bien la colonne date", () => {
        // Sans 'date' dans les attributs Sequelize, la detection compare
        // undefined a dateFin et annonce TOUJOURS une journee vide.
        const src = lire('routes/finance.js');
        expect(src).toMatch(/attributes:\s*\['montant',\s*'produit',\s*'nombre',\s*'date'\]/);
    });
});
