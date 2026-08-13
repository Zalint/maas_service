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

/**
 * Le texte d'une fonction, de sa signature a son accolade fermante.
 *
 * La fermeture est cherchee A L'INDENTATION DE LA SIGNATURE. Une regle fixee
 * sur la colonne 0 ne trouvait rien dans js/simulation-v2.js, dont tout le
 * corps vit dans une IIFE: l'extraction avalait alors le fichier jusqu'au bout
 * et rendait du code qui ne compile pas, avec une erreur de syntaxe pour seule
 * explication.
 */
function extraire(source, signature) {
    const debut = source.indexOf(signature);
    if (debut === -1) {
        throw new Error(
            `${signature} introuvable. Signature renommee, ou fonction devenue imbriquee ?`
        );
    }
    // L'indentation de la ligne qui porte la signature.
    const debutLigne = source.lastIndexOf('\n', debut) + 1;
    const marge = source.slice(debutLigne, debut);
    if (/\S/.test(marge)) {
        throw new Error(`${signature} n'est pas en debut de ligne: extraction impossible.`);
    }
    const cloture = '\n' + marge + '}';
    const fin = source.indexOf(cloture, debut);
    if (fin === -1) {
        throw new Error(
            `${signature} trouvee mais sans accolade fermante a son indentation `
            + `(${marge.length} espaces): l'extraction rendrait du code tronque.`
        );
    }
    return source.slice(debut, fin + cloture.length);
}

/** Le texte d'un fichier du depot, chemin relatif a la racine. */
function sourceDe(chemin) {
    return fs.readFileSync(path.join(__dirname, '..', '..', chemin), 'utf8');
}

/**
 * Assemble des fonctions prelevees dans N'IMPORTE QUEL fichier du depot.
 *
 * @param {string}   chemin     relatif a la racine, ex. 'js/simulation-v2.js'
 * @param {string[]} signatures dans l'ordre voulu - les dependances d'abord
 * @param {string}   retour     expression evaluee apres les definitions
 * @param {string}   [prelude]  code injecte AVANT, pour les helpers du module
 */
function chargerDepuis(chemin, signatures, retour, prelude) {
    const source = sourceDe(chemin);
    const code = (prelude || '') + '\n'
        + signatures.map((s) => extraire(source, s)).join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(`${code}\nreturn ${retour};`)();
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

module.exports = { extraire, sourceScript, chargerDepuisScript, sourceDe, chargerDepuis };
