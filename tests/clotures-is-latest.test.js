/**
 * @jest-environment node
 *
 * TOUTE LECTURE DE clotures_caisse DOIT FILTRER is_latest.
 *
 * La table conserve chaque REVISION d'une cloture, pas seulement la
 * derniere. Mesure sur les donnees de Mbao: le 31/07 porte deux lignes du
 * meme montant (une is_latest=false, une true) et le 12/06 en porte quatre.
 * Sommer sans le filtre compte donc la caisse autant de fois qu'elle a ete
 * corrigee.
 *
 * Constate en vrai: le point de depart du cash theorique rendait 1 142 200 F
 * au lieu de 571 100 F - tout le depart double, et un total faux de
 * 571 100 F presente comme juste. Le calcul du cash par point de vente, lui,
 * filtrait correctement depuis toujours; c'est la nouvelle requete qui a
 * introduit l'oubli.
 *
 * Ce test enumere les lectures plutot que d'en verifier une: c'est le seul
 * moyen que la PROCHAINE requete ecrite sans le filtre echoue ici.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'finance.js'), 'utf8');

describe('lectures de clotures_caisse', () => {
    // Les requetes SQL brutes: on isole le texte entre 'FROM clotures_caisse'
    // et la fin de l'appel sequelize.query correspondant.
    const requetesSql = (() => {
        const out = [];
        const marqueur = 'FROM clotures_caisse';
        let i = SRC.indexOf(marqueur);
        while (i >= 0) {
            // Remonter au debut de l'appel, descendre jusqu'a sa fermeture:
            // une fenetre large suffit, le filtre est toujours dans la meme
            // requete que le FROM.
            const debut = Math.max(0, SRC.lastIndexOf('sequelize.query', i));
            const fin = SRC.indexOf(');', i);
            out.push(SRC.slice(debut, fin < 0 ? i + 400 : fin));
            i = SRC.indexOf(marqueur, i + 1);
        }
        return out;
    })();

    test('la source expose bien des requetes a verifier', () => {
        // Sans ce garde-fou, un changement de forme rendrait le test suivant
        // vert sur un ensemble vide - il ne garderait plus rien.
        expect(requetesSql.length).toBeGreaterThan(0);
    });

    test('chaque requete SQL brute filtre is_latest', () => {
        const sansFiltre = requetesSql
            .filter((q) => !/is_latest/.test(q))
            .map((q) => q.replace(/\s+/g, ' ').slice(0, 120));
        expect(sansFiltre).toEqual([]);
    });

    test('les lectures par le modele filtrent is_latest aussi', () => {
        // ClotureCaisse.findAll doit porter is_latest dans son where.
        const appels = Array.from(SRC.matchAll(/ClotureCaisse\.findAll\(\{[\s\S]{0,400}?\}\)/g))
            .map((m) => m[0]);
        expect(appels.length).toBeGreaterThan(0);
        const sansFiltre = appels
            .filter((a) => !/is_latest/.test(a))
            .map((a) => a.replace(/\s+/g, ' ').slice(0, 120));
        expect(sansFiltre).toEqual([]);
    });
});
