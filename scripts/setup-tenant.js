#!/usr/bin/env node
/**
 * Generate a new per-tenant config bundle.
 *
 *   node scripts/setup-tenant.js --slug=mbao --name="Mbao"
 *
 * Creates config/tenants/<slug>/ with seeded files:
 *   - nomDuClient.json
 *   - brand-config.json
 *   - modules-state.json   (abattage / suivi-achat-boeuf disabled by default)
 *   - .env.tenant          (env vars to paste into the Render service,
 *                           with random SESSION_SECRET / EXTERNAL_API_KEY)
 *
 * Pass --force to overwrite an existing bundle.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name) {
    const prefix = `--${name}=`;
    const m = process.argv.find((a) => a.startsWith(prefix));
    return m ? m.slice(prefix.length) : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const slug = arg('slug');
const name = arg('name') || slug;
const force = flag('force');

if (!slug) {
    console.error('Usage: node scripts/setup-tenant.js --slug=<slug> --name="<Display Name>" [--force]');
    process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    console.error('--slug must be lowercase alphanumeric and may contain hyphens (e.g. "keur-massar")');
    process.exit(1);
}

const tenantDir = path.join(__dirname, '..', 'config', 'tenants', slug);
if (fs.existsSync(tenantDir) && !force) {
    console.error(`Tenant ${slug} already exists at ${tenantDir}. Use --force to overwrite.`);
    process.exit(1);
}
fs.mkdirSync(tenantDir, { recursive: true });

const brandKey = slug.toUpperCase().replace(/-/g, '_');

const nomDuClient = {
    nom: name,
    site_web: '',
};

const brandConfig = {
    [brandKey]: {
        nom_complet: name,
        slogan: '',
        site_web: '',
        telephones: [],
        adresse_siege: '',
        footer_facture: 'Merci de votre confiance !',
        footer_whatsapp: 'Merci de votre confiance !',
        points_vente_codes: [],
        // Reference de caisse par point de vente, ecrite dans
        // cash_payments.payment_reference a chaque cloture. Laissee VIDE
        // volontairement: tenant:apply refuse de deployer tant qu'elle l'est.
        // Sans elle, generateCashReference rend null, server.js saute
        // l'ecriture, et la cloture repond 201 succes SANS enregistrer le
        // cash - le point de vente disparait de la reconciliation.
        references_caisse: {},
    },
};

// Read by /api/client-config; the login page uses clientName for the
// heading on the login form.
const clientConfig = {
    clientName: name,
    clientLogo: null,
    clientColor: '#0d6efd',
    contactEmail: null,
    contactPhone: null,
};

// Default new-tenant module state: core modules on, abattage and other
// Mata-specific advanced modules off. The tenant admin can flip these
// later from the in-app /config-admin screen.
const modulesState = {
    saisie: { active: true },
    visualisation: { active: true },
    stock: { active: true },
    reconciliation: { active: true },
    audit: { active: false },
    'cash-paiement': { active: true },
    'suivi-achat-boeuf': { active: false }, // abattage off
    estimation: { active: false },
    precommande: { active: false },
    'payment-links': { active: false },
    abonnements: { active: false },
};

fs.writeFileSync(
    path.join(tenantDir, 'nomDuClient.json'),
    JSON.stringify(nomDuClient, null, 2) + '\n'
);
fs.writeFileSync(
    path.join(tenantDir, 'brand-config.json'),
    JSON.stringify(brandConfig, null, 2) + '\n'
);
fs.writeFileSync(
    path.join(tenantDir, 'modules-state.json'),
    JSON.stringify(modulesState, null, 2) + '\n'
);
fs.writeFileSync(
    path.join(tenantDir, 'client-config.json'),
    JSON.stringify(clientConfig, null, 2) + '\n'
);

const sessionSecret = crypto.randomBytes(48).toString('hex');
const externalApiKey = crypto.randomBytes(32).toString('hex');
const envSnippet =
`# Render env vars for tenant: ${slug}
# Paste these into the Render Web Service "Environment" tab.
TENANT_SLUG=${slug}
TENANT_NAME=${name}
TENANT_BRAND_KEY=${brandKey}
NODE_ENV=production
PORT=3000
SESSION_SECRET=${sessionSecret}
EXTERNAL_API_KEY=${externalApiKey}
# DATABASE_URL=<paste from this tenant's Render Postgres "Internal Database URL">
# DB_SSL=true
# OPENAI_API_KEY=<optional — set if AI features are used>
# OPENAI_MODEL=gpt-4o-mini
# BICTORYS_API_KEY=<optional — set if payment links module enabled>
# BASE_URL=https://${slug}.example.com
`;
fs.writeFileSync(path.join(tenantDir, '.env.tenant'), envSnippet);

console.log(`✅ Tenant "${slug}" bundle created at ${tenantDir}`);
console.log('   - nomDuClient.json');
console.log('   - brand-config.json');
console.log('   - modules-state.json   (abattage off)');
console.log('   - client-config.json');
console.log('   - .env.tenant');
console.log('');
console.log('Next steps:');
console.log(`  1. Edit config/tenants/${slug}/brand-config.json — fill phones, address, points_vente_codes,`);
console.log('     and REQUIRED: references_caisse, one entry per point de vente, e.g.');
console.log('       "references_caisse": { "Mbao": "CASH_MBA", "Touba": "CASH_TB" }');
console.log('     The key is the point de vente name exactly as stored in the DB.');
console.log('     Leaving it empty makes tenant:apply fail the deploy — on purpose:');
console.log('     without it, cash closings succeed without recording any cash.');
console.log('  2. In Render: create a new Postgres for this tenant; copy its Internal Database URL.');
console.log(`  3. In Render: create a new Web Service from this branch with env vars from config/tenants/${slug}/.env.tenant`);
console.log(`     (replace DATABASE_URL with the value from step 2).`);
console.log('  4. In Render: set buildCommand to "npm install && npm run tenant:apply".');
console.log('  5. Set the custom domain for the service (e.g. ' + slug + '.example.com).');
