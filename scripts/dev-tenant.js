#!/usr/bin/env node
/**
 * Local-dev convenience: apply a tenant's config bundle and start the
 * server with that tenant's identity in one command.
 *
 *   npm run tenant:dev -- --slug=mbao
 *
 * What it does:
 *   1. Reads config/tenants/<slug>/ to derive name + brandKey.
 *   2. Runs scripts/apply-tenant-config.js with TENANT_SLUG set so the
 *      live config files (nomDuClient.json, brand-config.json,
 *      config/modules-state.json, config/client-config.json) match the
 *      tenant.
 *   3. Spawns nodemon with TENANT_SLUG / TENANT_NAME / TENANT_BRAND_KEY
 *      injected into the env, plus whatever's already in .env.local
 *      (DATABASE_URL etc.).
 *
 * Stop with Ctrl-C. Switching tenants is just running this command with
 * a different --slug value (it overwrites the live config files each
 * time, which is the right thing for dev).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

function arg(name) {
    const prefix = `--${name}=`;
    const m = process.argv.find((a) => a.startsWith(prefix));
    return m ? m.slice(prefix.length) : null;
}

// Prefer --slug=… on the command line; fall back to the TENANT_SLUG
// env var. The env-var fallback is the reliable path on Windows /
// PowerShell where `npm run X -- --flag` strips arguments before they
// reach the script (npm.ps1 wrapper quirk). Documented workaround:
//   $env:TENANT_SLUG='mbao'; npm run tenant:dev
const slug = arg('slug') || process.env.TENANT_SLUG;
if (!slug) {
    console.error('Usage:');
    console.error('  npm run tenant:dev -- --slug=<slug>          (Linux/macOS)');
    console.error('  $env:TENANT_SLUG=\'<slug>\'; npm run tenant:dev   (Windows/PowerShell)');
    console.error('  node scripts/dev-tenant.js --slug=<slug>     (any shell, bypasses npm)');
    console.error('');
    console.error('Available tenants:');
    const tenantsDir = path.join(__dirname, '..', 'config', 'tenants');
    if (fs.existsSync(tenantsDir)) {
        for (const dir of fs.readdirSync(tenantsDir)) {
            console.error('  - ' + dir);
        }
    }
    process.exit(1);
}

const tenantDir = path.join(__dirname, '..', 'config', 'tenants', slug);
if (!fs.existsSync(tenantDir)) {
    console.error(`Tenant "${slug}" not found at ${tenantDir}`);
    console.error('Generate it first: npm run tenant:create -- --slug=' + slug + ' --name="<Display Name>"');
    process.exit(1);
}

// Derive name + brandKey from the bundle's nomDuClient.json + brand-config.json
let tenantName = slug;
let brandKey = slug.toUpperCase().replace(/-/g, '_');
try {
    const nom = JSON.parse(fs.readFileSync(path.join(tenantDir, 'nomDuClient.json'), 'utf8'));
    if (nom.nom) tenantName = nom.nom;
    const brand = JSON.parse(fs.readFileSync(path.join(tenantDir, 'brand-config.json'), 'utf8'));
    const keys = Object.keys(brand);
    if (keys.length === 1) brandKey = keys[0];
} catch (e) {
    console.warn('[tenant:dev] could not read bundle metadata, using defaults:', e.message);
}

console.log(`[tenant:dev] tenant=${slug} name="${tenantName}" brandKey=${brandKey}`);

// Step 1: apply config files
const apply = spawnSync(process.execPath, ['scripts/apply-tenant-config.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, TENANT_SLUG: slug },
});
if (apply.status !== 0) {
    console.error('[tenant:dev] apply-tenant-config.js failed.');
    process.exit(apply.status || 1);
}

// Step 2: spawn nodemon with tenant env injected.
//
// DB_SCHEMA defaults to the slug with hyphens turned into underscores
// (Variant A: shared local Postgres, schema-per-tenant). That mirrors
// the production env-var convention and means switching tenants in
// dev is just `npm run tenant:dev -- --slug=<x>`. Set DB_SCHEMA
// explicitly in .env.local or the shell to override (e.g. =public for
// legacy single-DB local setups).
const dbSchema = process.env.DB_SCHEMA || slug.replace(/-/g, '_');

const env = {
    ...process.env,
    TENANT_SLUG: slug,
    TENANT_NAME: tenantName,
    TENANT_BRAND_KEY: brandKey,
    DB_SCHEMA: dbSchema,
};

console.log(`[tenant:dev] DB_SCHEMA=${dbSchema}`);

// Use the local nodemon if it exists; fall back to plain `node server.js`.
const nodemonBin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'nodemon.cmd' : 'nodemon');
const useNodemon = fs.existsSync(nodemonBin);
const cmd = useNodemon ? nodemonBin : process.execPath;
// Charge .env.local en priorité (avec fallback sur .env). Sans ça,
// dotenv/config ne lit que .env et les variables tenant-spécifiques
// (DB_NAME, MATA_DECOUPE_*, etc.) sont ignorées.
const envLocalPath = path.join(__dirname, '..', '.env.local');
const envFile = fs.existsSync(envLocalPath) ? '.env.local' : '.env';
const args = ['-r', 'dotenv/config', 'server.js', `dotenv_config_path=${envFile}`];
console.log(`[tenant:dev] env file: ${envFile}`);

// shell:true is needed on Windows ONLY when running a .cmd file
// (nodemon.cmd needs cmd.exe to resolve). For plain node.exe we must
// NOT use shell:true — cmd.exe breaks on the space in
// "C:\Program Files\nodejs\node.exe" and reports
// 'C:\Program' is not recognized'.
const useShell = useNodemon && process.platform === 'win32';

console.log(`[tenant:dev] starting ${useNodemon ? 'nodemon' : 'node'} server.js (Ctrl-C to stop)\n`);

const child = spawn(cmd, args, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env,
    shell: useShell,
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
