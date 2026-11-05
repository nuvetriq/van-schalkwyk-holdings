# Netlify Database connector — development release gate

Status: **development branch only; NO migration applied to production**.

This project already has **one manually provisioned Netlify Database** attached to the existing `van-schalkwyk-holdings` Netlify project. The owner's screenshots confirmed its production branch, sleep after 5 minutes, and active credit-based billing. No second website or database is needed.

## Implemented on feature/shared-mixed-brand-cart

- `package.json` installs official `@netlify/database` ^2.0.1.
- `netlify/lib/mixed-book-db-runtime.mjs` accesses `getDatabase().pool` and uses Netlify's branch-specific managed credentials without copying connection strings. **Off by default** unless `VSH_MIXED_BOOK_DB_ENABLED=true` is deliberately configured server-side. Only recognised Netlify production/deploy-preview contexts can request it.
- `netlify/lib/mixed-book-db-service.mjs` wires the existing mixed-brand pending-order, checkout binding and signed-payment settlement ledger to this pool, and returns brand-scoped paid sales plus grant/order read adapters.
- `netlify/lib/mixed-book-db-reads.mjs` queries by `order_id` AND `business`, returns only the specified brand's PDF lines, and requires a paid live master order for brand-sale retrieval. Access control of a caller still must be verified independently: these are **private server helpers**, not public endpoints.
- `scripts/test-mixed-book-db-adapters.mjs` verifies disabled mode, context gating, separate brand records, parameterised lookups and no migration directory.
- GitHub Actions runs disposable PostgreSQL 16 and a separate real-client integration test, without accessing the user's Netlify Database or requiring their secrets.

## Not yet activated

- The draft SQL remains at `docs/database/mixed-book-orders-DRAFT.sql`, **NOT** in `netlify/database/migrations/`. Netlify automatically runs migrations from that directory on deployments. Moving it there is a production schema change and requires an explicit release review.
- No deployed Netlify Function imports this new service; no payment handler, email worker or paid-PDF download endpoint is exposed.
- The Netlify dashboard does not yet contain `VSH_MIXED_BOOK_DB_ENABLED=true`; leave OFF. Do not enter database credentials in GitHub or chat, and do not enable personal access token full permissions.
- Yoco customer payments and automatic branded emails remain OFF.
- Existing product records, uploaded PDFs, admin login and the live storefront are unchanged.

## Controlled release sequence (later)

1. Confirm the real client integration test and all current suites pass; audit snapshot reconciliation, webhook signature verification and brand access.
2. Review database resource usage/credits and migration rollback strategy. The draft adds only new `vsh_mixed_*` tables and should not mutate existing Netlify Blob storage.
3. Once the full live checkout and customer download flows are ready, separately approve a backwards-compatible `netlify/database/migrations/<timestamp>_create_mixed_book_tables.sql`.
4. Check that the Netlify deployment's migration succeeds, that its production database is healthy, and that old pages/admin still work **with customer purchases disabled**.
5. Enable restricted server-side flags and test Yoco sandbox + signed callback, brand emails and large PDF download before approving real customer sales. Keep a rollback procedure.
6. Keep purchased credits and auto-recharge settings under review; data storage and compute consumption have ongoing costs.

Reference: https://docs.netlify.com/build/data-and-storage/netlify-database/api/ and https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/
