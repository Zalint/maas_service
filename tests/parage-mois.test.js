/**
 * @jest-environment jsdom
 *
 * Parage cumule du mois (cartes du haut de la reconciliation mensuelle).
 *
 * Charge la VRAIE fonction depuis script.js par extraction, plutot que d'en
 * recopier la logique: une copie diverge, et c'est une duplication de rendu qui
 * avait deja fait afficher a ce tableau 11 colonnes sous un en-tete de 15.
 */
const fs = require('fs');
const path = require('path');

// La fonction lit desormais window.parageLib - la formule du taux, ecrite une
// seule fois dans lib/parage.js et servie au navigateur par index.html. En
// jsdom, `window` existe: requerir le module pose le meme global que la
// balise <script> en production. C'est le cablage reel, pas un bouchon.
require('../lib/parage');

/** Le texte d'une fonction de premier niveau, de sa signature a son '}' seul. */
function extraire(source, signature) {
    const debut = source.indexOf(signature);
    if (debut === -1) throw new Error(`${signature} introuvable dans script.js`);
    const fin = source.indexOf('\n}', debut) + 2;
    return source.slice(debut, fin);
}

function charger() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    // afficherParageMois APPELLE afficherContributeursParage, qui liste les
    // produits composant chaque taux. N'extraire que la premiere rendait une
    // fonction qui levait ReferenceError des le premier appel: l'extraction
    // doit suivre les dependances, sinon elle teste un code qui n'existe pas.
    const code = extraire(source, 'function afficherContributeursParage(parageMois, kg)')
        + '\n' + extraire(source, 'function afficherParageMois(parageMois)');
    // eslint-disable-next-line no-new-func
    return new Function(`${code}\nreturn afficherParageMois;`)();
}

const afficher = charger();

function poser() {
    // #parage-contributeurs manquait: afficherContributeursParage() sortait
    // aussitot sur son garde `if (!zone) return`, et tout le rendu de la
    // composition passait les tests sans qu'une seule de ses lignes s'execute.
    document.body.innerHTML = `
        <p id="parage-bovin-mois">—</p><p id="parage-bovin-mois-detail"></p>
        <p id="parage-ovin-mois">—</p><p id="parage-ovin-mois-detail"></p>
        <div id="parage-contributeurs"></div>`;
    delete window.__parageContributeursOuvert;
}

const lire = (cat) => ({
    valeur: document.getElementById(`parage-${cat}-mois`).textContent,
    detail: document.getElementById(`parage-${cat}-mois-detail`).textContent,
    titre: document.getElementById(`parage-${cat}-mois`).title
});

beforeEach(poser);

