# Van Schalkwyk Holdings — mixed-book PostgreSQL release and recovery runbook

**Prepared 1 November 2026. REVIEW ONLY: no live access, no approval, no migration, no deployment.**

Scope: existing Netlify project for `vanschalkwykholdings.com`; existing site-wide Granny's/CleverCubs private Netlify Blob files and product catalogue remain as-is. Work stays on `feature/shared-mixed-brand-cart`, NOT `main`.

## Verified from the repository (not the live Netlify Database)

- The UNAPPLIED draft schema is at `docs/database/mixed-book-orders-DRAFT.sql`, **not** in `netlify/database/migrations`. The GitHub tests use a disposable PostgreSQL 16 container.
- The draft creates **six new, prefixed tables only**: `vsh_mixed_orders`, `vsh_mixed_order_lines`, `vsh_mixed_brand_sales`, `vsh_mixed_payment_events`, `vsh_mixed_email_outbox`, and `vsh_mixed_download_grants`. Existing products, customers, legacy Blob orders and private PDF objects are outside the DDL.
- SQL begins with `BEGIN` and ends with `COMMIT`; it includes unique payment/event identifiers, per-brand foreign keys, indexed email retries and grant expiry, and unique per-book hashed grants plus UUID token nonce. It **does not contain DROP, ALTER, TRUNCATE, DELETE or UPDATE**. This makes it additive but does not by itself prove the production migration will succeed.
- Live Netlify **UI screenshots** were reviewed on 1 and 2 November 2026 (see dated snapshots below). A **dated scheduled backup is now visible** in the Netlify UI, but successful restoration, a backup identifier, other DB schemas, cost forecast, and the old Yoco webhook's current health have **not** been independently verified.

## Owner-verified Netlify UI snapshot — 1 November 2026

The owner supplied screenshots of the **existing** `vanschalkwykholdings.com` Netlify project and NUVETRIQ team billing page. This section records visible UI evidence, **not** a database connection or proof of restoration capability.

- **Production branch:** created 1 November 2026, showed `Idle` with sleep after 5 minutes and was later opened in the built-in Netlify data explorer. It showed **`0 tables in public schema`**. This rules out collisions with our six proposed `public.vsh_mixed_*` tables **at the moment shown**; it does not prove absence of objects in other schemas or guarantee a future migration will succeed.
- **Project database:** screenshot showed one branch of 100 available; around 141.9 KB total storage; last activity approximately four hours before the screenshot. The read-only and read/write connection string fields were **masked**. No password was revealed, copied or used.
- **Backup policy (1 Nov snapshot):** Netlify's UI displayed daily scheduled backups **retained seven days** and on-publish backups associated with the **three most recent deploys**. That initial screenshot **did not show any dated backup**; the updated 2 November screenshot below now does. Do not confuse retention policy with successful restoration.
- **Billing (dated snapshot):** NUVETRIQ Personal plan, USD 9/month, 1,000 credits/month shown. Credits available approximately **1,878.4**, and the current 16 October–15 November billing period showed **6.2 credits used** at the screenshot time. This is **not** a cost projection or promise that future database, deployments or PDF delivery will be free.
- **Access control:** `Allow personal access tokens full access to the production database` was **unchecked**. Leave it unchecked. A controlled Netlify Functions deployment has separate database permissions; do not conflate these access modes.
- **Decision at 1 November:** **NO-GO** because no dated backup was visible yet, other deployment safeguards were not verified, and owner authorization for production changes had not been given. The new screenshot below resolves the *visibility of a dated backup*, not the remaining release conditions.

## New scheduled backup listed — owner screenshot, 2 November 2026

- In the existing project's **Database → Backups** section, Netlify visibly lists a **Scheduled** backup dated **2 November 2026, 5:00 AM** and displays a **Restore** button for the entry. The screenshot does not show the display time zone or backup identifier.
- **Evidence level:** The listed backup is a **dated pre-migration candidate**, since no production migration of the new schema has been performed. This is stronger evidence than the retention policy alone. It does **not** prove the backup's contents, that it can be successfully restored, that current restoration permissions are sufficient, or how later data would be affected.
- **Safety decision:** **DO NOT click Restore** to test it; restoring can replace live data. Do not change the original scheduled backup, read/write DB connection credentials, Yoco registration or production code in response to this screenshot.
- **Remaining gate:** On the actual release day, reconfirm an appropriately dated recovery point remains available and the owner's restore authority and consequences are understood; perform an approved read-only schema preflight and reassess current credits/costs. Then obtain **specific, separate owner approval** for any deployment, migration or Yoco TEST change.
- **Current GO/NO-GO: NO-GO.** A listed backup and green CI do not authorize a production-changing release.

## Current Netlify behavior relevant to release

- Native migrations located in `netlify/database/migrations` are **automatically applied** at deployment: on deploy preview immediately before that preview becomes available, and on production immediately before publishing the new deploy. A failing migration blocks that deploy. Simply adding a file to that directory or merging can have consequences; we deliberately have not done either. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/
- Deploy previews use a separate, branched database copy. **The current test checkout/webhook code requires Netlify `production` context**, however, so it **cannot** be tested on an ordinary deploy preview unchanged. Decide and approve a secure test-context redesign or a controlled, gated TEST-only production-host trial as a **separate release decision**; do not disable guards casually. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/
- Netlify takes scheduled production backups daily and backups on production publish, with **plan-based retention**. Rolling back to an earlier site deploy does **NOT** automatically restore the database. Restoring a database backup replaces its production schema **and data** and loses post-backup writes. Confirm the exact backup timestamp and available retention **before** making any change. A Netlify **Team Owner** is required to restore. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/
- An on-publish backup is NOT a substitute for confirming a known-good **pre-migration recovery point** (and it may not be the backup you expect). Verify dates and recoverability with Netlify before launch.
- Netlify Database consumes credits for compute/bandwidth and may incur storage costs. The docs' earlier storage-free date was **1 July 2026**, already past; do NOT assume storage remains free in November 2026. Check actual billing and plan before activation. Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/

## Explicit owner review: release gate 0 (no writes)

Before approving any migration, verify in the **existing** Netlify project UI:

- [x] Owner screenshot confirms the existing site/domain and its production branch (only one branch was visible on 1 November 2026). Recheck immediately before release; this does not authorize any write.
- [ ] NUVETRIQ team plan, credits and database compute/bandwidth settings were **viewed on 1 November 2026** (snapshot above); verify updated limits, costs and budget immediately before any production deploy.
- [x] Owner screenshot dated 2 November 2026 shows **Scheduled, 5:00 AM, Restore offered**; it predates our un-applied migration. Backup identifier, content and actual restoration were NOT checked.
- [ ] Before release, reconfirm the backup is available, the Team Owner has restore authority, and the effect of restoring on newer data is understood. **Do not restore merely to check.**
- [ ] Production data explorer showed **0 public-schema tables on 1 November 2026**. Before first application, refresh with an approved **read-only** `information_schema` check; if any expected table exists, STOP and reconcile schema rather than reapplying `CREATE TABLE`.
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
