/**
 * L'echelle des taux de parage proposee par la matrice de Simulation 2.0.
 *
 * Sept colonnes, le taux EN VIGUEUR au milieu. Les deux proprietes comptent
 * autant l'une que l'autre:
 *
 *  - le taux applique doit etre au CENTRE, sinon la matrice ne se lit plus de
 *    part et d'autre de l'existant;
 *  - il doit y etre EXACT, non arrondi: arrondi a 4 % quand il vaut 3,96,
 *    cliquer la colonne du milieu compterait comme un levier actif et rendrait
 *    le scenario « je ne change rien » introuvable.
 */
const { chargerDepuis } = require('./helpers/extraire-fonction');

const echelleParage = chargerDepuis(
    'js/simulation-v2.js',
    ['function echelleParage(taux)'],
    'echelleParage',
    'var nb = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };'
);

const centre = (v) => v[Math.floor(v.length / 2)];

describe('sept colonnes, le taux en vigueur au milieu', () => {
    // 3,96 est le parage bovin mesure sur aout 2026 a Mbao; 0,94 l'ovin, sur
    // une seule journee; 17 l'ordre de grandeur d'un mois pollue par une
    // journee sans inventaire du soir.
    test.each([0, 0.03, 0.94, 2, 3.96, 5, 10, 17, 42])('taux %p', (t) => {
        const v = echelleParage(t);
        expect(v).toHaveLength(7);
        expect(centre(v)).toBe(t);
        expect(v.every((x) => x >= 0)).toBe(true);
        // Croissante: une matrice qui repart en arriere ne se lit pas.
        for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
    });

    test('le taux du milieu n est JAMAIS arrondi', () => {
        // Le defaut des leviers vaut ce taux exact: la moindre difference
        // ferait compter un levier actif sur un scenario que personne n'a
        // touche.
        expect(centre(echelleParage(3.96))).toBe(3.96);
        expect(centre(echelleParage(0.94))).toBe(0.94);
        expect(centre(echelleParage(17.47))).toBe(17.47);
    });

    test('un taux bas garde des crans DISTINCTS en dessous', () => {
        // Avec un pas fixe de 2, les trois valeurs basses tombaient toutes a
        // zero; les dedupliquer raccourcissait la ligne et faisait glisser le
        // taux hors du centre.
        const v = echelleParage(3.96);
        expect(v).toEqual([0, 1.32, 2.64, 3.96, 5.96, 7.96, 9.96]);
        expect(new Set(v).size).toBe(7);
    });

    test('un taux eleve garde le pas large vers le haut', () => {
        // Au-dela de 10 %, un pas de 2 donnerait une matrice trop serree pour
        // montrer ce qu'un vrai progres rapporterait.
        expect(echelleParage(17)).toEqual([8, 11, 14, 17, 20, 23, 26]);
    });

    test('zero: rien en dessous, et c est la realite', () => {
        // On ne pare pas moins que rien. Les colonnes basses se confondent,
        // mais le centre reste juste et la ligne garde sa forme.
        const v = echelleParage(0);
        expect(v).toHaveLength(7);
        expect(centre(v)).toBe(0);
        expect(v.slice(0, 4)).toEqual([0, 0, 0, 0]);
    });

    test('une entree illisible ou negative retombe a zero', () => {
        for (const mauvais of [null, undefined, 'abc', -5]) {
            expect(centre(echelleParage(mauvais))).toBe(0);
        }
    });
});
