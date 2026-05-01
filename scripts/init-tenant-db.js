#!/usr/bin/env node
/**
 * Initialize a fresh tenant database.
 *
 * Run once per tenant after the first deploy, from the Render Web Service
 * shell:
 *
 *   npm run tenant:init
 *
 * What it does:
 *   1. Verifies the DB connection.
 *   2. Calls Sequelize sync() to create all tables (no force, no alter
 *      after first run — safe to re-invoke).
 *   3. If the users table is empty, seeds an ADMIN user with the temp
 *      password DEFAULT_ADMIN_PASSWORD ("ChangeMe123!" if not set in env)
 *      so the tenant admin can log in. Logs the credentials clearly.
 *   4. If the points_vente table is empty, seeds a single point of sale
 *      named after TENANT_NAME (one POS per tenant per current spec) and
 *      grants the ADMIN access to it.
 *
 * Idempotent: re-running on an already-initialized tenant is a no-op,
 * except sync() which will pick up any new columns added in code.
 */

require('dotenv').config({
    path: process.env.NODE_ENV === 'production' ? '.env' : '.env.local',
});

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const tenant = require('../config/tenant');
const { sequelize, testConnection } = require('../db');
const { User, PointVente, UserPointVente, Category, Produit } = require('../db/models');
const { updateSchema } = require('../db/update-schema');

const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'ADMIN';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123!';

function resetDataFiles() {
    const root = path.join(__dirname, '..');
    const wipes = [
        ['data/stock-matin.json', '{}\n'],
        ['data/stock-soir.json', '{}\n'],
        ['data/transferts.json', '[]\n'],
        // Mata-specific staff lists committed to the repo. The new tenant
        // admin will repopulate via the app.
        ['acheteur.json', '[]\n'],
        ['livreurs_actifs.json', JSON.stringify({ api_url: null, livreurs_actifs: [] }, null, 2) + '\n'],
    ];
    for (const [rel, contents] of wipes) {
        const p = path.join(root, rel);
        try {
            fs.writeFileSync(p, contents);
            console.log(`🧹 reset ${rel}`);
        } catch (e) {
            console.warn(`   could not reset ${rel}: ${e.message}`);
        }
    }
    // Clear data/by-date/ — these are per-day snapshots from Mata.
    const byDate = path.join(root, 'data', 'by-date');
    if (fs.existsSync(byDate)) {
        try {
            for (const entry of fs.readdirSync(byDate)) {
                const full = path.join(byDate, entry);
                fs.rmSync(full, { recursive: true, force: true });
            }
            console.log('🧹 cleared data/by-date/');
        } catch (e) {
            console.warn(`   could not clear data/by-date/: ${e.message}`);
        }
    }
}

/**
 * Seed the default product catalog (categories + produits) from
 * db/seeds/default-catalog.json. Only runs when the categories table is
 * empty so re-running tenant:init can never overwrite a tenant's edits.
 *
 * The seed mirrors the Mata production catalog with one transformation:
 * legacy "Import OCR" products were merged under "Autres" so the POS
 * Boucherie/Epicerie split works out of the box.
 *
 * Skip this step entirely by setting SEED_DEFAULT_CATALOG=false in env.
 */
async function seedCatalog() {
    if (process.env.SEED_DEFAULT_CATALOG === 'false') {
        console.log('ℹ️  SEED_DEFAULT_CATALOG=false — skipping catalog seed.\n');
        return;
    }

    const catCount = await Category.count();
    if (catCount > 0) {
        console.log(`ℹ️  ${catCount} categorie(s) already exist — skipping catalog seed.\n`);
        return;
    }

    const seedPath = path.join(__dirname, '..', 'db', 'seeds', 'default-catalog.json');
    if (!fs.existsSync(seedPath)) {
        console.log('ℹ️  No db/seeds/default-catalog.json — skipping catalog seed.\n');
        return;
    }

    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const nbCat = (seed.categories || []).length;
    const nbProd = (seed.produits || []).length;
    console.log(`📦 Seeding default catalog: ${nbCat} categories, ${nbProd} produits...`);

    await sequelize.transaction(async (t) => {
        await Category.bulkCreate(seed.categories, { transaction: t });
        await Produit.bulkCreate(seed.produits, { transaction: t });
        // Reset sequences past the highest seeded id so future inserts
        // don't collide with the preserved primary keys.
        await sequelize.query(
            "SELECT setval('categories_id_seq', (SELECT MAX(id) FROM categories));",
            { transaction: t }
        );
        await sequelize.query(
            "SELECT setval('produits_id_seq', (SELECT MAX(id) FROM produits));",
            { transaction: t }
        );
    });

    console.log('🆕 Default catalog seeded.\n');
}

