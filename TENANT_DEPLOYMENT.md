# Multi-tenant deployment runbook

This branch (`maas-app`) is a fork of the Mata app deployed as **one Render
Web Service per tenant + one shared Render Postgres for all tenants**.
Each tenant runs as its own isolated Node process; tenant data isolation
is enforced at the database layer via Postgres schemas (one schema per
tenant, search_path locked to that schema on every connection — no
cross-tenant fallback).

Three tenants are pre-configured: **Mbao**, **Keur Massar**, **Sacre Coeur**.
All have abattage (Suivi Achat Boeuf) disabled by default.

---

## Architecture in one paragraph

A single shared codebase with no in-app tenancy logic. At deploy time, the
`tenant:apply` build step reads the `TENANT_SLUG` env var and copies the
matching files from `config/tenants/<slug>/` over the runtime config files
(`nomDuClient.json`, `brand-config.json`, `config/modules-state.json`,
`config/client-config.json`). At runtime, `db/index.js` reads `DB_SCHEMA`
and runs `SET search_path TO "<schema>"` on every Postgres connection so
all queries (Sequelize and raw SQL) are constrained to that tenant's
schema. The frontend reads the tenant identity from `/api/tenant` and
prefixes the page title with the tenant name.

---

## One-time setup: the shared Postgres cluster

Done **once for the whole platform**, not per tenant. Skip this section if
the shared cluster already exists — go straight to "Per-tenant resources".

- Dashboard → New → Postgres
- Name: `maas-shared-db`
- Region: same region as the web services (latency)
- Plan: Starter is fine to begin with; bump to Standard once you're past
  ~5 tenants or the dataset grows past Starter's 1 GB / 256 MB RAM
  limits.
- After creation, copy the **Internal Database URL**. Every tenant's web
  service will use this same URL as their `DATABASE_URL`.

> **Sizing note:** at 10 tenants on Standard ($95/mo) you're well within
> connection-count headroom (Sequelize uses a pool of 5 per process, so
> 10 × 5 = 50 active connections out of ~100). Past 20 tenants, put
> PgBouncer in front to multiplex.

---

## Per-tenant resources to create on Render

For **each** of `mbao`, `keur-massar`, `sacre-coeur` (or any new tenant):

### 1. Create a Render Web Service

- Dashboard → New → Web Service
- Connect this Git repo and pick branch `maas_service`
- Name: `maas-<slug>` (e.g. `maas-mbao`)
- Runtime: Node
- Build command:
  ```
  npm install && npm run tenant:apply
  ```
- Start command:
  ```
  npm run tenant:init && npm start
  ```

> **Why `tenant:init && npm start` instead of a separate Pre-Deploy
> Command?** Render Starter plans don't expose a Pre-Deploy Command
> field in the dashboard UI. Chaining init into the start command
> works on every plan and is functionally equivalent: `tenant:init`
> is idempotent (creates the schema if missing, syncs tables,
> seeds catalog/admin/POS only on first run; ~2s no-op on
> subsequent restarts) and `&&` ensures init failures block server
> startup so a misconfigured tenant fails loudly instead of serving
> traffic against a missing schema.
>
> If your plan does expose Pre-Deploy Command (Standard+), you can
> split for cleaner deploy logs:
> ```
> Pre-Deploy Command: npm run tenant:init
> Start Command:      npm start
> ```

### 2. Set the env vars on the web service

Open `config/tenants/<slug>/.env.tenant` for the matching tenant and paste
each line as an environment variable in the Render dashboard.

The file already has a randomly generated `SESSION_SECRET` and
`EXTERNAL_API_KEY` — keep those values, do not regenerate them per deploy.

> ⚠️ **Never commit `.env.tenant` files.** They contain plaintext secrets.
> They are gitignored (`config/tenants/*/.env.tenant`); regenerate them
> locally with `npm run tenant:create -- --slug=<x> --force` if you lose
> the originals (and update Render env vars to the new values).

You must additionally set:
- `DATABASE_URL` → the **Internal Database URL** of the shared Postgres
  cluster (see "One-time setup" above). All tenants use the same URL.
- `DB_SCHEMA` → the tenant's slug (e.g. `mbao`, `keur_massar`,
  `sacre_coeur`). Use underscores, not hyphens — Postgres prefers them
  for unquoted identifiers. The next step (`tenant:init`) creates this
  schema if it doesn't exist; thereafter every connection from this
  service runs `SET search_path TO "<schema>"` so all queries resolve
  inside the tenant's schema only.

