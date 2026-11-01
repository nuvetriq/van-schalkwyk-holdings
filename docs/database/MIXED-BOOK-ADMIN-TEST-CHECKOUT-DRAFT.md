# Admin-only mixed-brand Yoco TEST checkout endpoint — NOT ENABLED

## What was added

A guarded `netlify/functions/mixed-book-yoco-test-checkout.mjs` endpoint, only for the existing `https://vanschalkwykholdings.com` site after explicit future rollout. Development code remains solely on branch `feature/shared-mixed-brand-cart`, **not merged or deployed**.

It implements this sequence:
1. Verify POST, canonical production origin, explicit TEST enable flag, separate Netlify Database enable flag, absence of live-payment enablement, dedicated **test** key + webhook signing-secret configuration, admin master key and JSON-size limit. Rate-limit by IP.
2. Read selected book IDs/customer name/email (admin-controlled dry-run only; not yet connected to customer cart checkout).
3. Re-load EVERY selected book's current price, title, published state and private PDF ownership from existing **server-side** Netlify Blob stores: `vsh-products` and `vsh-private-recipe-pdfs`. Never use browser price, title, or PDF path.
4. Write one pending master order and line snapshots transactionally to Netlify Database (requires future controlled migration).
5. Send ONE checkout request to Yoco's server-side Checkout API using the dedicated test key, one combined integer cents amount and deterministic per-order idempotency key.
6. Validate returned TEST checkout amount, ID, mode, order identity and safe `https://c.yoco.com/checkout/...` redirect.
7. Bind the returned checkout ID to the saved order in a committed transaction **before** returning any redirect URL.
8. Customer visiting return URL is NOT proof of payment; a distinct signed webhook endpoint must be registered and must independently verify the payment before settlement.

## Default safety posture

This endpoint is **disabled** unless all of these are explicitly configured *later* in Netlify Functions environment:

- `VSH_MIXED_BOOK_DB_ENABLED=true`
- `VSH_MIXED_YOCO_TEST_ENABLED=true`
- `VSH_MIXED_YOCO_TEST_KEY` is a separately issued Yoco TEST-only secret, never LIVE
- `VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET` is the test webhook signing secret
- `VSH_ENABLE_PAYMENTS` remains absent or `false`
- Existing `VSH_ADMIN_KEY` satisfies admin authentication
- Deployment context is production and request origin is the canonical hostname

The code deliberately rejects Deploy Previews and branch deploys, and isn't imported into the customer-facing cart. **No environment variables were changed. No actual Yoco checkout was requested.** Never paste secrets in chat or screenshots.

## Status and necessary follow-ups

The development branch can build this handler, but the owner's real production database still has **no mixed-book tables** because the draft SQL remains outside the migration directory. Enabling this endpoint *now* would lead to a controlled 503, not a working checkout. Do NOT toggle the flags until a separately approved migration and webhook release are complete.

Next engineering tasks:
1. Review the database migration for compatibility, take/confirm backups, and agree to a controlled production deploy.
2. Implement a strictly signed Yoco webhook HTTP endpoint with verified checkout-to-payment association; live/test isolation, idempotency, retryable races.
3. Add full customer cart checkout and protect against bots/rate issues, with customer receipts.
4. Integrate branded email provider, outbox, private PDF grant/redemption and incremental 2 GiB file delivery.
5. End-to-end test using a Yoco TEST card and only then consider real payments.

GitHub CI tests `scripts/test-mixed-book-yoco-test-endpoint.mjs` for server-side private catalogue lookups, one combined charge, durably saved order before outgoing provider request, persisted checkout binding before redirect, disabled flags, admin authentication, wrong-origin requests, malformed payloads, failure handling, and no secret leaks. CI additionally exercises disposable PostgreSQL 16 without any owner production DB access.

Official Yoco checkout API: https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
