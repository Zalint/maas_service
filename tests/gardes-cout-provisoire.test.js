/**
 * @jest-environment node
 *
 * DEUX GARDES NEES DE LA MEME REVUE : ne pas graver ni effacer a l'aveugle.
 *
 * 1) Le cron de figeage refusait deja une source MUETTE (MataBanq ne repond
 *    pas), mais pas une avance EN RETARD : la source repond, une journee a
 *    recu de la marchandise, et l'avance n'est pas encore saisie. Le cout des
 *    ventes la compte a titre provisoire - figer a cet instant grave un PL que
 *    la saisie du lendemain rendra faux, et le panneau d'ecart attribuera la
 *    difference a un poste plutot qu'a une saisie tardive.
 *
 * 2) DELETE /cash-autres supprimait par id seul : un onglet reste ouvert sur
 *    un autre mois effacait une ligne d'un mois que personne ne regardait,
 *    et l'ecran courant ne bougeait pas.
 *
 * Tests sur la SOURCE, comme finance-gardes-routes.test.js et pour la meme
 * raison : ces fichiers tirent la couche modeles (ou une connexion) au
 * require, qu'un test unitaire n'a pas a demarrer. L'ORDRE des refus compte
 * autant que leur presence, et il se lit ici.
 */

const fs = require('fs');
const path = require('path');

const lire = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')
    .replace(new RegExp('\\r\\n', 'g'), '\n');

describe('cron : une avance en retard bloque le figeage', () => {
    const SRC = lire('scripts', 'pl-snapshot-cron.js');

    test('le refus sur avances provisoires existe et sort en erreur', () => {
        const refus = SRC.indexOf('data.avances_provisoires > 0');
        expect(refus).toBeGreaterThan(-1);
        // Le bloc du refus doit poser exitCode = 1 : un cron qui refuse en
        // silence (exit 0) passe pour un cron qui a fige.
        const bloc = SRC.slice(refus, SRC.indexOf('} else if', refus + 1));
        expect(bloc).toContain('process.exitCode = 1');
        expect(bloc).not.toContain('upsert');
    });

    test('le refus vient APRES celui de la source muette, AVANT toute ecriture', () => {
        const muette = SRC.indexOf('data.sources.fiable === false');
        const retard = SRC.indexOf('data.avances_provisoires > 0');
        const ecriture = SRC.indexOf('PlSnapshot.upsert');
        expect(muette).toBeGreaterThan(-1);
        // La source muette d'abord : quand MataBanq ne repond pas, les
        // avances provisoires valent zero par construction (d64b75e) et ce
        // refus-ci ne se declencherait jamais seul.
        expect(retard).toBeGreaterThan(muette);
        expect(ecriture).toBeGreaterThan(retard);
    });

    test('le message nomme les dates en attente, pour savoir quoi saisir', () => {
        expect(SRC).toContain('avances_provisoires_detail');
    });
});

describe('POST /pl/snapshot (figeage manuel) : meme refus que le cron', () => {
    const SRC = lire('routes', 'finance.js');
    const debut = SRC.indexOf("router.post('/pl/snapshot'");
    const bloc = SRC.slice(debut, SRC.indexOf("router.post('/pl/rattraper", debut) > -1
        ? SRC.indexOf("router.post('/pl/rattraper", debut)
        : debut + 4000);

    test('le bouton manuel refuse aussi un cout provisoire, en 409', () => {
        // Sans ce refus, un superviseur presse pouvait graver avant que le
        // cron ne refuse la nuit meme - exactement le PL que la garde du
        // cron existe pour empecher.
        expect(bloc).toContain('data.avances_provisoires > 0');
        expect(bloc).toContain('avances_provisoires');
        expect(bloc).toMatch(/status\(409\)/);
    });
});

describe('DELETE /cash-autres : le mois est exige et verifie', () => {
    const SRC = lire('routes', 'finance.js');
    const debut = SRC.indexOf("router.delete('/cash-autres/:id'");
    const bloc = SRC.slice(debut, SRC.indexOf('router.', debut + 30));

    test('la route existe', () => {
        expect(debut).toBeGreaterThan(-1);
    });

    test('le mois est valide au meme format que les approbations', () => {
        expect(bloc).toContain('APPROB_MOIS.test(mois)');
    });

    test('le SQL filtre sur id ET mois, jamais sur id seul', () => {
        expect(bloc).toContain('WHERE id = :id AND mois = :mois');
    });

    test('zero ligne touchee repond 404, pas un succes silencieux', () => {
        // Un id d'un autre mois ne doit ni supprimer ni pretendre l'avoir
        // fait : l'ecran afficherait un succes et la ligne survivrait.
        expect(bloc).toContain('rowCount');
        expect(bloc).toContain('404');
    });

    test("l'ecran envoie le mois affiche avec la suppression", () => {
        const JS = lire('js', 'finance.js');
        const appel = JS.indexOf("'/api/finance/cash-autres/' + encodeURIComponent(b.dataset.id)");
        expect(appel).toBeGreaterThan(-1);
        expect(JS.slice(appel, appel + 200)).toContain("'?mois=' + encodeURIComponent(ct.mois");
    });

    test("un 404 resynchronise l'ecran au lieu de laisser une ligne fantome", () => {
        // Une autre session a deja supprime la ligne : l'etat local est
        // prouve perime, recalculer() le corrige au lieu d'un alert() qui
        // laisse le total afficher une ligne qui n'existe plus.
        const JS = lire('js', 'finance.js');
        const appel = JS.indexOf("'/api/finance/cash-autres/' + encodeURIComponent(b.dataset.id)");
        const gestion = JS.slice(appel, appel + 700);
        expect(gestion).toContain("r.status === 404) recalculer()");
    });
});

describe('DELETE /depots-approuves : meme garde que cash-autres', () => {
    const SRC = lire('routes', 'finance.js');
    const debut = SRC.indexOf("router.delete('/depots-approuves'");
    const bloc = SRC.slice(debut, SRC.indexOf('router.', debut + 30));

    test('zero ligne touchee repond 404, pas un succes silencieux', () => {
        expect(bloc).toContain('rowCount');
        expect(bloc).toContain('404');
    });

    test("l'ecran resynchronise sur un 404, comme pour cash-autres", () => {
        const JS = lire('js', 'finance.js');
        const appel = JS.indexOf("'/api/finance/depots-approuves' + q");
        expect(appel).toBeGreaterThan(-1);
        expect(JS.slice(appel, appel + 700)).toContain("r.status === 404) recalculer()");
    });
});
