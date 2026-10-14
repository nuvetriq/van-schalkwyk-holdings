# Paid PDF download system — development guide

**Status (14 October 2026): implemented in the development branch, NOT activated or published on the live site.** The owner has reported two large Granny's recipe-book PDFs uploaded and attached to their products. Do not expose these books as public raw files.

## What is built

- **Separate private download page:** `book-download.html` with `assets/book-download.js` and `assets/book-download.css`.
- **Private download API:** `netlify/functions/book-download.mjs`. Every metadata request and every 3 MiB part request is authenticated using the same expiring signed token and checked against the paid order. Public listings never reveal private PDF paths.
- **Private signing and authorization:** `netlify/lib/book-link-auth.mjs`. `issuePaidBookLink({business,orderId,bookId,origin})` is a server-only helper (no public issuance endpoint). It may issue a link **only** for an actual immutable paid order verified by Yoco. The issuance helper also checks `VSH_ENABLE_PAYMENTS=true` and production context. Link validity defaults to 24 hours, maximum 72 hours.
- A bearer token identifies **one business, one specific verified order, and one purchased book**; it uses an HMAC-SHA256 signature and a random ID. Every download access rechecks that the original order is still paid and verified. Altered/expired links are denied, and a per-token conditional byte quota allows at most three full downloads (including interrupted attempts).
- Both the original small uploaded PDF files and the new large chunked `.manifest.json` books are supported without ever publicly exposing the private storage keys.
- The browser downloads large files in separate authenticated parts and writes directly to the chosen file using the File System Access API in modern **desktop Chrome/Edge**. Other browsers use a memory-based download fallback for PDFs of at most 75 MiB. **Large mobile/iOS downloads are not yet supported; do not launch without deciding how to support affected customers.**
- Netlify Functions have a 6 MB buffered payload limit (~4.5 MB usable binary) and a 20 MB streamed response ceiling, so this chunked architecture avoids an impossible 500MB single-response download. See https://docs.netlify.com/build/functions/configuration/.

## Order storage contract — essential

The future **verified** Yoco checkout system must create an immutable order snapshot, privately, in the persistent `vsh-book-orders` Netlify Blob store, key:

`orders/<business>/<order-id>.json`

Example shape (documentation only, NEVER use this as a public client payload):
```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "business": "grannys",
  "status": "paid",
  "paymentVerified": true,
  "paymentProvider": "yoco",
  "currency": "ZAR",
  "amount": 7500,
  "items": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "title": "Example Recipe Book",
      "priceCents": 7500,
      "pdfPath": "grannys/33333333-3333-4333-8333-333333333333.manifest.json"
    }
  ]
}
```

The `status: paid`, `paymentVerified: true` and `paymentProvider: yoco` fields **MUST NEVER** be writable via a public checkout request, user redirect or unverified API call. They must be set only after checking authentic webhook signatures, Yoco checkout ID, currency/amount, order reference, and real payment state, with durable idempotency/replay protection. Never trust a customer's cart prices. Preserve the immutable product PDF path in the paid order even when the product is edited later.

**Current Granny's recipe checkout proof of concept uses a different store (`vsh-recipe-orders`) and sends small PDF attachments. It is NOT suitable for 500MB+ files or the second business. Replace the old fulfillment before enabling payments. Do not activate the old `VSH_ENABLE_PAYMENTS` flag prematurely.**

## Pre-launch secret configuration

When ready to activate the fully tested Yoco/SMTP system, create a private Netlify Functions secret:

`VSH_BOOK_LINK_SECRET` — at least 48 unpredictable characters, unrelated to `VSH_ADMIN_KEY`, `OPENAI_API_KEY`, Yoco or Gmail.

The two separate store-specific Gmail identities are mapped in `netlify/lib/book-email-brands.mjs`. Send Granny's order links from `grannyspopsandtreats@gmail.com`, CleverCubs Learning orders from `learningclevercubs@gmail.com`, with each business's **own** server-side SMTP credentials. Do not embed those credentials in GitHub. Only purchased book links should appear in the matching email.

## Tests still needed before launch

- [x] Simulated: an appropriate paid order receives a link; token validates for the matching business and book.
- [x] Simulated: modified token, wrong business, unpaid order and disabled-payment issuance are rejected.
- [x] Simulated: download usage counts are recorded using conditional updates.
- [ ] Integrate a shared **Yoco signed webhook, checkout creation and immutable paid-order snapshots** for both business stores, with replay protection.
- [ ] Integrate both authenticated sender accounts and confirm email deliverability; email private links for exactly the purchased books.
- [ ] Test actual 500 MB+ downloads via the production Netlify Functions API, PDF integrity after reconstruction, invalid/expired links, and cross-business isolation.
- [ ] Test interrupted downloads and recovery, storage/usage limits, mobile browser behavior and alternative delivery options.
- [ ] Load-test download usage quotas and verify privacy headers, logs and link revocation.
- [ ] Conduct paid test orders; verify failed, pending, cancelled, duplicate-webhook and refunded payments grant no unauthorized access.
- [ ] Keep `VSH_ENABLE_PAYMENTS` OFF until all critical checks are complete.

**Important:** The mere existence of an uploaded PDF, published book listing, or customer email address does not grant download access. A server-verified paid order must exist first.