Optional, only if the corresponding module is enabled for that tenant:
- `OPENAI_API_KEY`, `OPENAI_MODEL` — for AI features
- `BICTORYS_API_KEY`, `BICTORYS_BASE_URL` — for the payment-links module
- `BASE_URL` — for absolute URLs in generated invoices

> ⚠️ **`BICTORYS_API_KEY` quirk:** even when the payment-links module is
> off, `server.js` currently does a hard `throw` at module-load time if
> `BICTORYS_API_KEY` is empty (see `server.js:7249`). Until that check
> gets wrapped in a module-enabled guard, set
> `BICTORYS_API_KEY=dev-placeholder-not-used` (or any non-empty string)
> on every tenant — otherwise the Render service crashes on boot before
> it even gets to the rest of the env.

### 3. (Reference) What `tenant:init` does on every restart

You don't run this by hand — the chained `tenant:init` in the start
command from step 1 runs it automatically before the server boots.
This section documents what it does so you can predict what shows
up on first boot.

```
npm run tenant:init
```

This:
- Verifies the DB connection and creates all tables (`sequelize.sync()`).
- **Seeds the default product catalog** from `db/seeds/default-catalog.json`
  (9 categories + 260 produits — derived from Mata's production catalog
  with legacy "Import OCR" merged into "Autres"). Skip with
  `SEED_DEFAULT_CATALOG=false` if the tenant brings their own catalog.
