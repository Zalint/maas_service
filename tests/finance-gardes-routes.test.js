/**
 * @jest-environment node
 *
 * LE COMMENTAIRE MENSUEL DOIT ETRE GARDE COMME LES ECRANS QU'IL DECRIT.
 *
 * Le routeur finance est monte avec checkAuth SEUL (server.js: app.use(
 * '/api/finance', checkAuth, financeRouter)). Chaque route sensible ajoute
 * donc sa propre garde, par prefixe (ADVANCED_FINANCE_PREFIXES) ou par
 * router.use. GET/PUT /notes avait ete ajoute sans aucune des deux: un role
 * 'user', qui ne voit ni le PL ni Cash et Stock, pouvait lire ET ecraser les
 * notes de gestion de ces deux ecrans - typiquement la description d'une
 * livraison non saisie ou d'un ecart de caisse.
 *
 * Test sur la SOURCE plutot que sur le routeur monte: le fichier tire toute la
 * couche modeles au require, ce qu'un test unitaire n'a pas a demarrer.
 * L'ordre de montage compte autant que la presence, et il se lit ici.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'finance.js'), 'utf8');

describe('garde du commentaire mensuel', () => {
    test('/notes est declare dans ADVANCED_FINANCE_PREFIXES', () => {
        const bloc = SRC.slice(
            SRC.indexOf('const ADVANCED_FINANCE_PREFIXES'),
            SRC.indexOf('ADVANCED_FINANCE_PREFIXES.forEach')
        );
        expect(bloc).toContain("'/notes'");
    });

    test("/notes porte checkPlAccess, la garde stricte du PL", () => {
        expect(SRC).toContain("router.use('/notes', checkPlAccess);");
    });

    test('la garde est montee AVANT la definition des routes /notes', () => {
        const garde = SRC.indexOf("router.use('/notes', checkPlAccess);");
        const lecture = SRC.indexOf("router.get('/notes'");
        const ecriture = SRC.indexOf("router.put('/notes'");
        expect(garde).toBeGreaterThan(-1);
        expect(lecture).toBeGreaterThan(garde);
        expect(ecriture).toBeGreaterThan(garde);
    });

    test('checkPlAccess refuse tout role hors admin et superviseur', () => {
        // La garde est definie dans le meme fichier: on la reconstruit pour la
        // faire tourner, plutot que d'affirmer sur son texte.
        const corps = SRC.slice(SRC.indexOf('function checkPlAccess'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        const checkPlAccess = new Function(
            'return ' + corps.slice(0, fin + 2)
        )();

        const essayer = (role) => {
            let statut = null, suivant = false;
            const req = { session: { user: { role } } };
            const res = {
                status(c) { statut = c; return this; },
                json() { return this; }
            };
            checkPlAccess(req, res, () => { suivant = true; });
            return { statut, suivant };
        };

        for (const role of ['admin', 'superviseur', 'ADMIN', 'Superviseur']) {
            expect(essayer(role).suivant).toBe(true);
        }
        // superutilisateur passe checkAdvancedAccess mais PAS celle-ci: c'est
        // exactement la raison d'ajouter router.use en plus du prefixe.
        for (const role of ['user', 'superutilisateur', 'lecteur', '', undefined]) {
            const r = essayer(role);
            expect(r.suivant).toBe(false);
            expect(r.statut).toBe(403);
        }
    });

    test('aucune session du tout est refusee, sans lever', () => {
        const corps = SRC.slice(SRC.indexOf('function checkPlAccess'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        const checkPlAccess = new Function('return ' + corps.slice(0, fin + 2))();
        let statut = null, suivant = false;
        checkPlAccess({}, {
            status(c) { statut = c; return this; },
            json() { return this; }
        }, () => { suivant = true; });
        expect(suivant).toBe(false);
        expect(statut).toBe(403);
    });
});

/**
 * TOUTE ROUTE D'ECRITURE DE FINANCE PORTE UNE GARDE DE ROLE.
 *
 * Le trou de /notes n'etait pas isole: POST /depenses n'avait lui non plus
 * aucune garde, et le role 'lecteur' (canRead sans canWrite) pouvait creer une
 * depense qui pesait sur le PL - sans pouvoir la retirer, DELETE /depenses/:id
 * demandant checkAdvancedAccess. Les deux se ressemblent parce qu'ils viennent
 * du meme angle mort: le routeur est monte avec checkAuth SEUL, et chaque
 * route doit donc apporter sa propre garde. Une route ajoutee distraitement
 * n'en a aucune, et rien ne le dit.
 *
 * Ce test enumere les routes plutot que d'en verifier une: c'est le seul
 * moyen que la PROCHAINE route ajoutee sans garde echoue ici.
 */
describe('gardes de toutes les routes d ecriture', () => {
    // Les prefixes gardes en bloc, lus dans la source pour rester d'accord
    // avec elle plutot que d'en tenir une copie.
    const PREFIXES = (() => {
        const bloc = SRC.slice(
            SRC.indexOf('const ADVANCED_FINANCE_PREFIXES'),
            SRC.indexOf('ADVANCED_FINANCE_PREFIXES.forEach')
        );
        return Array.from(bloc.matchAll(/'(\/[^']+)'/g)).map((m) => m[1]);
    })();

    // Les gardes posees par router.use en dehors de la liste (ex: checkPlAccess).
    const USE = Array.from(
        SRC.matchAll(/router\.use\('(\/[^']+)',\s*(\w+)\)/g)
    ).map((m) => ({ chemin: m[1], garde: m[2] }));

    const ROUTES = Array.from(
        SRC.matchAll(/^router\.(post|put|delete|patch)\('(\/[^']*)'([^)]*)/gm)
    ).map((m) => ({ verbe: m[1], chemin: m[2], reste: m[3] }));

    test('la source expose bien des prefixes et des routes a verifier', () => {
        // Sans ce garde-fou, une regex qui cesse de matcher rendrait le test
        // suivant vert sur un ensemble vide - il ne garderait plus rien.
        expect(PREFIXES.length).toBeGreaterThan(5);
        expect(ROUTES.length).toBeGreaterThan(10);
        expect(USE.length).toBeGreaterThan(0);
    });

    test('chaque ecriture est couverte par un prefixe ou un middleware inline', () => {
        // Un prefixe Express ne matche qu'aux frontieres de segment: '/prix'
        // ne couvre PAS '/prix-cdc', d'ou leurs entrees distinctes.
        const couvertParPrefixe = (chemin, liste) => liste.some(
            (p) => chemin === p || chemin.startsWith(p + '/')
        );
        const sansGarde = ROUTES.filter((r) => {
            if (couvertParPrefixe(r.chemin, PREFIXES)) return false;
            if (couvertParPrefixe(r.chemin, USE.map((u) => u.chemin))) return false;
            // Middleware nomme passe en deuxieme argument de la route.
            return !/,\s*(check\w+|admin\w+|require\w+)/.test(r.reste);
        }).map((r) => r.verbe.toUpperCase() + ' ' + r.chemin);
        expect(sansGarde).toEqual([]);
    });

    test('POST /depenses porte checkWriteAccess, et le middleware est importe', () => {
        expect(SRC).toMatch(/router\.post\('\/depenses',\s*checkWriteAccess,/);
        expect(SRC).toMatch(/require\('\.\.\/middlewares\/auth'\)/);
        expect(SRC.slice(0, SRC.indexOf('router.post'))).toContain('checkWriteAccess');
    });
});
