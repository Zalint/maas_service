/**
 * @jest-environment node
 *
 * AUCUN IDENTIFIANT EN DUR DANS LE DEPOT.
 *
 * Trouve en vrai: routes/payments-generated.js portait la cle de production
 * Bictorys comme valeur de repli d'une variable d'environnement. Elle etait
 * donc dans chaque clone, chaque commit et chaque fork.
 *
 * Le motif est traitre parce qu'il a l'air prudent: `process.env.X || '...'`
 * se lit comme une valeur par defaut raisonnable, alors que la valeur par
 * defaut d'un SECRET ne peut pas exister. Sans variable, il faut refuser -
 * un repli fait croire que le service est configure quand il ne l'est pas,
 * et le jour ou la cle est revoquee l'erreur remonte du fournisseur, pas
 * d'ici.
 *
 * Ce test cherche le MOTIF, pas une valeur particuliere: il n'y a donc aucun
 * secret dans ce fichier, et il attrapera le prochain.
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');

// Les repertoires de code applicatif. node_modules et les donnees sont hors
// sujet: on garde le code que l'equipe ecrit.
const DOSSIERS = ['routes', 'lib', 'db', 'config', 'middlewares', 'scripts'];
const FICHIERS_RACINE = ['server.js', 'script.js'];

function listerJs(dossier) {
    const complet = path.join(RACINE, dossier);
    if (!fs.existsSync(complet)) return [];
    const out = [];
    for (const e of fs.readdirSync(complet, { withFileTypes: true })) {
        if (e.isDirectory()) out.push(...listerJs(path.join(dossier, e.name)));
        else if (e.name.endsWith('.js')) out.push(path.join(dossier, e.name));
    }
    return out;
}

const SOURCES = [
    ...FICHIERS_RACINE.filter((f) => fs.existsSync(path.join(RACINE, f))),
    ...DOSSIERS.flatMap(listerJs),
];

// LES NOMS QUI CONTIENNENT « KEY » SANS ETRE DES SECRETS. TENANT_BRAND_KEY
// designe une marque ('MBAO'), pas un identifiant d'acces: le mettre en dur
// est normal.
const NON_SECRETS = /^(TENANT_BRAND_KEY|BRAND_KEY|[A-Z0-9_]*_PUBLIC_KEY)$/;

// DETTE ANTERIEURE, recensee pour qu'elle se compte et diminue.
//
// Ces replis litteraux existaient avant que ce test soit ecrit. Les corriger
// touche la connexion base et les scripts de deploiement: c'est un chantier a
// part, pas un effet de bord d'un correctif Bictorys. La liste est ici pour
// qu'ils soient VISIBLES et pour qu'aucun NOUVEAU ne s'ajoute en silence.
//
// Regle: cette liste ne doit que RETRECIR. Y ajouter une entree demande de
// justifier pourquoi un secret a une valeur par defaut - ce qui n'arrive pas.
const CONNUS = new Set([
    'server.js (process.env.DB_PASSWORD',
    'server.js (process.env.EXTERNAL_API_KEY',
    'server.js (process.env.SESSION_SECRET',
    'routes/payments-generated.js (process.env.EXTERNAL_API_KEY',
    'scripts/dump-prod-to-local.js (process.env.LOCAL_DB_PASSWORD',
    'scripts/init-tenant-db.js (process.env.DEFAULT_ADMIN_PASSWORD',
    'scripts/migrate-sqlite-to-postgres.js (process.env.DB_PASSWORD',
]);

describe('secrets en dur', () => {
    test('la liste des sources n est pas vide', () => {
        // Sans ce garde-fou, un chemin casse rendrait les tests suivants verts
        // sur un ensemble vide: ils ne garderaient plus rien.
        expect(SOURCES.length).toBeGreaterThan(20);
    });

    test('aucune variable de secret n a de valeur de repli litterale', () => {
        // process.env.QUELQUE_CHOSE_SECRET || 'valeur'
        const motif = new RegExp(
            'process\\.env\\.[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PWD)[A-Z0-9_]*'
            + '\\s*\\|\\|\\s*[\'"`][^\'"`\\n]{8,}[\'"`]'
        );
        const coupables = [];
        for (const f of SOURCES) {
            const texte = fs.readFileSync(path.join(RACINE, f), 'utf8');
            for (const ligne of texte.split('\n')) {
                // On ne rapporte que le NOM du fichier et le nom de la
                // variable: recopier la ligne remettrait le secret dans la
                // sortie de test, donc dans les journaux de CI.
                const m = ligne.match(motif);
                if (!m) continue;
                const variable = String(m[0]).split('||')[0].trim();
                const nom = variable.replace('process.env.', '');
                if (NON_SECRETS.test(nom)) continue;
                // Separateur normalise: le test doit rendre le meme verdict
                // sous Windows et sous Linux.
                const cle = f.split(path.sep).join('/') + ' (' + variable;
                if (CONNUS.has(cle)) continue;
                coupables.push(cle + ')');
            }
        }
        expect(coupables).toEqual([]);
    });

    test('aucune cle au format fournisseur ne traine dans le code', () => {
        // Prefixes courants: 'secret-<hex>', 'sk_live_', 'sk_test_'.
        const motifs = [
            new RegExp('[\'"]secret-[a-f0-9]{8}'),
            new RegExp('sk_(live|test)_[A-Za-z0-9]{10,}'),
        ];
        const coupables = [];
        for (const f of SOURCES) {
            const texte = fs.readFileSync(path.join(RACINE, f), 'utf8');
            if (motifs.some((m) => m.test(texte))) coupables.push(f);
        }
        expect(coupables).toEqual([]);
    });

    test('le fichier d exemple ne porte que des placeholders', () => {
        const p = path.join(RACINE, '.env.example');
        if (!fs.existsSync(p)) return;
        const suspects = [];
        for (const ligne of fs.readFileSync(p, 'utf8').split('\n')) {
            const m = ligne.match(/^([A-Z0-9_]*(PASSWORD|SECRET|KEY|TOKEN)[A-Z0-9_]*)=(.+)$/);
            if (!m) continue;
            if (NON_SECRETS.test(m[1])) continue;
            const valeur = m[3].trim();
            if (!valeur) continue;
            // Un placeholder se reconnait: il decrit ce qu'il faut mettre.
            const estPlaceholder = /^(votre|your|xxx|<|\.\.\.|change|placeholder|dev-only|a-remplir|to-?be)/i
                .test(valeur);
            if (!estPlaceholder) suspects.push(m[1]);
        }
        expect(suspects).toEqual([]);
    });

    test('la dette anterieure ne grossit pas', () => {
        // Si une entree de CONNUS disparait du code, il faut la retirer de la
        // liste: sinon elle protegerait un defaut qui reviendrait plus tard.
        const vues = new Set();
        const motif = new RegExp(
            'process\\.env\\.[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PWD)[A-Z0-9_]*'
            + '\\s*\\|\\|\\s*[\'"`][^\'"`\\n]{8,}[\'"`]'
        );
        for (const f of SOURCES) {
            for (const ligne of fs.readFileSync(path.join(RACINE, f), 'utf8').split('\n')) {
                const m = ligne.match(motif);
                if (!m) continue;
                vues.add(f.split(path.sep).join('/') + ' ('
                    + String(m[0]).split('||')[0].trim());
            }
        }
        const perimes = Array.from(CONNUS).filter((c) => !vues.has(c));
        expect(perimes).toEqual([]);
    });

    test('aucun fichier .env reel n est suivi par git', () => {
        // .gitignore doit couvrir les variantes qui ont deja fuite:
        // .env.backup etait suivi et portait DB_PASSWORD.
        const ignore = fs.readFileSync(path.join(RACINE, '.gitignore'), 'utf8');
        for (const nom of ['.env', '.env.local', '.env.backup']) {
            expect(ignore.split('\n').map((l) => l.trim())).toContain(nom);
        }
    });
});