- Seeds a default `ADMIN` user with temp password `ChangeMe123!`.
- Seeds a single point of sale named after `TENANT_NAME`.
- Links the admin user to that point of sale.
- **On first run only**, wipes the Mata-specific JSON files that ship in
  the repo so the new tenant starts clean:
  - `data/stock-matin.json`, `data/stock-soir.json`, `data/transferts.json`
  - `data/by-date/` snapshots
  - `acheteur.json` (Mata's buyers list — only used by abattage, off here)
  - `livreurs_actifs.json` (Mata's drivers list)

The script is idempotent — re-running on an already-initialized tenant
won't duplicate users, won't reset POS, and won't wipe accumulated data.
The wipe is gated on `User.count() === 0` so it only fires the very first
time `tenant:init` runs against a fresh DB.

You can override the temp password by setting `DEFAULT_ADMIN_PASSWORD` in
the env before running, but in practice the simpler flow is: log in with
the default, change the password from the user-management screen, then
create real staff accounts there.

> **Security note:** the temp password is intentionally shared across
> tenants for runbook simplicity. **Change it on every tenant on first
> login** before letting anyone else in.

### 4. (Optional) Add a per-tenant cron for daily stock copy

If the tenant uses the Stock module and wants automated overnight copy
("stock soir" → next-day "stock matin"):

- Dashboard → New → Cron Job
- Name: `maas-<slug>-stock-copy`
- Branch: `maas-app`
- Schedule: `0 5 * * *` (daily 5am UTC — adjust per tenant timezone)
- Build command: `npm install && npm run tenant:apply`
- Start command: `node scripts/copy-stock-cron.js`
- Env vars: same as the web service (`TENANT_SLUG`, `TENANT_NAME`,
  `TENANT_BRAND_KEY`, `DATABASE_URL`, `DB_SCHEMA`, plus `LOG_LEVEL=info`,
  `DATA_PATH=./data/by-date`). The cron is currently file-based (doesn't
  touch the DB), so `DB_SCHEMA` is included for future-proofing in case
  the script is later refactored to use Sequelize.

Skip this entirely if the tenant doesn't run an end-of-day stock workflow.

### 5. Set the custom domain

- Web service → Settings → Custom Domains → Add
  - `mbao.yourdomain.com` for `maas-mbao`
  - `keur-massar.yourdomain.com` for `maas-keur-massar`
  - `sacre-coeur.yourdomain.com` for `maas-sacre-coeur`
- Add the matching CNAME records at your DNS provider.
- Render auto-provisions SSL.

---

## Onboarding a new tenant after these three

```bash
npm run tenant:create -- --slug=<slug> --name="<Display Name>"
```

This generates `config/tenants/<slug>/` with `nomDuClient.json`,
`brand-config.json`, `modules-state.json` (abattage off by default),
and `.env.tenant` containing freshly generated secrets.

Then:
1. Edit `config/tenants/<slug>/brand-config.json` — fill `telephones`,
   `adresse_siege`, `points_vente_codes`.
2. Commit the bundle.
3. Repeat the Render steps above for the new tenant.

---

## Verifying a deployment

The fastest check is the bundled script — run it from your laptop after
the service is up:

```
npm run tenant:verify -- --url=https://mbao.yourdomain.com --slug=mbao --name=Mbao
```

It hits `/api/tenant`, `/api/client-config`, and the abattage gate, and
exits non-zero on any mismatch. Run it for each of the three tenants
after deploying.

For a manual quick check, hit `https://<slug>.yourdomain.com/api/tenant`.
You should see:
```json
{ "slug": "mbao", "name": "Mbao", "brandKey": "MBAO" }
```

The login page title bar will read **"Mbao — Connexion - Gestion des Ventes"**.

The Suivi Achat Boeuf menu item / API will return 403 (`Module
"suivi-achat-boeuf" désactivé`) — this is expected.

To enable abattage for a specific tenant later, log in as admin on that
tenant and toggle the module from `/config-admin`, **or** edit
`config/tenants/<slug>/modules-state.json` and redeploy.

### Boot-time self-check

Every process logs its tenant identity at startup, e.g.
`[tenant] slug=mbao name="Mbao" brandKey=MBAO`.

If you see a warning like:

```
[tenant] ⚠️  brand-config.json has no entry for "MBAO". Did the
buildCommand run "npm run tenant:apply"? Available keys: KEUR_BALLI
```

…that means the `buildCommand` field on the Render service is wrong (or
missing) — fix it to `npm install && npm run tenant:apply` and redeploy.

---

## Why Variant A (and when other patterns make sense)

This guide describes **Variant A**: per-tenant Node process, shared
Postgres, one schema per tenant. Three other patterns exist:

|   | Process | DB | Best when |
|---|---|---|---|
| Silo | per-tenant | per-tenant | A tenant contractually requires their own DB |
| **Variant A** *(this guide)* | per-tenant | shared, schema-per-tenant | Default for 1–30 tenants |
| Variant C | shared | per-tenant | A specific tenant insists on its own DB while others share |
| Variant B (Pool) | shared | shared, `tenant_id` column on every table | 30+ tenants *and* engineering bandwidth for the rewrite |

**Cost picture at 10 tenants on Render Standard plans** (web $25, Postgres $95):

- Silo: 10 × ($25 + $95) = **$1,200/mo**
- Variant A: 10 × $25 + 1 × $95 = **$345/mo**  ← this guide
- Variant B: 1 × $25 + 1 × $95 = **$120/mo**

**Why Variant A is the default here:**

- **Process isolation is preserved.** A bug in one tenant's running
  process can't read another tenant's data — the runtime never has
  multiple tenants in scope.
- **Schema isolation is enforced at connection level**, not in
  application code. `db/index.js` runs `SET search_path TO "<schema>"`
  on every new connection. A missed `WHERE tenant_id = ?` in a future
  PR can't cause a leak because there's no `tenant_id` column to begin
  with — Postgres won't let queries see other schemas.
- **DB cost collapses** to one Postgres for the whole platform.
- **Hybrid is one env var away.** A single tenant can be moved back to
  its own DB by clearing `DB_SCHEMA` and pointing `DATABASE_URL` at a
  separate Postgres — useful if a contract demands physical isolation.

**Why not Variant B (Pool):** the codebase has no `tenant_id` columns,
no per-request tenant resolution middleware, and a 720 KB `server.js`
with embedded raw SQL. Refactoring for shared-process multi-tenancy is
a 2–3 week effort with real risk of cross-tenant data leakage. Defer
until tenant count crosses 30 and the engineering bandwidth is there
to audit every query.

**Why not Variant C:** ~80% of Variant B's engineering work for ~50% of
its savings — generally the wrong stop on the spectrum unless a
specific tenant requires their own DB while others share, in which case
the hybrid setup above (clear `DB_SCHEMA` for that tenant only) is
simpler than committing the whole platform to Variant C.

---

## Migrating a legacy Silo tenant onto the shared cluster

Use this recipe when an existing tenant runs on its own Render
Postgres (Silo model) and you want to move them onto the shared cluster
without losing data:

```bash
# 1. Dump + rewrite + restore in one shot (pg_dump pipeline that
#    rewrites public.<obj> → "<slug>".<obj> in the SQL stream, then
#    pipes into psql). Requires pg_dump and psql to be on PATH or
#    PG_BIN env var pointed at the postgres bin/ directory.
npm run tenant:migrate -- \
  --slug=<slug> \
  --source-url=<old-tenant-database-url> \
  --shared-url=<shared-database-url>

# Pass --dry-run to preview the rewritten SQL without applying it.
# The script also runs a sanity check at the end and asserts zero
# remaining "public." references in the rewritten dump.

# 2. On Render, swap the tenant's web service env vars:
#    DATABASE_URL  →  shared cluster URL
#    DB_SCHEMA     →  <slug>
#    Redeploy. The afterConnect hook now constrains all queries to the
#    new schema; sequelize.sync() on next boot is a no-op since all
#    tables already exist.

# 3. Verify: npm run tenant:verify against the live URL, log in,
#    record a test sale, run a cash-up. Once happy, decommission the
#    old per-tenant Render Postgres.
```

> ⚠️ Hyphens vs underscores: tenant slugs use hyphens (`keur-massar`)
> but Postgres schemas should use underscores (`keur_massar`). The
> migrate / drop scripts enforce this — pass `--slug=keur_massar` to
> them, and set `DB_SCHEMA=keur_massar` on Render. `TENANT_SLUG`
> stays `keur-massar`.

This pipeline was tested locally migrating `maas_db`'s legacy public
schema into `maas_shared_dev` as a `legacy_test` schema and then
booting the server against the migrated data — all 260 produits, 9
categories, 1 POS, and 2 sales preserved.

## Decommissioning a tenant

When a tenant is permanently shut down:

1. Cancel their Render Web Service (and cron, if any).
2. Drop their schema from the shared cluster:

   ```bash
   npm run tenant:drop -- \
     --slug=<schema-name> \
     --shared-url=<shared-database-url> \
     --yes
   ```

   The script refuses without `--yes`, refuses to drop `public` or any
   reserved schema, and is idempotent (re-running on a missing schema
   exits cleanly).

---

## File reference

- `config/tenant.js` — exposes the current process's tenant identity from
  `TENANT_SLUG` / `TENANT_NAME` / `TENANT_BRAND_KEY` env vars; warns on
  boot if the brand-config doesn't match.
- `scripts/apply-tenant-config.js` — runs in `buildCommand`; copies
  `config/tenants/<slug>/*` over the live config files.
- `scripts/setup-tenant.js` — generator for new tenant bundles
  (`npm run tenant:create -- --slug=<x> --name="<X>"`).
- `scripts/init-tenant-db.js` — first-deploy DB seed (admin user + POS).
  Run via `npm run tenant:init` from the Render shell.
- `scripts/verify-tenant.js` — post-deploy health check
  (`npm run tenant:verify -- --url=<host> --slug=<x> --name=<X>`).
- `scripts/migrate-tenant-to-shared.js` — moves a Silo tenant onto the
  shared cluster as a schema (`npm run tenant:migrate`).
- `scripts/drop-tenant-schema.js` — destructively decommissions a
  tenant's schema (`npm run tenant:drop`).
- `config/tenants/<slug>/` — per-tenant config bundles. Each contains:
  - `nomDuClient.json`
  - `brand-config.json`
  - `modules-state.json`
  - `client-config.json`
  - `.env.tenant` (env vars to paste into Render — never commit secrets
    if you regenerate this file).
- `public/js/tenant-branding.js` — frontend snippet that reads
  `/api/tenant` and applies the tenant name to page titles.
- `render.yaml.tenant.template` — Render blueprint template per tenant
  (web service + optional cron).
- `GET /api/tenant` — returns `{slug, name, brandKey}`. Public endpoint.

## npm script reference

```
npm run tenant:create  -- --slug=<x> --name="<X>"                                       # generate bundle (local)
npm run tenant:apply                                                                    # build-time copier (Render)
npm run tenant:init                                                                     # first-time DB seed (Render shell)
npm run tenant:verify  -- --url=<host> --slug=<x> --name=<X>                            # post-deploy QA (local)
npm run tenant:migrate -- --slug=<x> --source-url=<old> --shared-url=<shared>           # Silo → Variant A (local)
npm run tenant:drop    -- --slug=<x> --shared-url=<shared> --yes                        # decommission a tenant (local)
```
