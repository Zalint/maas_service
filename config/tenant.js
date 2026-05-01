/**
 * Tenant identity for the current process.
 *
 * The app runs one Node process per tenant on Render. Each tenant's
 * Render service sets these env vars to identify itself:
 *
 *   TENANT_SLUG       URL-safe identifier, e.g. "mbao", "keur-massar"
 *   TENANT_NAME       Human-readable name shown in UI, e.g. "Mbao"
 *   TENANT_BRAND_KEY  Key into brand-config.json, e.g. "MBAO"
 *
 * Defaults preserve the legacy single-tenant Mata / Keur BALLI behavior
 * when none of the vars are set, so this module is safe to require even
 * in development without a tenant configured.
 */

const slug = process.env.TENANT_SLUG || 'default';
const name = process.env.TENANT_NAME || 'Mata';
const brandKey = process.env.TENANT_BRAND_KEY || 'KEUR_BALLI';

// Postgres schema for this tenant's tables.
//   Default 'public'        → legacy DB-per-tenant behavior, unchanged.
//   Set DB_SCHEMA=<schema>  → shared-Postgres / schema-per-tenant.
// db/index.js sets search_path to this schema on every connection so all
// queries (Sequelize and raw SQL) resolve here. scripts/init-tenant-db.js
// creates the schema if needed before running sequelize.sync().
// Whitelist d'identifiants Postgres sûrs (pas d'espaces, pas de quotes,
// pas de point-virgule). Toute valeur non conforme retombe sur 'public'
// avec un warning. Identifiant SQL valide: lettre/_ suivi de
// lettres/chiffres/_, longueur max 63 (limite Postgres).
function sanitizeSchema(raw) {
    if (!raw || typeof raw !== 'string') return 'public';
    const trimmed = raw.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(trimmed)) {
        console.warn(
            `[tenant] ⚠️  DB_SCHEMA="${raw}" rejeté (identifiant invalide) — fallback sur "public"`
        );
        return 'public';
    }
    return trimmed;
}
const schema = sanitizeSchema(process.env.DB_SCHEMA);

const tenant = Object.freeze({ slug, name, brandKey, schema });

console.log(`[tenant] slug=${slug} name="${name}" brandKey=${brandKey}`);

// Best-effort sanity check: if a tenant slug was declared via env, the
// build-time copier (scripts/apply-tenant-config.js) should have placed
// the matching brand-config.json at the project root. If we can't see
// the expected brandKey in that file, the deploy almost certainly skipped
// the apply step — log loudly so it shows up in Render logs on first boot.
if (process.env.TENANT_SLUG) {
    try {
        const fs = require('fs');
        const path = require('path');
        const brandPath = path.join(__dirname, '..', 'brand-config.json');
        if (fs.existsSync(brandPath)) {
            const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
            if (!brand[brandKey]) {
                console.warn(
                    `[tenant] ⚠️  brand-config.json has no entry for "${brandKey}". ` +
                    `Did the buildCommand run "npm run tenant:apply"? ` +
                    `Available keys: ${Object.keys(brand).join(', ')}`
                );
            }
        } else {
            console.warn('[tenant] ⚠️  brand-config.json not found at project root.');
        }
    } catch (e) {
        console.warn('[tenant] sanity check skipped:', e.message);
    }
}

module.exports = tenant;
