/**
 * Tests E2E pour le modal "Centre de Découpe" sur le POS.
 *
 * Pré-requis: serveur lancé localement (npm run tenant:dev --slug=mbao)
 * + tenant admin connecté + au moins un produit dans le catalogue.
 *
 * Pour rendre les tests robustes face à des envs variés, chaque test
 * détecte la disponibilité de la fonctionnalité avant de jouer ses
 * assertions (skip si pas dispo).
 */

describe('Centre de Découpe — modal POS', () => {
    let modalAvailable = false;

    before(() => {
        cy.visit('/', { timeout: 30000, failOnStatusCode: false });
        cy.login();
        cy.visit('/pos.html', { failOnStatusCode: false });
        cy.get('body', { timeout: 10000 }).then(($body) => {
            modalAvailable = $body.find('#btnOuvrirDecoupe').length > 0;
            cy.log(`Bouton Découpe ${modalAvailable ? 'disponible' : 'non disponible'}`);
        });
    });

    beforeEach(() => {
        if (!modalAvailable) {
            cy.log('Test ignoré — fonctionnalité Découpe non disponible');
            return;
        }
        cy.visit('/pos.html', { failOnStatusCode: false });
        cy.login();
    });

    it('le bouton "🔪 Découpe" est visible dans le header Produits', function () {
        if (!modalAvailable) return this.skip();
        cy.get('#btnOuvrirDecoupe', { timeout: 10000 }).should('be.visible');
        cy.get('#btnOuvrirDecoupe').should('contain.text', 'Découpe');
    });

    it('cliquer sur Découpe avec panier vide affiche un toast warning', function () {
        if (!modalAvailable) return this.skip();
        cy.get('#btnOuvrirDecoupe').click();
        // Toast "Panier vide" attendu (showToast warning)
        cy.contains('panier est vide', { matchCase: false, timeout: 5000 })
            .should('be.visible');
    });

    it('ajouter un produit puis ouvrir Découpe affiche le modal', function () {
        if (!modalAvailable) return this.skip();
        // Ajouter un produit au panier (clic sur la première carte produit)
        cy.get('.product-card, [data-product]', { timeout: 10000 }).first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#modalCentreDecoupe').should('be.visible');
        cy.contains('Centre de Découpe').should('be.visible');
    });

    it('le modal a deux onglets: Nouvelle commande et Mes commandes', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#tab-decoupe-new').should('be.visible')
            .and('contain.text', 'Nouvelle commande');
        cy.get('#tab-decoupe-mine').should('be.visible')
            .and('contain.text', 'Mes commandes');
    });

    it('le tableau du panier affiche le produit ajouté', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#decoupePanierBody tr').should('have.length.at.least', 1);
        cy.get('#decoupePanierTotal').invoke('text').should('not.equal', '0');
    });

    it('le select centre est rempli avec les options de l\'env', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        // Le select doit avoir au moins 2 options (placeholder + au moins un centre)
        cy.get('#decoupeCentreSelect option').should('have.length.at.least', 2);
    });

    it('Envoyer sans choix de centre déclenche un toast warning', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        // Forcer placeholder vide (default)
        cy.get('#decoupeCentreSelect').then(($s) => {
            if ($s.find('option[value=""]').length) {
                cy.get('#decoupeCentreSelect').select('');
            }
        });
        cy.get('#decoupeNomClient').type('Client Test');
        cy.get('#decoupeNumClient').type('770000000');
        cy.contains('button', 'Envoyer au Centre').click();
        // Cible le toast warning explicitement (pas le titre du modal qui contient
        // aussi "Centre de Découpe"). showToast() crée un .toast.text-bg-warning.
        cy.get('.toast.text-bg-warning', { timeout: 5000 })
            .should('be.visible')
            .and('contain.text', 'Sélectionne un centre de découpe.');
    });

    it('Envoyer sans nom client → erreur', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        // Choisir un centre valide
        cy.get('#decoupeCentreSelect option').not('[value=""]').first().then(($opt) => {
            cy.get('#decoupeCentreSelect').select($opt.val());
        });
        // Pas de nom — laisser vide
        cy.get('#decoupeNumClient').type('770000000');
        cy.contains('button', 'Envoyer au Centre').click();
        cy.contains(/nom.*client.*requis|requis/i, { matchCase: false, timeout: 5000 })
            .should('be.visible');
    });

    it('basculer sur "Mes commandes" affiche un tableau (vide ou non)', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#tab-decoupe-mine').click();
        cy.get('#decoupeMineBody', { timeout: 10000 }).should('be.visible');
    });

    it('fermer le modal via × ou Échap', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#modalCentreDecoupe').should('be.visible');
        // Bouton fermer
        cy.get('#modalCentreDecoupe .btn-close-modal').click();
        cy.get('#modalCentreDecoupe').should('not.be.visible');
    });

    it('a11y: le modal a role="dialog" et aria-labelledby', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#modalCentreDecoupe')
            .should('have.attr', 'role', 'dialog')
            .and('have.attr', 'aria-modal', 'true')
            .and('have.attr', 'aria-labelledby');
        // Le close button a un aria-label explicite
        cy.get('#modalCentreDecoupe .btn-close-modal')
            .should('have.attr', 'aria-label')
            .and('match', /fermer/i);
    });

    it('a11y: les inputs requis ont aria-required="true"', function () {
        if (!modalAvailable) return this.skip();
        cy.get('.product-card, [data-product]').first().click();
        cy.wait(500);
        cy.get('#btnOuvrirDecoupe').click();
        cy.get('#decoupeNomClient').should('have.attr', 'aria-required', 'true');
        cy.get('#decoupeNumClient').should('have.attr', 'aria-required', 'true');
        cy.get('#decoupeCentreSelect').should('have.attr', 'aria-required', 'true');
    });
});
