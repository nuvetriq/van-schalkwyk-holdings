# Shared digital-book emails — draft operating model (NOT LIVE)

The website must keep **one Yoco checkout** while splitting purchased books into two independent brand-scoped delivery emails and merchant sale notices. This document describes the *undeployed* code in `netlify/lib/mixed-book-email-templates.mjs` and `netlify/lib/mixed-book-email-outbox.mjs`.

## 1. Immutable payment-to-email ordering

1. Customer purchases Granny's and/or CleverCubs digital books through one Yoco checkout.
2. **Backend**, not the redirect page, verifies the raw HMAC-signed Yoco payment callback and matches the stored checkout ID, live/test mode, ZAR amount, order ID and payment ID.
3. In a real PostgreSQL transaction, mark the master order paid, store the event, create each included brand sale, and create exactly two outbox rows per brand: `customer-delivery` and `merchant-sale-notice`. Unique task IDs are `masterUUID:business:kind`.
4. Before a customer-delivery task can send, issue and commit each purchased book's random, brand-specific, time-limited download grant. The link must resolve only to the paid order's specific product through a **separate future server endpoint**, never expose a Netlify Blob path. **The private streaming endpoint does not exist yet.**
5. Only a trusted worker may claim pending or safely retried outbox rows for `paid` and `live` master orders, using `FOR UPDATE SKIP LOCKED` and a claim UUID.
6. Load only the included brand sale; compose the customer email from that brand's sender, its titles, its subtotal and its committed download links. Compose the merchant notice to that brand's own inbox **without download links**. A mixed Yoco payment should have **one combined payment receipt**, not two separate payment receipts.
7. After a provider returns an explicit, trustworthy *acceptance* acknowledgement, record provider message ID and mark the task `sent` (which means provider accepted, not guaranteed mailbox delivery).

## 2. Lost acknowledgement and retry policy

- Error before *any* provider/network attempt: release the claim as `retry` with delay; cap automatic attempts at four.
- Provider request started, SMTP timeout, uncertain response, or worker crashed after claiming: mark `unknown` or quarantine an expired claim as `unknown`. **Never auto-resend uncertain messages.** A human must reconcile using provider logs and the unique task ID.
- A confirmed reject with explicit no-acceptance can be considered for a retry only after review of the particular provider's semantics.
- Pending/unknown statuses and customer support/manual resend need operator UI and audit controls before launch. Unique database task IDs do not deliver exactly-once SMTP semantics by themselves.
- A failure for Granny's does not modify CleverCubs tasks. No duplicate charges or deliveries should follow repeated webhooks.

## 3. Privacy and release gates

- Never put Gmail app passwords, Yoco keys or database credentials in HTML, GitHub, or client-side JavaScript.
- Never expose the *master* mixed order to brand-specific notification endpoints; query by brand and enforce access rights.
- Do not send PDF attachments (files may be extremely large). Email only expiring, private download URLs.
- Use the existing brand mailboxes for sender identities and owner notices. Their actual credentials remain separate and unconfigured in this branch.
- Before enabling: review signed webhook integration, transaction schema against *real* PostgreSQL, DB billing, timed worker deployment, link grant insert/redemption, private large-PDF streaming, email provider authentication/quotas, the combined Yoco receipt, and end-to-end acceptance/failure/replay testing.
- **No real database was provisioned, no migration applied, no email transport implemented, and no Netlify deployment performed** during this development milestone.
