/**
 * Contrat ecran <-> serveur de Simulation 2.0.
 *
 * L'ecran (js/simulation-v2.js) lit des cles nominatives dans les reponses de
 * routes/finance.js, et le moteur recoit un contexte construit a partir
 * d'elles. Aucun test ne protegeait ce contrat: renommer variation_bovin cote
 * serveur ne faisait rougir AUCUNE suite, et l'ecran serait passe a zero en
 * silence - constat de la revue adversariale.
 *
 * Ces tests lisent les SOURCES, comme tests/routes-ordre.test.js: si une cle
 * consommee par l'ecran disparait du serveur, ou l'inverse, la suite le dit
 * avant l'ecran.
 *
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

/**
 * Le source SANS ses commentaires.
 *
 * Ce fichier est bavard en commentaires, et ils nomment abondamment les cles
 * du contrat: `ca_par_jour`, `commandes`, `top_clients` apparaissent dans des
 * phrases explicatives autant que dans du code. Un test qui cherche la chaine
 * dans le source BRUT passait donc au vert sur un simple commentaire - il
 * pouvait affirmer qu'une cle existait des deux cotes alors qu'un seul des
 * deux la posait vraiment, ce qui est exactement le silence que ce contrat
 * existe pour rompre.
 *
 * Les URL (`http://`) sont preservees: sans cette precaution, `//` y serait
 * pris pour un debut de commentaire et couperait la ligne en deux.
 */
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Le CORPS d'une fonction, borne par son accolade fermante.
 *
 * Les tests decoupaient 900 caracteres a partir du nom: une tranche fixe
 * deborde sur la fonction suivante des que celle qu'on vise raccourcit, et
 * l'assertion se met alors a passer grace au code VOISIN.
 */
const corpsDe = (source, nom) => {
    const debut = source.indexOf('function ' + nom);
    if (debut < 0) return '';
    let prof = 0;
    let i = source.indexOf('{', debut);
    if (i < 0) return '';
    for (let j = i; j < source.length; j++) {
        if (source[j] === '{') prof++;
        else if (source[j] === '}') {
            prof--;
            if (prof === 0) return source.slice(debut, j + 1);
        }
    }
    return source.slice(debut);
};

/** La cle comme IDENTIFIANT ou propriete, jamais comme sous-chaine. */
const porte = (source, cle) => new RegExp('\\b' + cle + '\\b').test(source);

// Les cles du contrat, chacune presente DES DEUX cotes. En ajouter une ici
// quand l'ecran se met a lire un nouveau champ du serveur.
const CLES = [
    // stock ventile, pour les leviers de parage et de prix d'achat
    'variation_bovin',
    'variation_ovin',
    'pertes_decoupe_pct',
    'matin_detail',
    'soir_detail',
    // postes lus par l'ecran
    'commission_maas',
    'total_avances',
    'total_ventes',
    // simulation v2
    'prix_achat_origine',
    // Le cout d'achat POUR LA SUITE, a cote de la moyenne du mois. Sans lui,
    // la projection tournait sur la moyenne ponderee des journees ecoulees -
    // 4 191 F mesures contre 4 500 au prix de fin, soit 7,4 % de cout invisible.
    'prix_achat_fin',
    'volumes',
    'pv_boeuf',
    'pv_agneau',
    'pv_poulet',
    // QUELS PRODUITS PORTENT DEJA LA COMMISSION dans leur prix d'achat. Le
    // serveur cesse de la facturer sur leurs livraisons; l'ecran, qui la
    // REDERIVE par produit a partir du prix catalogue, doit cesser avec lui.
    // Sans cette cle, l'ecran retombe sur son defaut prudent - il la deduit -
    // et affiche des marges qui ne sont plus celles du PL, en silence. C'est
    // precisement le genre de divergence que ce fichier existe pour rompre.
    'commission_integree',
    // projection fin de mois
    'ca_par_jour',
    'historique',
    'coeff_defaut',
    'top_clients',
    'commandes'
];

