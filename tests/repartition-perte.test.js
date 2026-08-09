/**
 * @jest-environment jsdom
 *
 * Carte "Répartition de la perte" des détails du jour (réconciliation).
 *
 * Charge la VRAIE fonction depuis reconciliationManager.js par extraction,
 * comme parage-mois.test.js le fait pour script.js: une copie de la logique
 * divergerait. Le fetch est un bouchon: la carte ne recalcule RIEN, elle ne
 * fait qu'écrire la formule avec les termes que /api/reconciliation/parage
 * lui donne — c'est exactement ce qu'on vérifie ici.
 */
const fs = require('fs');
const path = require('path');

function charger(fetchMock, getCurrentDateMock) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'reconciliationManager.js'), 'utf8');
    const debut = source.indexOf('async function afficherRepartitionPerte(pointVente)');
    if (debut === -1) throw new Error('afficherRepartitionPerte introuvable dans reconciliationManager.js');
    // La fonction est indentée de 4 espaces: elle se termine sur la première
    // ligne "    }" (les blocs internes ferment à 8 espaces ou plus).
    const fin = source.indexOf('\n    }', debut) + '\n    }'.length;
    // eslint-disable-next-line no-new-func
    return new Function('fetch', 'getCurrentDate',
        `${source.slice(debut, fin)}\nreturn afficherRepartitionPerte;`
    )(fetchMock, getCurrentDateMock);
}

function poser() {
    document.body.innerHTML = '<div id="debug-parage-dechet"></div>';
}

const lireHtml = () => document.getElementById('debug-parage-dechet').innerHTML;

// Journée de l'exemple utilisateur: 3 kg de déchet le matin, 4,1 le soir,
// rien de vendu ni jeté → 1,1 kg produit; perte globale 2,25 kg → 1,15 kg
// de déperdition. Les taux viennent du serveur, jamais recalculés ici.
const jourNominal = () => ({
    success: true,
    data: {
        Mbao: {
            bovin: {
                theorique: 57.9, vendu: 55.65, perte: 0.038,
                taux_dechet: 0.019, taux_deperdition: 0.019,
                dechet: { matin: 3, transferts: 0, soir: 4.1, vendu: 0, jete: 0, produit: 1.1 }
            },
            ovin: { theorique: 0, vendu: 0, perte: null, taux_dechet: null, taux_deperdition: null }
        }
    }
});

const fetchOk = (payload) => {
    const mock = jest.fn(async () => ({ ok: true, json: async () => payload }));
    return mock;
};

beforeEach(poser);

