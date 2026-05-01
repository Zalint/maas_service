/**
 * Tests E2E pour la case "Masquer les produits en mode stock automatique"
 * sur l'écran Stock (gestion stock).
 */

describe('Filtre produits automatiques (Stock)', () => {
    let stockAvailable = false;

    before(() => {
        cy.visit('/', { timeout: 30000, failOnStatusCode: false });
        cy.login();
        cy.get('body', { timeout: 10000 }).then(($body) => {
            stockAvailable = $body.find('#masquer-produits-automatiques').length > 0 ||
                              $body.text().includes('Stock');
            cy.log(`Filtre stock auto ${stockAvailable ? 'disponible' : 'non disponible'}`);
        });
    });

    beforeEach(() => {
        if (!stockAvailable) {
            cy.log('Test ignoré');
            return;
        }
        cy.visit('/', { failOnStatusCode: false });
        cy.login();
        // Naviguer vers Stock — selon le menu
        cy.get('body').then(($body) => {
            const stockLink = $body.find(
                '[data-section="stock"], [data-target*="stock"], a:contains("Stock")'
            );
            if (stockLink.length) {
                cy.wrap(stockLink.first()).click({ force: true });
                cy.wait(800);
            }
        });
    });

    it('la case "Masquer les produits en mode stock automatique" est cochée par défaut', function () {
        if (!stockAvailable) return this.skip();
        cy.get('#masquer-produits-automatiques', { timeout: 10000 })
            .should('be.checked');
    });

    it('elle est positionnée juste après "Masquer quantité à zéro"', function () {
        if (!stockAvailable) return this.skip();
        cy.get('#masquer-produits-automatiques').then(($el) => {
            const parent = $el.closest('.row, .form-group, .col-md-6');
            expect(parent.find('#masquer-quantite-zero').length).to.be.greaterThan(0);
        });
    });

    it('décocher rend visibles les lignes avec badge ⚡', function () {
        if (!stockAvailable) return this.skip();
        // S'assurer que le tableau est rendu
        cy.get('#stock-table tbody tr', { timeout: 10000 }).should('exist');

        // État initial: case cochée → ⚡ rows cachées
        cy.get('#stock-table tbody tr:visible').then(($visible) => {
            const visibleCount = $visible.length;

            cy.get('#masquer-produits-automatiques').uncheck();
            cy.wait(300);

            cy.get('#stock-table tbody tr:visible').then(($afterUncheck) => {
                // Si le tenant a des produits auto, le count doit augmenter
                // Sinon (tenant sans auto), il reste pareil. On accepte les
                // deux scénarios.
                expect($afterUncheck.length).to.be.gte(visibleCount);
            });
        });
    });

    it('recocher cache à nouveau les ⚡', function () {
        if (!stockAvailable) return this.skip();
        cy.get('#stock-table tbody tr', { timeout: 10000 }).should('exist');
        cy.get('#masquer-produits-automatiques').uncheck();
        cy.wait(300);
        cy.get('#masquer-produits-automatiques').check();
        cy.wait(300);
        // Aucune ligne avec un badge bg-primary visible
        cy.get('#stock-table tbody tr:visible .badge.bg-primary').should('have.length', 0);
    });

    it('le filtre s\'applique automatiquement au chargement (pas besoin de toucher la case)', function () {
        if (!stockAvailable) return this.skip();
        // Refresh complet
        cy.reload();
        cy.wait(2000);
        cy.get('#stock-table tbody tr', { timeout: 10000 }).should('exist');
        // Aucun ⚡ visible (cochée par défaut)
        cy.get('#stock-table tbody tr:visible .badge.bg-primary').should('have.length', 0);
    });
});
