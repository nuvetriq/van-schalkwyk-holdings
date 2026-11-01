# Mixed-book database migration review — 2026-11-01
**Status: REVIEWED DRAFT, NOT A DEPLOYMENT.** No SQL has been placed in `netlify/database/migrations/` and the owner's existing Netlify production database has not been modified.

## What the draft changes
`docs/database/mixed-book-orders-DRAFT.sql` creates ONLY six new tables with prefix `vsh_mixed_`:
1. `orders`: one Yoco master checkout, test/live mode, immutable server-price snapshot, state and unique checkout/payment IDs.
2. `order_lines`: business-keyed purchased books with authoritative cents and private PDF paths; no duplicate licence within a brand.
3. `brand_sales`: per-business subtotals for one master order; protected by compound foreign keys.
4. `payment_events`: unique Yoco event ID for deduplication and a reference to its master order.
5. `email_outbox`: unique `(order_id,business,kind)` messages for branded delivery/owner notices, with an explicit `unknown` state for uncertain sends.
6. `download_grants`: hashed, expiring/revocable private link tokens with a compound FK to the exact purchased book and brand.

No existing `vsh-products`, `vsh-private-recipe-pdfs`, `vsh-private-book-parts` Blob stores or admin users are altered. The same Yoco merchant account receives ONE combined charge; business sales are internal ledger entries, not two independent Yoco charges.

## Verified on disposable PostgreSQL 16
- DDL successfully executed in GitHub Actions' temporary PostgreSQL service.
- One synthetic paid order, two independent brand sales, four separate email outbox rows and one matching download grant insert correctly.
- Uniqueness checks reject duplicate event IDs and email tasks; compound FK rejects a cross-brand download grant.
- Client-side tests exercise transactional rollback and a repeated payment event with no new email tasks.
- These tests **do not** mean the application is production-ready. No live migration or large-file browser/email delivery has been exercised.

## Release blockers and design risks
- **Yoco test callback**: the signed webhook must contain a Yoco-generated checkout ID (Yoco documents `payload.metadata.checkoutId`). If absent, fail closed pending independently verified provider association; do not infer from `orderId`.
- **Test vs live**: real email outbox delivery and download grants must remain inaccessible to test orders; never enable `VSH_ENABLE_PAYMENTS=true` as part of test rollout.
- **PII**: customer name/email exist in order columns and JSON snapshots and some outbox payloads. Before live sales, confirm POPIA retention, erasure, access control, logs, incident response and admin access partitioning.
- **Outbox**: a committed pending job does not mean an email was sent. A provider timeout after initiating a send must be quarantined as `unknown` pending manual reconciliation; do not blindly resend.
- **Large PDFs**: up to 2 GiB need protected, per-part streaming and browser compatibility testing; cannot return a 2 GiB PDF from a single Netlify Function.
- **Operational load**: credit-based database compute/bandwidth plus function/download bandwidth and storage need monitoring. Account has prepaid credits; do not auto-recharge or provision additional resources without approval.
- **Reconciliation**: test real refund/reversal handling, failed payments and customer payment receipt separately; schema alone does not implement these actions.

## Controlled migration proposal (NOT executed)
1. Obtain explicit approval before updating production `main` or applying any migration. Confirm Netlify Database production branch, 7-day backups, free space, and a recovery/export strategy.
2. Resolve the release blockers and run all GitHub CI suites from a stable reviewed commit; verify Yoco TEST signature and checkout association with real provider sandbox data.
3. Review an additive, idempotent (where practical) timestamped SQL migration under `netlify/database/migrations/`. Netlify automatically runs migrations immediately before publishing production deploys and on deploy previews (see https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/).
4. Deploy with customer payments, download delivery and SMTP disabled. Verify the six new tables only; inspect log errors and known-good previous storefront/admin functionality. Remember that reverting code alone does NOT necessarily revert database schema.
5. Only then enable the strict admin-only Yoco TEST checkout and webhook in production context with separate test secrets; verify one charge produces one verified test-paid order and **zero real emails or PDFs**.
6. Test full mail/PDF/customer flow separately, including cross-brand privacy and browser downloads, before offering any live customer checkout.

**Conclusion:** additive draft schema is structurally feasible and verified in ephemeral PostgreSQL, but production migration is explicitly withheld until release approval and operational prerequisites are met.
