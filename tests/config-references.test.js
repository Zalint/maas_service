/**
 * Garde-fous sur la configuration lue au demarrage.
 *
 * Les deux comportements testes ici ont deja casse en production, chacun en
 * silence: une table de references vidée fait passer une cloture de caisse
 * sans ecrire la ligne de cash, et une validation qui leve ne rapporte plus
 * AUCUN probleme au lieu de tous les lister.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('references de caisse', () => {
    test('la configuration du depot rend une table non vide', () => {
        const { CASH_REFERENCES, erreurConfigReferences } = require('../config/cash-references');
        expect(erreurConfigReferences()).toBeNull();
        expect(Object.keys(CASH_REFERENCES).length).toBeGreaterThan(0);
    });

    test('un point de vente non mappe rend null, sans lever', () => {
        const { generateCashReference } = require('../config/cash-references');
        expect(generateCashReference('Point de vente inexistant')).toBeNull();
        expect(generateCashReference('')).toBeNull();
        expect(generateCashReference(undefined)).toBeNull();
    });

    test('les points de vente configures gardent tous leur reference', () => {
        const { CASH_REFERENCES, generateCashReference } = require('../config/cash-references');
        // Regression: en deplacant la table de server.js vers la configuration,
        // six references sur neuf avaient ete perdues. server.js fait
        // `if (cashRef)` et saute alors l'ecriture: la cloture reussissait sans
        // enregistrer le cash du point de vente concerne.
        for (const nom of Object.keys(CASH_REFERENCES)) {
            expect(generateCashReference(nom)).toBe(CASH_REFERENCES[nom]);
        }
    });

    test('une configuration illisible leve au lieu de rendre null', () => {
        // null ferait passer la cloture en 201 succes sans ligne de caisse.
        // Lever fait rouler la transaction en arriere et remonte une erreur.
        const racine = path.join(__dirname, '..', 'config', 'tenants', '__jest_illisible__');
        fs.mkdirSync(racine, { recursive: true });
        fs.writeFileSync(path.join(racine, 'brand-config.json'), '{ "X": { "references_caisse": {');

        const slugPrecedent = process.env.TENANT_SLUG;
        const erreurPrecedente = console.error;
        try {
            process.env.TENANT_SLUG = '__jest_illisible__';
            console.error = () => {};
            jest.resetModules();
            const mod = require('../config/cash-references');
            expect(mod.erreurConfigReferences()).not.toBeNull();
            expect(() => mod.generateCashReference('Mbao')).toThrow(/illisible/i);
        } finally {
            console.error = erreurPrecedente;
            if (slugPrecedent === undefined) delete process.env.TENANT_SLUG;
            else process.env.TENANT_SLUG = slugPrecedent;
            fs.rmSync(racine, { recursive: true, force: true });
            jest.resetModules();
        }
    });
});

describe('verification des compositions', () => {
    const { verifierCompositions } = require('../config/pack-compositions');

    test('une composition saine ne rapporte rien', () => {
        expect(verifierCompositions({
            P: [
                { produit: 'Veau en détail', quantite: 8, unite: 'kg' },
                { produit: 'Poulet en détail', quantite: 5, unite: 'pièce', poids_unitaire: 1.5 },
                { produit: 'Oeuf', quantite: 1, unite: 'tablette' }
            ]
        })).toEqual([]);
    });

    test('une unite inconnue est signalee', () => {
        const r = verifierCompositions({ P: [{ produit: 'Boeuf', quantite: 2, unite: 'kgs' }] });
        expect(r).toHaveLength(1);
        expect(r[0]).toMatch(/unite inconnue "kgs"/);
    });

    test('une piece sans poids unitaire est signalee', () => {
        const r = verifierCompositions({ P: [{ produit: 'Poulet', quantite: 2, unite: 'pièce' }] });
        expect(r.join(' ')).toMatch(/sans poids_unitaire/);
    });

    // Un element null faisait lever la fonction sur l'acces c.unite: elle ne
    // rapportait plus AUCUN probleme, y compris ceux des lignes valides qui
    // suivaient. Un demarrage muet vaut ici un demarrage "au vert" trompeur.
    test('un element null ne fait pas lever, et les autres restent rapportes', () => {
        let r;
        expect(() => {
            r = verifierCompositions({ P: [null, { produit: 'Boeuf', quantite: 2, unite: 'kgs' }] });
        }).not.toThrow();
        expect(r.join(' ')).toMatch(/produit manquant/);
        expect(r.join(' ')).toMatch(/unite inconnue "kgs"/);
    });

    test('une composition vide est signalee', () => {
        expect(verifierCompositions({ P: [] }).join(' ')).toMatch(/composition vide/);
    });
});
