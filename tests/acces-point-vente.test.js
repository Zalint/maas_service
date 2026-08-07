/**
 * @jest-environment node
 *
 * `user.pointVente` est soit la chaine 'tous', soit un TABLEAU de noms
 * (users.js:26 et users.js:97). Une comparaison directe
 * `userPointVente !== pointVente` compare alors une chaine a un tableau des
 * que l'utilisateur est cloisonne: toujours vrai, donc 403 pour tout le monde
 * sauf les acces globaux - y compris sur son PROPRE point de vente.
 *
 * C'est ce qui rendait DELETE /api/precommandes/:id inutilisable aux non-admins,
 * et ce que la premiere version du garde ajoute au PUT reproduisait.
 */

const { aAccesAuPointVente, aAccesGlobal } = require('../lib/acces-point-vente');

describe('acces a un point de vente', () => {
    test("la chaine 'tous' donne acces a tout", () => {
        expect(aAccesAuPointVente('tous', 'Mbao')).toBe(true);
        expect(aAccesAuPointVente('tous', 'O.Foire')).toBe(true);
    });

    // Le cas qui cassait: un tableau, pas une chaine.
    test('un utilisateur cloisonne accede a SON point de vente', () => {
        expect(aAccesAuPointVente(['Mbao'], 'Mbao')).toBe(true);
        expect(aAccesAuPointVente(['Mbao', 'Keur Massar'], 'Keur Massar')).toBe(true);
    });

    test("un utilisateur cloisonne n'accede pas a un AUTRE point de vente", () => {
        expect(aAccesAuPointVente(['Mbao'], 'O.Foire')).toBe(false);
        expect(aAccesAuPointVente(['Mbao', 'Keur Massar'], 'O.Foire')).toBe(false);
    });

    test("'tous' peut aussi figurer DANS le tableau", () => {
        expect(aAccesAuPointVente(['tous'], 'O.Foire')).toBe(true);
        expect(aAccesGlobal(['tous'])).toBe(true);
    });

    test('aucun point de vente rattache ne donne acces a rien', () => {
        expect(aAccesAuPointVente([], 'Mbao')).toBe(false);
        expect(aAccesGlobal([])).toBe(false);
    });

    test('la forme chaine simple reste geree', () => {
        expect(aAccesAuPointVente('Mbao', 'Mbao')).toBe(true);
        expect(aAccesAuPointVente('Mbao', 'O.Foire')).toBe(false);
    });

    test('aAccesGlobal distingue "peut agir" de "peut deplacer ailleurs"', () => {
        expect(aAccesGlobal('tous')).toBe(true);
        expect(aAccesGlobal(['Mbao'])).toBe(false);
        expect(aAccesGlobal('Mbao')).toBe(false);
    });

    // Le point central: l'ancienne ecriture refusait meme les cas legitimes.
    test("l'ecriture naive refusait un utilisateur sur son propre point de vente", () => {
        const naif = (upv, pv) => !(upv !== 'tous' && pv !== upv);
        expect(naif(['Mbao'], 'Mbao')).toBe(false);              // refuse a tort
        expect(aAccesAuPointVente(['Mbao'], 'Mbao')).toBe(true);  // corrige
    });
});
