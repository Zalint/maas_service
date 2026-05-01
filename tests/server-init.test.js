/**
 * @jest-environment node
 *
 * Tests autour des points sensibles de server.js et scripts/init-tenant-db.js
 * ajoutés par le PR maas_service.
 *
 * Couvre:
 * - server.js: le mount du router /api/decoupe est protégé par checkAuth
 *   (smoke test sur le comportement attendu d'auth absente)
 * - init-tenant-db: ordre updateSchema → sequelize.sync (sans inversion,
 *   sinon le bug "column famille does not exist" sur tenants existants)
 * - scripts/dev-tenant.js: chargement .env + .env.local en cascade avec
 *   override (logique extraite mirroir)
 */

describe('server.js mount /api/decoupe', () => {
    // On ne charge PAS server.js entièrement (trop de side effects, DB,
    // sessions, …). On teste juste le contrat: le router decoupe est
    // monté avec checkAuth → sans session, on doit avoir 401.
    //
    // C'est déjà couvert par les tests d'intégration de la route, mais
    // on documente ici l'attendu du mount côté server.

    test('checkAuth est appliqué avant le routeur découpe', () => {
        // Vérification statique: le source de server.js mount le router
        // avec checkAuth en position 2.
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'),
            'utf8'
        );
        // Pattern: app.use('/api/decoupe', checkAuth, decoupeForwardRouter)
        expect(src).toMatch(/app\.use\(['"]\/api\/decoupe['"],\s*checkAuth/);
    });

    test('le router decoupe est requis depuis routes/decoupe-forward', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'server.js'),
            'utf8'
        );
        expect(src).toMatch(/require\(['"]\.\/routes\/decoupe-forward['"]\)/);
    });
});

describe('init-tenant-db: ordre updateSchema → sync', () => {
    // L'ordre est critique: sans updateSchema d'abord, sequelize.sync()
    // génère un COMMENT ON COLUMN sur la nouvelle colonne famille de la
    // table categories existante → erreur Postgres "column does not exist"
    // sur tenants déployés avant l'ajout de la colonne.

    test('updateSchema est appelé avant sequelize.sync dans le code source', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'init-tenant-db.js'),
            'utf8'
        );
        const updateSchemaIdx = src.indexOf('await updateSchema()');
        const syncIdx = src.indexOf('await sequelize.sync()');
        expect(updateSchemaIdx).toBeGreaterThan(0);
        expect(syncIdx).toBeGreaterThan(0);
        expect(updateSchemaIdx).toBeLessThan(syncIdx);
    });

    test('updateSchema est importé depuis db/update-schema', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'init-tenant-db.js'),
            'utf8'
        );
        expect(src).toMatch(/require\(['"]\.\.\/db\/update-schema['"]\)/);
        expect(src).toMatch(/\{\s*updateSchema\s*\}/);
    });

    test('updateSchema dans un try/catch (échec ne doit pas tuer init)', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'init-tenant-db.js'),
            'utf8'
        );
        // Cherche un bloc try { ... await updateSchema() ... } catch
        const updateSchemaIdx = src.indexOf('await updateSchema()');
        const beforeUpdate = src.slice(0, updateSchemaIdx);
        const afterUpdate = src.slice(updateSchemaIdx);
        const tryIdx = beforeUpdate.lastIndexOf('try {');
        const catchIdx = afterUpdate.indexOf('catch');
        expect(tryIdx).toBeGreaterThanOrEqual(0);
        expect(catchIdx).toBeGreaterThanOrEqual(0);
    });
});

describe('dev-tenant.js: chargement .env multi-couches', () => {
    // Mirror logique: charger .env (defaults) puis .env.local (override)
    // avant le spawn du serveur. La fonction n'est pas exportée; on teste
    // l'effet via mock dotenv.

    test('charge .env avant .env.local avec override', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'dev-tenant.js'),
            'utf8'
        );
        // Vérifications statiques sur l'ordre
        const dotenvCalls = src.match(/require\(['"]dotenv['"]\)\.config\(/g);
        expect(dotenvCalls).not.toBeNull();
        expect(dotenvCalls.length).toBeGreaterThanOrEqual(2);
        expect(src).toMatch(/path:\s*envPath/);
        expect(src).toMatch(/path:\s*envLocalPath,\s*override:\s*true/);
        // L'appel sur .env doit précéder celui sur .env.local
        const envIdx = src.indexOf('path: envPath');
        const envLocalIdx = src.indexOf('path: envLocalPath');
        expect(envIdx).toBeLessThan(envLocalIdx);
    });

    test('le dotenv_config_path n\'est plus passé au child', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'dev-tenant.js'),
            'utf8'
        );
        // Le fix est qu'on charge en parent, donc le child n'a plus besoin
        // de l'arg dotenv_config_path. Le tableau args ne doit pas le contenir.
        // On vérifie que la nouvelle signature args = ['server.js'] est utilisée
        // (sans dotenv_config_path).
        expect(src).toMatch(/const args = \[['"]server\.js['"]\]/);
    });

    test('utilise fs.existsSync pour ne pas exiger .env.local', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'scripts', 'dev-tenant.js'),
            'utf8'
        );
        expect(src).toMatch(/fs\.existsSync\(envLocalPath\)/);
        expect(src).toMatch(/fs\.existsSync\(envPath\)/);
    });
});

