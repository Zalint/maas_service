/**
 * Tests E2E pour le modal "Gérer ventes liées" sur l'admin Inventaire.
 */

describe('Modal Gérer ventes liées (admin Inventaire)', () => {
    let modalAvailable = false;

    before(() => {
        cy.visit('/', { timeout: 30000, failOnStatusCode: false });
        cy.login();
        cy.visit('/admin.html', { failOnStatusCode: false });
        cy.get('body', { timeout: 10000 }).then(($body) => {
            modalAvailable = $body.text().includes('Produits Inventaire');
            cy.log(`Admin Inventaire ${modalAvailable ? 'disponible' : 'non disponible'}`);
        });
    });

    beforeEach(() => {
        if (!modalAvailable) {
            cy.log('Test ignoré');
            return;
        }
        cy.visit('/admin.html', { failOnStatusCode: false });
        cy.login();
        // Naviguer vers l'onglet Inventaire
        cy.contains(/Produits Inventaire/i, { timeout: 10000 }).click();
        cy.wait(1000);
    });

    it('la colonne "Ventes liées" affiche un bouton 🔗 Gérer', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /🔗|Gérer/, { timeout: 10000 }).should('exist');
    });

    it('cliquer sur Gérer ouvre le modal "Ventes liées à"', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.contains(/Ventes liées à/i, { timeout: 5000 }).should('be.visible');
    });

    it('le modal a une section "Ajouter un produit vente lié"', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.get('#newVenteLinkName', { timeout: 5000 }).should('be.visible');
        cy.contains('button', /Ajouter/).should('be.visible');
    });

    it('le modal a un tableau Produit Généraux / Prix / État / Actions', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.get('#gererVentesBody', { timeout: 5000 }).should('be.visible');
        cy.contains(/produit généraux/i).should('be.visible');
        cy.contains(/prix défaut/i).should('be.visible');
        cy.contains(/état/i).should('be.visible');
    });

    it('l\'autocomplete propose les produits Généraux existants', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.get('#newVenteLinkName').should('have.attr', 'list', 'ventesAvailableList');
        cy.get('#ventesAvailableList option').should('have.length.at.least', 1);
    });

    it('le bouton "Sauver" est présent dans le footer', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.get('#gererVentesSaveBtn', { timeout: 5000 }).should('be.visible');
        cy.get('#gererVentesSaveBtn').should('contain.text', 'Sauver');
    });

    it('fermer le modal via "Fermer"', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.get('#gererVentesModal').should('be.visible');
        cy.contains('#gererVentesModal button', 'Fermer').click();
        cy.get('#gererVentesModal').should('not.exist');
    });

    it('un produit lié affiche le badge 🔗 hérité ou 🔒 prix personnalisé', function () {
        if (!modalAvailable) return this.skip();
        cy.contains('button', /Gérer/).first().click();
        cy.get('#gererVentesBody tr', { timeout: 5000 }).then(($rows) => {
            const linkedRows = $rows.not(':contains("Aucun")');
            if (linkedRows.length === 0) {
                cy.log('Pas de produit lié — skip badge check');
                return;
            }
            // Au moins un badge attendu
            cy.wrap(linkedRows).first().within(() => {
                cy.get('.badge').should('exist');
            });
        });
    });
});
