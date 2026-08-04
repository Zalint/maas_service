/**
 * Validation d'une composition de pack avant ecriture.
 *
 * Ces regles n'existent que pour arreter des defauts MUETS: rien ne plante,
 * les chiffres du parage se decalent. Sans test, une simplification bien
 * intentionnee les retire sans que personne ne s'en apercoive.
 */
const { validerCompositionPack } = require('../lib/composition-pack');

const ligne = (extra) => Object.assign(
    { produit: 'Boeuf en détail', quantite: 4, unite: 'kg' },
    extra || {}
);

describe('composition acceptee', () => {
    test('une ligne en kilos', () => {
        const r = validerCompositionPack('Pack75000', [ligne()]);
        expect(r.ok).toBe(true);
        expect(r.valides).toHaveLength(1);
        expect(r.valides[0]).toMatchObject({
            pack: 'Pack75000', ordre: 0, produit: 'Boeuf en détail',
            quantite: 4, unite: 'kg', poids_unitaire: null
        });
    });

    test('une piece avec son poids unitaire', () => {
        const r = validerCompositionPack('Pack75000', [
            ligne({ produit: 'Poulet en détail', quantite: 2, unite: 'pièce', poids_unitaire: 1.5 })
        ]);
        expect(r.ok).toBe(true);
        expect(r.valides[0].poids_unitaire).toBe(1.5);
    });

    test('les lignes vides sont ignorees, sans decaler l ordre', () => {
        const r = validerCompositionPack('Pack75000', [
            { produit: '', quantite: 3, unite: 'kg' },
            ligne({ produit: 'Agneau' }),
            { produit: '   ', quantite: 1, unite: 'kg' },
            ligne({ produit: 'Oeuf', quantite: 1, unite: 'tablette' })
        ]);
        expect(r.ok).toBe(true);
        expect(r.valides.map((v) => [v.produit, v.ordre]))
            .toEqual([['Agneau', 0], ['Oeuf', 1]]);
    });

    test('la casse et les espaces de l unite ne font pas echouer', () => {
        const r = validerCompositionPack('Pack75000', [ligne({ unite: '  KG ' })]);
        expect(r.ok).toBe(true);
        expect(r.valides[0].unite).toBe('kg');
    });
});

describe('composition refusee', () => {
    // Le defaut le plus couteux: l'ecran retire une ligne avec
    // this.closest('tr').remove(). Vider les lignes puis Enregistrer envoyait
    // lignes: [], que Array.isArray laisse passer - un tableau vide est
    // truthy. L'ecriture remplacant les lignes du pack en entier, le pack
    // disparaissait, en 200 OK et sans retour possible par l'ecran.
    test('un tableau vide efface le pack: refuse', () => {
        const r = validerCompositionPack('Pack75000', []);
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/au moins une ligne/);
    });

    test('des lignes toutes sans produit: meme effet, meme refus', () => {
        const r = validerCompositionPack('Pack75000', [
            { produit: '', quantite: 2, unite: 'kg' },
            { produit: '   ', quantite: 5, unite: 'kg' }
        ]);
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/au moins une ligne/);
    });

    // quantiteEnKg rend 0 hors kg/piece/tablette: les kilos sortiraient du
    // parage sans la moindre alerte.
    test('une unite inconnue', () => {
        const r = validerCompositionPack('Pack75000', [ligne({ unite: 'kgs' })]);
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/inconnue/);
    });

    test('une piece sans poids unitaire', () => {
        const r = validerCompositionPack('Pack75000', [
            ligne({ produit: 'Poulet en détail', unite: 'pièce', poids_unitaire: null })
        ]);
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/poids unitaire/);
    });

    test('une quantite nulle, negative ou illisible', () => {
        for (const q of [0, -3, 'abc', null, undefined]) {
            const r = validerCompositionPack('Pack75000', [ligne({ quantite: q })]);
            expect(r.ok).toBe(false);
            expect(r.message).toMatch(/quantite invalide/);
        }
    });

    test('un nom de pack absent ou vide', () => {
        for (const p of ['', '   ', null, undefined]) {
            expect(validerCompositionPack(p, [ligne()]).ok).toBe(false);
        }
    });

    test('lignes absent ou non tableau', () => {
        for (const l of [null, undefined, 'kg', 42, {}]) {
            const r = validerCompositionPack('Pack75000', l);
            expect(r.ok).toBe(false);
            expect(r.message).toMatch(/requis/);
        }
    });
});

describe('coherence avec le calcul du parage', () => {
    // Le garde-fou n'a de valeur que s'il refuse exactement ce que le calcul
    // ne sait pas convertir. On le verifie contre quantiteEnKg lui-meme,
    // plutot que contre une liste recopiee qui pourrait diverger.
    const { quantiteEnKg, UNITES_CONNUES } = require('../lib/parage');

    test('toute unite acceptee est convertible, ou vaut zero deliberement', () => {
        for (const unite of UNITES_CONNUES) {
            const r = validerCompositionPack('P', [ligne({ unite, poids_unitaire: 1.5 })]);
            expect(r.ok).toBe(true);
            // tablette vaut 0 kg par choix (des oeufs ne sont ni bovin ni ovin),
            // les autres doivent convertir.
            const kg = quantiteEnKg(r.valides[0]);
            if (unite === 'tablette') expect(kg).toBe(0);
            else expect(kg).toBeGreaterThan(0);
        }
    });

    test('une composition acceptee ne perd jamais de kilos par surprise', () => {
        const r = validerCompositionPack('Pack75000', [
            ligne({ produit: 'Veau en détail', quantite: 8, unite: 'kg' }),
            ligne({ produit: 'Poulet en détail', quantite: 5, unite: 'pièce', poids_unitaire: 1.5 })
        ]);
        expect(r.ok).toBe(true);
        const total = r.valides.reduce((s, v) => s + quantiteEnKg(v), 0);
        expect(total).toBeCloseTo(8 + 7.5, 6);
    });
});
