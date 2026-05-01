/**
 * Tests unitaires des helpers du forwarder découpe.
 *
 * Couvre les zones où des bugs concrets sont apparus pendant le développement:
 *  - parseCentres: env parsing + fallback
 *  - normalizeProduit: payloads FR/EN, fallback montant (bug NaN historique)
 *  - clampLimit: protection contre les valeurs négatives ou non numériques
 *  - resoudrePV: ré-attribution des PV legacy au nom du tenant
 */

const {
    CENTRES_PAR_DEFAUT,
    parseCentres,
    normalizeProduit,
    clampLimit,
    resoudrePV
} = require('../routes/decoupe-helpers');

describe('parseCentres', () => {
    const ORIGINAL_ENV = process.env.MATA_DECOUPE_CENTRE;

    afterEach(() => {
        if (ORIGINAL_ENV === undefined) delete process.env.MATA_DECOUPE_CENTRE;
        else process.env.MATA_DECOUPE_CENTRE = ORIGINAL_ENV;
    });

    test('retourne les défauts quand l\'env est absente', () => {
        delete process.env.MATA_DECOUPE_CENTRE;
        expect(parseCentres()).toEqual(CENTRES_PAR_DEFAUT);
    });

    test('retourne les défauts quand l\'env est vide ou whitespace', () => {
        process.env.MATA_DECOUPE_CENTRE = '';
        expect(parseCentres()).toEqual(CENTRES_PAR_DEFAUT);

        process.env.MATA_DECOUPE_CENTRE = '  ;  ;  ';
        expect(parseCentres()).toEqual(CENTRES_PAR_DEFAUT);
    });

    test('parse une liste séparée par ;', () => {
        process.env.MATA_DECOUPE_CENTRE = 'Centre A;Centre B';
        expect(parseCentres()).toEqual(['Centre A', 'Centre B']);
    });

    test('trim les espaces autour des entrées', () => {
        process.env.MATA_DECOUPE_CENTRE = '  Centre A  ;Centre B ;  Centre C';
        expect(parseCentres()).toEqual(['Centre A', 'Centre B', 'Centre C']);
    });

    test('preserve l\'ordre — la première entrée sert de défaut', () => {
        process.env.MATA_DECOUPE_CENTRE = 'Banlieue;Dakar';
        const list = parseCentres();
        expect(list[0]).toBe('Banlieue');
        expect(list[1]).toBe('Dakar');
    });

    test('valeur unique sans ; est acceptée', () => {
        process.env.MATA_DECOUPE_CENTRE = 'Centre Solo';
        expect(parseCentres()).toEqual(['Centre Solo']);
    });

    test('mutations du tableau retourné ne polluent pas les appels suivants', () => {
        delete process.env.MATA_DECOUPE_CENTRE;
        const a = parseCentres();
        a.push('mutation');
        const b = parseCentres();
        expect(b).toEqual(CENTRES_PAR_DEFAUT);
        expect(b).not.toContain('mutation');
    });
});

describe('normalizeProduit', () => {
    test('payload français complet (clés FR avec montant)', () => {
        expect(normalizeProduit({
            categorie: 'Bovin',
            produit: 'Boeuf en détail',
            prixUnit: 3700,
            nombre: 2,
            montant: 7400
        })).toEqual({
            categorie: 'Bovin',
            produit: 'Boeuf en détail',
            prixUnit: 3700,
            nombre: 2,
            montant: 7400
        });
    });

    test('payload français sans montant — recalcule prixUnit*nombre (bug historique)', () => {
        // Avant le fix, ce cas tombait en NaN parce que le fallback était
        // p.price * p.quantity (undefined * undefined). Le test verrouille
        // le comportement attendu.
        const out = normalizeProduit({
            prixUnit: 3700,
            nombre: 2,
            produit: 'Foie',
            categorie: 'Bovin'
        });
        expect(out.montant).toBe(7400);
    });

    test('payload anglais (price/quantity/name/category)', () => {
        expect(normalizeProduit({
            category: 'Volaille',
            name: 'Poulet',
            price: 3500,
            quantity: 3
        })).toEqual({
            categorie: 'Volaille',
            produit: 'Poulet',
            prixUnit: 3500,
            nombre: 3,
            montant: 10500
        });
    });

    test('valeurs string converties en nombres', () => {
        const out = normalizeProduit({
            prixUnit: '3700',
            nombre: '2.5',
            produit: 'Boeuf'
        });
        expect(out.prixUnit).toBe(3700);
        expect(out.nombre).toBe(2.5);
        expect(out.montant).toBe(9250);
    });

    test('valeurs invalides → 0 (pas NaN)', () => {
        const out = normalizeProduit({
            prixUnit: 'abc',
            nombre: null,
            produit: 'X'
        });
        expect(out.prixUnit).toBe(0);
        expect(out.nombre).toBe(0);
        expect(out.montant).toBe(0);
        expect(Number.isNaN(out.montant)).toBe(false);
    });

    test('input null/undefined ne plante pas et retourne un produit vide', () => {
        expect(normalizeProduit(null)).toEqual({
            categorie: '', produit: '', prixUnit: 0, nombre: 0, montant: 0
        });
        expect(normalizeProduit(undefined)).toEqual({
            categorie: '', produit: '', prixUnit: 0, nombre: 0, montant: 0
        });
    });

    test('montant explicite 0 reste 0 (pas écrasé par le fallback)', () => {
        // p.montant != null est true pour 0, donc on garde 0 via le ternaire.
        // Number(0) || 0 retourne 0. Comportement attendu: respecter le 0
        // explicite envoyé par le client (cas "produit offert").
        const out = normalizeProduit({
            prixUnit: 1000,
            nombre: 5,
            montant: 0,
            produit: 'X'
        });
        expect(out.montant).toBe(0);
    });

    test('montant manquant ET prixUnit*nombre = 0 → 0 (pas NaN)', () => {
        const out = normalizeProduit({ produit: 'X' });
        expect(out.montant).toBe(0);
        expect(Number.isNaN(out.montant)).toBe(false);
    });

    test('clés FR prioritaires sur clés EN', () => {
        const out = normalizeProduit({
            prixUnit: 100, price: 999,
            nombre: 2, quantity: 99,
            produit: 'FR', name: 'EN',
            categorie: 'CatFR', category: 'CatEN'
        });
        expect(out.prixUnit).toBe(100);
        expect(out.nombre).toBe(2);
        expect(out.produit).toBe('FR');
        expect(out.categorie).toBe('CatFR');
        expect(out.montant).toBe(200);
    });
});

