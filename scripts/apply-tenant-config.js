#!/usr/bin/env node
/**
 * Apply per-tenant config files at deploy time.
 *
 * Render runs this in buildCommand. It reads TENANT_SLUG and copies the
 * matching files from config/tenants/<slug>/ over the live config files
 * at the project root.
 *
 *   nomDuClient.json        -> nomDuClient.json
 *   brand-config.json       -> brand-config.json
 *   modules-state.json      -> config/modules-state.json
 *
 * If TENANT_SLUG is unset, the existing files are left untouched (this
 * is the fallback for the legacy Mata service running on `main`).
 *
 * Exits non-zero only on hard errors so a misconfigured tenant fails the
 * deploy instead of silently shipping the wrong client's branding.
 */

const fs = require('fs');
const path = require('path');

const slug = process.env.TENANT_SLUG;

if (!slug) {
    console.log('[apply-tenant-config] TENANT_SLUG not set — leaving existing config files in place.');
    process.exit(0);
}

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'config', 'tenants', slug);

if (!fs.existsSync(sourceDir)) {
    console.error(`[apply-tenant-config] FATAL: tenant config dir not found: ${sourceDir}`);
    console.error('Run: npm run tenant:create -- --slug=' + slug + ' --name="<Display Name>"');
    process.exit(1);
}

const mappings = [
    ['nomDuClient.json', 'nomDuClient.json'],
    ['brand-config.json', 'brand-config.json'],
    ['modules-state.json', path.join('config', 'modules-state.json')],
    ['client-config.json', path.join('config', 'client-config.json')],
];

// Controle de deploiement: references de caisse.
//
// Sans `references_caisse`, generateCashReference rend null pour chaque point
// de vente, server.js fait `if (cashRef)` et saute l'ecriture: la cloture
// repond 201 succes SANS enregistrer le cash, et le point de vente disparait
// de la reconciliation. Aucune erreur nulle part.
//
// Le gabarit de setup-tenant.js cree la cle vide expres: c'est ici qu'on
// refuse de deployer tant qu'elle n'est pas remplie. Un deploiement qui
// echoue au build coute une minute; une caisse muette se decouvre des
// semaines plus tard, quand les chiffres ne tombent plus juste.
const brandPath = path.join(sourceDir, 'brand-config.json');
if (!fs.existsSync(brandPath)) {
    // La boucle de copie plus bas se contente d'un avertissement, mais un
    // tenant sans brand-config.json part avec celui de la racine: le nom, le
    // pied de facture ET les references de caisse d'un AUTRE client. C'est
    // exactement ce que l'en-tete de ce script promet d'empecher.
    console.error(`[apply-tenant-config] FATAL: ${brandPath} absent.`);
    console.error('  Le tenant partirait avec la configuration de la racine:');
    console.error("  nom, pied de facture et references de caisse d'un autre client.");
    process.exit(1);
}

let brand;
try {
    // stripBOM: require() tolere un BOM UTF-8, pas JSON.parse. Sans cela, un
    // fichier que l'application lit parfaitement ferait echouer le deploiement
    // - un editeur Windows suffit a l'introduire, et ce depot en a deja fait
    // les frais sur index.html.
    const brut = fs.readFileSync(brandPath, 'utf8').replace(/^﻿/, '');
    brand = JSON.parse(brut);
} catch (e) {
    console.error(`[apply-tenant-config] FATAL: brand-config.json illisible: ${e.message}`);
    process.exit(1);
}

// La regle vit dans lib/valider-references-caisse.js: ce script appelle
// process.exit, donc rien de ce qu'il decide ne serait verifiable ici.
const { validerReferencesCaisse } = require('../lib/valider-references-caisse');
const controle = validerReferencesCaisse(brand);
if (!controle.ok) {
    controle.problemes.forEach((p) => console.error(`[apply-tenant-config] FATAL: ${p}`));
    console.error('  Sans references_caisse, les clotures reussissent sans enregistrer le cash:');
    console.error('  le point de vente disparait de la reconciliation, sans aucune erreur.');
    console.error(`  A corriger dans: config/tenants/${slug}/brand-config.json`);
    console.error('  (et non a la racine, qui est ECRASEE par ce script a chaque deploiement).');
    console.error('  Une entree par point de vente, la cle etant le nom du point de vente');
    console.error("  tel qu'il est enregistre en base:");
    console.error('    "references_caisse": { "Mbao": "CASH_MBA", "Touba": "CASH_TB" }');
    process.exit(1);
}
console.log(`[apply-tenant-config] references_caisse: ${controle.total} point(s) de vente `
    + `(${controle.resume.map((r) => r.marque).join(', ')}) ✅`);

let copied = 0;
for (const [src, dst] of mappings) {
    const srcPath = path.join(sourceDir, src);
    if (!fs.existsSync(srcPath)) {
        console.warn(`[apply-tenant-config] missing source ${src} — skipping`);
        continue;
    }
    const dstPath = path.join(root, dst);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
    console.log(`[apply-tenant-config] ${src} -> ${dst}`);
    copied += 1;
}

console.log(`[apply-tenant-config] tenant=${slug} files=${copied} ✅`);
