# Mixed-brand books — code-only candidate (2 November 2026)

**REVIEW BRANCH ONLY. NOT APPROVED TO MERGE OR DEPLOY.**

This branch is based on production `main` at commit `694a8259743ef4d2c3f8af2bc578e86944ed418d`, after owner-approved PR #6.

## Verified by owner screenshots on 2 November 2026
- Netlify production published `main@694a825` at 4:10 PM and displayed **Migrations applied**.
- The production database branch displayed all six `vsh_mixed_*` tables with zero rows.
- An isolated preview database branch also displayed six tables.
- PR #5 is still a draft and is **NOT** authorized for merging.
- A dated 2 November 2026 5:00 AM scheduled backup was visible, but restoring it was not tested.

## Candidate scope
- Reuse the exact six-table migration already present in `main`. **No additional migration file or schema changes**. The baseline guard verifies byte-for-byte equality with the previously reviewed SQL after removing draft-only wrappers.
- Carry forward the shared digital-book basket, guarded admin-only Yoco TEST checkout and signed webhook, order ledger, private download implementation, draft branded email transport, and synthetic tests from the development branch.
- The public basket's Yoco checkout button stays disabled. Test payment endpoints are blocked by required production-context/test-only flags and valid secrets. No email worker has a live HTTP/scheduled invoker.
- CI uses synthetic data and ephemeral PostgreSQL. It does not contact the owner's Netlify database, Yoco or Gmail.

## No-go
- **Do not merge this review branch or PR #5**, publish code to production, alter Netlify environment flags, modify Yoco webhook registrations, initiate a Yoco TEST or LIVE payment, send mail, or grant customer PDF links without separate, explicit owner approval.
- Older documents in `docs/database/` are historical development-stage plans and often say the production migration was unapplied. Those statements are **superseded by this dated record**; do not use them as the current release status.
- Before proposing a controlled code deployment, review CI results, compare all changed files, verify rollback behavior, obtain explicit production-code approval, and separately review merchant/email/download activations.

This note records authorization for GitHub-only development branch preparation, **not** a production deployment.
