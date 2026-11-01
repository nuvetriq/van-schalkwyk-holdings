# Van Schalkwyk Holdings — mixed-book PostgreSQL release and recovery runbook

**Prepared 1 November 2026. REVIEW ONLY: no live access, no approval, no migration, no deployment.**

Scope: existing Netlify project for `vanschalkwykholdings.com`; existing site-wide Granny's/CleverCubs private Netlify Blob files and product catalogue remain as-is. Work stays on `feature/shared-mixed-brand-cart`, NOT `main`.

## Verified from the repository (not the live Netlify Database)

- The UNAPPLIED draft schema is at `docs/database/mixed-book-orders-DRAFT.sql`, **not** in `netlify/database/migrations`. The GitHub tests use a disposable PostgreSQL 16 container.
- The draft creates **six new, prefixed tables only**: `vsh_mixed_orders`, `vsh_mixed_order_lines`, `vsh_mixed_brand_sales`, `vsh_mixed_payment_events`, `vsh_mixed_email_outbox`, and `vsh_mixed_download_grants`. Existing products, customers, legacy Blob orders and private PDF objects are outside the DDL.
- SQL begins with `BEGIN` and ends with `COMMIT`; it includes unique payment/event identifiers, per-brand foreign keys, indexed email retries and grant expiry, and unique per-book hashed grants plus UUID token nonce. It **does not contain DROP, ALTER, TRUNCATE, DELETE or UPDATE**. This makes it additive but does not by itself prove the production migration will succeed.
- No Netlify project backups, usage, plan limits, branch schema, existing production tables, credits, or Yoco webhook health have been inspected by this review. Do **not** report them as verified.

## Current Netlify behavior relevant to release

- Native migrations located in `netlify/database/migrations` are **automatically applied** at deployment: on deploy preview immediately before that preview becomes available, and on production immediately before publishing the new deploy. A failing migration blocks that deploy. Simply adding a file to that directory or merging can have consequences; we deliberately have not done either. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/
- Deploy previews use a separate, branched database copy. **The current test checkout/webhook code requires Netlify `production` context**, however, so it **cannot** be tested on an ordinary deploy preview unchanged. Decide and approve a secure test-context redesign or a controlled, gated TEST-only production-host trial as a **separate release decision**; do not disable guards casually. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/
- Netlify takes scheduled production backups daily and backups on production publish, with **plan-based retention**. Rolling back to an earlier site deploy does **NOT** automatically restore the database. Restoring a database backup replaces its production schema **and data** and loses post-backup writes. Confirm the exact backup timestamp and available retention **before** making any change. A Netlify **Team Owner** is required to restore. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/
- An on-publish backup is NOT a substitute for confirming a known-good **pre-migration recovery point** (and it may not be the backup you expect). Verify dates and recoverability with Netlify before launch.
- Netlify Database consumes credits for compute/bandwidth and may incur storage costs. The docs' earlier storage-free date was **1 July 2026**, already past; do NOT assume storage remains free in November 2026. Check actual billing and plan before activation. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/

## Explicit owner review: release gate 0 (no writes)

Before approving any migration, verify in the **existing** Netlify project UI:

- [ ] The correct site/domain and production database branch are selected; no second project/database.
- [ ] Account plan, daily available credits, project database compute/bandwidth/branch limits, and current spend are understood and acceptable.
- [ ] Current production backup list shows a suitable dated restore point that predates this schema change, and the Team Owner knows how to restore. **Do not restore** just to check.
- [ ] Any existing `vsh_mixed_*` tables are inventoried with **read-only** `information_schema` queries before first application. If even one expected table already exists, STOP and reconcile schema rather than blindly reapplying `CREATE TABLE`.
- [ ] Current live website build/version, branch status, and the legacy Yoco TEST webhook to Deploy Preview 2 are recorded. No pending legacy TEST payment needs that handler during a future cutover.
- [ ] Stop/rollback owner, preferred testing hour, communication channel, and acceptable downtime/credit budget are defined. Do not touch existing products or private PDF Blob namespaces.

