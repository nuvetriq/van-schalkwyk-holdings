# Van Schalkwyk Holdings — production-code release safety checklist
**Prepared:** 5 November 2026. **Decision: NO-GO for production code or payment activation.**
**Scope:** Read-only review and documentation of draft PR #7. This document is **not** permission to merge/deploy, alter Netlify settings, edit or remove product records, change a Yoco webhook, initiate a charge, send customer email, or grant private PDF access.

## 1. Verified baseline (read-only)
- Repo: `nuvetriq/van-schalkwyk-holdings`; existing site `vanschalkwykholdings.com`. Continue using the **single** existing Netlify site, not a duplicate.
- Production `main`: `694a8259743ef4d2c3f8af2bc578e86944ed418d`. Owner screenshot on 2 Nov 2026 shows production deploy published, migrations applied.
- The already-approved PR #6 added exactly six `vsh_mixed_*` PostgreSQL tables; the production database browser showed all six with zero records on 2 Nov. Reconfirm before any release, because screenshots are historical evidence.
- Draft PR #7: `feature/mixed-book-code-review-20261102`. Reviewed head before this documentation commit: `ff812c5e4c7b8943152865109c6c9761d8803a02`. Remains **draft, unmerged**. Its application code does not change existing Netlify DB migration files compared with `main`.
- Latest reviewed CI run [42004082882](https://github.com/nuvetriq/van-schalkwyk-holdings/actions/runs/42004082882) **passed** on `ff812c5`; review any subsequent commit's new CI results before releasing.
- Owner manually verified in Deploy Preview #7: Granny's and CleverCubs books share one basket; per-brand subtotals and combined totals update; removing books reduces total to zero; public Yoco button is disabled.
- The six-table **Preview #7 PostgreSQL** branch is separate from production. This isolation **does not imply Netlify Blobs isolation**.

## 2. Critical blocker: preview writes affect site-wide Netlify Blobs
**STOP before further preview admin uploads, publishes, edits, or deletes.**
- Code `netlify/lib/catalogue-store.mjs` calls `getStore()`, *not* `getDeployStore()`. Netlify documents `getStore()` as site-scoped, shared across production and previews: https://docs.netlify.com/build/data-and-storage/netlify-blobs/ and https://www.netlify.com/knowledge-base/why-your-deploy-preview-can-delete-netlify-blobs-data/ .
- `netlify/functions/admin-products.mjs` writes `vsh-products` through that helper; `product-image.mjs`, `recipe-pdf.mjs`, and `book-upload.mjs` also write site-wide Blobs. A preview admin operation can therefore affect live listings or private upload storage despite the separate PostgreSQL branch.
- The CleverCubs product **TEST (R70)** was visible to the owner in Preview #7. Whether it is also published on production is **unverified**. Owner should inspect the **public live CleverCubs catalogue only** (no editor action). Do not assume the synthetic product is isolated or remove it without explicit approval.
- Before a controlled production release, design and test a solution that protects site-wide Blobs from preview **writes** (e.g. restrict state-changing admin/upload routes by deploy context, or explicitly isolate preview stores with careful handling of read-only production catalogue tests). Confirm reading existing real products still works. Review cleanup/function side effects and prevent accidental production alterations.
- A test product must not be treated as a real sale item; plan owner-approved cleanup only after identifying the exact record and evaluating its links.

## 3. Preflight checklist — all blocking until independently verified
- [ ] Verify the owner-reviewed PR #7 head SHA, latest successful CI tests, preview result, and complete code diff. Confirm PR #5 remains untouched and PR #7 is still draft; no extra migration SQL files or edits.
- [ ] Fix/mitigate preview-to-production Blob writes, then verify safeguards with preview-only tests. Confirm whether `TEST` is on live CleverCubs and obtain explicit approval for any change to it.
- [ ] Owner inspect Netlify environment-variable **names, contexts, and whether values exist**, without sharing secret values or screenshots revealing them. Confirm production and preview scopes; verify `VSH_ENABLE_PAYMENTS`, `VSH_MIXED_BOOK_DB_ENABLED`, `VSH_MIXED_YOCO_TEST_ENABLED`, `VSH_MIXED_BOOK_EMAIL_ENABLED`, `VSH_MIXED_BOOK_DOWNLOADS_ENABLED`, and any operator-send triggers are OFF or absent for the first code release.
- [ ] Verify production build's existing admin, uploads, public Granny's/CleverCubs catalogues and Vian still behave normally; use read-only checks first. No TEST payment endpoint needs to be activated to do this.
- [ ] Recheck Netlify's currently available dated production **database backup** and recovery owner before release. The 2 Nov 2026 5:00 AM scheduled backup was observed but **not restored/tested**. Never click Restore merely to check; know that restoring a deploy does not restore Postgres or Netlify Blobs.
- [ ] Confirm active credits, current preview branches, deployment auto-publish from `main`, and planned rollback owner. Do not enable new paid services or another Netlify project.
- [ ] Verify that production `main` contains exactly the approved migration file and that its six tables and existing data are intact. Netlify applies migrations as part of publish: https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/ .
- [ ] Document initial customer-facing checkout state: the shared-cart button remains **disabled**; there is no live customer checkout yet. Existing admin-only Yoco TEST functions are production-origin/context locked and require explicit feature flags and TEST credentials.
- [ ] Record the correct test plan and separate approvals for merchant actions. Older Yoco TEST webhook inventory reportedly pointed to **Deploy Preview #2**, but this is historical/unverified: use an owner-run **read-only Yoco TEST GET inventory** when authorized. Do not create, overwrite or remove subscriptions merely to inspect.
- [ ] Confirm no automatic customer email worker is deployed/triggered and no PDF grant/download mechanism is activated; ensure multi-brand emails are tested only offline/synthetically.
- [ ] Owner gives **separate, specific approval** for the exact production code commit and deployment after blockers are cleared; no `ok` or preview approval counts as production authorization.

## 4. Release stages — approvals are independent
1. **A: Review-only (current):** GitHub audit, checklist, isolated preview of static/client flows and disposable DB. Never write to site-wide Blob stores in preview.
2. **B: Disabled production code release (future; separate explicit approval):** After all blockers, deploy the exact reviewed commit to the existing site with Yoco TEST/LIVE, customer emails and PDF delivery disabled; verify no regression and previous schema unchanged. Netlify currently auto-publishes merges to `main`.
3. **C: Controlled Yoco TEST (future; another explicit approval):** Reconcile current TEST webhook via read-only inventory; separately authorize any registration/deletion, configuration flags and one bounded synthetic test transaction. Verify signed event, matching stored TEST order, correct ZAR cents and duplicate handling, **zero emails**, **zero PDF grants**, **zero LIVE charges**.
4. **D: Customer delivery and LIVE checkout (later separate reviews):** Verify secure PDF grants, two brand-specific sender emails and owner receipts on a mixed-brand order, refunds/revocation, errors and retries; require independent authorization before any public launch.

## 5. Stop/rollback rules
- Stop on: accidental preview Blob writes, unexpected published TEST listing, mismatch between checked SHA and deploy SHA, new database migration, unsupported recovery/backup status, unintended activated env flag, non-TEST Yoco key, stale webhook, customer email, PDF grant, or unknown transaction.
- For a code-only release, reverting Netlify code may restore code behavior but **does not reverse database migrations**, paid events, Yoco webhook registrations, or Blob writes. Do not assume `Restore` is a safe fix. Preserve immutable evidence and seek owner approval before any rollback that mutates data or merchant state.
- Never send Netlify access tokens, Yoco keys, Gmail app passwords, private PDF links or personal customer details through chat or GitHub.

**Release verdict as of 5 Nov 2026: NO-GO.** This file is documentation only on the draft preview branch; no owner-approved production change has occurred.
