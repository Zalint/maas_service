/**
 * @jest-environment node
 *
 * Test d'intégration de db/update-schema.js contre un Postgres en mémoire
 * (pg-mem). Vérifie que les migrations:
 *   1. fonctionnent sur DB vierge
 *   2. sont idempotentes (re-run safe)
 *   3. ajoutent les colonnes manquantes sur tables pré-existantes (le cas
 *      "tenant déployé avant l'ajout de famille" qui a cassé la prod)
 *   4. ON CONFLICT DO NOTHING préserve les valeurs admin existantes
 *
 * Le but est de blinder les déploiements: avant ce test, le seul filet
 * était une regex sur le source SQL. Maintenant on l'exécute contre un
 * Postgres réel-ish.
 */

const { newDb } = require('pg-mem');

// =============== Setup pg-mem + shim Sequelize ===============
//
// Sequelize natif sur pg-mem échoue parce que Sequelize fait des introspection
// queries que pg-mem ne supporte pas pleinement. On contourne en exposant un
// shim minimal qui implémente uniquement l'interface utilisée par
// update-schema.js: `sequelize.query(sql, opts)` + `QueryTypes.SELECT`.

let memDb;
let pgClient;
let sequelize;
let updateSchema;

async function pgQuery(sql, replacements) {
    // Translation simple: remplacer les ":nom" par $1, $2, …
    let pgSql = sql;
    const values = [];
    if (replacements) {
        const keys = Object.keys(replacements);
        // Ordre deterministe: dans l'ordre d'apparition dans le SQL
        const ordered = [];
        keys.forEach((k) => {
            const re = new RegExp(`:${k}\\b`, 'g');
            if (re.test(pgSql)) ordered.push(k);
        });
        ordered.forEach((k, i) => {
            const re = new RegExp(`:${k}\\b`, 'g');
            pgSql = pgSql.replace(re, `$${i + 1}`);
            values.push(replacements[k]);
        });
    }
    const result = await pgClient.query(pgSql, values);
    return result.rows;
}