describe('cumul du mois', () => {
    test('somme des kilos, pas moyenne des taux journaliers', () => {
        // Une journee a 2 kg vendus sur 4 (50% de perte) et une journee a 200 kg
        // vendus sur 200 (0%). La moyenne des taux donnerait 25%; le cumul
        // donne 1 - 202/204 = 0,98%, ce qui est la realite du mois.
        afficher({ bovin: { vendu: 202, theorique: 204 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').valeur).toBe('1.0 %');
        expect(lire('bovin').valeur).not.toBe('25.0 %');
    });

    test('cas nominal: 5% de perte', () => {
        afficher({ bovin: { vendu: 95, theorique: 100 }, ovin: { vendu: 190, theorique: 200 } });
        expect(lire('bovin').valeur).toBe('5.0 %');
        expect(lire('ovin').valeur).toBe('5.0 %');
    });

    test('le detail montre le numerateur et le denominateur', () => {
        afficher({ bovin: { vendu: 95.5, theorique: 100 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').detail).toBe('95,5 kg vendus / 100 kg théoriques');
    });

    test('l infobulle donne le calcul complet', () => {
        afficher({ bovin: { vendu: 95, theorique: 100 }, ovin: { vendu: 0, theorique: 0 } });
        const t = lire('bovin').titre;
        expect(t).toContain('95 kg');
        expect(t).toContain('100 kg');
        expect(t).toContain('Parage : 100 − 95.0 = 5.0 %');
    });
});

describe('denominateur nul: on ignore, on n affiche pas zero', () => {
    // 0% se lirait "decoupe parfaite". Un tiret dit "rien a mesurer".
    test('0 / 0 affiche un tiret', () => {
        afficher({ bovin: { vendu: 0, theorique: 0 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').valeur).toBe('—');
        expect(lire('ovin').valeur).toBe('—');
        expect(lire('bovin').valeur).not.toBe('0.0 %');
    });

    test('theorique negatif aussi', () => {
        afficher({ bovin: { vendu: 10, theorique: -5 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').valeur).toBe('—');
    });

    test('du vendu sans theorique: tiret, mais le detail le signale', () => {
        afficher({ bovin: { vendu: 34.75, theorique: 0 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').valeur).toBe('—');
        expect(lire('bovin').detail).toBe('34,8 kg vendus, théorique inconnu');
    });

    test('aucune donnee du tout', () => {
        afficher(null);
        expect(lire('bovin').valeur).toBe('—');
        expect(lire('ovin').valeur).toBe('—');
    });
});

describe('repartition de la perte du mois', () => {
    // Cumul terme a terme du bilan dechet des journees mesurables. La formule
    // (soir + vendu + jete − matin − transferts) reste vraie sur les sommes.
    const dechet = { matin: 3, transferts: 0, soir: 4.1, vendu: 1, jete: 0.5, produit: 2.6 };

    test('les deux lignes du mois apparaissent sous le detail', () => {
        afficher({ bovin: { vendu: 95, theorique: 100, dechet }, ovin: { vendu: 0, theorique: 0 } });
        const det = lire('bovin').detail;
        expect(det).toContain('95 kg vendus / 100 kg théoriques');
        expect(det).toContain('Déchet produit : 2,6 kg (2.6 %)');
        expect(det).toContain('Déperdition inexpliquée : 2,4 kg (2.4 %)');
        // Additivite au meme denominateur: 2.6 + 2.4 = 5.0, le taux affiche.
        expect(lire('bovin').valeur).toBe('5.0 %');
    });

    test('l infobulle du mois montre la formule terme a terme', () => {
        afficher({ bovin: { vendu: 95, theorique: 100, dechet }, ovin: { vendu: 0, theorique: 0 } });
        const t = lire('bovin').titre;
        expect(t).toContain('Déchet produit (soir 4,1 kg + vendu 1 kg + jeté 0,5 kg − matin 3 kg) : 2,6 kg soit 2.6 %');
        expect(t).toContain('Déperdition inexpliquée : 2,4 kg soit 2.4 %');
        // Transferts dechet nuls: le terme n'apparait pas dans la formule.
        // (Le "matin + transferts − soir" du theorique, lui, est toujours la.)
        expect(t).not.toContain('− transferts');
    });

    test('des transferts dechet non nuls entrent dans la formule', () => {
        afficher({
            bovin: { vendu: 95, theorique: 100, dechet: { ...dechet, transferts: 2, produit: 0.6 } },
            ovin: { vendu: 0, theorique: 0 }
        });
        expect(lire('bovin').titre).toContain('− transferts 2 kg');
    });

    test('une deperdition negative est signalee, pas rabotee', () => {
        // Plus de dechet pese que de perte globale: 7% de dechet pour 5% de
        // perte. La deperdition sort a −2%, telle quelle, avec l'avertissement.
        afficher({
            bovin: { vendu: 95, theorique: 100, dechet: { ...dechet, produit: 7 } },
            ovin: { vendu: 0, theorique: 0 }
        });
        const det = lire('bovin').detail;
        expect(det).toContain('⚠');
        expect(det).toContain('Déperdition inexpliquée : -2 kg (-2.0 %)');
        expect(lire('bovin').titre).toContain('⚠ Déperdition négative');
    });

    test('un dechet produit negatif est signale — sortie de dechet non tracee', () => {
        // Le stock dechet a fondu sans vente ni jete saisis (le cas reel
        // d'aout a Mbao): produit −3,4 kg. Le modele ne connait que deux
        // portes de sortie pour le dechet; quand le stock baisse sans passer
        // par l'une d'elles, on le dit, on ne rabote pas a zero.
        afficher({
            bovin: {
                vendu: 275.5, theorique: 286.9,
                dechet: { matin: 19.4, transferts: 0, soir: 16, vendu: 0, jete: 0, produit: -3.4 }
            },
            ovin: { vendu: 0, theorique: 0 }
        });
        const det = lire('bovin').detail;
        expect(det).toContain('⚠ Déchet produit : -3,4 kg');
        // La deperdition, elle, est positive ici: pas de second avertissement.
        expect(det).not.toContain('⚠ Déperdition');
        expect(lire('bovin').titre).toContain('⚠ Déchet produit négatif : le stock déchet a baissé sans vente ni jeté saisis');
    });

    test('sans bilan dechet (cache d avant cette version), affichage d origine', () => {
        afficher({ bovin: { vendu: 95.5, theorique: 100 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').detail).toBe('95,5 kg vendus / 100 kg théoriques');
        expect(lire('bovin').titre).not.toContain('Répartition de la perte');
    });
});

describe('robustesse', () => {
    test('une categorie absente ne fait pas lever', () => {
        expect(() => afficher({ bovin: { vendu: 10, theorique: 20 } })).not.toThrow();
        expect(lire('bovin').valeur).toBe('50.0 %');
        expect(lire('ovin').valeur).toBe('—');
    });

    test('des valeurs illisibles sont traitees comme absentes', () => {
        afficher({ bovin: { vendu: 'abc', theorique: null }, ovin: { vendu: undefined, theorique: 'x' } });
        expect(lire('bovin').valeur).toBe('—');
        expect(lire('ovin').valeur).toBe('—');
    });

    test('les elements absents du DOM ne font pas lever', () => {
        document.body.innerHTML = '';
        expect(() => afficher({ bovin: { vendu: 95, theorique: 100 } })).not.toThrow();
    });

    // Vendre plus que le theorique signale une erreur de saisie: la valeur doit
    // ressortir negative telle quelle, au lieu d'etre ecretee a zero.
    test('un rendement au-dela de 100% donne un parage negatif', () => {
        afficher({ bovin: { vendu: 110, theorique: 100 }, ovin: { vendu: 0, theorique: 0 } });
        expect(lire('bovin').valeur).toBe('-10.0 %');
    });
});

describe('composition des taux: quels produits les portent', () => {
    const zone = () => document.getElementById('parage-contributeurs');
    const lignes = () => Array.from(zone().querySelectorAll('tbody tr'))
        .map((tr) => Array.from(tr.children).map((td) => td.textContent.trim()));

    test('les produits sont classes par poids DECROISSANT dans le theorique', () => {
        // C'est le denominateur qui decide du classement: il repond a la seule
        // question posee, « sur quoi ce taux porte-t-il ».
        afficher({
            bovin: {
                vendu: 100, theorique: 150,
                parProduit: {
                    'Foie': { theorique: 10, vendu: 8 },
                    'Boeuf': { theorique: 130, vendu: 90 },
                    'Yell': { theorique: 10, vendu: 2 }
                }
            },
            ovin: { vendu: 0, theorique: 0, parProduit: {} }
        });
        expect(lignes().map((l) => l[0])).toEqual(['Boeuf', 'Foie', 'Yell']);
    });

    test('la part est calculee sur le theorique, et sommee a 100', () => {
        afficher({
            bovin: {
                vendu: 75, theorique: 100,
                parProduit: { 'Boeuf': { theorique: 75, vendu: 60 }, 'Foie': { theorique: 25, vendu: 15 } }
            },
            ovin: { vendu: 0, theorique: 0, parProduit: {} }
        });
        const parts = lignes().map((l) => l[3]);
        expect(parts).toEqual(['75 %', '25 %']);
    });

    test('un produit range dans la mauvaise espece devient VISIBLE', () => {
        // Le cas qui a motive cet ecran: 48 kg de Laxass classes en Ovin
        // portaient a eux seuls le taux attribue a l'agneau.
        afficher({
            bovin: { vendu: 0, theorique: 0, parProduit: {} },
            ovin: {
                vendu: 10, theorique: 58,
                parProduit: {
                    'Laxass': { theorique: 48, vendu: 0 },
                    'Agneau': { theorique: 10, vendu: 10 }
                }
            }
        });
        const l = lignes();
        expect(l[0][0]).toBe('Laxass');
        expect(l[0][3]).toBe('83 %');
    });

    test('replie par defaut, et l ouverture SURVIT a un nouveau rendu', () => {
        // La zone est videe entre deux rendus: relire l'etat dans le DOM
        // rendait toujours « ferme », et le bloc se refermait sous les doigts
        // des qu'on cochait une exclusion.
        const donnees = {
            bovin: { vendu: 9, theorique: 10, parProduit: { 'Boeuf': { theorique: 10, vendu: 9 } } },
            ovin: { vendu: 0, theorique: 0, parProduit: {} }
        };
        afficher(donnees);
        const det = zone().querySelector('details');
        expect(det.open).toBe(false);

        det.open = true;
        det.dispatchEvent(new Event('toggle'));
        afficher(donnees);
        expect(zone().querySelector('details').open).toBe(true);
    });

    test('aucun produit: la zone reste vide plutot que d afficher un cadre creux', () => {
        afficher({
            bovin: { vendu: 9, theorique: 10, parProduit: {} },
            ovin: { vendu: 0, theorique: 0, parProduit: {} }
        });
        expect(zone().innerHTML).toBe('');
    });

    test('un mois sans donnees efface la composition precedente', () => {
        afficher({
            bovin: { vendu: 9, theorique: 10, parProduit: { 'Boeuf': { theorique: 10, vendu: 9 } } },
            ovin: { vendu: 0, theorique: 0, parProduit: {} }
        });
        expect(zone().innerHTML).not.toBe('');
        afficher(null);
        expect(zone().innerHTML).toBe('');
    });
});
