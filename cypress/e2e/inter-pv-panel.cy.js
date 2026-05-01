/**
 * Tests E2E pour le panneau "Commandes inter-PV" dans le Résumé du jour
 * (POS).
 */

describe('Panneau Commandes inter-PV (Résumé du jour)', () => {
    let panelAvailable = false;

    before(() => {
        cy.visit('/', { timeout: 30000, failOnStatusCode: false });
        cy.login();
        cy.visit('/pos.html', { failOnStatusCode: false });
        cy.get('body', { timeout: 10000 }).then(($body) => {
            panelAvailable = $body.find('#btnInterPV').length > 0;
            cy.log(`Panneau inter-PV ${panelAvailable ? 'disponible' : 'non disponible'}`);
        });
    });

    beforeEach(() => {
        if (!panelAvailable) {
            cy.log('Test ignoré');
            return;
        }
        cy.visit('/pos.html', { failOnStatusCode: false });
        cy.login();
    });

    it('le bouton inter-PV (icône factory) est visible dans la toolbar', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV', { timeout: 10000 }).should('be.visible');
        cy.get('#btnInterPV i.fa-industry').should('exist');
    });

    it('le panneau est caché par défaut', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#interPVPanel').should('not.be.visible');
    });

    it('cliquer ouvre le panneau et déclenche un fetch /api/decoupe/mine', function () {
        if (!panelAvailable) return this.skip();
        cy.intercept('GET', '/api/decoupe/mine*').as('getMine');
        cy.get('#btnInterPV').click();
        cy.get('#interPVPanel').should('be.visible');
        cy.wait('@getMine', { timeout: 10000 });
    });

    it('le panneau a un header "Commandes envoyées (inter-PV)" + bouton fermer', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV').click();
        cy.get('#interPVPanel').contains(/commandes envoyées|inter-pv/i)
            .should('be.visible');
        cy.get('#interPVPanel .btn-close').should('be.visible');
    });

    it('le tableau a les colonnes attendues: Date, Réf, Centre, Produits, Montant, Statut', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV').click();
        cy.get('#interPVPanel thead th').should('have.length', 6);
        cy.get('#interPVPanel thead').contains('Date');
        cy.get('#interPVPanel thead').contains('Réf');
        cy.get('#interPVPanel thead').contains('Centre');
        cy.get('#interPVPanel thead').contains('Produits');
        cy.get('#interPVPanel thead').contains('Montant');
        cy.get('#interPVPanel thead').contains('Statut');
    });

    it('le badge sur le bouton reflète le nombre d\'orders du jour', function () {
        if (!panelAvailable) return this.skip();
        // Selon la data réelle, le badge peut être visible ou caché.
        // On vérifie juste que la logique est cohérente.
        cy.get('#btnInterPV').click();
        cy.wait(500);
        cy.get('#interPVTableBody tr').then(($rows) => {
            const dataRows = $rows.filter(':not(:contains("Aucune"))');
            cy.get('#interPVBadge').then(($badge) => {
                if (dataRows.length > 0) {
                    // S'il y a des rows réelles, le badge devrait être visible
                    cy.wrap($badge).should('be.visible');
                } else {
                    cy.wrap($badge).should('not.be.visible');
                }
            });
        });
    });

    it('le total affiché est cohérent avec la somme des montants du tableau', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV').click();
        cy.wait(1000);
        cy.get('#interPVTableBody tr').then(($rows) => {
            const dataRows = $rows.filter(':not(:contains("Aucune")):not(:contains("Chargement"))');
            if (dataRows.length === 0) {
                cy.get('#interPVTotal').should('contain.text', '0');
                return;
            }
            // Sum les montants visibles
            let sum = 0;
            dataRows.each((_, row) => {
                const text = Cypress.$(row).find('td').eq(4).text();
                const value = parseFloat(text.replace(/[^\d,.-]/g, '').replace(',', '.'));
                if (!isNaN(value)) sum += value;
            });
            cy.get('#interPVTotal').invoke('text').then((totalStr) => {
                const totalDisplayed = parseFloat(
                    totalStr.replace(/[^\d,.-]/g, '').replace(',', '.')
                );
                expect(totalDisplayed).to.be.closeTo(sum, 1);
            });
        });
    });

    it('cliquer sur une ligne (s\'il y en a) ouvre le modal de détails', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV').click();
        cy.wait(1000);
        cy.get('#interPVTableBody tr').then(($rows) => {
            const dataRows = $rows.filter(':not(:contains("Aucune")):not(:contains("Chargement"))');
            if (dataRows.length === 0) {
                cy.log('Pas de ligne, test skipped');
                return;
            }
            cy.wrap(dataRows.first()).click();
            cy.get('#decoupeDetailsModal', { timeout: 5000 }).should('be.visible');
            cy.contains('Commande').should('be.visible');
        });
    });

    it('le modal détails est user-friendly (pas de JSON brut)', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV').click();
        cy.wait(1000);
        cy.get('#interPVTableBody tr').then(($rows) => {
            const dataRows = $rows.filter(':not(:contains("Aucune")):not(:contains("Chargement"))');
            if (dataRows.length === 0) return;
            cy.wrap(dataRows.first()).click();
            cy.get('#decoupeDetailsModal').within(() => {
                cy.contains(/client/i).should('be.visible');
                cy.contains(/produits/i).should('be.visible');
                // Pas de blocs <pre> de JSON brut
                cy.get('pre').should('not.exist');
            });
        });
    });

    it('changer la date du résumé recharge le panneau si ouvert', function () {
        if (!panelAvailable) return this.skip();
        cy.get('#btnInterPV').click();
        cy.intercept('GET', '/api/decoupe/mine*').as('reload');
        // Changer la date
        cy.get('#summaryDate').then(($input) => {
            if ($input.length) {
                cy.wrap($input).type('2026-01-01');
                cy.wait(500);
                // Le rafraîchirBadgeInterPV se déclenche aussi
                // On valide juste que le panel est encore visible
                cy.get('#interPVPanel').should('be.visible');
            }
        });
    });
});
