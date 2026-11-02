# First Yoco TEST mixed-book release — controlled sequence and go/no-go

**Prepared 2 November 2026. PLANNING ONLY — no live Netlify changes, no migrations applied, no Yoco API mutations, no test payments, no emails.**

Scope: the **existing** Netlify project for https://vanschalkwykholdings.com , currently backed by GitHub \`nuvetriq/van-schalkwyk-holdings\`. The candidate implementation is only on \`feature/shared-mixed-brand-cart\`. Do not create another Netlify project. This document is **not** permission to merge/publish/test.

## Evidence and known limitations

1. Owner Netlify screenshots (1–2 Nov 2026): production PostgreSQL branch created 1 Nov; the explorer showed **0 public tables**; one *Scheduled* backup listed **2 Nov 2026, 5:00 AM**, with **Restore** offered; 7-day scheduled backup retention and 3 most recent on-publish deploys; Personal plan with 1,000 credits/month and 1,878.4 available/6.2 used when captured. Backup timezone, ID, contents and restoration success are **not** established; recheck backup on the actual release date. Never click **Restore** merely to test availability.
2. The six-table migration is an **UNAPPLIED** draft in \`docs/database/mixed-book-orders-DRAFT.sql\`. There must still be **no** \`netlify/database/migrations\` folder in the protected development branch. Tests only apply schema to disposable GitHub PostgreSQL 16, **not** the owner's Netlify Database.
3. The Yoco TEST key's old, owner-reported webhook inventory (not verified today) listed exactly one TEST subscription, named \`Van Schalkwyk Holdings – Book Test\`, URL:
   \`https://deploy-preview-2--van-schalkwyk-holdings.netlify.app/.netlify/functions/yoco-books-webhook\`
   This old Preview 2 handler consumes **legacy Blob order mappings**, not the new mixed Postgres ledger, and could return 503 for a new mixed checkout. No merchant subscription ID or signing secret has been provided to the assistant. Re-list immediately before an approved cutover; do not assume this is still the current account state.
4. New handler URLs are:
   - **Admin TEST checkout:** \`https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-checkout\`
   - **Signed TEST webhook:** \`https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-webhook\`
   - **Admin-only TEST order status:** \`https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-order-status\`
   All are **production-context** and origin-locked, denied until both \`VSH_MIXED_BOOK_DB_ENABLED=true\`, \`VSH_MIXED_YOCO_TEST_ENABLED=true\`, valid **TEST-only** keys, and \`VSH_ENABLE_PAYMENTS!=="true"\`. Public shop pages do **not** call these functions. No signed webhook can send any customer email or PDF in TEST mode.
5. Netlify applies migration files in \`netlify/database/migrations\` **automatically** at preview deployment (to an isolated preview branch) and before production publish. Adding a migration to a PR can therefore change a preview DB even before main merges. A previous production website deploy rollback does **not** roll the DB back. Relevant docs: https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/ , https://docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery/ .
6. Yoco's Checkout API exposes **GET list, POST register, DELETE** webhook operations (not a documented Checkout PATCH update). The provider recommends one Checkout webhook, 2xx confirmation within ~15 seconds; non-2xx triggers retries. Newly registered secrets appear **only once**. Provider docs: https://developer.yoco.com/api-reference/checkout-api/webhooks/list-webhooks and https://developer.yoco.com/guides/online-payments/webhooks/listen-for-events . **Never** guess registration IDs, webhook keys, or availability of an update API.

## Release stages — EACH requires its own precise owner approval

### Stage A — schema review and isolated preview verification

**Approval scope required:** permission to create a *preview-only* schema migration/deploy on the existing project; this is not production approval.

1. Reconfirm current \`main\`, deploy behavior, and whether opening/updating a PR automatically starts a preview and runs migrations. Record exact migration file and commit. Do not accidentally merge/publish.
2. Preserve production state; recheck relevant production schemas read-only, approved credits/branch usage, and the dated scheduled backup's continuing availability. No credentials should be pasted in chat.
3. Only with approval, put the reviewed *additive* six-table SQL in a correctly named \`netlify/database/migrations\` file for a preview. Determine whether wrapping \`BEGIN/COMMIT\` is acceptable for Netlify migration runner and confirm any auto-publish settings. Ensure the preview's database branch is separate from production. Confirm legacy products, PDFs, and pages are intact.
4. Use **disposable synthetic records only** in the preview database. Do **not** register the preview webhook with Yoco, connect preview to the production DB, copy real customers, activate LIVE checkout, SMTP, or PDF delivery.
5. The current TEST checkout/webhook is **production-context locked**, so a preview DB pass is **not** a Yoco TEST end-to-end pass. Do not bypass the lock without independent security review and explicit approval.

**Stop conditions:** preview uses production DB, cannot prove branch isolation, unexpected schema/table collision, migration failure, unreadable prior data, unexpected spend, or any unsolicited new webhook.

### Stage B — disabled, controlled production release

**Approval scope required:** *separate, explicit* owner permission for production deployment **and** database migration. The confirmed 2 Nov backup candidate is not alone an approval.

1. Immediately before the deployment, recheck a suitable dated pre-migration backup in Netlify, owner/team restore authority, live schema (no conflicting \`vsh_mixed_*\` tables), actual spending/credit budget and rollback owner; lock down the change window.
2. Confirm all feature flags remain **OFF**: \`VSH_ENABLE_PAYMENTS\`, \`VSH_MIXED_YOCO_TEST_ENABLED\`, \`VSH_MIXED_BOOK_EMAIL_ENABLED\`, \`VSH_MIXED_BOOK_DOWNLOADS_ENABLED\`. No Gmail or Yoco TEST keys need to be exposed or shared in chat/GitHub.
3. If approved, publish only reviewed code+schema to the **existing** project. Validate six new tables, old product/Blob behavior and public checkout unavailability; inspect sanitized Netlify logs and credits. Keep all Yoco actions disabled.
4. If anything unexpected happens, **stop**. Roll back code independently if appropriate; do not assume that rollback removes DB tables. Prefer a reviewed forward fix over destructive SQL. Database restore is a distinct high-impact action requiring new explicit approval and awareness of post-backup data loss.

### Stage C — enable Yoco **TEST only**, cut over webhook

**Approval scope required:** separate explicit owner permission to enable TEST keys/flags, to change an existing **TEST** webhook subscription, and to attempt a specific TEST checkout. Do not conflate any of these with LIVE activation.

1. Confirm old test activity is settled; use an owner-run **read-only GET** to list current Yoco TEST subscriptions and confirm exact existing subscription ID/URL. Reconcile any differences from the earlier Preview 2 inventory. Do NOT inventory LIVE subscriptions using an unapproved LIVE key.
2. Confirm the new production-host test webhook is **deployed** and **safely gated**, and that Netlify Functions environment is prepared with only **TEST** secret key \`VSH_MIXED_YOCO_TEST_KEY\` and new registration secret \`VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET\`. The user enters secret values directly in Netlify UI; never GitHub, chat, console logs or screenshots.
3. Agree a provider cutover order **before acting**: old and new subscriptions may both receive the same TEST notification. Do not register duplicate active webhooks casually; old Blob-only handler could return 503/retry on a new Postgres checkout. Yoco Checkout API registration/deletion are distinct mutating operations and need explicit owner authorization.
4. Enable \`VSH_MIXED_BOOK_DB_ENABLED=true\` and \`VSH_MIXED_YOCO_TEST_ENABLED=true\` ONLY as approved. Keep LIVE payments, mail worker and PDF delivery **OFF**. Verify Netlify's actual env scope/context and redeploy behavior. Test unsigned/malformed webhook POSTs are rejected without leaking data.
5. Once authorised and registration is correct, perform **one bounded owner-approved Yoco TEST checkout**, using disposable example customer information, the official provider TEST payment flow, and a tiny synthetic mixed-brand cart. Check Yoco amount and ZAR cents, unique Checkout ID, signed matching event, one PAID TEST master ledger and correct per-brand amounts. An HTML redirect alone **does not prove payment**.
6. Check **ZERO** customer emails, **ZERO** private PDF grants/downloads, and **ZERO** LIVE transactions. Review event retries/duplicates, exactly one intended active TEST subscription, sanitized logs and resource usage. Pause further attempts on any unknown charge, retry loop, mismatch or error.
7. Retain the rollback sequence: stop new TEST checkouts first, assess unfinished old test checkouts, confirm current webhook inventory, and only with approval change/delete/re-register a TEST subscription with its real ID. Disabling code cannot unregister merchant webhooks automatically.

### Stage D — separate future LIVE release (NOT IN SCOPE)

No LIVE Yoco API keys, LIVE webhook registration, public customer checkout, customer Gmail sending or PDF delivery in stages A–C. Full LIVE payment safety, refund/dispute revocation, external downloads/email acceptance, merchant reconciliation, recovery and compliance testing must pass a **separate review and owner approval**.

## Evidence and approvals before action

| Decision | Current evidence | Status |
| --- | --- | --- |
| Owner Netlify site and GitHub repo identified | Screenshots and source | Confirmed |
| Six-table schema tests, Yoco synthetic signed tests | GitHub Actions ephemeral PostgreSQL | Confirmed in CI, not live |
| Dated pre-migration Netlify backup candidate | Scheduled 2 Nov 2026 5 AM; Restore offered | Observed, NOT restoration-tested |
| Preview DB branch isolation for this new migration | Netlify documented behavior only | **Not proven on deployment** |
| Current actual TEST webhook list/ID and new endpoint health | Previous read-only merchant inventory | **Recheck required** |
| Production migration/deploy authorization | No explicit permission | **Not approved** |
| Yoco TEST registration/edit/test-charge authorization | No explicit permission | **Not approved** |
| LIVE checkout, email or PDF activation | No explicit permission | **Prohibited in first test** |

**Current release verdict: NO-GO.** User's normal "ok" only permits safe development branch changes. No new file in this plan goes into \`netlify/database/migrations\`, no GitHub PR/merge/deploy is performed, and no merchant settings are altered.
