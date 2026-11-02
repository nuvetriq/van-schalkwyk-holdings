# Gmail SMTP transport for branded PDF delivery — UNDEPLOYED DRAFT
**Updated: 1 November 2026. No actual Gmail messages, credentials, checkout or database changes.**

## What was prepared
`netlify/lib/mixed-book-gmail-smtp-draft.mjs` adds a server-only Nodemailer 10.3.1 transport adapter that plugs into the already-existing **draft** `dispatchOneMixedBrandEmail` outbox worker. It has not been invoked by a Netlify Function or a scheduler and is off by default.

Both brands use their own existing public mail identities:
- **Granny's:** `grannyspopsandtreats@gmail.com`
- **CleverCubs Learning:** `learningclevercubs@gmail.com`

Each transaction uses `smtp.gmail.com`, implicit TLS port **465**, TLS minimum 1.2 and independent SMTP authentication for the exact brand that owns the sale. The message From identity, recipient syntax, stable outbox Message-ID, length and brand ownership are validated before any transport is created. No attachments are accepted, PDFs remain private, file/URL access are disabled in Nodemailer, and SMTP debug and body logging remain off.

Actual message sending is denied unless **all** of these are set in an approved future Netlify production Functions context:
- The API wrapper explicitly calls `createMixedBookGmailSender({enabled:true,context,...})` from a permitted server-only worker after verified paid **LIVE** order checks.
- `VSH_MIXED_BOOK_EMAIL_ENABLED=true`
- `VSH_MIXED_BOOK_DB_ENABLED=true`
- `VSH_MIXED_BOOK_DOWNLOADS_ENABLED=true`
- `VSH_ENABLE_PAYMENTS=true`
- Per-brand app-password secrets named `VSH_GRANNYS_SMTP_APP_PASSWORD` and `VSH_CLEVERCUBS_SMTP_APP_PASSWORD`, each unique and securely configured in Netlify Functions scope.

**None of these new Gmail SMTP secrets/feature flags were set or changed by the assistant.** Do not paste secrets into GitHub, this chat, a URL, browser console or screenshots. The user should only enter secrets directly into their own Netlify environment UI during a specifically approved release. The existing user-created Gmail App Passwords may need to be reviewed/recreated then.

## What this does and does NOT guarantee
Nodemailer `accepted` recipient and Message-ID checks mean the SMTP provider reported accepting the email, **not** that the customer read it or that it reached an inbox. There is **no universal Gmail exactly-once SMTP idempotency API**. To avoid duplicate deliveries, our outbox moves any timeout, uncertain send, rejected acknowledgment or lost acknowledgment to `unknown` for **manual reconciliation**, never automatic retry. Its deterministic Message-ID helps identify an already-sent message, but is not a deduplication guarantee.

Real outbound sending is still **NOT** connected; no production worker, explicit enablement or release scheduler exists. No developer/Yoco TEST flow sends email. Existing live website remains untouched.

## Test safety
`scripts/test-mixed-book-gmail-smtp-draft.mjs` runs with fake passwords and an injected in-memory transport, plus Nodemailer's **JSON transport** (which makes no network calls). It covers: separate sender credentials, TLS settings, reject cross-brand/forged sender, one recipient only, CR/LF header injection, disabled flags, missing or malformed credentials, stable Message-ID, simulated provider failures and zero public website activation.

`scripts/test-mixed-book-release-gates.mjs` also confirms the SMTP module is not imported by public Netlify Functions and that no brand SMTP passwords or Nodemailer code enter the public website build.

## Before any production email activation
1. Owner expressly approves controlled database migration and site deployment on the **existing** Netlify project, with rollback and cost review.
2. Complete first real Yoco **TEST-mode** checkout/webhook integration while emails and customer PDF download grants are OFF. Existing registered TEST webhook points to older Preview 2; coordinate cutover carefully.
3. Implement a separately reviewed privileged, rate-limited worker invocation/scheduling mechanism (not a public unauthenticated endpoint) with provider-level observability that does not log bearer PDF tokens or credentials.
4. With explicit approval, configure both app passwords in Netlify UI; verify Google allows each account to use SMTP and that each sender identity is accepted; send owner-approved test messages **only to designated test inboxes**.
5. Verify Gmail rate limits, bounces, spam handling, sender reputation, message IDs, idempotent outbox acknowledgments, link expiry, refunds and manual reconciliation for `unknown` cases.
6. Only then plan and approve the **separate LIVE Yoco payment/customer email release**.

Sources: <https://nodemailer.com/smtp> and <https://nodemailer.com/guides/using-gmail>.

**Current release status:** draft and simulations only. No paid checkout, email sent, deployment or Netlify/Yoco changes.
