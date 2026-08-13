/**
 * Stockage serveur des journees ecartees du cumul mensuel.
 *
 * @jest-environment node
 */

// La bascule ecrit sous VERROU: elle cree la ligne si besoin, la relit avec
// lock: t.LOCK.UPDATE, puis la met a jour - le tout dans une transaction. Le
// faux sequelize execute le callback tel quel, ce qui laisse les assertions
// porter sur ce qui a REELLEMENT ete ecrit.
jest.mock('../db/models', () => ({
    FinanceConfig: {
        findOne: jest.fn(), findOrCreate: jest.fn(), update: jest.fn()
    },
    sequelize: { transaction: (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }) }
}));

const { FinanceConfig } = require('../db/models');
const lib = require('../lib/reconciliation-exclusions');

const poser = (valeur) => FinanceConfig.findOne.mockResolvedValue(valeur === null ? null : { value: valeur });
const ecrit = () => JSON.parse(FinanceConfig.update.mock.calls.at(-1)[0].value);

beforeEach(() => {
    jest.clearAllMocks();
    FinanceConfig.findOrCreate.mockResolvedValue([{}, false]);
    FinanceConfig.update.mockResolvedValue([1]);
});

describe('lecture', () => {
    test('aucune ligne en base: aucune exclusion', async () => {
        poser(null);
        expect(await lib.lireExclusions()).toEqual({});
    });

    test('relit ce qui a ete ecrit, signature comprise', async () => {
        poser(JSON.stringify({ '08-2026': [{ cle: '13/08/2026|Mbao', par: 'ADMIN', le: '2026-08-13T10:00:00.000Z' }] }));
        expect(await lib.lireExclusions()).toEqual({
            '08-2026': [{ cle: '13/08/2026|Mbao', par: 'ADMIN', le: '2026-08-13T10:00:00.000Z' }]
        });
    });

    test('un JSON casse n empeche pas l ecran de s afficher', async () => {
        // Une exclusion illisible doit se traduire par « on compte tout »,
        // jamais par un ecran vide: le total montre est alors le plus complet.
        poser('{pas du json');
        expect(await lib.lireExclusions()).toEqual({});
    });

    test('une panne de base ne fait pas lever', async () => {
        FinanceConfig.findOne.mockRejectedValue(new Error('connexion perdue'));
        expect(await lib.lireExclusions()).toEqual({});
    });

    test('les formes invalides sont RENORMALISEES a la lecture', async () => {
        // Une ligne ecrite a la main en base ne doit pas pouvoir faire
        // disparaitre une journee sous une forme que l'ecriture aurait refusee.
        poser(JSON.stringify({
            '13-2026': [{ cle: 'mois inexistant' }],          // 13e mois
            'aout': [{ cle: 'pas au format' }],                // pas MM-AAAA
            '08-2026': [
                { cle: '13/08/2026|Mbao' },
                { cle: '13/08/2026|Mbao' },                    // doublon
                { pas_de_cle: true },                          // sans cle
                { cle: 'x'.repeat(200) }                       // trop longue
            ]
        }));
        const r = await lib.lireExclusions();
        expect(Object.keys(r)).toEqual(['08-2026']);
        expect(r['08-2026']).toEqual([{ cle: '13/08/2026|Mbao', par: null, le: null }]);
    });

    test('un mois vide ne laisse pas de cle orpheline', async () => {
        poser(JSON.stringify({ '08-2026': [] }));
        expect(await lib.lireExclusions()).toEqual({});
    });
});

