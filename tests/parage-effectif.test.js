/**
 * @jest-environment node
 *
 * QUEL TAUX DE PARAGE POUR QUEL PRODUIT.
 *
 * Le parametre est un chiffre decide (5 %), applique au boeuf, au veau et a
 * l'agneau sans distinction. Le depot mesure pourtant la perte reelle par
 * espece - aout 2026 a Mbao: bovin 3,96 % sur 23 jours, ovin 1,4 % sur 2.
 *
 * Le module choisit entre les deux, et le choix est tout l'enjeu: une mesure
 * assise sur 2 jours n'est pas une mesure, et une perte negative n'est pas un
 * gain de matiere mais une entree non saisie.
 */

const {
    tauxParEspece, paragePourProduit, JOURS_MIN_PAR_DEFAUT
} = require('../lib/parage-effectif');

describe('choix du taux par espece', () => {
    test('une mesure solide remplace le parametre', () => {
        const t = tauxParEspece({
            mesures: { bovin: { perte: 0.0396, joursMesures: 23 } },
            parametrePct: 5
        });
        expect(t.bovin.source).toBe('mesure');
        expect(t.bovin.pct).toBe(3.96);
    });

    test('trop peu de jours: on retombe sur le parametre', () => {
        // Le cas reel de l'ovin: 1,4 % mais sur DEUX journees.
        const t = tauxParEspece({
            mesures: { ovin: { perte: 0.014, joursMesures: 2 } },
            parametrePct: 5
        });
        expect(t.ovin.source).toBe('parametre');
        expect(t.ovin.pct).toBe(5);
        expect(t.ovin.raison).toMatch(/2 jour/);
    });

    test('le seuil par defaut est de cinq jours', () => {
        expect(JOURS_MIN_PAR_DEFAUT).toBe(5);
        const faire = (jours) => tauxParEspece({
            mesures: { bovin: { perte: 0.04, joursMesures: jours } }, parametrePct: 5
        }).bovin.source;
        expect(faire(4)).toBe('parametre');
        expect(faire(5)).toBe('mesure');
    });

    test('une perte NEGATIVE est refusee', () => {
        // Vendu plus que sorti: une entree n'a pas ete saisie. Ce n'est pas
        // un gain de matiere, et l'appliquer ferait un cout d'achat INFERIEUR
        // au prix paye.
        const t = tauxParEspece({
            mesures: { bovin: { perte: -0.08, joursMesures: 20 } }, parametrePct: 5
        });
        expect(t.bovin.source).toBe('parametre');
        expect(t.bovin.raison).toMatch(/hors bornes/);
    });

    test('une perte aberrante est refusee', () => {
        const t = tauxParEspece({
            mesures: { bovin: { perte: 0.62, joursMesures: 20 } }, parametrePct: 5
        });
        expect(t.bovin.source).toBe('parametre');
    });

    test('aucune mesure: parametre, et le dire', () => {
        const t = tauxParEspece({ mesures: {}, parametrePct: 7 });
        expect(t.bovin).toMatchObject({ pct: 7, source: 'parametre' });
        expect(t.ovin).toMatchObject({ pct: 7, source: 'parametre' });
        expect(t.autre).toMatchObject({ pct: 7, source: 'parametre' });
    });

    test('un parametre aberrant retombe sur 5', () => {
        for (const mauvais of [100, 150, -3, NaN, null, 'abc']) {
            expect(tauxParEspece({ mesures: {}, parametrePct: mauvais }).autre.pct).toBe(5);
        }
    });

    test('un parametre de 0 est legitime', () => {
        expect(tauxParEspece({ mesures: {}, parametrePct: 0 }).autre.pct).toBe(0);
    });
});

describe('le taux applique a un produit', () => {
    const TAUX = tauxParEspece({
        mesures: {
            bovin: { perte: 0.0396, joursMesures: 23 },
            ovin: { perte: 0.02, joursMesures: 12 }
        },
        parametrePct: 5
    });
    const CAT = (p) => ({ Boeuf: 'bovin', Veau: 'bovin', Agneau: 'ovin' }[p] || null);
    const BOUCHERIE = (p) => p !== 'Poivre';
    const pour = paragePourProduit(TAUX, CAT, BOUCHERIE);

    test('le veau suit le bovin, pas une categorie a lui', () => {
        expect(pour('Veau')).toBe(3.96);
        expect(pour('Boeuf')).toBe(3.96);
    });

    test('l agneau suit l ovin', () => {
        expect(pour('Agneau')).toBe(2);
    });

    test('la boucherie sans espece connue prend le parametre', () => {
        // Volaille, poisson, caprin: pas de mesure dediee.
        expect(pour('Poulet')).toBe(5);
    });

    test('hors boucherie: AUCUN parage', () => {
        // On ne pare pas un sachet d'epices; diviser son cout par 0,95 le
        // rendrait plus cher qu'il n'est.
        expect(pour('Poivre')).toBe(0);
    });

    test('sans resolveur de categorie, tout prend le parametre', () => {
        const p = paragePourProduit(TAUX, null, null);
        expect(p('Boeuf')).toBe(5);
    });
});
