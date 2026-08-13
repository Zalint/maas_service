/**
 * Extraire une fonction de premier niveau de script.js, pour la tester.
 *
 * script.js n'exporte rien: c'est un fichier de navigateur de 11 000 lignes,
 * charge par une balise <script>. Le charger en entier dans un test tirerait
 * tout le DOM de l'application. On en preleve donc les fonctions une a une,
 * telles qu'elles sont ecrites - jamais recopiees, une copie diverge.
 *
 * La regle de decoupage est ecrite ICI, une seule fois: deux tests qui
 * extraient avec deux regles differentes finissent par tester deux choses
 * differentes en croyant tester la meme.
 */
const fs = require('fs');
const path = require('path');

/** Le texte d'une fonction de premier niveau, de sa signature a son '}' seul. */
function extraire(source, signature) {
    const debut = source.indexOf(signature);
    if (debut === -1) {
        throw new Error(
            `${signature} introuvable. Signature renommee, ou fonction devenue imbriquee ?`
        );
    }
    const fin = source.indexOf('\n}', debut);
    if (fin === -1) {
        throw new Error(
            `${signature} trouvee mais sans accolade fermante en colonne 0 : `
            + 'la fonction n\'est plus de premier niveau, l\'extraction rendrait du code tronque.'
        );
    }
    return source.slice(debut, fin + 2);
}

/** Le texte de script.js, lu une fois. */
function sourceScript() {
    return fs.readFileSync(path.join(__dirname, '..', '..', 'script.js'), 'utf8');
}

/**
 * Assemble plusieurs fonctions de script.js et rend ce que `retour` designe.
 *
 * @param {string[]} signatures dans l'ordre voulu - les dependances d'abord
 * @param {string}   retour     expression evaluee apres les definitions
 */
function chargerDepuisScript(signatures, retour) {
    const source = sourceScript();
    const code = signatures.map((s) => extraire(source, s)).join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(`${code}\nreturn ${retour};`)();
}

module.exports = { extraire, sourceScript, chargerDepuisScript };