beforeEach(async () => {
    memDb = newDb({ autoCreateForeignKeyIndices: true });

    // Functions utilisées par checkTableExists / checkColumnsExist
    memDb.public.registerFunction({
        name: 'current_schema',
        returns: 'text',
        implementation: () => 'public',
    });
    memDb.public.registerFunction({
        name: 'current_database',
        returns: 'text',
        implementation: () => 'test',
    });

    const pgPkg = memDb.adapters.createPg();
    pgClient = new pgPkg.Client();
    await pgClient.connect();

    // Shim minimal: update-schema utilise sequelize.query(sql, {replacements,
    // type, plain}) et obtient soit un array de rows, soit la première row
    // si plain:true.
    sequelize = {
        query: async (sql, opts = {}) => {
            const rows = await pgQuery(sql, opts.replacements || {});
            if (opts.plain) return rows[0];
            // Sequelize avec type=SELECT renvoie juste l'array de rows.
            // Avec d'autres types (DDL), renvoie [results, metadata].
            if (opts.type === 'SELECT') return rows;
            return [rows, { rowCount: rows.length }];
        },
        QueryTypes: { SELECT: 'SELECT' }
    };

    // Mock les modèles: dans update-schema.js, Reconciliation.sync() et
    // CashPayment.sync() sont appelés sur DB vierge. On simule par CREATE
    // TABLE IF NOT EXISTS qui matche le schéma attendu par les modèles.
    const Reconciliation = {
        sync: async () => {
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS reconciliations (
                    id SERIAL PRIMARY KEY,
                    date VARCHAR(255) UNIQUE NOT NULL,
                    data TEXT NOT NULL,
                    "cashPaymentData" TEXT,
                    "comments" TEXT,
                    "calculated" BOOLEAN DEFAULT TRUE,
                    "version" INTEGER DEFAULT 1,
                    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
                    "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
                )
            `);
        }
    };
    const CashPayment = {
        sync: async () => {
            await pgClient.query(`
                CREATE TABLE IF NOT EXISTS cash_payments (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255),
                    created_at TIMESTAMP NOT NULL,
                    amount FLOAT NOT NULL
                )
            `);
        }
    };

    jest.resetModules();
    jest.doMock('../db', () => ({
        sequelize,
        QueryTypes: { SELECT: 'SELECT' },
        testConnection: async () => true
    }));
    jest.doMock('../db/index', () => ({
        sequelize,
        QueryTypes: { SELECT: 'SELECT' },
        testConnection: async () => true
    }));
    jest.doMock('../db/models/Reconciliation', () => Reconciliation);
    jest.doMock('../db/models/CashPayment', () => CashPayment);

    ({ updateSchema } = require('../db/update-schema'));
});

afterEach(async () => {
    if (pgClient) await pgClient.end().catch(() => {});
});

// =============== Helpers ===============

async function tableExists(tableName) {
    // pg-mem est plus strict que Postgres réel sur certaines queries
    // d'introspection. On utilise une approche simple: tenter un SELECT
    // depuis la table — succès = elle existe, échec = elle n'existe pas.
    try {
        await pgClient.query(`SELECT 1 FROM "${tableName}" LIMIT 1`);
        return true;
    } catch (e) {
        return false;
    }
}

async function columnExists(tableName, columnName) {
    // pg-mem a un bug interne sur COUNT(*) FROM information_schema.columns —
    // on évite COUNT en récupérant les rows et on count en JS.
    const r = await pgClient.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1
         AND column_name = $2`,
        [tableName, columnName]
    );
    return r.rows.length > 0;
}

async function createLegacyTablesWithoutNewColumns() {
    // Simuler un tenant déployé AVANT le PR maas_service:
    // tables existent mais sans les nouvelles colonnes (famille, ventes,
    // prix_personnalise, mata_response).
    await pgClient.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50))`);
    await pgClient.query(`
        CREATE TABLE categories (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(50) UNIQUE NOT NULL,
            ordre INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
    // pg-mem n'aime pas DECIMAL[] ; on simplifie les types pour le test
    // (ce qui compte ici c'est l'existence de la table et l'ajout des
    // colonnes ventes/prix_personnalise via update-schema, pas le type
    // exact de prix_alternatifs).
    await pgClient.query(`
        CREATE TABLE produits (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(100) NOT NULL,
            type_catalogue VARCHAR(20) NOT NULL,
            prix_defaut NUMERIC DEFAULT 0,
            prix_alternatifs TEXT[],
            mode_stock VARCHAR(20) DEFAULT 'manuel',
            unite_stock VARCHAR(20) DEFAULT 'unite',
            categorie_affichage VARCHAR(100),
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
    await pgClient.query(`
        INSERT INTO categories (nom, ordre) VALUES
            ('Bovin', 1), ('Pack', 2), ('Conserve', 3)
    `);
}

// =============== Tests: DB vierge ===============

describe('update-schema sur DB vierge', () => {
    test('crée toutes les nouvelles tables sans erreur', async () => {
        await updateSchema();

        expect(await tableExists('reconciliations')).toBe(true);
        expect(await tableExists('cash_payments')).toBe(true);
        expect(await tableExists('inventaire_categories')).toBe(true);
        expect(await tableExists('decoupe_order_logs')).toBe(true);
    });

    test('inventaire_categories est seedée avec les 6 catégories standard', async () => {
        await updateSchema();
        const { rows } = await pgClient.query(
            `SELECT nom, famille FROM inventaire_categories ORDER BY nom`
        );
        const noms = rows.map((r) => r.nom);
        expect(noms).toContain('Viandes');
        expect(noms).toContain('Œufs et Produits Laitiers');
        expect(noms).toContain('Déchets');
        const viandes = rows.find((r) => r.nom === 'Viandes');
        expect(viandes.famille).toBe('Boucherie');
        const oeufs = rows.find((r) => r.nom === 'Œufs et Produits Laitiers');
        expect(oeufs.famille).toBe('Epicerie');
    });
});

// =============== Tests: idempotence ===============

describe('update-schema idempotent', () => {
    test('deux exécutions consécutives ne lèvent pas d\'erreur', async () => {
        await updateSchema();
        // Pas de throw
        await expect(updateSchema()).resolves.not.toThrow();
    });

    test('le seed inventaire_categories n\'écrase pas les valeurs admin', async () => {
        await updateSchema();
        // Admin reclasse Viandes en "Autres"
        await pgClient.query(
            `UPDATE inventaire_categories SET famille='Autres' WHERE nom='Viandes'`
        );
        // Re-run
        await updateSchema();
        const { rows } = await pgClient.query(
            `SELECT famille FROM inventaire_categories WHERE nom='Viandes'`
        );
        // ON CONFLICT DO NOTHING → l'override admin est préservé
        expect(rows[0].famille).toBe('Autres');
    });

    test('après plusieurs runs, pas de doublons dans inventaire_categories', async () => {
        await updateSchema();
        await updateSchema();
        await updateSchema();
        // pg-mem est faible sur GROUP BY/HAVING — on vérifie l'unicité en JS.
        const { rows } = await pgClient.query(`SELECT nom FROM inventaire_categories`);
        const noms = rows.map((r) => r.nom);
        const unique = new Set(noms);
        expect(noms.length).toBe(unique.size);
    });
});

// =============== Tests: tenant déployé avant le PR ===============

describe('update-schema sur DB pré-existante (cas tenant prod)', () => {
    test('ajoute famille à categories sans casser les données', async () => {
        await createLegacyTablesWithoutNewColumns();
        expect(await columnExists('categories', 'famille')).toBe(false);

        await updateSchema();

        // Colonne famille ajoutée
        expect(await columnExists('categories', 'famille')).toBe(true);
        // Les rangées pré-existantes ont reçu une famille (DEFAULT 'Autres'
        // au minimum). Note: pg-mem n'applique pas toujours les UPDATE de
        // seed conditionnels sur les rangées pré-existantes; ce qu'on
        // vérifie c'est que la migration ne casse pas et que famille est
        // assignée. La logique de seed UPDATE est testée séparément en
        // statique (cf. server-init.test.js).
        const { rows } = await pgClient.query(
            `SELECT nom, famille FROM categories ORDER BY nom`
        );
        for (const r of rows) {
            expect(r.famille).toBeDefined();
            expect(['Boucherie', 'Epicerie', 'Autres']).toContain(r.famille);
        }
    });

    test('ajoute ventes et prix_personnalise à produits', async () => {
        await createLegacyTablesWithoutNewColumns();
        expect(await columnExists('produits', 'ventes')).toBe(false);
        expect(await columnExists('produits', 'prix_personnalise')).toBe(false);

        await updateSchema();

        expect(await columnExists('produits', 'ventes')).toBe(true);
        expect(await columnExists('produits', 'prix_personnalise')).toBe(true);
    });

    test('ajoute default_screen à users', async () => {
        await createLegacyTablesWithoutNewColumns();
        expect(await columnExists('users', 'default_screen')).toBe(false);
        await updateSchema();
        expect(await columnExists('users', 'default_screen')).toBe(true);
    });

    test('crée decoupe_order_logs', async () => {
        await createLegacyTablesWithoutNewColumns();
        expect(await tableExists('decoupe_order_logs')).toBe(false);
        await updateSchema();
        expect(await tableExists('decoupe_order_logs')).toBe(true);
        // Vérification fonctionnelle: l'INSERT marche (donc indices présents
        // ou non, pas bloquant). pg-mem ne supporte pas pg_indexes view, on
        // s'en passe.
        await pgClient.query(`
            INSERT INTO decoupe_order_logs (point_vente, montant_total)
            VALUES ('Mbao', 1000)
        `);
        const { rows } = await pgClient.query(
            `SELECT * FROM decoupe_order_logs WHERE point_vente = 'Mbao'`
        );
        expect(rows).toHaveLength(1);
    });

    test('mata_response est ajoutée si decoupe_order_logs existe sans elle', async () => {
        await createLegacyTablesWithoutNewColumns();
        // Simuler une table decoupe_order_logs déjà créée par un déploiement
        // antérieur à l'ajout de mata_response.
        await pgClient.query(`
            CREATE TABLE decoupe_order_logs (
                id SERIAL PRIMARY KEY,
                point_vente VARCHAR(100) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        `);
        expect(await columnExists('decoupe_order_logs', 'mata_response')).toBe(false);

        await updateSchema();

        expect(await columnExists('decoupe_order_logs', 'mata_response')).toBe(true);
    });

    test('CREATE INDEX IF NOT EXISTS idempotent (tenant qui a déjà l\'index)', async () => {
        await createLegacyTablesWithoutNewColumns();
        await pgClient.query(`
            CREATE TABLE decoupe_order_logs (
                id SERIAL PRIMARY KEY,
                point_vente VARCHAR(100) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            )
        `);
        await pgClient.query(
            `CREATE INDEX idx_decoupe_log_point_vente ON decoupe_order_logs(point_vente)`
        );
        // updateSchema ne doit PAS lever
        await expect(updateSchema()).resolves.not.toThrow();
    });
});

// =============== Tests: les tables nouvelles préservent les types ===============

describe('Schémas créés (vérifs fonctionnelles)', () => {
    test('decoupe_order_logs accepte un INSERT valide', async () => {
        await updateSchema();
        // Test fonctionnel: si la table a les bonnes colonnes, l'INSERT marche
        await pgClient.query(`
            INSERT INTO decoupe_order_logs (
                commande_ref, point_vente, point_vente_executant,
                produits, montant_total, nom_client, mata_response
            ) VALUES (
                'CD-X', 'Mbao', 'Centre A',
                '[]'::jsonb, 100, 'Test', '{}'::jsonb
            )
        `);
        const { rows } = await pgClient.query(`SELECT * FROM decoupe_order_logs`);
        expect(rows).toHaveLength(1);
        expect(rows[0].commande_ref).toBe('CD-X');
    });

    test('inventaire_categories: PK sur nom (insert doublon échoue)', async () => {
        await updateSchema();
        // Le seed a déjà inséré 'Viandes'. Insérer encore avec ON CONFLICT
        // doit être no-op grâce au PK.
        await expect(pgClient.query(
            `INSERT INTO inventaire_categories (nom, famille) VALUES ('Viandes', 'Autres')`
        )).rejects.toThrow();
    });
});
