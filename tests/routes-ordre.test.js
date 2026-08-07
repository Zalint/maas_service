/**
 * @jest-environment node
 *
 * Express retient la PREMIERE route qui correspond. Une route litterale
 * declaree apres une route parametree de meme forme est donc inatteignable,
 * silencieusement.
 *
 * Ce depot en avait deux. GET '/produits/doublons' (ajoutee par cette branche)
 * aurait ete captee par GET '/produits/:id'. Et GET '/produits/by-name' l'etait
 * DEJA: elle repondait 500 avec 'invalid input syntax for type integer:
 * "by-name"', parce que findByPk recevait la chaine 'by-name'. Le bouton
 * "Modifier produit inventaire" de config-admin.html:1499 etait casse.
 *
 * Rien dans les tests ne l'aurait montre: la route existe, elle est bien
 * declaree, elle n'est simplement jamais atteinte.
 */

const fs = require('fs');
const path = require('path');

const FICHIERS = ['config-admin.js', 'finance.js'];

/** Extrait les routes declarees, dans l'ordre du fichier. */
function routesDe(fichier, prefixe = 'router', dossier = 'routes') {
    const chemin = dossier
        ? path.join(__dirname, '..', dossier, fichier)
        : path.join(__dirname, '..', fichier);
    const src = fs.readFileSync(chemin, 'utf8');
    const routes = [];
    // On capture aussi ce qui suit le chemin jusqu'au handler: c'est la liste
    // des middlewares, et une route peut etre au bon endroit tout en ayant
    // perdu sa garde d'acces.
    const motif = new RegExp(
        `^${prefixe}\\.(get|post|put|patch|delete)\\(\\s*['"]([^'"]+)['"]([^\\n]*)`, 'gm');
    let m;
    while ((m = motif.exec(src)) !== null) {
        const avant = src.slice(0, m.index);
        routes.push({
            methode: m[1],
            chemin: m[2],
            ligne: avant.split('\n').length,
            segments: m[2].split('/').filter(Boolean),
            middlewares: (m[3] || '')
                .split(',')
                .map((s) => s.trim())
                .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
        });
    }
    return routes;
}

/**
 * `precedente` capte-t-elle `chemin` ? Meme methode, meme nombre de segments,
 * et chaque segment soit parametre, soit identique.
 */
function capte(precedente, route) {
    if (precedente.methode !== route.methode) return false;
    if (precedente.segments.length !== route.segments.length) return false;
    return precedente.segments.every((seg, i) =>
        seg.startsWith(':') || seg === route.segments[i]);
}

describe('ordre de declaration des routes', () => {
    for (const fichier of FICHIERS) {
        test(`${fichier}: aucune route litterale n'est ombrée par une route parametree`, () => {
            const routes = routesDe(fichier);
            expect(routes.length).toBeGreaterThan(0);

            const mortes = [];
            routes.forEach((route, i) => {
                // Seules les routes SANS parametre peuvent etre ombrees.
                if (route.segments.some((s) => s.startsWith(':'))) return;
                for (let j = 0; j < i; j++) {
                    if (routes[j].segments.some((s) => s.startsWith(':')) && capte(routes[j], route)) {
                        mortes.push(
                            `${route.methode.toUpperCase()} ${route.chemin} (l.${route.ligne})`
                            + ` est captee par ${routes[j].methode.toUpperCase()} ${routes[j].chemin}`
                            + ` (l.${routes[j].ligne})`);
                    }
                }
            });

            expect(mortes).toEqual([]);
        });
    }

    // server.js declare ses routes sur `app` et non sur un routeur. Il en portait
    // quatre inatteignables, dont deux qui coutaient une garde d'acces:
    // '/api/stock/:date/matin|soir|transfert/...' etaient captees par
    // '/api/stock/:date/:type/:pointVente/:categorie', declaree AVANT et sans
    // aucun middleware - le stock etait lisible sans session.
    test("server.js: aucune route litterale n'est ombrée par une route parametree", () => {
        const routes = routesDe('server.js', 'app', null);
        expect(routes.length).toBeGreaterThan(50);

        const mortes = [];
        routes.forEach((route, i) => {
            if (route.segments.some((s) => s.startsWith(':'))) return;
            for (let j = 0; j < i; j++) {
                if (routes[j].segments.some((s) => s.startsWith(':')) && capte(routes[j], route)) {
                    mortes.push(
                        `${route.methode.toUpperCase()} ${route.chemin} (l.${route.ligne})`
                        + ` est captee par ${routes[j].chemin} (l.${routes[j].ligne})`);
                }
            }
        });
        expect(mortes).toEqual([]);
    });

    // Etre au bon endroit ne suffit pas. Cette route sert le stock de tous les
    // points de vente; sans checkAuth ni checkReadAccess elle repondait 200 a
    // une requete sans session. Un simple controle d'ordre ne verrait pas leur
    // disparition.
    test('la route de stock garde checkAuth et checkReadAccess', () => {
        const routes = routesDe('server.js', 'app', null);
        const stock = routes.filter((r) => r.methode === 'get'
            && r.chemin.startsWith('/api/stock/:date/'));

        expect(stock.length).toBeGreaterThan(0);
        for (const route of stock) {
            expect({ chemin: route.chemin, middlewares: route.middlewares })
                .toEqual({
                    chemin: route.chemin,
                    middlewares: expect.arrayContaining(['checkAuth', 'checkReadAccess'])
                });
        }
    });

    // Deux handlers sur le meme chemin: le second est mort, en silence. C'est
    // ainsi que le controle d'acces par point de vente de PUT /api/precommandes/:id
    // n'a jamais tourne - il vivait dans le doublon.
    test('aucun chemin n est declare deux fois', () => {
        const doublons = [];
        const verifier = (routes, source) => {
            const vus = new Map();
            for (const r of routes) {
                const cle = `${r.methode} ${r.chemin}`;
                if (vus.has(cle)) {
                    doublons.push(`${source}: ${cle} declare l.${vus.get(cle)} puis l.${r.ligne}`);
                } else {
                    vus.set(cle, r.ligne);
                }
            }
        };
        for (const f of FICHIERS) verifier(routesDe(f), `routes/${f}`);
        verifier(routesDe('server.js', 'app', null), 'server.js');
        expect(doublons).toEqual([]);
    });

    test('les routes ajoutees par cette branche sont bien avant /produits/:id', () => {
        const routes = routesDe('config-admin.js');
        const pos = (methode, chemin) => routes.findIndex(
            (r) => r.methode === methode && r.chemin === chemin);

        const parId = pos('get', '/produits/:id');
        expect(parId).toBeGreaterThan(-1);
        expect(pos('get', '/produits/doublons')).toBeLessThan(parId);
        expect(pos('get', '/produits/by-name')).toBeLessThan(parId);
    });
});
