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
function routesDe(fichier) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', fichier), 'utf8');
    const routes = [];
    const motif = /^router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gm;
    let m;
    while ((m = motif.exec(src)) !== null) {
        const avant = src.slice(0, m.index);
        routes.push({
            methode: m[1],
            chemin: m[2],
            ligne: avant.split('\n').length,
            segments: m[2].split('/').filter(Boolean)
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