test('chaque cle du contrat existe cote serveur ET cote ecran', () => {
    const serveur = lire('routes/finance.js');
    const ecran = lire('js/simulation-v2.js');
    const absentes = [];
    CLES.forEach((k) => {
        if (!porte(serveur, k)) absentes.push(k + ' (serveur)');
        // Cote ecran, la cle doit etre LUE — donc apparaitre en acces de
        // PROPRIETE (`.cle`), et pas seulement a gauche d'un deux-points dans
        // un objet que l'ecran construit. Le test passait au vert sur
        // `commandes: etat.sim.commandes || []` meme apres avoir remplace la
        // lecture par un tableau vide: la cle survivait a gauche, la lecture
        // avait disparu a droite.
        if (!new RegExp('\\.\\s*' + k + '\\b').test(ecran)) {
            absentes.push(k + ' (écran : jamais lu comme propriété)');
        }
    });
    expect(absentes).toEqual([]);
});

test('le moteur ne lit le contexte que par les noms que l ecran construit', () => {
    // preparer() de l'ecran pose ces champs; le moteur les consomme. Si le
    // moteur se met a lire un champ que l'ecran ne pose pas, il vaudra 0 en
    // silence: la liste doit rester alignee.
    const moteur = lire('js/simulation-v2-moteur.js');
    const ecran = lire('js/simulation-v2.js');
    ['varBovin', 'varOvin', 'parageBase', 'commissionPct', 'commission', 'boeuf', 'pv']
        .forEach((k) => {
            expect(porte(moteur, k)).toBe(true);
            expect(porte(ecran, k)).toBe(true);
        });
});

test('la projection ne lit le module que par les fonctions qu il exporte', () => {
    // Meme logique pour le module de projection: l'ecran appelle ces
    // fonctions par leur nom, le module doit les exporter.
    const module_ = lire('js/simulation-v2-projection.js');
    const ecran = lire('js/simulation-v2.js');
    ['calibrerCoeff', 'projeterCA', 'scenarios', 'confiance', 'recommandations', 'commandesRentables']
        .forEach((k) => {
            expect(module_.includes(k + ':')).toBe(true);
            expect(ecran.includes('PJ.' + k)).toBe(true);
        });
});

/**
 * LA PROJECTION SE FAIT AU COUT LE PLUS RECENT, pas a la moyenne du mois.
 *
 * `prix_achat` est une moyenne PONDEREE des journees ecoulees: elle explique le
 * passe et melange les lots anciens aux recents. Les jours qui RESTENT se
 * paieront au dernier prix connu. Mesure sur mbao au 16-08-2026: la moyenne
 * donnait 4 191 F quand le prix de fin valait 4 500 - 7,4 % de cout que la
 * projection ne voyait pas, sur ~400 kg restant a vendre.
 *
 * Ce test lit la SOURCE plutot que d'executer l'ecran: auPrixDeLaSuite vit
 * dans une IIFE et n'est pas exportable. Il verrouille donc que la bascule
 * existe, la ou seule une relecture humaine la protegeait.
 */
test('auPrixDeLaSuite bascule le prix d ACHAT, pas seulement celui de vente', () => {
    const ecran = lire('js/simulation-v2.js');
    const bloc = corpsDe(ecran, 'auPrixDeLaSuite');
    expect(bloc).toContain('prix_achat_fin');
    // La bascule elle-meme: sans cette affectation, le champ serait lu et
    // jete, et la projection resterait sur la moyenne du mois.
    expect(bloc).toMatch(/copie\.prix_achat\s*=/);
    // Et le prix de vente continue de basculer: le correctif ne doit pas
    // avoir remplace un comportement par l'autre.
    expect(bloc).toMatch(/copie\.prix_moyen\s*=/);
});

/**
 * LE PARAGE ET LA COMMISSION restent DEUX ajustements distincts.
 *
 * Le cout carcasse doit rester NU: le moteur le divise par (1-parage), puis la
 * commission induite se retranche separement. Les melanger dans un cout unique
 * empecherait de les lire l'un sans l'autre - et ferait compter le parage deux
 * fois le jour ou quelqu'un l'incorporerait aussi en amont.
 */
test('le cout d achat bascule NU, sans parage ni commission incorpores', () => {
    const ecran = lire('js/simulation-v2.js');
    const bloc = corpsDe(ecran, 'auPrixDeLaSuite');
    // Aucune division par un diviseur de parage, aucun taux de commission,
    // dans la bascule du prix d'achat.
    expect(bloc).not.toMatch(/parage/i);
    expect(bloc).not.toMatch(/commission/i);
});