describe('clampLimit', () => {
    test('valeur valide passe inchangée', () => {
        expect(clampLimit('50')).toBe(50);
        expect(clampLimit('1')).toBe(1);
        expect(clampLimit('500')).toBe(500);
    });

    test('valeur négative est ramenée à 1 (bug historique parseInt(-5)||100=-5)', () => {
        expect(clampLimit('-5')).toBe(1);
        expect(clampLimit('-100')).toBe(1);
        expect(clampLimit(-1)).toBe(1);
    });

    test('zéro est ramené à 1', () => {
        expect(clampLimit('0')).toBe(1);
        expect(clampLimit(0)).toBe(1);
    });

    test('valeur supérieure au max est tronquée', () => {
        expect(clampLimit('99999')).toBe(500);
        expect(clampLimit('501')).toBe(500);
    });

    test('valeur non numérique → defaultLimit', () => {
        expect(clampLimit('abc')).toBe(100);
        expect(clampLimit(null)).toBe(100);
        expect(clampLimit(undefined)).toBe(100);
        expect(clampLimit('')).toBe(100);
    });

    test('defaultLimit et maxLimit personnalisés', () => {
        expect(clampLimit('abc', 25, 50)).toBe(25);
        expect(clampLimit('100', 25, 50)).toBe(50);
        expect(clampLimit('-1', 25, 50)).toBe(1);
    });

    test('NaN explicite traité comme non numérique', () => {
        expect(clampLimit(NaN)).toBe(100);
    });
});

describe('resoudrePV', () => {
    const centres = ['Centre de Découpe Dakar', 'Centre de Découpe Banlieue'];

    test('PV non-centre est conservée', () => {
        expect(resoudrePV('Mbao', centres, 'Mbao')).toBe('Mbao');
        expect(resoudrePV('Sacre Coeur', centres, 'Sacre Coeur')).toBe('Sacre Coeur');
    });

    test('PV vide retombe sur le tenant', () => {
        expect(resoudrePV('', centres, 'Mbao')).toBe('Mbao');
        expect(resoudrePV(null, centres, 'Mbao')).toBe('Mbao');
        expect(resoudrePV(undefined, centres, 'Mbao')).toBe('Mbao');
    });

    test('PV qui matche un centre est ré-attribuée au tenant (legacy data)', () => {
        // Bug historique: avant le fix de pointVenteSelect, certaines lignes
        // étaient sauvegardées avec point_vente=nom du centre. Cette logique
        // les rattrape pour qu'elles agrègent sous le tenant.
        expect(resoudrePV('Centre de Découpe Dakar', centres, 'Mbao')).toBe('Mbao');
        expect(resoudrePV('Centre de Découpe Banlieue', centres, 'Mbao')).toBe('Mbao');
    });

    test('accepte un Set comme deuxième argument', () => {
        const set = new Set(centres);
        expect(resoudrePV('Centre de Découpe Dakar', set, 'Mbao')).toBe('Mbao');
        expect(resoudrePV('Mbao', set, 'Mbao')).toBe('Mbao');
    });

    test('tenant vide → fallback sur Inconnu', () => {
        expect(resoudrePV('', centres, '')).toBe('Inconnu');
        expect(resoudrePV(null, centres, null)).toBe('Inconnu');
    });

    test('liste de centres vide ou absente: tout passe sauf empty/null', () => {
        expect(resoudrePV('Mbao', [], 'Mbao')).toBe('Mbao');
        expect(resoudrePV('Mbao', null, 'Mbao')).toBe('Mbao');
        expect(resoudrePV('', [], 'Mbao')).toBe('Mbao');
    });

    test('comparaison sensible à la casse (Mata renvoie casse exacte)', () => {
        // "centre de découpe dakar" en minuscules ne matche pas — c'est OK,
        // Mata utilise toujours la casse exacte de centres-decoupe.json.
        expect(resoudrePV('centre de découpe dakar', centres, 'Mbao'))
            .toBe('centre de découpe dakar');
    });
});
