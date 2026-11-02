# Controlled paid-book email worker wiring — UNDEPLOYED (1 November 2026)

**Owner consent status:** General "ok" permits development/testing on `feature/shared-mixed-brand-cart` only. It is **not** authorization to deploy, migrate Netlify Database, register/change Yoco webhooks, enable LIVE payments, configure actual Gmail passwords, send mail, or access customers.

## Complete in DEVELOPMENT

`netlify/lib/mixed-book-email-worker-draft.mjs` now composes the already-developed components into **one** server-only `runOne()` operation:

1. `assertMixedBookEmailWorkerReadiness()` rejects the request before any DB/SMTP access unless the caller explicitly passes `enabled:true` and `operatorApproved:true`, the context is Netlify production, all four future env flags are true, the signing secret is a valid 32-byte `vshlk_` key, and **both** Gmail app password formats exist.
2. `openMixedBookPool()` opens the existing Netlify project's PostgreSQL pool; it does **not** provision, migrate, or overwrite databases.
3. `createMixedBookDbReads(pool)` provides **paid LIVE** brand-only sale reads. It must not return the mixed order's other brand line items.
4. `createMixedBookGmailSender()` uses Gmail SMTP over TLS 465 and always sends from the matching Granny's / CleverCubs Gmail account. It is independently disabled unless full future LIVE flags are set; each secret remains server-only.
5. `dispatchOneMixedBrandEmail()` atomically claims one outbox job (only a PAID LIVE order, never Yoco TEST), recovers committed SHA-256/HMAC private PDF links for customer delivery, composes the brand-specific email and calls the injected sender. Merchant-sale notices contain **no** book links. Pre-send problems are safe to retry. After any uncertain send/outcome the task is held `unknown` for manual review; never auto-retry an uncertain email.

The worker returns only a small `status`, `kind`, and `business` summary; it never returns personal addresses, bearer tokens, plaintext keys, PDF paths or raw SMTP errors. **The module has no public HTTP handler, scheduled trigger or default export; no production Function imports it.** This is deliberately not usable by customers or merchant automation yet.

### CI evidence

- `scripts/test-mixed-book-email-worker-draft.mjs` runs **four** unit/integration tests with fake in-memory Postgres/outbox and fake Nodemailer SMTP. Tests cover 4 separate brand emails, 2 book link families, correct sender, disabled and malformed configurations, no public trigger, and uncertain delivery quarantine without duplicates.
- `scripts/test-mixed-book-real-email-worker.mjs` checks one *synthetically signed* LIVE payment against a disposable **GitHub Actions PostgreSQL 16**, then 4 claimed/sent outbox rows and 2 committed hashed grants, with a **fake** SMTP transport that makes no network calls. A repeat run must return no pending jobs.
- An integration test revealed that earlier CI scripts left **synthetic PAID LIVE outbox rows** in the *same disposable* DB, causing the worker to pick up the extra jobs. Fixed the earlier SQL tests to clean up their own payment/events/outbox/brand-sale/order rows in `finally`; these changes affect **only synthetic disposable CI data**, never Netlify's real database.
- `scripts/test-mixed-book-release-gates.mjs` rejects any Function that imports or invokes this draft worker, keeps SMTP secrets out of public assets, and verifies no automatic database migration exists.

## Not complete / explicitly blocked for launch

- No approved Netlify production migration, no real environment flags, no real Gmail secret reads, no actual Gmail messages.
- No approved worker trigger, scheduler or authorized admin-only invocation. Both `enabled:true` and `operatorApproved:true` in this server helper are **technical prerequisites, not user authorization**; a future privileged, audited execution channel must be separately designed and approved.
- A real email transport is drafted but still needs owner-approved test sends, account login verification, deliverability tests, quotas/limits, and robust manual reconciliation for `unknown` outcomes. Google/Gmail SMTP acceptance does not guarantee inbox delivery or exactly-once semantics.
- The *real* customer's Yoco payment success path and signed webhook, refunds/chargebacks, privacy and grant revocation need end-to-end verification before any LIVE sale.
- Existing TEST Yoco account still has its old Deploy Preview 2 webhook; a controlled TEST cutover is a separate approval and change.
- No new Netlify site/project or recurring costs authorized; cost/credits must be checked before a deployment.

**Do not send credentials via this chat.** When rollout is explicitly approved, enter app passwords and HMAC key in the Netlify environment UI, scoped to the required functions, never GitHub or public pages.
