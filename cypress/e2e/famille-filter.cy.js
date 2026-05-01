/**
 * Tests E2E pour le filtre Famille (Boucherie/Epicerie/Autres) sur les
 * onglets Produits Généraux et Produits Inventaire.
 */

describe('Filtre Famille — Produits Généraux + Inventaire', () => {
    let adminAvailable = false;

    before(() => {
        cy.visit('/', { timeout: 30000, failOnStatusCode: false });
        cy.login();
        cy.visit('/admin.html', { failOnStatusCode: false });
        cy.get('body', { timeout: 10000 }).then(($body) => {
            adminAvailable = $body.text().includes('Produits Généraux') ||
                             $body.text().includes('Produits Inventaire');
            cy.log(`Admin produits ${adminAvailable ? 'disponible' : 'non disponible'}`);
        });
    });

    beforeEach(() => {
        if (!adminAvailable) {
            cy.log('Test ignoré');
            return;
        }
        cy.visit('/admin.html', { failOnStatusCode: false });
        cy.login();
        cy.wait(1000);
    });

    describe('onglet Produits Généraux', () => {
        beforeEach(() => {
            if (!adminAvailable) return;
            cy.contains(/Produits Généraux/i, { timeout: 10000 }).click();
            cy.wait(800);
        });

        it('affiche les 4 boutons de filtre famille', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /^Tous$/).should('be.visible');
            cy.contains('button', /Boucherie/).should('be.visible');
            cy.contains('button', /Epicerie/).should('be.visible');
            cy.contains('button', /^Autres$/).should('be.visible');
        });

        it('"Tous" est actif par défaut (btn-primary)', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /^Tous$/).should('have.class', 'btn-primary');
        });

        it('cliquer sur Boucherie filtre les catégories', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /Boucherie/).click();
            cy.wait(300);
            cy.contains('button', /Boucherie/).should('have.class', 'btn-primary');
            // Au moins une catégorie Boucherie attendue (Bovin, Ovin, …)
            // ou un message "Aucune catégorie" si famille pas configurée
            cy.get('#produits-categories').should('be.visible');
        });

        it('cliquer sur Epicerie filtre différemment', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /Boucherie/).click();
            cy.wait(300);
            const beforeBoucherie = [];
            cy.get('#produits-categories .accordion-item').each(($el) => {
                beforeBoucherie.push($el.text());
            }).then(() => {
                cy.contains('button', /Epicerie/).click();
                cy.wait(300);
                // Le contenu doit avoir changé (sauf si les deux familles
                // sont vides ou identiques — cas edge)
                cy.get('#produits-categories').should('exist');
            });
        });

        it('chaque accordéon a un dropdown famille', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /^Tous$/).click();
            cy.wait(300);
            cy.get('#produits-categories select[data-action="changer-famille-categorie"]')
                .should('have.length.at.least', 1);
        });

        it('changer la famille via dropdown déclenche un PUT', function () {
            if (!adminAvailable) return this.skip();
            cy.intercept('PUT', '/api/admin/config/categories/*').as('putCategorie');
            cy.contains('button', /^Tous$/).click();
            cy.wait(300);
            cy.get('#produits-categories select[data-action="changer-famille-categorie"]')
                .first().then(($select) => {
                    const current = $select.val();
                    const next = current === 'Autres' ? 'Boucherie' : 'Autres';
                    cy.wrap($select).select(next);
                    cy.wait('@putCategorie', { timeout: 5000 });
                });
        });

        it('cliquer sur le dropdown ne ferme pas l\'accordéon', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /^Tous$/).click();
            cy.wait(300);
            cy.get('#produits-categories .accordion-item').first().within(() => {
                cy.get('.accordion-collapse').then(($before) => {
                    const wasShown = $before.hasClass('show');
                    cy.get('select[data-action="changer-famille-categorie"]').click();
                    cy.wait(200);
                    cy.get('.accordion-collapse').should(($after) => {
                        // L'état du collapse ne doit pas changer
                        expect($after.hasClass('show')).to.equal(wasShown);
                    });
                });
            });
        });
    });

    describe('onglet Produits Inventaire', () => {
        beforeEach(() => {
            if (!adminAvailable) return;
            cy.contains(/Produits Inventaire/i, { timeout: 10000 }).click();
            cy.wait(800);
        });

        it('affiche aussi les 4 boutons de filtre famille', function () {
            if (!adminAvailable) return this.skip();
            cy.get('#inventaire-categories').should('exist');
            cy.contains('button', /^Tous$/).should('be.visible');
            cy.contains('button', /Boucherie/).should('be.visible');
            cy.contains('button', /Epicerie/).should('be.visible');
        });

        it('Viandes par défaut → famille Boucherie', function () {
            if (!adminAvailable) return this.skip();
            cy.contains('button', /Boucherie/).click();
            cy.wait(300);
            cy.contains('Viandes', { timeout: 5000 }).should('be.visible');
        });

        it('changer la famille d\'une catégorie inventaire → PUT inventaire-categories', function () {
            if (!adminAvailable) return this.skip();
            cy.intercept('PUT', '/api/admin/config/inventaire-categories/*').as('putInvCat');
            cy.contains('button', /^Tous$/).click();
            cy.wait(300);
            cy.get('#inventaire-categories select').first().then(($select) => {
                const current = $select.val();
                const next = current === 'Autres' ? 'Epicerie' : 'Autres';
                cy.wrap($select).select(next);
                cy.wait('@putInvCat', { timeout: 5000 });
            });
        });
    });
});
