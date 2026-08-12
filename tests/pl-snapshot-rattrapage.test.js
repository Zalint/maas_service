/**
 * Gardes du figeage du PL, dont le rattrapage d'une journee passee.
 *
 * Le rattrapage est le pendant du refus de figer un PL ampute: sans lui, une
 * nuit sans source laissait un trou definitif. Mais ecrire dans l'historique
 * n'est pas figer la journee courante, d'ou trois gardes.
 *
 * @jest-environment node
 */

const { resoudreCibleSnapshot } = require('../routes/finance');

const DEFAUT = { dateDebut: '2026-08-01', dateFin: '2026-08-12' };
const appel = (body, role = 'admin', existant = null) =>
    resoudreCibleSnapshot({ body, defaut: DEFAUT, role, existant });

describe('sans date : comportement d origine', () => {
    test('la periode par defaut, source manuel', () => {
        expect(appel({})).toEqual({
            dateDebut: '2026-08-01', dateFin: '2026-08-12', source: 'manuel', remplace: null
        });
    });

    test('un corps absent ou une date vide ne changent rien', () => {
        for (const body of [undefined, null, {}, { date: '' }, { date: '   ' }]) {
            expect(appel(body).source).toBe('manuel');
        }
    });

    test('un superviseur garde le droit de figer la journee courante', () => {
        expect(appel({}, 'superviseur').source).toBe('manuel');
    });

    test("la ligne existante n'empeche pas de refiger le jour courant", () => {
        // Le cron et le bouton doivent pouvoir refiger apres une saisie
        // tardive: c'est le sens meme de l'upsert sur la date du jour.
        expect(appel({}, 'admin', { pl: -1, source: 'cron' }).source).toBe('manuel');
    });
});

describe('avec date : les trois gardes', () => {
    test('la periode part du 1er du mois de la date visee', () => {
        expect(appel({ date: '2026-07-09' })).toEqual({
            dateDebut: '2026-07-01', dateFin: '2026-07-09', source: 'rattrapage', remplace: null
        });
    });

    test('les deux graphies de date sont acceptees', () => {
        expect(appel({ date: '09-07-2026' }).dateFin).toBe('2026-07-09');
    });

    test('une date illisible est refusee en 400', () => {
        expect(() => appel({ date: 'hier' })).toThrow(/date invalide/);
        try { appel({ date: 'hier' }); } catch (e) { expect(e.statusHttp).toBe(400); }
    });

    test('une date future est refusee : elle figerait une periode vide', () => {
        try { appel({ date: '2026-09-01' }); throw new Error('aurait du refuser'); }
        catch (e) { expect(e.statusHttp).toBe(400); expect(e.code).toBe('date_future'); }
    });

    test('aujourd hui reste acceptable comme date explicite', () => {
        expect(appel({ date: DEFAUT.dateFin }).dateFin).toBe('2026-08-12');
    });

    test('un superviseur ne peut PAS ecrire dans l historique', () => {
        // checkPlAccess laisse passer admin ET superviseur: trop large pour
        // reecrire une journee deja passee.
        for (const role of ['superviseur', 'superutilisateur', 'user', '']) {
            try { appel({ date: '2026-07-09' }, role); throw new Error('aurait du refuser'); }
            catch (e) { expect(e.statusHttp).toBe(403); expect(e.code).toBe('admin_requis'); }
        }
    });

    test('une date deja figee n est PAS ecrasee sans demande explicite', () => {
        const existant = { pl: -65514.94, source: 'cron' };
        try { appel({ date: '2026-08-10' }, 'admin', existant); throw new Error('aurait du refuser'); }
        catch (e) {
            expect(e.statusHttp).toBe(409);
            expect(e.code).toBe('deja_fige');
            // Le message doit porter ce qui serait perdu.
            expect(e.message).toMatch(/-65514.94/);
            expect(e.message).toMatch(/cron/);
        }
    });

    test('remplacer: true autorise l ecrasement et trace la valeur perdue', () => {
        const existant = { pl: -65514.94, source: 'cron' };
        const r = appel({ date: '2026-08-10', remplacer: true }, 'admin', existant);
        expect(r.source).toBe('rattrapage');
        expect(r.remplace).toEqual({ pl: -65514.94, source: 'cron' });
    });

    test('remplacer n accepte que le booleen true, pas une valeur vraie', () => {
        const existant = { pl: -1, source: 'cron' };
        for (const v of ['true', 1, 'oui', {}]) {
            expect(() => appel({ date: '2026-08-10', remplacer: v }, 'admin', existant))
                .toThrow(/déjà figé/);
        }
    });

    test("source tient dans la colonne VARCHAR(10)", () => {
        expect(appel({ date: '2026-07-09' }).source.length).toBeLessThanOrEqual(10);
    });
});