describe('bascule', () => {
    test('exclure ajoute la cle avec son auteur et sa date', async () => {
        poser(null);
        const r = await lib.basculerExclusion({
            mois: '08-2026', cle: '13/08/2026|Mbao', exclure: true,
            par: 'ADMIN', le: '2026-08-13T10:00:00.000Z'
        });
        expect(r.ok).toBe(true);
        expect(ecrit()['08-2026']).toEqual([
            { cle: '13/08/2026|Mbao', par: 'ADMIN', le: '2026-08-13T10:00:00.000Z' }
        ]);
    });

    test('reintegrer retire la cle, et le mois vide disparait', async () => {
        poser(JSON.stringify({ '08-2026': [{ cle: '13/08/2026|Mbao', par: 'A', le: null }] }));
        await lib.basculerExclusion({ mois: '08-2026', cle: '13/08/2026|Mbao', exclure: false, par: 'B', le: 'x' });
        expect(ecrit()).toEqual({});
    });

    test('exclure DEUX FOIS ne cree pas de doublon', async () => {
        poser(JSON.stringify({ '08-2026': [{ cle: '13/08/2026|Mbao', par: 'A', le: null }] }));
        await lib.basculerExclusion({ mois: '08-2026', cle: '13/08/2026|Mbao', exclure: true, par: 'B', le: 'y' });
        expect(ecrit()['08-2026']).toHaveLength(1);
        // Le dernier a coche signe: c'est lui qui a confirme la decision.
        expect(ecrit()['08-2026'][0].par).toBe('B');
    });

    test('une bascule ne touche PAS les autres exclusions du mois', async () => {
        // Deux personnes qui cochent deux journees differentes doivent obtenir
        // deux exclusions, pas la derniere ecriture qui gagne.
        poser(JSON.stringify({ '08-2026': [{ cle: '12/08/2026|Mbao', par: 'A', le: null }] }));
        await lib.basculerExclusion({ mois: '08-2026', cle: '13/08/2026|Mbao', exclure: true, par: 'B', le: null });
        expect(ecrit()['08-2026'].map((e) => e.cle).sort())
            .toEqual(['12/08/2026|Mbao', '13/08/2026|Mbao']);
    });

    test('les autres MOIS sont conserves', async () => {
        poser(JSON.stringify({ '07-2026': [{ cle: '01/07/2026|Mbao', par: 'A', le: null }] }));
        await lib.basculerExclusion({ mois: '08-2026', cle: '13/08/2026|Mbao', exclure: true, par: 'B', le: null });
        expect(Object.keys(ecrit()).sort()).toEqual(['07-2026', '08-2026']);
    });

    test('un mois mal forme est refuse, sans rien ecrire', async () => {
        poser(null);
        for (const mois of ['2026-08', '13-2026', 'aout', '', null, '8-2026']) {
            const r = await lib.basculerExclusion({ mois, cle: 'x|y', exclure: true });
            expect(r.ok).toBe(false);
        }
        expect(FinanceConfig.update).not.toHaveBeenCalled();
    });

    test('une cle vide ou demesuree est refusee', async () => {
        poser(null);
        expect((await lib.basculerExclusion({ mois: '08-2026', cle: '', exclure: true })).ok).toBe(false);
        expect((await lib.basculerExclusion({ mois: '08-2026', cle: 'x'.repeat(200), exclure: true })).ok).toBe(false);
        expect(FinanceConfig.update).not.toHaveBeenCalled();
    });

    test('le plafond par mois est oppose, pas silencieusement depasse', async () => {
        const pleine = Array.from({ length: lib.MAX_PAR_MOIS }, (_, i) => ({ cle: `j${i}|Mbao`, par: null, le: null }));
        poser(JSON.stringify({ '08-2026': pleine }));
        const r = await lib.basculerExclusion({ mois: '08-2026', cle: 'nouvelle|Mbao', exclure: true });
        expect(r.ok).toBe(false);
        expect(FinanceConfig.update).not.toHaveBeenCalled();
    });

    test('les mois les plus anciens sortent quand la liste deborde', async () => {
        // Sans purge, la ligne grossit indefiniment: personne ne reintegrera a
        // la main une journee de 2024 pour faire de la place.
        // La fixture est derivee de la constante, avec UN mois de trop: figer
        // 60 ici ferait passer ce test au vert le jour ou le plafond bougerait.
        const vieux = {};
        for (let i = 0; i <= lib.MAX_MOIS; i++) {
            const a = 2020 + Math.floor(i / 12);
            const m = String((i % 12) + 1).padStart(2, '0');
            vieux[m + '-' + a] = [{ cle: `x|${a}${m}`, par: null, le: null }];
        }
        poser(JSON.stringify(vieux));
        await lib.basculerExclusion({ mois: '08-2026', cle: '13/08/2026|Mbao', exclure: true });
        const apres = ecrit();
        expect(Object.keys(apres).length).toBeLessThanOrEqual(lib.MAX_MOIS);
        // Le mois qu'on vient d'ecrire survit, le plus ancien non.
        expect(apres['08-2026']).toBeDefined();
        expect(apres['01-2020']).toBeUndefined();
    });
});
