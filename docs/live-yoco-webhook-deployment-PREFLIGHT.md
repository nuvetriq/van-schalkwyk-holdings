# LIVE Yoco webhook deployment preflight — REVIEW ONLY

**Status: NO-GO / NOT AUTHORISED.** This is a preparation checklist, not an instruction to activate payments. The owner must explicitly approve deployment and any later release separately.

As reviewed on 17 November 2026, Draft PR #11 includes a LIVE webhook HTTP handler, but `main` does **not**. The existing Yoco subscription shown to the owner is **TEST mode** and must be left unchanged. A passing GitHub Actions or Netlify preview build is not permission to merge.

## Verified boundaries

- Production website: `https://vanschalkwykholdings.com`.
- Candidate LIVE callback, **only after publishing the reviewed function**:
  `https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-live-webhook`
- Source: `netlify/functions/mixed-book-yoco-live-webhook.mjs`.
- Current PR: `https://github.com/nuvetriq/van-schalkwyk-holdings/pull/11`, draft, unmerged.
- The handler is fail-closed. It requires the production deployment context, LIVE Yoco key, a matching LIVE signing secret and three independent flags: `VSH_MIXED_BOOK_DB_ENABLED=true`, `VSH_MIXED_YOCO_LIVE_ENABLED=true`, `VSH_ENABLE_PAYMENTS=true`, while TEST mode must not be enabled.
- The customer-facing checkout is controlled separately by `VSH_MIXED_BOOK_PUBLIC_CHECKOUT_ENABLED` and a **hardcoded OFF switch** in the public cart. Email dispatch, secure PDFs and scheduled delivery have additional independent OFF-by-default controls.
- A deployment with payments OFF is **not** proof that a LIVE signed payment can be settled or delivered. The disabled webhook will reject POST requests with HTTP 503; do not claim successful end-to-end verification.

## Before any publish (owner approval required)

1. Review PR #11 in full, especially the fact that **merging also installs a scheduled function** configured to wake periodically (although its delivery operation remains disabled). Confirm operational and billing implications. Do not describe this as a webhook-only deployment.
2. Check the GitHub CI and Netlify preview at the exact reviewed commit; confirm draft code contains no hardcoded credentials.
3. Confirm the database backup and approved schema state independently; do not run migrations merely to register a webhook.
4. Obtain the owner's **explicit approval for the complete code-only production deployment**, with all payment, public checkout, email and download activation flags remaining OFF.
5. Publish only through the approved GitHub/Netlify workflow. Do not create another permanent Netlify site or modify computer-local Nuvetriq projects.

## Yoco LIVE registration — later, separate approval

1. Confirm the LIVE callback has actually been deployed at the verified domain and the owner has separately approved webhook registration. Do not register a callback that points to a missing path.
2. Use Yoco's official `GET /api/webhooks` with LIVE credentials to re-check existing subscriptions. Preserve the previously registered TEST-mode subscription; do not delete or update it.
3. Register exactly one new LIVE Checkout API webhook through Yoco's official `POST /api/webhooks`, with a recognisable name (for example, `Van Schalkwyk Holdings — Book LIVE`), the actual published callback URL, and only `payment.succeeded` unless broader events are explicitly approved. **Do not place real API keys in the JSON body.** The account/key determines mode; verify the returned `mode` is `live`.
4. Yoco returns a `whsec_...` signing secret **only once**. Immediately save it in an approved secure password manager and in Netlify's **masked Production-only** environment variable `VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET`, without exposing it in screenshots, GitHub, logs, chat or source code. Do not confuse this with `VSH_MIXED_BOOK_LINK_KEY`, which signs paid PDF links.
5. While settlement flags remain OFF, expect HTTP 503 from the disabled webhook; this is an intentional security condition, **not** a successful webhook-delivery test. Do not use paid orders to test a disabled endpoint. Before any real orders are accepted, obtain a separate owner-approved, controlled release of all necessary gates and reconcile a verified provider webhook and full email/PDF fulfilment path.

## Final release safety checks (still NO-GO until satisfied)

- Payment webhook HMAC-SHA256 checked against the untouched raw body, signed ID and timestamp; timestamp freshness bounded. Reject unsigned, mismatched, unrelated, TEST and duplicate events.
- Resolve Yoco's signed `checkoutId` only through a **durably bound** LIVE order. Reconcile amount, currency, payment ID and status against stored server-authored order information. Browser redirect is never proof of payment.
- Confirm one mixed payment creates **separate** Granny's and CleverCubs sales and outbox tasks, with no duplicate sends; quarantine unknown SMTP results for manual reconciliation.
- Confirm branded sender identities and safe private signed PDF grants. A working real-provider test, including verified payment and delivery, has **not yet occurred**.
- Customer checkout activation requires a separate approved code change to the browser's hardcoded OFF switch, plus controlled Production configuration. Until then, show `Yoco checkout coming soon`.

## Rollback and emergency stop

- Keep `VSH_ENABLE_PAYMENTS=false`, `VSH_MIXED_YOCO_LIVE_ENABLED=false`, `VSH_MIXED_BOOK_PUBLIC_CHECKOUT_ENABLED=false`, and `VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED=false` through prelaunch.
- If anything appears unsafe after a later launch, turn customer checkout OFF first; keep sufficient ability to **reconcile already accepted paid orders** before disabling their webhook/delivery. Never abandon paid customers or silently retry ambiguous emails.
- Do not delete LIVE webhook registrations or rotate keys without a documented, owner-approved recovery plan; changing signing secrets can invalidate existing links or verification.
- No real LIVE charge, automatic customer email, or customer PDF grant is authorised by this document.

Official Yoco guidance:
- https://developer.yoco.com/api-reference/checkout-api/webhooks/register-webhook
- https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
