/**
 * @jest-environment node
 *
 * Le filtre "cette ligne porte bien une date DD-MM-YYYY" doit rester UNIQUE.
 *
 * Il a existe en deux exemplaires, et les deux ne disaient pas la meme chose:
 * valoriserSnapshotStock ecrivait '^\\d{2}...' dans un litteral de gabarit
 * (correct), produitsAStockSoirNegatif ecrivait '^\d{2}...' (casse). Dans un
 * gabarit, \d vaut d: la seconde envoyait '^d{2}-d{2}-d{4}$' a Postgres, ne
 * correspondait a aucune date, la sous-requete rendait NULL, et la fonction
 * retournait TOUJOURS un ensemble vide.
 *
 * Consequence mesuree: les produits a stock du soir negatif n'etaient jamais
 * ecartes des DEUX bornes de la variation. Seule la ligne negative etait jetee
 * par valoriserLignes, et le stock du MATIN du meme produit restait compte -
 * exactement l'asymetrie que le commentaire du code disait vouloir eviter. Un
 * produit passant de 10 a -15 voyait sa variation ramenee a -10, soit tout son
 * stock du matin porte en consommation. L'ecran des "produits ecartes" etait
 * inerte pour la meme raison: il lit produits_ecartes, toujours vide.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'finance.js'), 'utf8');
const ANTISLASH = String.fromCharCode(92);

describe('filtre de date des snapshots de stock', () => {
    test('aucune regex de date recopiee en dur dans une requete', () => {
        // Toute occurrence de "date ~ '^" hors de la declaration de la constante
        // est une copie, donc une divergence en puissance.
        const occurrences = SRC.split("date ~ '^").length - 1;
        expect(occurrences).toBe(1);
    });

    test('la constante partagee est utilisee par les deux sous-requetes', () => {
        const usages = (SRC.match(/STOCKS_DATE_VALIDE_SQL/g) || []).length;
        // 1 declaration + au moins 2 usages
        expect(usages).toBeGreaterThanOrEqual(3);
    });

    test('la regex transmise a Postgres contient un vrai antislash', () => {
        const ligne = SRC.split('\n').find((l) => l.includes('const STOCKS_DATE_VALIDE_SQL'));
        expect(ligne).toBeDefined();

        // On evalue la declaration telle qu'elle est ecrite, pour mesurer la
        // valeur REELLE et non ce que le source donne a lire.
        // eslint-disable-next-line no-eval
        const valeur = eval(ligne.replace(/^\s*const\s+STOCKS_DATE_VALIDE_SQL\s*=\s*/, '').replace(/;\s*$/, ''));

        expect(valeur).toContain(ANTISLASH + 'd{2}');
        expect(valeur).not.toContain("'^d{2}");

        // Et elle reconnait bien une date du format reellement stocke.
        const motif = valeur.match(/'(\^.*\$)'/)[1];
        expect(new RegExp(motif).test('28-07-2026')).toBe(true);
        expect(new RegExp(motif).test('2026-07-28')).toBe(false);
    });
});
