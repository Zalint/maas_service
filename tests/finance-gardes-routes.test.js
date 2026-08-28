/**
 * @jest-environment node
 *
 * LE COMMENTAIRE MENSUEL DOIT ETRE GARDE COMME LES ECRANS QU'IL DECRIT.
 *
 * Le routeur finance est monte avec checkAuth SEUL (server.js: app.use(
 * '/api/finance', checkAuth, financeRouter)). Chaque route sensible ajoute
 * donc sa propre garde, par prefixe (ADVANCED_FINANCE_PREFIXES ou
 * PREFIXES_PL_LECTURE_ELARGIE) ou par router.use.
 *
 * Un role 'user' peut desormais CONSULTER (GET) le PL, Cash et Stock, la
 * Simulation et le commentaire mensuel qui les accompagne - mais toujours pas
 * ecrire: approuver un depot, ajouter une ligne « Autres » ou ecraser une
 * note reste reserve a admin/superviseur via checkPlAccess.
 *
 * Test sur la SOURCE plutot que sur le routeur monte: le fichier tire toute la
 * couche modeles au require, ce qu'un test unitaire n'a pas a demarrer.
 * L'ordre de montage compte autant que la presence, et il se lit ici.
 */

const fs = require('fs');
const path = require('path');

// Fins de ligne NORMALISEES. Sous Windows, git rend le fichier en CRLF, et
// les decoupages qui cherchent une accolade en fin de ligne ne trouvaient
// plus rien: la reconstruction de checkPlAccess levait « f is not defined ».
const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'finance.js'), 'utf8')
    .replace(new RegExp('\\r\\n', 'g'), '\n');

