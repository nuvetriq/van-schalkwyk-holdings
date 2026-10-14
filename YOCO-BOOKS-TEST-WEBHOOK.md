# Yoco Checkout API test webhook — Granny's and CleverCubs Learning

**Development status (14 October 2026):** A test-event receiver is implemented in the `feature/unified-product-admin` branch only. **Not deployed to production, not registered in Yoco, not activated for payments.** It does not record an order as paid or trigger any email or download.

## Tested webhook receiving code

- `netlify/lib/yoco-books-verification.mjs` checks Yoco Standard Webhooks HMAC-SHA256 signatures over `webhook-id.webhook-timestamp.rawBody`, supporting v1 key rotation, constant-time comparisons, and a maximum 3-minute timestamp difference.
- `netlify/functions/yoco-books-webhook.mjs` accepts signed **test-mode** events only, behind the separate `VSH_YOCO_VERIFY_ONLY=true` flag and a `sk_test_` API key. It logs minimal checkout/event metadata to a development Blob store and de-duplicates event IDs.
- It does not mark any order paid, create checkout sessions, issue book download tokens, send mail, or enable live checkout.
- Simulated tests of signature acceptance, altered body, wrong signature, expired timestamp, duplicate events, live-mode rejection and disabled-by-default operation passed **10/10**. Real Yoco end-to-end delivery has not been tested.

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