async function main() {
    console.log(`\n=== init-tenant-db: tenant=${tenant.slug} (${tenant.name}) ===\n`);

    const ok = await testConnection();
    if (!ok) {
        console.error('❌ Cannot connect to DB. Check DATABASE_URL / DB_* env vars.');
        process.exit(1);
    }

    // Ensure the tenant's schema exists before sync. When DB_SCHEMA is
    // unset, tenant.schema is 'public' and this is a no-op (public always
    // exists). When set, this is the only place where shared-Postgres
    // schemas are created — keeps schema lifecycle next to model lifecycle.
    if (tenant.schema && tenant.schema !== 'public') {
        console.log(`🔧 Ensuring schema "${tenant.schema}" exists...`);
        await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${tenant.schema}"`);
        console.log('✅ Schema ready.\n');
    }

    // ORDRE IMPORTANT: update-schema avant sync.
    // Sequelize.sync() avec une table existante génère un CREATE TABLE IF NOT
    // EXISTS suivi de COMMENT ON COLUMN pour chaque colonne du modèle. Si une
    // nouvelle colonne (ex: categories.famille) a été ajoutée au modèle après
    // la création initiale de la table, le COMMENT échoue parce que la colonne
    // n'existe pas en DB. update-schema ajoute toutes les colonnes manquantes
    // de manière idempotente, ce qui rend sync() ensuite safe.
    console.log('🔧 Applying schema migrations (update-schema)...');
    try {
        await updateSchema();
        console.log('✅ Migrations applied.\n');
    } catch (e) {
        console.warn('⚠️  update-schema a renvoyé une erreur, on continue avec sync:', e.message);
    }

    console.log('🔧 Syncing models (creates missing tables, leaves existing data alone)...');
    await sequelize.sync();
    console.log('✅ Sync complete.\n');

    // Filet défensif: sequelize.sync() peut silencieusement skipper certains
    // modèles dans des cas edge (search_path désynchro, COMMENT qui plante,
    // etc.). On force la création explicite des tables critiques que
    // seedCatalog et la suite vont attaquer immédiatement. Idempotent: ces
    // sync individuels font CREATE TABLE IF NOT EXISTS, no-op si déjà là.
    console.log('🔧 Force-sync des modèles critiques (filet de sécurité)...');
    const criticalModels = [
        ['User', User], ['PointVente', PointVente],
        ['UserPointVente', UserPointVente], ['Category', Category],
        ['Produit', Produit]
    ];
    for (const [name, model] of criticalModels) {
        try {
            await model.sync();
        } catch (err) {
            console.error(`❌ Échec sync ${name}:`, err.message);
            throw err;
        }
    }
    console.log('✅ Modèles critiques sync.\n');

    // ====== DIAGNOSTIC: où sont vraiment les tables ? ======
    console.log('🔍 Diagnostic post-sync:');
    try {
        const sp = await sequelize.query('SHOW search_path', { type: sequelize.QueryTypes.SELECT, plain: true });
        console.log('   search_path actuel:', sp ? sp.search_path : 'inconnu');

        const tables = await sequelize.query(
            `SELECT table_schema, table_name FROM information_schema.tables
             WHERE table_name IN ('categories', 'produits', 'users', 'points_vente', 'reconciliations')
             ORDER BY table_schema, table_name`,
            { type: sequelize.QueryTypes.SELECT }
        );
        if (tables.length === 0) {
            console.log('   ⚠️  AUCUNE des tables critiques n\'existe nulle part!');
        } else {
            console.log('   Tables trouvées:');
            for (const t of tables) {
                console.log(`     - ${t.table_schema}.${t.table_name}`);
            }
        }
        // Lister tous les schémas existants
        const schemas = await sequelize.query(
            `SELECT schema_name FROM information_schema.schemata
             WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
             ORDER BY schema_name`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log('   Schémas DB:', schemas.map((s) => s.schema_name).join(', '));
    } catch (diagErr) {
        console.error('   ⚠️  Diagnostic échoué:', diagErr.message);
    }
    console.log('');

    await seedCatalog();

    // Seed ADMIN user if no users exist
    const userCount = await User.count();
    if (userCount === 0) {
        const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
        const admin = await User.create({
            username: DEFAULT_ADMIN_USERNAME,
            password: hash,
            role: 'admin',
            acces_tous_points: true,
            active: true,
        });
        console.log('🆕 Created default admin user.');
        console.log(`   Username: ${DEFAULT_ADMIN_USERNAME}`);
        console.log(`   Password: ${DEFAULT_ADMIN_PASSWORD}`);
        console.log('   ⚠️  CHANGE THIS PASSWORD on first login.');
        console.log('');

        // Seed the single point of sale for this tenant
        const pvCount = await PointVente.count();
        if (pvCount === 0) {
            const pv = await PointVente.create({
                nom: tenant.name,
                active: true,
            });
            await UserPointVente.create({
                user_id: admin.id,
                point_vente_id: pv.id,
            });
            console.log(`🆕 Created default point of sale: "${tenant.name}"`);
            console.log(`   Linked admin user to it.\n`);
        }

        // Wipe Mata's stock JSON files inherited from the repo so the new
        // tenant doesn't see Mata's stock/transfer data on first login.
        // Only runs when the DB was empty (truly first deploy) so re-running
        // tenant:init can never destroy accumulated data.
        resetDataFiles();
    } else {
        console.log(`ℹ️  ${userCount} user(s) already exist — skipping seed.\n`);
    }

    console.log('=== init-tenant-db: done ✅ ===\n');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ init-tenant-db failed:', err);
    process.exit(1);
});
