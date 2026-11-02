# Secure email worker invocation and review plan — DRAFT ONLY
**1 November 2026. Nothing deployed or scheduled. No real Gmail emails, Yoco events, database migrations, or changes to live website.**

## Recommended activation architecture — after explicit owner approval

**Do not expose an email sender through an ordinary public HTTP Function or website button.** For a later owner-approved rollout, prefer a **Netlify Scheduled Function** within the existing Holdings site which calls the existing `createControlledMixedBookEmailWorker(...).runOne()` at a deliberately low, bounded cadence. Official Netlify documentation states scheduled functions on published deployments are not directly callable by URL; an operator can use Netlify's Functions **Run now** control. Scheduled Functions use UTC cron, have a 30-second execution limit, and only run automatically on **published** deployments, so adding a scheduled function today would be an unapproved live operational change. **No schedule or Netlify function was added.**

Reference: https://docs.netlify.com/build/functions/scheduled-functions/

## Built now (server-only, disabled)

The new `netlify/lib/mixed-book-email-operator-review.mjs` provides a **read-only inspection** of the draft outbox. There is NO default export, public endpoint, schedule, automated execution, SMTP dependency, or payment mutation. To even create it, a privileged server-side caller must deliberately pass `enabled:true`, `operatorApproved:true`, `context.deploy.context='production'`, and two future explicit flags `VSH_MIXED_BOOK_DB_ENABLED=true` and `VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED=true`.

Its only database operation is a grouped PostgreSQL **SELECT**:
- includes **LIVE**-mode orders (but not Yoco TEST orders);
- groups by `business`, `kind`, `outbox status`, and `order status`;
- reports counts only: total, eligible pending/retry for paid orders, ambiguous/expired-lease jobs needing manual reconciliation, and jobs attached to nonpaid/refunded orders;
- never returns names, email addresses, order IDs, payment references, message bodies, claim tokens, private paths or bearer links;
- does not claim rows, update counts, release leases or trigger mail;
- sanitizes database failures before returning errors.

The email worker itself stays at `netlify/lib/mixed-book-email-worker-draft.mjs`, protected by separate LIVE-only flags and private brand SMTP app-password readiness, and still has **no Function invoker**. A generic `ok` in the chat does not count as approval for any deployment or real send.

## Rollout gates to review separately

1. **Pre-release:** Back up the existing Netlify project, review database storage/credits/migration and domain binding, verify full synthetic CI, and explicitly authorize schema migration. Keep draft SQL in `docs/database/mixed-book-orders-DRAFT.sql` until then.
2. **Yoco TEST:** Preserve existing TEST registration at older Deploy Preview 2 until controlled cutover. Set up a stable endpoint only with explicit owner approval; send a small Yoco TEST payment; ensure signed verified TEST events **never enqueue LIVE mail or PDF grants**.
3. **Operator preview:** After explicit approval, expose only an authenticated operator-controlled internal mechanism to call the read-only preview. If inspection shows unknown jobs or expired claims, halt/reconcile rather than auto-resend.
4. **Brand account verification:** Configure Gmail app passwords and server HMAC key **in Netlify secure environment variables, Functions scope, production context only** after explicit approval. Confirm sender login, rates and two test recipients without using customer data. Do not put secret values in GitHub, chat, public JS, screenshots or build logs. Netlify documentation says `netlify.toml` variables are not available to Functions as secrets and secret changes may need redeployment.
5. **Privileged execution:** Build/review a small scheduled-function handler for the one existing site, with server-side approval switches, exactly **one** outbox job per invocation, limited execution time, sanitized metrics and error alerts. Do not expose job selection or `operatorApproved` through a public request parameter. Review `Run now` permissions and logging. Require explicit owner approval to publish the schedule.
6. **Partial failures:** A provider timeout or lost acknowledgment is marked `unknown` (never automatic retry). Expired claimed jobs also need quarantine. Reconcile message IDs in sender Gmail before deciding about any manual resend. SMTP accepted does **not** mean email reached inbox and deterministic Message-ID alone cannot provide exactly-once delivery.
7. **Live release:** Enable LIVE payment/email/download flags separately with owner consent after testing chargeback/refund revocation, 2 GiB download behavior, links and sender deliverability. Launch requires a separate final go/no-go decision.
8. **Emergency stop:** The proposed `VSH_MIXED_BOOK_EMAIL_ENABLED` flag and schedule must support an operational stop with a separately documented procedure. Removing a schedule or changing environment may require a new deployment; **do not assume** an instantaneous stop without testing. Keep reconciliation and existing customer obligations in view.

References:
- https://docs.netlify.com/build/functions/scheduled-functions/
- https://docs.netlify.com/build/functions/environment-variables/

## CI verification

- `scripts/test-mixed-book-email-operator-review.mjs`: simulated SQL checks for default-deny, wrong context/flags, no private fields, grouped counts, expired/unknown/blocked statuses, invalid data and sanitized errors.
- `scripts/test-mixed-book-real-email-operator-review.mjs`: synthetic records in disposable GitHub PostgreSQL 16, read-only preview before/after inserting data in a **rolled-back** transaction; verifies Yoco TEST records are excluded and rows remain unclaimed.
- `scripts/test-mixed-book-release-gates.mjs`: requires the review module to stay disabled, non-mutating and absent from Netlify HTTP Functions and public assets.
- No GitHub CI test connects to real Netlify Database, Gmail or Yoco.

**Next implementation decision:** Owner must separately approve the future production-safe invocation mechanism and deployment strategy. Do not add `config.schedule` or a new handler in `netlify/functions` until then.