Safe *example* read-only query for an authorized DB operator (not run here):

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'vsh_mixed_%'
ORDER BY table_name;
```

No API passwords, database connection strings, Gmail app passwords, or webhook signing secrets should be copied to this chat or committed to GitHub.

## Release gate 1 — preview dry run (separate explicit approval)

1. Confirm all GitHub CI tests passing, including the new `scripts/test-mixed-book-migration-readiness.mjs` that checks the six tables, FKs, uniqueness and indexes on an **ephemeral** PostgreSQL 16 instance.
2. Before generating an **actual Netlify migration**, get owner approval to move the reviewed schema into Netlify's migrations directory; verify migration filename ordering and whether an explicit `BEGIN/COMMIT` wrapper is appropriate with Netlify's execution model. This step **does not exist** in GitHub today.
3. Use an owner-approved deploy-preview, which has its own database branch, to prove schema and existing-site compatibility before production. Do **not** connect preview code to the production DB or to the old Preview 2 Yoco webhook.
4. The existing Yoco TEST endpoint's production-context guard prevents ordinary preview tests. Review how to isolate/test that handler without weakening payment verification before declaring the preview an end-to-end payment test.
5. Check Netlify release credits, database branch allocation, constraints, rollback-to-previous-preview behavior and log privacy. Do not activate customer checkout, email delivery or PDF grants.

## Release gate 2 — controlled production migration (SEPARATE EXPLICIT APPROVAL)

- Schedule the change only after a verified, appropriately timed **pre-migration** backup/recovery checkpoint and an agreed maintenance/testing window.
- Record version/commit, existing database schema and brand order counts *without exposing customer PII*. Keep all customer payment, email, private PDF download and LIVE flags OFF. Avoid sending a production email as part of database setup.
- Use only the existing site's reviewed deployment workflow. Do not run SQL manually against production or move draft SQL into auto-migrations merely because CI is green.
- After production schema migration is applied, verify exactly six expected new tables, correct constraints/indexes and no unexpected writes. Preserve old website behavior; do not delete any live data. Confirm Netlify migration status and credits.
- If migration or publishing fails: **STOP**, keep checkout disabled, capture sanitized error and investigate. Don't blindly re-run the DDL or attempt a speculative database restore.

## Release gate 3 — strictly isolated Yoco TEST and brand delivery tests (FURTHER APPROVAL)

- Keep `VSH_ENABLE_PAYMENTS` (LIVE), `VSH_MIXED_BOOK_EMAIL_ENABLED`, `VSH_MIXED_BOOK_DOWNLOADS_ENABLED`, and real Gmail sends OFF.
- Plan carefully how to replace the **existing TEST** Yoco registration still pointing to the old Deploy Preview 2 handler. Yoco's Checkout API provides register/list/delete; don't invent an update API, signing secret or registration ID. Confirm the TEST webhook only after exact approved setup.
- Perform a single low-value **TEST-mode** checkout using a fake book and approved test account; verify signature, checkout binding, correct ZAR cents, two brand rows and zero customer emails/PDF grants. TEST mode on the production hostname may still write **test** rows to the real production database: do not confuse provider TEST mode with isolated database mode.
- Observe retries, resource consumption and old webhook behavior before any follow-up. No LIVE purchases, automatic book email, or customer downloads until separately reviewed.

## Rollback and recovery decision tree

**Scenario A — code-only problem, database intact**: disable *new* feature flags (accounting for whether env changes need redeploy), stop further test checkouts, and consider rolling back the **production deployment** to the prior known-good version. **The six new tables remain**. This is normally the least destructive choice, subject to Netlify-specific app behavior.

**Scenario B — schema introduced but no new orders/data**: keep the six additive tables unused while repairing forward via a separately reviewed migration. Do **not** run automatic `DROP TABLE` as part of rollback. Database changes are not rolled back by website rollback.

**Scenario C — corrupt data / unrecoverable schema fault**: assess whether a targeted repair can preserve newer legitimate records. Only after explicit Team Owner approval and verification of a safe backup timestamp, consider Netlify's UI restore. **Restore replaces the production database branch and permanently loses all writes after that backup timestamp**, potentially including other site activity. Coordinate live transactions and merchant reconciliations first. Netlify retains a recovery branch before restore but recovery isn't automatic.

**Scenario D — Yoco webhook change failed**: separately assess restoring the old TEST registration with its correct original URL and signing secret or an approved replacement; the website and DB rollbacks do not change Yoco webhook subscriptions. Do not create duplicate active subscriptions or expose secrets.

**Scenario E — disputed/refunded payment or uncertain email**: no automatic re-send or grant recreation. Manually reconcile event, merchant account, outbox, claim status and grant revocation without assuming Gmail acceptance equals customer delivery.

## Not yet verified

A passing disposable PostgreSQL test **does not** establish: existence/contents of a production backup; actual Netlify account billing; current production schema compatibility; a successful Netlify deploy-preview migration; real Yoco TEST webhook delivery; Gmail account authentication; refund handling; large-PDF customer downloads; or safety of production activation.

**Current GO/NO-GO: NO-GO for deployment or any production database change.** This document is for owner review and subsequent explicitly authorized release only.
