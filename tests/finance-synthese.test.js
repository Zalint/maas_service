/**
 * @jest-environment node
 *
 * SYNTHESE FINANCIERE EXTERNE - la route (server.js) et l'assembleur
 * (routes/finance-synthese.js).
 *
 * Test sur la SOURCE, comme finance-gardes-routes.test.js et pour la meme
 * raison: requerir ces fichiers tire la couche modeles, qu'un test unitaire
 * n'a pas a demarrer. Ce qui se verifie ici est du meme ordre que les gardes:
 * l'authentification par cle, la validation de la date, l'allowlist des
 * blocs, l'isolation des echecs et le plafond des recalculs.
 */

const fs = require('fs');
const path = require('path');

const lire = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(new RegExp('\\r\\n', 'g'), '\n');

const SERVER = lire('server.js');
const SYNTHESE = lire('routes/finance-synthese.js');
const FINANCE = lire('routes/finance.js');

/** Le bloc source de la route synthese, borne par la route suivante. */
function blocRouteSynthese() {
    const debut = SERVER.indexOf("app.get('/api/external/finance/synthese'");
    expect(debut).toBeGreaterThan(-1);
    const fin = SERVER.indexOf("app.get('/api/external/parage'", debut);
    expect(fin).toBeGreaterThan(debut);
    return SERVER.slice(debut, fin);
}

describe('la route externe et sa garde', () => {
    test('authentifiee par MAAS_KEY_API (validateMaasKeyApi), jamais ouverte', () => {
        expect(SERVER).toContain(
            "app.get('/api/external/finance/synthese', validateMaasKeyApi, async (req, res)"
        );
    });

    test('la date est VALIDEE (parseDateIso: existence reelle, pas juste la '
        + 'regex) et bornee au present', () => {
        const bloc = blocRouteSynthese();
        expect(bloc).toContain('parseDateIso');
        // Meme tolerance de fuseau que Cash et Stock: un jour, pas plus.
        expect(bloc).toContain('24 * 3600 * 1000');
        expect(bloc).toContain("res.status(400)");
    });

    test('les blocs demandes passent par l\'allowlist BLOCS_VALIDES', () => {
        const bloc = blocRouteSynthese();
        expect(bloc).toContain('BLOCS_VALIDES.includes');
        expect(bloc).toContain('blocs invalides');
    });
});

describe('l\'assembleur et ses contrats', () => {
    test('cinq blocs, aux noms attendus par les consommateurs', () => {
        const m = SYNTHESE.match(/const BLOCS_VALIDES = \[([^\]]+)\]/);
        expect(m).not.toBeNull();
        expect(Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]).sort())
            .toEqual(['cash_et_stock', 'journee', 'pl', 'pl_journalier', 'projection']);
    });

    test('chaque bloc est ISOLE: un echec s\'inscrit en { erreur } sans '
        + 'emporter les autres', () => {
        expect(SYNTHESE).toContain('sortie[nom] = { erreur: e.message }');
    });

    test('les recalculs de la serie journaliere sont PLAFONNES et le plafond '
        + 'borne reellement la boucle', () => {
        expect(SYNTHESE).toMatch(/const RECALCULS_MAX = \d+/);
        expect(SYNTHESE).toContain('trous.slice(0, RECALCULS_MAX)');
        // La sortie COMPTE ce qui manque plutot que de le taire.
        expect(SYNTHESE).toContain('nb_absents');
    });

    test('le PL est prechauffe AVANT le depart en parallele: la memoisation '
        + 'stocke le resultat, pas la promesse', () => {
        const debut = SYNTHESE.indexOf('async function construireSynthese');
        expect(debut).toBeGreaterThan(-1);
        const corps = SYNTHESE.slice(debut);
        const prechauffage = corps.indexOf('computePlMemoise');
        const parallele = corps.indexOf('Promise.all');
        expect(prechauffage).toBeGreaterThan(-1);
        expect(parallele).toBeGreaterThan(prechauffage);
    });

    test('les calculs viennent de routes/finance.js, jamais d\'une seconde '
        + 'formule: aucun acces direct aux ventes ou aux clotures', () => {
        for (const fn of ['computePlMemoise', 'computeEcartJour',
            'computeCashStock', 'computeSimulation', 'lireConfigPublique']) {
            expect(SYNTHESE).toContain('financeRouter.' + fn);
        }
        // Seules lectures directes tolerees: pl_snapshots (la serie) et la
        // note du mois. Pas de requete sur ventes ni clotures_caisse.
        expect(SYNTHESE).not.toMatch(/FROM ventes/i);
        expect(SYNTHESE).not.toMatch(/clotures_caisse/i);
    });
});

describe('les exports de routes/finance.js dont la synthese depend', () => {
    test('attaches au router, a cote de computePl', () => {
        for (const fn of ['computePlMemoise', 'clientsPeriodeMemoise',
            'computeSimulation', 'computeCashStock', 'computeEcartJour',
            'lireConfigPublique', 'parseDateVersISO']) {
            expect(FINANCE).toContain('router.' + fn + ' = ' + fn + ';');
        }
    });

    test('les routes d\'origine consomment les fonctions extraites: une seule '
        + 'definition par calcul', () => {
        expect(FINANCE).toContain(
            "res.json({ success: true, data: await computeSimulation(dateDebut, dateFin) });"
        );
        expect(FINANCE).toContain(
            "res.json({ success: true, data: await computeCashStock(dateD, todayISO) });"
        );
        // La route ecart-jour passe par la fonction extraite.
        expect(FINANCE).toContain('const data = await computeEcartJour({');
    });
});