describe('garde du commentaire mensuel', () => {
    // UNE SEULE GARDE PAR PREFIXE. /notes, /pl, /depots-approuves et
    // /cash-autres portent checkPlAccess, strictement plus severe que
    // checkAdvancedOuLecturePourUser: les empiler faisait repondre la moins
    // stricte a la place de l'autre, avec un message faux et sous une cle
    // (`message`) que l'ecran ne lit pas. Ces quatre prefixes ne doivent donc
    // PAS figurer dans la liste de lecture elargie.
    test("/notes n'est PAS dans PREFIXES_PL_LECTURE_ELARGIE : checkPlAccess le garde seul", () => {
        const bloc = SRC.slice(
            SRC.indexOf('const PREFIXES_PL_LECTURE_ELARGIE'),
            SRC.indexOf('PREFIXES_PL_LECTURE_ELARGIE.forEach')
        );
        for (const p of ["'/notes'", "'/pl'", "'/depots-approuves'", "'/cash-autres'"]) {
            expect(bloc).not.toContain(p);
        }
    });

    test('la garde de lecture elargie ne couvre que les prefixes sans garde '
        + 'plus stricte en aval : /cash-stock, /config et /simulation', () => {
        const bloc = SRC.slice(
            SRC.indexOf('const PREFIXES_PL_LECTURE_ELARGIE'),
            SRC.indexOf('PREFIXES_PL_LECTURE_ELARGIE.forEach')
        );
        expect(Array.from(bloc.matchAll(/'(\/[^']+)'/g)).map((m) => m[1]).sort())
            .toEqual(['/cash-stock', '/config', '/simulation']);
        const debut = SRC.indexOf('PREFIXES_PL_LECTURE_ELARGIE.forEach');
        expect(debut).toBeGreaterThan(-1);
        expect(SRC.slice(debut, debut + 100)).toContain('checkAdvancedOuLecturePourUser');
    });

    test("un 'user' qui ECRIT sur /notes recoit le message de checkPlAccess, "
        + 'pas celui de la garde large', () => {
        // C'etait le bug: checkAdvancedOuLecturePourUser, monte en premier,
        // repondait « Niveau superutilisateur requis » - faux, puisqu'un
        // superutilisateur est refuse lui aussi ici - sous la cle `message`,
        // alors que l'ecran lit `error`.
        const corps = SRC.slice(SRC.indexOf('function checkPlAccess'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        const checkPlAccess = new Function('return ' + corps.slice(0, fin + 2))();
        let recu = null;
        checkPlAccess(
            { method: 'PUT', session: { user: { role: 'user' } } },
            { status() { return this; }, json(o) { recu = o; return this; } },
            () => { recu = 'PASSE'; }
        );
        expect(recu).not.toBe('PASSE');
        expect(recu.error).toContain('administrateurs et superviseurs');
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

    test("checkPlAccess laisse un 'user' CONSULTER (GET) mais pas ECRIRE", () => {
        const corps = SRC.slice(SRC.indexOf('function checkPlAccess'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        const checkPlAccess = new Function('return ' + corps.slice(0, fin + 2))();

        const essayer = (role, method) => {
            let statut = null, suivant = false;
            const req = { method, session: { user: { role } } };
            const res = {
                status(c) { statut = c; return this; },
                json() { return this; }
            };
            checkPlAccess(req, res, () => { suivant = true; });
            return { statut, suivant };
        };

        expect(essayer('user', 'GET').suivant).toBe(true);
        for (const m of ['POST', 'PUT', 'DELETE']) {
            const r = essayer('user', m);
            expect(r.suivant).toBe(false);
            expect(r.statut).toBe(403);
        }
        // Un role hors du RBAC ne gagne rien a se faire passer pour un GET.
        expect(essayer('lecteur', 'GET').suivant).toBe(false);
        expect(essayer('superutilisateur', 'GET').suivant).toBe(false);
    });
});

describe("checkAdvancedOuLecturePourUser (PL, Cash et Stock, Simulation)", () => {
    const construire = () => {
        const corps = SRC.slice(SRC.indexOf('function checkAdvancedOuLecturePourUser'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        return new Function('return ' + corps.slice(0, fin + 2))();
    };

    const essayer = (fn, user, method) => {
        let statut = null, suivant = false;
        const req = { method, session: { user } };
        const res = {
            status(c) { statut = c; return this; },
            json() { return this; }
        };
        fn(req, res, () => { suivant = true; });
        return { statut, suivant };
    };

    test("un 'user' passe en GET, pas en ecriture", () => {
        const fn = construire();
        expect(essayer(fn, { role: 'user' }, 'GET').suivant).toBe(true);
        const r = essayer(fn, { role: 'user' }, 'POST');
        expect(r.suivant).toBe(false);
        expect(r.statut).toBe(403);
    });

    test('canManageAdvanced passe quelle que soit la methode - defense en '
        + 'profondeur inchangee pour superutilisateur/superviseur/admin', () => {
        const fn = construire();
        for (const m of ['GET', 'POST', 'DELETE']) {
            expect(essayer(fn, { role: 'superviseur', canManageAdvanced: true }, m).suivant).toBe(true);
        }
    });

    test("un role hors RBAC ('lecteur') reste refuse meme en GET", () => {
        const fn = construire();
        const r = essayer(fn, { role: 'lecteur' }, 'GET');
        expect(r.suivant).toBe(false);
        expect(r.statut).toBe(403);
    });
});

/**
 * GET /simulation ET GET /cash-stock DUPLIQUAIENT LE FILTRE DE ROLE EN
 * LIGNE, EN PLUS DU router.use.
 *
 * checkAdvancedOuLecturePourUser laisse un 'user' passer en GET, mais ces
 * deux handlers refaisaient le meme test `['admin', 'superviseur']` a
 * l'interieur du corps de la route - constate en base (403 malgre la garde
 * du dessus deja corrigee). Un filtre redondant qui n'est pas mis a jour en
 * meme temps que la garde qu'il double-verifie retombe exactement dans ce
 * piege : la garde de tete dit "corrige", la route repond quand meme 403.
 */
describe("GET /simulation et GET /cash-stock n'ont plus de filtre de role redondant", () => {
    test("GET /simulation accepte 'user' dans son filtre inline", () => {
        const debut = SRC.indexOf("router.get('/simulation'");
        const fin = SRC.indexOf("router.get(", debut + 30);
        const bloc = SRC.slice(debut, fin > -1 ? fin : debut + 1500);
        expect(bloc).toMatch(/\['admin',\s*'superviseur',\s*'user'\]\.includes\(role\)/);
    });

    test("GET /cash-stock accepte 'user' dans son filtre inline", () => {
        const debut = SRC.indexOf("router.get('/cash-stock'");
        const fin = SRC.indexOf("router.get(", debut + 30);
        const bloc = SRC.slice(debut, fin > -1 ? fin : debut + 1500);
        expect(bloc).toMatch(/\['admin',\s*'superviseur',\s*'user'\]\.includes\(role\)/);
    });
});

/**
 * L'ANALYSE IA: un POST qui n'ecrit rien, ouvert au meme cercle que la
 * lecture du PL - et qui coute de l'argent a chaque appel non cache.
 */
describe('POST /analyse-ia', () => {
    const construire = () => {
        const corps = SRC.slice(SRC.indexOf('function checkAnalyseAccess'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        return new Function('return ' + corps.slice(0, fin + 2))();
    };

    test("la garde laisse passer admin, superviseur, 'user' et canManageAdvanced, refuse 'lecteur'", () => {
        const fn = construire();
        const essayer = (user) => {
            let passe = false, statut = null;
            fn({ session: { user } },
                { status(c) { statut = c; return this; }, json() { return this; } },
                () => { passe = true; });
            return { passe, statut };
        };
        for (const u of [{ role: 'admin' }, { role: 'superviseur' }, { role: 'user' },
            { role: 'superutilisateur', canManageAdvanced: true }]) {
            expect(essayer(u).passe).toBe(true);
        }
        const r = essayer({ role: 'lecteur' });
        expect(r.passe).toBe(false);
        expect(r.statut).toBe(403);
    });

    test('la route porte la garde, refuse sans cle et borne le payload', () => {
        const debut = SRC.indexOf("router.post('/analyse-ia'");
        expect(debut).toBeGreaterThan(-1);
        const bloc = SRC.slice(debut, debut + 3000);
        expect(SRC.slice(debut, debut + 80)).toContain('checkAnalyseAccess');
        // Sans cle: un 503 explicite, pas un appel qui part planter chez
        // OpenAI avec une cle vide.
        expect(bloc).toContain('OPENAI_API_KEY');
        expect(bloc).toMatch(/status\(503\)/);
        // Payload borne: chaque octet part chez OpenAI et se facture.
        expect(bloc).toContain('ANALYSE_PAYLOAD_MAX');
        expect(bloc).toMatch(/status\(413\)/);
    });

    test("l'empreinte du cache exclut genere_le, sinon chaque clic est unique", () => {
        // Constate au premier test reel: l'horodatage changeait a chaque
        // construction du payload, l'empreinte aussi, et le cache ne servait
        // jamais - chaque relecture payait un appel OpenAI.
        const debut = SRC.indexOf("router.post('/analyse-ia'");
        const bloc = SRC.slice(debut, debut + 4000);
        expect(bloc).toContain('delete pourEmpreinte.genere_le');
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
        const bloc1 = SRC.slice(
            SRC.indexOf('const ADVANCED_FINANCE_PREFIXES'),
            SRC.indexOf('ADVANCED_FINANCE_PREFIXES.forEach')
        );
        // PREFIXES_PL_LECTURE_ELARGIE aussi: /cash-stock et /simulation n'ont
        // pas d'autre garde nommee (pas de router.use('/x', checkPlAccess)
        // litteral), donc pas de trace dans USE plus bas - une ecriture
        // future sous ces deux prefixes doit rester detectable ici.
        const bloc2 = SRC.slice(
            SRC.indexOf('const PREFIXES_PL_LECTURE_ELARGIE'),
            SRC.indexOf('PREFIXES_PL_LECTURE_ELARGIE.forEach')
        );
        return Array.from((bloc1 + bloc2).matchAll(/'(\/[^']+)'/g)).map((m) => m[1]);
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

    test('POST /paiements porte checkWriteAccess ET televerserJustificatif, '
        + "meme forme que POST /depenses (un 'user' ajoute, un 'lecteur' non)", () => {
        expect(SRC).toMatch(/router\.post\('\/paiements',\s*checkWriteAccess,\s*televerserJustificatif,/);
    });

    test('DELETE /paiements/:id porte checkAdvancedAccess, comme DELETE /depenses/:id', () => {
        expect(SRC).toMatch(/router\.delete\('\/paiements\/:id',\s*checkAdvancedAccess,/);
    });

    test("'/paiements' n'est plus dans ADVANCED_FINANCE_PREFIXES (garde route par route desormais)", () => {
        const bloc = SRC.slice(
            SRC.indexOf('const ADVANCED_FINANCE_PREFIXES'),
            SRC.indexOf('ADVANCED_FINANCE_PREFIXES.forEach')
        );
        expect(bloc).not.toContain("'/paiements'");
    });

    // Retirer le prefixe a enleve sa garde aux LECTURES aussi, pas seulement
    // aux ecritures: sans ces deux gardes, tout compte connecte - dont
    // 'lecteur', qui n'a jamais eu cet ecran - listait les paiements
    // fournisseur et telechargeait leurs justificatifs.
    test('GET /paiements et son justificatif portent checkWriteAccess', () => {
        expect(SRC).toMatch(/router\.get\('\/paiements',\s*checkWriteAccess,/);
        expect(SRC).toMatch(/router\.get\('\/paiements\/:id\/justificatif',\s*checkWriteAccess,/);
    });

    // /config a quitte ADVANCED_FINANCE_PREFIXES pour la liste de lecture
    // elargie: sa LECTURE s'ouvre a 'user' (le moteur de Simulation y prend
    // le taux de commission), son ECRITURE doit rester ou elle etait.
    test("PUT /config reste reserve a canManageAdvanced apres l'ouverture en lecture", () => {
        const corps = SRC.slice(SRC.indexOf('function checkAdvancedOuLecturePourUser'));
        const fin = corps.indexOf('\n}\n');
        // eslint-disable-next-line no-new-func
        const garde = new Function('return ' + corps.slice(0, fin + 2))();
        const essayer = (user, method) => {
            let passe = false, statut = null;
            garde({ method, session: { user } },
                { status(c) { statut = c; return this; }, json() { return this; } },
                () => { passe = true; });
            return { passe, statut };
        };
        // Ecriture: seul canManageAdvanced passe, comme sous l'ancien prefixe.
        expect(essayer({ role: 'user' }, 'PUT').passe).toBe(false);
        expect(essayer({ role: 'user' }, 'PUT').statut).toBe(403);
        expect(essayer({ role: 'superutilisateur', canManageAdvanced: true }, 'PUT').passe).toBe(true);
        // Lecture: 'user' passe, c'est tout l'objet du deplacement.
        expect(essayer({ role: 'user' }, 'GET').passe).toBe(true);
    });
});
