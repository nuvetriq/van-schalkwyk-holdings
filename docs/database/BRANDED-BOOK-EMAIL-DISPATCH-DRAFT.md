# Branded paid-book email and recoverable delivery links — DRAFT (1 November 2026)

**NOT DEPLOYED.** This is a server-only development contract, not an enabled email sender, scheduled job, Netlify Function or production payment workflow. The owner has not approved deploying or sending anything.

## Desired behavior

One verified Yoco LIVE payment for mixed Granny's + CleverCubs Learning books creates one master order, one sale per purchased brand, and exactly two brand-specific email tasks per represented brand (customer delivery and merchant notification). Granny's customer delivery and notice use `grannyspopsandtreats@gmail.com`; CleverCubs uses `learningclevercubs@gmail.com`. Customers receive separate emails containing only that brand's books and private download links. Merchant notifications have no bearer tokens or PDF paths.

Existing `planAfterSignedPayment`, `settleVerifiedMixedYocoPayment` and PostgreSQL outbox implement draft atomic separation and no-send Yoco TEST mode. New `netlify/lib/mixed-book-brand-email-dispatch-draft.mjs` composes only claimed brand-scoped jobs from paid LIVE DB sales, prepares committed links for customer delivery, and accepts a *dependency-injected, never-configured* `sendEmail` callback. **No Gmail or SMTP adapter exists; it is not called by a Netlify Function, webhook, automation or storefront.**

## Crash-safe grant link reconstruction

Previously each download token was random and only its SHA-256 digest was stored. That prevented securely recreating the original link after a crashed worker, resulting in potentially missing customer deliveries. The new `netlify/lib/mixed-book-paid-grant-service.mjs` uses:

- A unique UUID nonce per purchased product, stored in `vsh_mixed_download_grants.token_nonce`.
- A separate 32-byte server secret, held in a future Netlify **Functions-only** environment variable `VSH_MIXED_BOOK_LINK_KEY` (format `vshlk_<32-byte-base64>`). Do not share it in chat, GitHub, client bundles, logs or screenshots.
- HMAC-SHA256 of the order ID, business, product ID and nonce under a versioned, purpose-specific domain. Encodes to a 43-character base64url token.
- **Only the SHA-256 of that token**, plus nonce, brand, order, product, expiry and revocation status, is stored in PostgreSQL. The same server secret + nonce reconstructs the same original URL on retry, without any raw token stored at rest.
- A 48-hour expiry. Expired or revoked grants cause a **manual renewal** requirement rather than silently generating a fresh access grant.
- A Postgres transaction that locks the verified paid LIVE master order, reconciles this brand's order lines/subtotal, checks old grants, inserts missing grants, and **commits everything before a single private URL is returned to the worker**.
- The **unapplied DRAFT** schema now includes `token_nonce uuid NOT NULL UNIQUE` and `UNIQUE(order_id,business,product_id)`. Existing production DB has not been migrated.

The email URLs remain of the form `https://vanschalkwykholdings.com/book-download.html#token=<secret>`, whose fragment is scrubbed by the first-party page. The PDF endpoint requires authenticated POST, not query-string bearer tokens. A link still needs to be kept out of diagnostics or email analytics.

## Safe email lease handling

1. `claimMixedBookEmail()` atomically claims **one** pending/retry job for a **paid LIVE** order with `FOR UPDATE SKIP LOCKED`, four-attempt limit and a short lease; Yoco TEST orders cannot be claimed.
2. Re-validate claimed row and exact brand-scoped DB sale; create/reconstruct **committed** links for customer email only. Merchant email never contains a download URL.
3. If preparation fails **before** any provider request starts, mark the task for safe retry.
4. Once a provider request is initiated, its outcome is **ambiguous** until a valid acknowledgment is committed. If send fails, times out, or the provider acknowledgment cannot be stored, mark as `unknown` and require manual reconciliation. **Never auto-retry ambiguous sends**, preventing duplicate customer emails.
5. Expired `claimed` leases are separately quarantined as unknown, never resent blindly. These are drafts; actual provider-level idempotency and mailbox reconciliation remain unimplemented.

## Verified by automated tests (synthetic resources only)

- `scripts/test-mixed-book-paid-grant-service.mjs`: 8 tests for HMAC determinism, no raw token in DB, two-brand isolation, identical retry links, TEST/unpaid rejection, failed transaction rollback, revoked/expired/changed-secret refusal, schema constraints.
- `scripts/test-mixed-book-brand-email-dispatch.mjs`: 7 tests for two separate senders and customer URLs, brand-only merchant emails without download URLs, pre-send retry, post-send quarantine, malformed outbox, no jobs, default-off behavior.
- `scripts/test-mixed-book-real-paid-grants.mjs`: integration with disposable GitHub Actions PostgreSQL 16 using a synthetic paid LIVE order and no real Yoco webhook or customer details; checks two committed grants, replay and refunded-order refusal.
- Existing tests still cover Yoco TEST-only isolation, temporary DB settlement, private PDF integrity, protected downloads and release gates.

## Blocks before real email delivery

- Explicit approval for reviewed production schema migration and Netlify environment variables; backup and rollback plan first.
- Explicit approval to implement and configure **per-brand authenticated SMTP/provider delivery** (credentials only in Netlify secure environment; no app passwords in chat or GitHub). Confirm each sender is allowed under the provider's policies and add strong server-only tracing with no token leakage.
- Real verified LIVE checkout/webhook processing; TEST payments must never dispatch a customer email or issue a live grant. Existing Yoco TEST webhook still points to older Preview 2; do not change it until approved cutover.
- Reliable provider-level idempotency and manual reconciliation procedures for `unknown`, failed, expired, bounced or rejected deliveries; password/key rotation implications for existing links.
- End-to-end test with owner-approved non-customer test addresses, small PDF and 2 GiB-sized chunks, browsers and consent to Netlify/Yoco resource costs.
- Refund/dispute automation to revoke grants and mark orders appropriately. Do not claim refund behavior is complete.

**Current safe status:** no actual SMTP/Gmail sends, no Netlify customer downloads, no live or TEST payment attempt, no Yoco registration change, no real DB schema mutation. Production `main`, uploads and customer website untouched.
