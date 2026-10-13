# Granny's PDF recipe book payments — Netlify + Yoco + email

**This work is a draft, not deployed or tested with a live Yoco merchant account.**

**Payment safety switch (October 2026):** Yoco checkout creation, Yoco webhook processing and scheduled PDF email sending are now **OFF by default**, even on Deploy Previews. Enabling future paid fulfillment requires the Netlify Functions environment variable `VSH_ENABLE_PAYMENTS=true` **and** a production-context deployment, in addition to all verified Yoco/email secrets and transaction safeguards. Do not enable it while this work is unfinished. Clever Cubs PDF files are supported by the shared admin editor, but a real Clever Cubs Yoco checkout and verified email fulfillment must still be built and tested.


## Customer flow

1. Add a recipe book in the master admin, with a public cover and a private PDF (max 3 MB). Publish only after uploading the PDF.
2. Buyer selects up to 4 books, provides their name and email, then clicks Pay with Yoco.
3. Netlify reads product prices server-side, verifies private files exist, creates the order and hosted Yoco Checkout.
4. Signed Yoco payment.succeeded webhooks are checked for authenticity, freshness, checkout ID, amount and currency before an order is marked paid.
5. Once verified, all purchased PDF files are emailed as attachments to the customer's checkout email; an hourly function retries unsuccessful delivery.

## Set these Netlify environment variables (Functions scope)

- VSH_ADMIN_KEY: the existing 32+ character private master-admin secret.
- VSH_SITE_URL: your real HTTPS website origin, without a trailing slash.
- YOCO_SECRET_KEY: Yoco Checkout API TEST secret key first; switch to live only after tests and Yoco domain verification.
- YOCO_WEBHOOK_SECRET: whsec_... provided when registering the Yoco webhook (keep private).
- For the existing Granny's Gmail: VSH_GMAIL_USER and VSH_GMAIL_APP_PASSWORD (eligible app password after Google Two-Step Verification).
- Or for Resend: RESEND_API_KEY and VSH_RECIPE_EMAIL_FROM, using a verified sending domain. Optional VSH_RECIPE_REPLY_TO. Resend is preferred if both methods are configured.

Never share live API keys, webhook secrets or Gmail app passwords in chat, screenshots, or GitHub source.

## Yoco setup

1. In the Yoco app, find Sales > e-Commerce integrations > Checkout API > How to connect. Add and verify the website domain; Yoco must approve it to unlock live keys.
2. Test with the Yoco sandbox/test secret first.
3. Register a checkout webhook at https://YOUR-SITE/.netlify/functions/yoco-recipe-webhook using Yoco's authenticated POST https://payments.yoco.com/api/webhooks endpoint (name + url). Save the returned secret in Netlify.
4. Sandbox-test paid, failed and cancelled checkouts; a two-book order; missing PDF; missing delivery credentials; duplicate webhook retries and wrong payment amounts.
5. Only enable live keys after verifying both the paid PDF email and the order status page.

Yoco official docs: https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
Webhook verification: https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
Webhook registration: https://developer.yoco.com/api-reference/checkout-api/webhooks/register-webhook

## Important safety and operational notes

- Private PDFs live in Netlify Blobs store vsh-private-recipe-pdfs. There is no public PDF download endpoint; product-cover photographs alone are public.
- Checkout records include customer email and name. Update the website's privacy notice and retention handling to meet POPIA requirements.
- Email delivery is attempted after verified payment, but inbox arrival isn't guaranteed instantly; spam filters and provider availability can delay messages.
- This draft uses Netlify Blobs for order state. Netlify recommends a transactional database (e.g. Netlify DB) for purchases and financial records. Before a production launch, migrate order/payment-event tracking to a database with unique constraints and an idempotent durable delivery queue/outbox.
- Gmail SMTP lacks provider-level message idempotency: an interrupted send may be retried and email a second copy. Resend plus a durable database is preferable for higher reliability.
- Maximum 3 MB per PDF and 4 books per checkout. For larger PDFs use paid-order private links instead of attachments.
- The public Yoco return/success page is not proof of payment. Fulfillment depends only on a verified signed webhook.
- This remains in the draft branch feature/unified-product-admin. No live deployment or production charge has been made.
