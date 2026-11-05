# Shared-cart Yoco TEST checkout and signed payment handoff (DEVELOPMENT ONLY)

Owner requirement: ONE Van Schalkwyk Holdings website, ONE basket, ONE Yoco payment from the already-connected merchant account, with independently scoped Granny's and CleverCubs Learning sales, customer delivery emails and internal receipt notifications.

## Implemented on feature/shared-mixed-brand-cart

- `netlify/lib/mixed-book-yoco-test-checkout.mjs` prepares a server-only POST to `https://payments.yoco.com/api/checkouts` with **one integer ZAR amount**, a stable per-order `Idempotency-Key`, immutable server order reference in `metadata.orderId`, `clientReferenceId` and `externalId`, plus canonical host return URLs. It **cannot** use live Yoco keys, requires an explicit enabling flag, and currently has **no deployed Netlify Function caller**. It validates that the provider returned a TEST checkout, exact amount and trusted `c.yoco.com` redirect URL before returning a redirect. Never rely on the redirect as proof of successful payment.
- `netlify/lib/mixed-book-yoco-webhook-verify.mjs` verifies Yoco HMAC on exact raw body, header event ID/timestamp, signature version, 3-minute replay window and matching test/live mode, checkout and cents. It now also safely uses authenticated `webhook-id` if the optional JSON event ID is absent.
- `netlify/lib/mixed-book-yoco-test-payment-handoff.mjs` is a PRIVATE, NOT deployed integration helper: after the verified signed `payment.succeeded` event, match own `purpose: vsh-mixed-book-test`, exact stored order, test mode, Yoco-generated checkout ID and total; then pass a trusted confirmation to the transactional ledger. When checkout binding hasn't completed, request a **retryable** response instead of falsely acknowledging success. Missing checkout identity also requires independent verification and cannot settle.
- Even when a simulated test payment is settled, the ledger's TEST mode creates **zero dispatchable emails** and **zero download grants**. All tests use generated fake keys and injected fake Yoco requests; no real charges or emails were performed.

## Tests

- `scripts/test-mixed-book-yoco-test-checkout.mjs` (8 tests): single combined amount, stable idempotency, server price validation, trusted Yoco test-only checkout response, redirect destination validation, disabled mode and request failures.
- `scripts/test-mixed-book-yoco-test-payment-handoff.mjs` (8 tests): signed webhook to a single verified test settlement, duplicates, early callback race, missing checkout identity, unrelated merchant payments, invalid signature/amount/mode and no-mail guarantee.
- One additional verifier test confirms authenticated `webhook-id` works when Yoco's JSON body lacks `event.id`.
- Existing comprehensive GitHub Actions workflow also builds the website and executes branch/unit and temporary real PostgreSQL integration tests.

## Critical remaining work before live tests or deployment

1. Make the combined cart collect purchaser name/email on the server, read published catalog prices from private server storage, and persist the immutable pending master order.
2. Connect the guarded test checkout request to a server-only HTTP transport and persist the returned Yoco checkout ID **before** revealing the redirect.
3. Confirm Yoco's actual signed TEST webhook fields against their published documentation/test callback. The documented `metadata.checkoutId` should be checked against the persisted server checkout. NEVER infer a checkout solely from customer-supplied `orderId`.
4. Make a controlled, reviewed Netlify Database schema migration (the SQL remains an **UNAPPLIED draft** in `docs/database/mixed-book-orders-DRAFT.sql`).
5. Expose an HTTPS webhook endpoint only under strict gates, with raw body verification, retry semantics and idempotent DB settlement.
6. Add real but gated branded SMTP transport and per-book expiring private download endpoints with large-PDF streaming; test full brand privacy and failure recovery.
7. Only after TEST checkout, PDF delivery and emails work end-to-end, consider real customer payment activation, with explicit owner approval and rollback.

**No Yoco key, webhook endpoint, Netlify database migration, checkout payment, email, PDF access, Netlify deploy or production branch merge has occurred as part of this milestone.**
