/**
 * Controle de deploiement des references de caisse.
 *
 * Ce garde-fou existe pour un scenario precis: un tenant fraichement cree.
 * scripts/setup-tenant.js genere `references_caisse: {}`, et sans ce controle
 * le tenant partait en production avec une table vide - clotures en 201 succes,
 * aucune ligne dans cash_payments, point de vente absent de la reconciliation,
 * et pas une seule erreur nulle part.
 */
const fs = require('fs');
const path = require('path');
const { validerReferencesCaisse } = require('../lib/valider-references-caisse');

const marque = (refs) => ({ ESSAI: { nom_complet: 'Essai', references_caisse: refs } });

describe('configuration acceptee', () => {
    test('une marque avec une reference', () => {
        const r = validerReferencesCaisse(marque({ Mbao: 'CASH_MBA' }));
        expect(r.ok).toBe(true);
        expect(r.problemes).toEqual([]);
        expect(r.total).toBe(1);
    });

    test('deux points de vente partageant une reference', () => {
        // 'Abattage' et 'Depot central' partagent CASH_ABATS en production:
        // ce n'est pas une erreur de configuration.
        const r = validerReferencesCaisse(marque({
            'Abattage': 'CASH_ABATS',
            'Dépôt central': 'CASH_ABATS',
            'Touba': 'CASH_TB'
        }));
        expect(r.ok).toBe(true);
        expect(r.total).toBe(3);
    });

    // Le controle doit suivre la semantique du runtime, qui fait Object.assign
    // sur TOUTES les marques - une union. Exiger la cle sur chacune ferait
    // echouer le build d'une configuration qui fonctionne, et un garde-fou qui
    // bloque un deploiement legitime coute plus cher que le defaut surveille.
    test('plusieurs marques: une seule portant les references suffit', () => {
        const r = validerReferencesCaisse({
            PRINCIPALE: { references_caisse: { Mbao: 'CASH_MBA' } },
            SECONDAIRE: { nom_complet: 'Sans caisse' }
        });
        expect(r.problemes).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.total).toBe(1);
    });

    test('plusieurs marques: les references sont unies, pas exigees partout', () => {
        const r = validerReferencesCaisse({
            A: { references_caisse: { Mbao: 'CASH_MBA' } },
            B: { references_caisse: { Touba: 'CASH_TB' } }
        });
        expect(r.ok).toBe(true);
        expect(r.total).toBe(2);
    });

    test('les espaces autour d une reference sont tolerés', () => {
        const r = validerReferencesCaisse(marque({ Mbao: '  CASH_MBA  ' }));
        expect(r.ok).toBe(true);
    });
});

describe('configuration refusee', () => {
    // Le cas qui motive tout: le gabarit de setup-tenant.js.
    test('references_caisse vide, tel que genere pour un tenant neuf', () => {
        const r = validerReferencesCaisse(marque({}));
        expect(r.ok).toBe(false);
        expect(r.problemes.join(' ')).toMatch(/absent ou vide/);
    });

    test('references_caisse absent de toutes les marques', () => {
        const r = validerReferencesCaisse({ A: { nom_complet: 'A' }, B: { nom_complet: 'B' } });
        expect(r.ok).toBe(false);
        expect(r.problemes.join(' ')).toMatch(/absent ou vide/);
    });

    // Une reference vide est aussi nefaste qu'une absente: `|| null` rend null
    // et server.js saute l'ecriture exactement pareil.
    test('une reference vide ou faite d espaces', () => {
        for (const v of ['', '   ']) {
            const r = validerReferencesCaisse(marque({ Mbao: 'CASH_MBA', Touba: v }));
            expect(r.ok).toBe(false);
            expect(r.problemes.join(' ')).toMatch(/Touba/);
        }
    });

    // String(42) vaut '42' et String({}) vaut '[object Object]': sans controle
    // de type, ces valeurs finiraient telles quelles dans
    // cash_payments.payment_reference.
    test('une reference qui n est pas une chaine', () => {
        for (const v of [42, {}, ['CASH_MBA'], true, null]) {
            const r = validerReferencesCaisse(marque({ Mbao: v }));
            expect({ v: JSON.stringify(v), ok: r.ok }).toEqual({ v: JSON.stringify(v), ok: false });
        }
    });

    test('un nom de point de vente vide', () => {
        const r = validerReferencesCaisse(marque({ '': 'CASH_X', Mbao: 'CASH_MBA' }));
        expect(r.ok).toBe(false);
        expect(r.problemes.join(' ')).toMatch(/nom de point de vente vide/);
    });

    test('references_caisse mal typee', () => {
        for (const v of [[], 'CASH_MBA', 42]) {
            const r = validerReferencesCaisse(marque(v));
            expect(r.ok).toBe(false);
            expect(r.problemes.join(' ')).toMatch(/doit etre un objet/);
        }
    });

    test('un brand-config vide, absent ou absurde', () => {
        for (const c of [{}, null, undefined, [], 'texte', 42]) {
            expect(validerReferencesCaisse(c).ok).toBe(false);
        }
    });
});

describe('configurations reelles du depot', () => {
    // Enumeration DYNAMIQUE: une liste de slugs codee en dur laisserait un
    // cinquieme tenant sortir sans jamais etre verifie - exactement le
    // scenario que ce garde-fou est cense couvrir.
    const racineTenants = path.join(__dirname, '..', 'config', 'tenants');
    const slugs = fs.existsSync(racineTenants)
        ? fs.readdirSync(racineTenants, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
        : [];

    test('au moins un tenant est present (sinon ce bloc ne teste rien)', () => {
        expect(slugs.length).toBeGreaterThan(0);
    });

    test.each(slugs)('le tenant %s passe le controle', (slug) => {
        const fichier = path.join(racineTenants, slug, 'brand-config.json');
        // Un bundle sans brand-config.json partirait avec la configuration de
        // la racine: le nom et les references de caisse d'un AUTRE client.
        expect(fs.existsSync(fichier)).toBe(true);
        const brand = JSON.parse(fs.readFileSync(fichier, 'utf8').replace(/^﻿/, ''));
        const r = validerReferencesCaisse(brand);
        expect({ slug, problemes: r.problemes }).toEqual({ slug, problemes: [] });
        expect(r.total).toBeGreaterThan(0);
    });

    test('la configuration a la racine passe', () => {
        const fichier = path.join(__dirname, '..', 'brand-config.json');
        const brand = JSON.parse(fs.readFileSync(fichier, 'utf8').replace(/^﻿/, ''));
        expect(validerReferencesCaisse(brand).problemes).toEqual([]);
    });

    // Ces tests-la liraient les vrais fichiers meme si la regle etait videe de
    // sa substance. Celui-ci verifie que la regle REFUSE encore quelque chose.
    test('la regle refuse toujours: elle n est pas devenue permissive', () => {
        expect(validerReferencesCaisse(marque({})).ok).toBe(false);
        expect(validerReferencesCaisse({}).ok).toBe(false);
    });
});