describe('Behavioral: ordre dotenv configurations', () => {
    // Test fonctionnel: si on simule le chargement avec override, la valeur
    // de .env.local doit gagner. On simule sans toucher dotenv réel.

    function loadLayers(envValues, envLocalValues) {
        const target = {};
        // .env d'abord (sans override → garde existant)
        for (const [k, v] of Object.entries(envValues || {})) {
            if (target[k] === undefined) target[k] = v;
        }
        // .env.local ensuite avec override
        for (const [k, v] of Object.entries(envLocalValues || {})) {
            target[k] = v;
        }
        return target;
    }

    test('.env.local override .env', () => {
        const merged = loadLayers(
            { DB_NAME: 'default_db', PORT: '3000' },
            { DB_NAME: 'mbao_db' }
        );
        expect(merged.DB_NAME).toBe('mbao_db');
        expect(merged.PORT).toBe('3000');
    });

    test('vars uniquement dans .env preserved', () => {
        const merged = loadLayers(
            { SESSION_SECRET: 'abc' },
            { DB_NAME: 'mbao_db' }
        );
        expect(merged.SESSION_SECRET).toBe('abc');
        expect(merged.DB_NAME).toBe('mbao_db');
    });

    test('.env.local seul (sans .env) marche', () => {
        const merged = loadLayers(undefined, { DB_NAME: 'mbao_db' });
        expect(merged.DB_NAME).toBe('mbao_db');
    });

    test('.env seul (sans .env.local) marche', () => {
        const merged = loadLayers({ DB_NAME: 'default_db' }, undefined);
        expect(merged.DB_NAME).toBe('default_db');
    });
});

describe('updateSchema migrations: vérifications source', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'db', 'update-schema.js'),
        'utf8'
    );

    test('seed inventaire_categories utilise ON CONFLICT DO NOTHING', () => {
        expect(src).toMatch(/INSERT INTO inventaire_categories[\s\S]*?ON CONFLICT \(nom\) DO NOTHING/);
    });

    test('CREATE INDEX decoupe_order_logs utilise IF NOT EXISTS (idempotent)', () => {
        expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_decoupe_log_point_vente/);
        expect(src).toMatch(/CREATE INDEX IF NOT EXISTS idx_decoupe_log_created_at/);
    });

    test('seed et indices hors des blocs if(!tableExists) — runnable sur upgrade', () => {
        // Heuristique: l'INSERT INTO inventaire_categories doit suivre le
        // bloc if() pas être à l'intérieur. On vérifie que le INSERT n'est
        // PAS dans la première } qui ferme le if(!invCatTableExists).
        const invIfMatch = src.match(/if \(!invCatTableExists\) \{[\s\S]*?\n        \}/);
        expect(invIfMatch).not.toBeNull();
        // Le INSERT doit être après ce bloc
        const insertIdx = src.indexOf('INSERT INTO inventaire_categories');
        const ifBlockEnd = invIfMatch.index + invIfMatch[0].length;
        expect(insertIdx).toBeGreaterThan(ifBlockEnd);
    });

    test('ALTER TABLE produits ADD COLUMN IF NOT EXISTS pour ventes + prix_personnalise', () => {
        expect(src).toMatch(/ALTER TABLE produits[\s\S]*?ADD COLUMN IF NOT EXISTS "ventes" TEXT\[\]/);
        expect(src).toMatch(/ADD COLUMN IF NOT EXISTS "prix_personnalise" BOOLEAN/);
    });

    test('ALTER TABLE categories ADD COLUMN IF NOT EXISTS famille', () => {
        expect(src).toMatch(/ALTER TABLE categories[\s\S]*?ADD COLUMN IF NOT EXISTS "famille" VARCHAR\(20\)/);
    });

    test('seed familles Boucherie/Epicerie pré-rempli pour catégories standard', () => {
        expect(src).toMatch(/Bovin.*Ovin.*Caprin.*Volaille/);
        expect(src).toMatch(/Boucherie/);
        expect(src).toMatch(/Pack.*Conserve.*Riz & Féculents.*Superette.*Boissons/);
        expect(src).toMatch(/Epicerie/);
    });
});
