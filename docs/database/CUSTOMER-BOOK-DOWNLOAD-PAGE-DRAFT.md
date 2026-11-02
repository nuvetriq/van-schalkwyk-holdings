# Customer PDF download page and privacy hardening — development draft

**Status:** UNMERGED and UNDEPLOYED on \`feature/shared-mixed-brand-cart\`; no Netlify schema migration, Yoco registration, payment, grant insertion, email dispatch or live file access has occurred.

## New customer flow

1. After a future **verified LIVE Yoco** payment, a separately approved fulfilment worker must store one hashed, 48-hour download grant for each purchased book. The sender then includes a private link such as \`https://vanschalkwykholdings.com/book-download.html#token=<random-43-character-token>\` in the **correct brand's** customer email. The encrypted/hashed token database persistence and email worker are NOT yet wired.
2. The static \`book-download.html\` page loads only first-party CSS and ES modules, uses restrictive CSP and \`Referrer-Policy: no-referrer\`. It captures the URL **fragment** in memory and immediately clears it from the address bar/history with \`history.replaceState\`. Fragments are not sent to HTTP servers in normal URL requests. Do not use query-string token links any more.
3. On a user click, a capable desktop browser invokes \`showSaveFilePicker()\` **before awaiting any network operation**, because the API requires user activation. Then it fetches **one 3 MiB PDF part at a time** using a private \`POST /.netlify/functions/paid-book-download\`: Authorization \`Bearer <token>\` header, body \`{"part":0}\` etc, \`cache:no-store\`, \`credentials:omit\`, and no referrer/redirects. Each verified part is written directly to disk and memory is released before the next part. No 2 GiB Blob is constructed.
4. The server rechecks the hashed grant, expiry, revocation, exact brand/book and **PAID LIVE** DB order for EVERY part, verifies metadata/checksum/header/EOF, and streams at most 3 MiB. It rejects token query strings, unexpected origin, malformed JSON parts, unsupported methods and overly large requests. It emits only count/size/part-index headers, never private Blob paths or DB details.
5. Browsers without a compatible File System Access API can download a **single small PDF (one part, up to 3 MiB)** as a Blob. For multi-part books, they show a clear compatibility message and do not buffer the whole PDF. In currently supported Chrome/Edge desktop, the user can choose the destination file. Closing/aborting after a bad part calls the writable's \`abort()\`.
6. The download page and core are NOT linked to or activated by the public Granny's or CleverCubs cart. The customer Yoco checkout remains disabled. The paid PDF function is independently disabled unless \`VSH_MIXED_BOOK_DB_ENABLED=true\` and \`VSH_MIXED_BOOK_DOWNLOADS_ENABLED=true\` are explicitly configured later.

## What was changed in GitHub

- \`assets/book-download-core.js\`: pure, testable bounded POST-part fetch, validates returned count/size/length/index, PDF header and final EOF, writes parts sequentially to the browser's disk writer, handles abort; single-part Blob fallback only
- \`assets/book-download.js\`: page/controller with immediate fragment scrub, user-click picker, progress, cancellation and error messages
- \`assets/book-download.css\` and \`book-download.html\`: private single-purpose book delivery UI
- \`netlify/functions/paid-book-download.mjs\`: converted the previously unshipped GET-with-query-token API to **POST with an Authorization header** and strict JSON body
- \`netlify/lib/mixed-book-download-grants.mjs\`: issue fragment-only email URLs pointing at the download page
- \`netlify/lib/mixed-book-email-templates.mjs\`: require new same-origin fragment-only URLs and reject old direct endpoint links
- \`scripts/test-mixed-book-paid-download-endpoint.mjs\`, \`scripts/test-mixed-book-download-grants.mjs\` and \`scripts/test-mixed-book-email-outbox.mjs\`: updated to the new interface
- \`scripts/test-paid-book-browser-download.mjs\`: 10 browser-core tests covering fragment handling, no URL token, POST integrity, 2-part sequential disk save, small fallback, missing file, cancelled/expired token, header mismatch and no customer checkout activation

## Remaining blockers before customer usage

- Need a securely implemented **real paid-live token persistence and brand-separated outbox email worker** with idempotency, retry, reliable recovery and protections against disclosing tokens in logs.
- Need real user acceptance tests in multiple browsers on one **approved** deployment, especially file picker, cancellation, slow network, file integrity and large book downloads. The new function still cannot process actual customer orders until DB migration and environment release.
- Need live payment controls, verified Yoco webhook mapping, refund/dispute revocation, and the carefully planned old TEST webhook cutover. **No approval has been given to deploy or alter merchant settings.**
- Consider browser support: File System Access's save picker is not universally supported, so the large-file flow is intentionally desktop-browser specific. A broader mobile and Safari solution remains a separate design task; do not claim universal 2 GiB support.
- Netlify response streaming size limit is 20 MiB and individual requests use only 3 MiB; browser disk capacity, download reliability and per-IP rate limits need real tests. Credits and storage traffic may have costs.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker and https://docs.netlify.com/build/functions/api/

The existing live site, customers, products and privately uploaded PDFs are untouched.
