# Yoco TEST webhook: legacy Preview 2 → permanent mixed-cart endpoint
**Release planning only — 1 November 2026. NOT deployed; no Yoco changes.**

## Confirmed merchant state (read-only, reported by owner)

Yoco Checkout API `GET /api/webhooks` with the owner's **TEST** API key returned **one** TEST webhook:

- **Name:** Van Schalkwyk Holdings – Book Test
- **Mode:** `test`
- **URL:** `https://deploy-preview-2--van-schalkwyk-holdings.netlify.app/.netlify/functions/yoco-books-webhook`

This confirms registration, **not** endpoint health or whether every Yoco event was delivered. A TEST-key listing is not evidence about webhooks associated with the LIVE key. Do not request the user's actual secret keys, signing secrets or authorization headers.

## Code-level comparison (verified from GitHub)

| Property | Old PR #2 `feature/unified-product-admin` | New `feature/shared-mixed-brand-cart` |
|---|---|---|
| Webhook | `netlify/functions/yoco-books-webhook.mjs` | `netlify/functions/mixed-book-yoco-test-webhook.mjs` |
| Netlify context | **deploy-preview** only | **production** only, guarded |
| Provider mode | Yoco **test** | Yoco **test** |
| Order model | **single business per order** | **one mixed order, separate brand sales** |
| Private storage | `vsh-book-checkouts`, `vsh-book-orders`, `vsh-yoco-book-test-events` Netlify Blobs | `vsh_mixed_*` PostgreSQL tables, **not migrated yet** |
| Event routing | `metadata.checkoutId` → old Blob checkout mapping, optional `metadata.business` | signed `metadata.purpose='vsh-mixed-book-test'`, `metadata.orderId`, strict Yoco checkout/amount/mode match |
| Delivery | **test-only:** no customer emails/downloads | **test-only:** no customer emails/downloads |
| Deployment | Existing PR #2 Deploy Preview may be reachable while deployed | Only GitHub development branch; no customer-facing deployment |
| Secrets | `YOCO_SECRET_KEY` and `YOCO_WEBHOOK_SECRET` in preview deployment | Future `VSH_MIXED_YOCO_TEST_KEY`, `VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET` flags |

**Critical:** The old handler requires the signed Checkout ID to exist in its own `vsh-book-checkouts` store. New mixed-cart checkouts are saved in PostgreSQL, so old code cannot verify or settle them. When both registrations receive a new mixed-cart event, the old handler could return HTTP **503** for missing mapping and Yoco will retry. Do not assume temporary dual registration is harmless. The new webhook deliberately ignores signed old events lacking our purpose marker without DB access; test in `scripts/test-mixed-book-legacy-webhook-isolation.mjs`.

Netlify [Deploy Preview docs](https://docs.netlify.com/deploy/deploy-types/deploy-previews/) say a preview URL remains valid until its deploy is deleted and is tied to PR lifecycle; a stable production hostname is preferable for an eventual merchant webhook.

Yoco's [Checkout API reference](https://developer.yoco.com/api-reference/checkout-api/webhooks/list-webhooks) currently provides **GET list**, **POST register**, and **DELETE**; no documented Checkout API PATCH endpoint to change an existing URL in place. Yoco [recommends one webhook](https://developer.yoco.com/guides/online-payments/webhooks/listen-for-events) and retries non-2xx responses. Registration creates a new `whsec_` secret displayed **only once**, so it must be saved securely at time of registration without posting it in chats/repositories.

## Proposed cutover checklist — do NOT execute without explicit approval

1. **No more test activity on legacy preview** for the cutover window. Confirm no pending test checkout is being paid; inspect Yoco activity and verify old webhook currently responds as expected with isolated TEST notifications.
2. Finish and review the new mixed-cart code: canonical production handler and admin-only test checkout, database schema migration/backups, test-mode secret flags, branded email/PDF delivery locked OFF, and no live customer checkout. Confirm new code is deployed behind disabled flags to **the same existing Netlify project** only after explicit owner approval.
3. Decide in advance how to transition without overlapping unhandled events or lost callbacks, using Yoco's Checkout API docs/support if needed. A planned short cutover may involve registering the permanent new URL under a TEST key and retiring the old subscription with its **actual ID**. An overlap may deliver events to *both* endpoints and trigger retries in old code; weigh this carefully and avoid new test purchases during overlap.
4. If registering a new TEST webhook, use only the TEST key, and save the new signing secret in appropriate Netlify **Functions** environment settings. Keep secret completely out of GitHub, chat, screenshots and Netlify build output. Do not reuse old signing secret or assume it can be fetched from list API.
5. With deployment approved, confirm the permanent URL: `https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-webhook`. Do not point the old webhook at an unpublished function.
6. Confirm exactly one intended TEST registration after cutover via a local **read-only** `GET /api/webhooks` and verify **real Yoco TEST webhook delivery** against a small synthetic test order, test-only Yoco card, exact amount and DB row. Prove no email outbox rows or customer PDF download grants for test orders.
7. Observe Yoco retries/error logs, Netlify DB usage and merchant account state; retain a safe recovery procedure for both unfinished old test orders and future mixed test orders. Reverting website code alone does not undo schema or registered subscriptions.
8. **Do not turn on live payments.** Treat live-key webhook inventory and future live rollout as a separate approval/verification.

## Currently safe and verified

- Single existing project and domain; no second Netlify website.
- TEST webhook registration inventory captured without exposing secrets.
- GitHub branch-only tests simulate signed legacy events and show new handler ignores them; no real Yoco POSTs or money.
- No real Netlify Database migration, Yoco webhook changes, email delivery, or PDF download activation.

**Next release decision requires owner approval, not an implicit "ok" to continue development.**