describe('carte du jour: les formules avec les termes du jour', () => {
    test('formule dechet produit et formule deperdition, kg et pourcents', async () => {
        const fetchMock = fetchOk(jourNominal());
        const afficher = charger(fetchMock, () => '06/08/2026');
        await afficher('Mbao');

        const html = lireHtml();
        // La perte globale est tracée depuis ses termes, sinon le lecteur ne
        // sait pas d'où sortent les 2,25 kg utilisés plus bas.
        expect(html).toContain('Perte globale : Théorique (57,9 kg) − Vendu (55,65 kg) = 2,25 kg');
        expect(html).toContain('Formule Déchet produit');
        expect(html).toContain('Stock soir déchet (4,1 kg) + Vendu (0 kg) + Jeté (0 kg)');
        expect(html).toContain('− Stock matin déchet (3 kg)');
        expect(html).toContain('1,1 kg');
        expect(html).toContain('Formule Déperdition');
        expect(html).toContain('Perte globale (2,25 kg) − Déchet produit (1,1 kg)');
        expect(html).toContain('1,15 kg');
        // Additivité affichée: déchet + déperdition = perte globale.
        expect(html).toContain('soit 1,9 % + 1,9 % = 3,8 %');
        // Ovin non mesurable: pas de bloc Ovin.
        expect(html).not.toContain('Ovin');
        // Transferts déchet nuls: le terme n'apparaît pas.
        expect(html).not.toContain('Transferts déchet');
    });

    test('la date de l ecran part encodee dans l URL', async () => {
        const fetchMock = fetchOk(jourNominal());
        const afficher = charger(fetchMock, () => '06/08/2026');
        await afficher('Mbao');
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/reconciliation/parage?date=06%2F08%2F2026',
            expect.objectContaining({ credentials: 'include' })
        );
    });

    test('des transferts dechet non nuls entrent dans la formule', async () => {
        const jour = jourNominal();
        jour.data.Mbao.bovin.dechet.transferts = 2;
        const afficher = charger(fetchOk(jour), () => '06/08/2026');
        await afficher('Mbao');
        expect(lireHtml()).toContain('− Transferts déchet (2 kg)');
    });

    test('l ovin mesurable a son propre bloc', async () => {
        const jour = jourNominal();
        jour.data.Mbao.ovin = {
            theorique: 20, vendu: 19, perte: 0.05,
            taux_dechet: 0.02, taux_deperdition: 0.03,
            dechet: { matin: 0, transferts: 0, soir: 0.4, vendu: 0, jete: 0, produit: 0.4 }
        };
        const afficher = charger(fetchOk(jour), () => '06/08/2026');
        await afficher('Mbao');
        const html = lireHtml();
        expect(html).toContain('Bovin');
        expect(html).toContain('Ovin');
        expect(html).toContain('soit 2,0 % + 3,0 % = 5,0 %');
    });

    test('une deperdition negative est signalee, pas rabotee', async () => {
        const jour = jourNominal();
        jour.data.Mbao.bovin.taux_deperdition = -0.01;
        jour.data.Mbao.bovin.dechet.produit = 2.8;
        const afficher = charger(fetchOk(jour), () => '06/08/2026');
        await afficher('Mbao');
        expect(lireHtml()).toContain('⚠ Déperdition négative');
        expect(lireHtml()).not.toContain('⚠ Déchet produit négatif');
    });

    test('un dechet produit negatif du jour est signale', async () => {
        // Le 01/08 reel de Mbao: 5,3 kg de dechet le matin, 3 le soir, rien
        // vendu ni jete → −2,3 kg "produits". Du dechet est sorti sans trace.
        const jour = jourNominal();
        jour.data.Mbao.bovin.dechet = { matin: 5.3, transferts: 0, soir: 3, vendu: 0, jete: 0, produit: -2.3 };
        jour.data.Mbao.bovin.taux_dechet = -0.04;
        jour.data.Mbao.bovin.taux_deperdition = 0.078;
        const afficher = charger(fetchOk(jour), () => '01/08/2026');
        await afficher('Mbao');
        expect(lireHtml()).toContain('⚠ Déchet produit négatif : le stock déchet a baissé sans vente ni jeté saisis');
        expect(lireHtml()).not.toContain('⚠ Déperdition négative');
    });
});

describe('la carte annexe ne casse jamais la vue', () => {
    test('point de vente absent des donnees: conteneur laisse vide', async () => {
        const afficher = charger(fetchOk(jourNominal()), () => '06/08/2026');
        await afficher('Keur Massar');
        expect(lireHtml()).toBe('');
    });

    test('echec reseau: pas d exception, conteneur laisse vide', async () => {
        const fetchMock = jest.fn(async () => { throw new Error('reseau'); });
        const afficher = charger(fetchMock, () => '06/08/2026');
        await expect(afficher('Mbao')).resolves.toBeUndefined();
        expect(lireHtml()).toBe('');
    });

    test('reponse non-ok: conteneur laisse vide', async () => {
        const fetchMock = jest.fn(async () => ({ ok: false }));
        const afficher = charger(fetchMock, () => '06/08/2026');
        await afficher('Mbao');
        expect(lireHtml()).toBe('');
    });

    test('sans date a l ecran, aucun appel reseau', async () => {
        const fetchMock = fetchOk(jourNominal());
        const afficher = charger(fetchMock, () => '');
        await afficher('Mbao');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('journee sans famille dechet mesurable: conteneur laisse vide', async () => {
        const jour = jourNominal();
        jour.data.Mbao.bovin.taux_dechet = null;
        jour.data.Mbao.bovin.taux_deperdition = null;
        const afficher = charger(fetchOk(jour), () => '06/08/2026');
        await afficher('Mbao');
        expect(lireHtml()).toBe('');
    });
});
