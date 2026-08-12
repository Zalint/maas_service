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
const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

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
    'volumes',
    'pv_boeuf',
    'pv_agneau',
    'pv_poulet',
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
        if (!serveur.includes(k)) absentes.push(k + ' (serveur)');
        if (!ecran.includes(k)) absentes.push(k + ' (écran)');
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
            expect(moteur.includes(k)).toBe(true);
            expect(ecran.includes(k)).toBe(true);
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
