# Pre-launch main-site release plan — PR #7
**Prepared:** 5 November 2026. **Status: READY FOR OWNER'S PRE-RELEASE CONFIGURATION CHECK, NOT APPROVED TO MERGE.**

## 1. Owner's updated operating decision
The owner confirmed on 5 November 2026 that the existing **main website** `vanschalkwykholdings.com` is **not yet launched to customers** and may be used as the day-to-day development/testing site. There is **no request for a separate Netlify site**. Later, before opening to paying customers, introduce a deliberately isolated staging environment and stop test-product writes reaching the live catalogue.

Owner also explicitly accepted keeping the existing CleverCubs product **TEST, R70**, which was visibly present in the **live** CleverCubs catalogue on 5 November. Do not edit/delete it as part of this release.

**This acceptance changes the previous preview-Blob-isolation blocker into a documented, temporary pre-launch risk, not a blocker for a disabled code-only release.** It does NOT waive payment, email, PDF, secrets or destructive-migration precautions.

## 2. Confirmed scope
- Release candidate: [Draft PR #7](https://github.com/nuvetriq/van-schalkwyk-holdings/pull/7), `feature/mixed-book-code-review-20261102` targeting existing `main`.
- Approved PR #6 has **already created all six `vsh_mixed_*` tables in production**; no additional schema changes in PR #7 compared with `main`.
- Shared Granny's and CleverCubs digital-book basket: owner verified adding from both brands, grouped subtotals, combined total and removal to zero on Preview #7.
- Granny's replacement hero image and responsive no-beige-gap styling included in PR #7.
- Existing admin, brand websites, Netlify Blobs and uploaded private PDFs must be preserved.
- First production release is **CODE ONLY**: disabled public checkout, disabled Yoco TEST and LIVE payment flows, disabled branded email worker and disabled paid customer PDF delivery.
- Yoco TEST checkout/webhook code in PR #7 has explicit flags, production-origin checks and signing/authentication requirements. However, the first release **must not enable its flags or register a merchant webhook**.
- Existing code still deploys function files even when guarded. Endpoint availability on a URL is not permission to use it or evidence that payment is enabled.

## 3. Verified evidence (read-only)
- Current `main` base recorded as `694a8259743ef4d2c3f8af2bc578e86944ed418d` (prior approved PR #6 migration).
- Latest CI run before updating this document: [42006716099](https://github.com/nuvetriq/van-schalkwyk-holdings/actions/runs/42006716099), successful for `a8343e0ebe0991ee118014d7175482eb3b527245`. Recheck the **final** PR SHA and CI again immediately before any merge.
- PR #7 was draft and unmerged during preparation.
- Production PostgreSQL tables and isolated preview DB were confirmed earlier by owner screenshots. **Netlify Blobs are site-shared through `getStore()`**; the observed TEST product appearing on live site confirms the practical visibility. This is **accepted only while pre-launch**.
- Historical pre-migration scheduled backup (2 November 2026 at 5 AM) has NOT been restore-tested. No restore has been requested.
- No independent verification yet of Netlify's **current** environment-variable values or deploy contexts, Yoco TEST webhook inventory, Gmail credential scopes, or customer-facing external launch state.

## 4. Release-blocking checks before merging
- [ ] Confirm `main` and PR #7 head have not drifted, the final diff is intended, and CI is green for that **exact** commit. Verify existing product admin, Granny's and CleverCubs, Vian, book uploads and public catalogues on the candidate.
- [ ] Confirm the live domain is still pre-launch; the owner has explicitly accepted retaining **TEST** book and shared Blob storage until a later isolation project.
- [ ] Owner inspects **Netlify environment variable names and deploy contexts** without exposing any value. On **production**, the values `VSH_ENABLE_PAYMENTS`, `VSH_MIXED_YOCO_TEST_ENABLED`, `VSH_MIXED_BOOK_EMAIL_ENABLED`, `VSH_MIXED_BOOK_DOWNLOADS_ENABLED` must each be **absent or not "true"**. Also inspect `VSH_MIXED_BOOK_DB_ENABLED`; for the first disabled release, keep it **absent or not "true"** as an extra safeguard. Review other enabled legacy payment handlers separately.
- [ ] Verify no deployed HTTP handler or scheduled function dispatches the new branded email worker or issues new paid download grants. CI checks part of this statically; production settings still need review.
- [ ] Verify the last scheduled production DB backup date and who can restore it. Do not click Restore; code deploy rollback cannot undo DB, Blob or Yoco mutations.
- [ ] Confirm enough Netlify credits and no unintended new site or subscription. The existing Netlify site auto-publishes `main`, so merging is itself a production deployment.
- [ ] Request **explicit separate approval** for merging PR #7 / deploying the exact reviewed SHA to production with all payment/email/download features disabled.
- [ ] Immediately after authorized deployment, check Netlify production status, migration messages (no new schema), existing products, public checkout disabled, and no unexpected outgoing emails or payment events. Stop if unexpected.

## 5. Steps requiring *new, separate* approvals later
**Yoco TEST:** Review current TEST webhook registrations with an owner-approved read-only GET and inspect any old Preview #2 webhook subscription. Registering/deleting/replacing a webhook, enabling TEST-only flags and making a bounded synthetic test payment each require deliberate approval. Never infer live payment authorisation from testing the basket.

**Customer emails and PDF fulfilment:** Test two independently branded customer emails and owner receipts plus private PDF downloads, revoked/expired links and retries only after separate review, with no exposure to real customers.

**Public launch:** Introduce isolated preview storage to prevent preview admin uploads affecting production; remove/unpublish synthetic TEST records only with owner's approval; independently validate live payment, customer email and PDF delivery before public purchases.

## 6. Immediate status and no-go triggers
**Immediate action permitted:** GitHub-only preparation/review of PR #7 and owner-led read-only settings checks. No merge, no Yoco webhook mutation, no test charge, no activated mail or paid download.
Stop if any payment/email/download feature flag is on, a live merchant key is unexpectedly used, production schema changes, backups/recovery are questionable, or the code SHA/test status changes without review.

This document updates the earlier 5 November checklist's *temporary pre-launch Blob-isolation requirement*. All historical security observations are retained in Git history, and the future staging-isolation requirement remains important once customers begin using the website.
