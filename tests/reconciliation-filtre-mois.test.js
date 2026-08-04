/**
 * @jest-environment jsdom
 *
 * Filtre par point de vente du tableau "Reconciliation du mois".
 *
 * Ce test charge la VRAIE fonction depuis script.js au lieu d'en recopier la
 * logique: une copie diverge, et c'est precisement une duplication de rendu qui
 * avait fait afficher a ce tableau 11 colonnes sous un en-tete de 15.
 */
const fs = require('fs');
const path = require('path');

// Extrait la fonction de script.js et l'evalue dans le contexte jsdom.
function chargerFiltre() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
    const debut = source.indexOf('function filtrerTableauReconciliationMensuelle()');
    if (debut === -1) throw new Error('filtrerTableauReconciliationMensuelle introuvable dans script.js');
    const fin = source.indexOf('\n}', debut) + 2;
    // eslint-disable-next-line no-new-func
    return new Function(`${source.slice(debut, fin)}\nreturn filtrerTableauReconciliationMensuelle;`)();
}

const filtrer = chargerFiltre();

function poser(lignes, filtre) {
    document.body.innerHTML = `
        <select id="point-vente-filtre-mois"><option value="${filtre}" selected>${filtre}</option></select>
        <table id="reconciliation-mois-table"><tbody></tbody></table>`;
    const tbody = document.querySelector('#reconciliation-mois-table tbody');
    lignes.forEach((l) => {
        const tr = document.createElement('tr');
        if (l === null) {
            // Ligne de remplacement "Aucune donnee": UNE seule cellule.
            const td = document.createElement('td');
            td.colSpan = 15;
            td.textContent = 'Aucune donnée disponible pour cette période.';
            tr.appendChild(td);
        } else {
            ['01/07/2026', l].forEach((txt) => {
                const td = document.createElement('td');
                td.textContent = txt;
                tr.appendChild(td);
            });
        }
        tbody.appendChild(tr);
    });
    return Array.from(tbody.querySelectorAll('tr'));
}

const visibles = (rows) => rows.filter((r) => r.style.display !== 'none').length;

describe('filtre par point de vente', () => {
    test('un filtre vide laisse tout visible', () => {
        const rows = poser(['Mbao', 'Touba', 'Dahra'], '');
        filtrer();
        expect(visibles(rows)).toBe(3);
    });

    test('un filtre ne garde que le point de vente choisi', () => {
        const rows = poser(['Mbao', 'Touba', 'Mbao'], 'Mbao');
        filtrer();
        expect(visibles(rows)).toBe(2);
        expect(rows[1].style.display).toBe('none');
    });

    test('un filtre reappliqué reaffiche ce qu il avait masque', () => {
        const rows = poser(['Mbao', 'Touba'], '');
        rows[1].style.display = 'none'; // etat laisse par un filtre precedent
        filtrer();
        expect(visibles(rows)).toBe(2);
    });
});

describe('ligne de remplacement "Aucune donnée"', () => {
    // Cette ligne n'a qu'une cellule (colSpan=15). Lire cells[1] y levait une
    // TypeError, et l'erreur remontait au chargement entier de l'ecran - pour
    // une table simplement vide. Le cas devient atteignable des lors que le
    // filtre est aussi applique au rendu depuis le cache.
    test('ne fait pas lever quand le tableau est vide', () => {
        poser([null], 'Mbao');
        expect(() => filtrer()).not.toThrow();
    });

    test('ne fait pas lever quand elle cotoie des lignes normales', () => {
        const rows = poser(['Mbao', null, 'Touba'], 'Mbao');
        expect(() => filtrer()).not.toThrow();
        expect(rows[0].style.display).toBe('');
        expect(rows[2].style.display).toBe('none');
    });

    test('la ligne de remplacement est laissee telle quelle, pas masquee', () => {
        const rows = poser([null], 'Mbao');
        filtrer();
        expect(rows[0].style.display).toBe('');
    });
});
