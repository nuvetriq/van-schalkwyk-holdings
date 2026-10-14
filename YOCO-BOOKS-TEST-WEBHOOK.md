# Yoco Checkout API test webhook — Granny's and CleverCubs Learning

**Development status (14 October 2026):** A test-event receiver is implemented in the `feature/unified-product-admin` branch only. **Not deployed to production, not registered in Yoco, not activated for payments.** It does not record an order as paid or trigger any email or download.

## Tested webhook receiving code

- `netlify/lib/yoco-books-verification.mjs` checks Yoco Standard Webhooks HMAC-SHA256 signatures over `webhook-id.webhook-timestamp.rawBody`, supporting v1 key rotation, constant-time comparisons, and a maximum 3-minute timestamp difference.
- `netlify/functions/yoco-books-webhook.mjs` accepts signed **test-mode** events only, behind the separate `VSH_YOCO_VERIFY_ONLY=true` flag and a `sk_test_` API key. It logs minimal checkout/event metadata to a development Blob store and de-duplicates event IDs.
- It does not mark any order paid, create checkout sessions, issue book download tokens, send mail, or enable live checkout.
- Simulated tests of signature acceptance, altered body, wrong signature, expired timestamp, duplicate events, live-mode rejection and disabled-by-default operation passed **10/10**. Real Yoco end-to-end delivery has not been tested.

## Deploy Preview environment configuration

The store owner has confirmed that `VSH_YOCO_TEST_CHECKOUT` has been added in Netlify. A **fresh Deploy Preview build** is required to apply the variable. Confirm the saved variable is `true` for **Deploy Previews** with **Functions** scope, and confirm `YOCO_SECRET_KEY` resolves to a `sk_test_` key for Deploy Previews. Do not use `VSH_ENABLE_PAYMENTS` during sandbox tests.

## Shared two-business sandbox checkout — now in development

- The private test UI is `/book-test-checkout.html` linked from the **master admin dashboard** in the development branch only. It reads published PDFs from the selected business's preview catalogue. **Books in the production admin do not automatically appear in Netlify Deploy Preview storage.**
- The guarded endpoint `/.netlify/functions/book-checkout-test` accepts **one business per order** and at most eight distinct book IDs, name and email. It calculates every price from private Netlify product records; validates the matching original private PDF or sealed large-PDF manifest; and stores immutable item IDs, prices and PDF paths in `vsh-book-orders` (preview-scoped) before creating a Yoco test checkout.
- The Yoco request uses ZAR cents, a UUID idempotency key and order reference, and safe HTTPS redirect host validation. The Yoco response must confirm **test** processing mode and exactly match the server amount/currency before the checkout ID is bound to the order.
- Every test order remains `checkout_pending` or `awaiting_payment`, with `paymentVerified:false`. **Neither checkout creation nor the redirect marks an order paid**. The return page `/book-order-test.html` explicitly says it is not proof of payment.
- Start requests require the secret admin key in the request header. The feature is OFF unless **all** of the following are true: Netlify `CONTEXT=deploy-preview`, `VSH_YOCO_TEST_CHECKOUT=true`, and a `YOCO_SECRET_KEY` beginning with `sk_test_`. The request origin must match Netlify's `DEPLOY_PRIME_URL`. The live production website is refused regardless of settings.
- **18/18 simulated backend checks passed**, including cross-business isolation, unpublished books, fractional prices, duplicate book IDs, key validation, cross-site requests, production refusal and test-key-only enforcement.
- The separate signed webhook receiver is still **verify-only**, not connected to these pending orders or email delivery.
- Setup after preview build: add `VSH_YOCO_TEST_CHECKOUT=true` for **Deploy Previews only** to the Netlify environment (Functions scope), trigger a fresh Deploy Preview; use the preview Admin Portal and upload a **small test book** in its isolated storage. Open the private sandbox link on the admin dashboard and test one book from each business. If Yoco refuses the unverified Netlify Preview callback domain, stop and diagnose; do **not** bypass the verification or enable production payments.
- Do **not** configure `VSH_ENABLE_PAYMENTS=true`; that's a separate activation for future signed-webhook + email link fulfillment.

## When the full shared checkout is ready

1. Release a standalone verified **test** webhook endpoint on Netlify with all payment/fulfilment flags still off.
2. Set `VSH_YOCO_VERIFY_ONLY=true` for Functions and keep `YOCO_SECRET_KEY` as the existing `sk_test_` key.
3. Register **one** test-mode Checkout API webhook programmatically using `POST https://payments.yoco.com/api/webhooks` with a name and public Netlify URL. **List existing webhooks first** to avoid duplicates; Yoco permits a limited number of subscriptions.
4. The registration returns an independent `whsec_` secret **only once**. Save it privately as `YOCO_WEBHOOK_SECRET` in the Netlify Functions environment. Never share or commit it. Registration cannot be completed from the public UI alone, and this connection does not yet have direct access to the owner's secret.
5. Test delivery and real signature verification without enabling purchases.
6. Implement a shared two-business checkout using **server-calculated totals**, immutable product/PDF snapshots and the `vsh-book-orders` contract. Confirm amount, currency, checkout identity, event mode and verified signature, with idempotent CAS updates.
7. After a verified paid order exists, issue expiring links only to its purchased PDFs, and send through each business's configured sender. Test failures, duplicate webhooks, refunds and missing emails before any live money can move.

**NEVER** turn on `VSH_ENABLE_PAYMENTS` just to test the webhook. The legacy Granny's attachment-based checkout is not compatible with 500MB+ books and must not be activated.

Official references:
- https://developer.yoco.com/api-reference/checkout-api/webhooks/register-webhook
- https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
- https://developer.yoco.com/api-reference/checkout-api/webhook-events/payment-notification


## Verification of checkout flag values (14 October 2026)

The owner has configured `VSH_YOCO_TEST_CHECKOUT` separately from `YOCO_SECRET_KEY`: `true` for Deploy Previews and `false` for Production, while `YOCO_SECRET_KEY` remains the Yoco `sk_test_...` API key. This documentation-only commit requests a fresh Deploy Preview so Netlify can inject updated Functions-scope settings. Do not enable `VSH_ENABLE_PAYMENTS`; the test checkout is admin-only and produces no paid book delivery.


## Deploy Preview rebuild after corrected Yoco flag

On 14 October 2026, the owner found that `VSH_YOCO_TEST_CHECKOUT` had been mistakenly configured as **false** for Deploy Previews and **true** for Branch deploys. The owner has now corrected the Netlify settings: **Deploy Previews = true; Branch deploys = false; Production = false**. Trigger **one** new Deploy Preview with this documentation-only commit to load the corrected Functions environment. Do not activate `VSH_ENABLE_PAYMENTS`, do not alter `YOCO_SECRET_KEY`, and do not deploy unfinished checkout functionality to production.
