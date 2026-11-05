# Private large-PDF delivery — implementation plan (DRAFT, NOT LIVE)

## Existing stored format, unchanged
- The production Admin Portal uploads small PDFs to private Blob store `vsh-private-recipe-pdfs`.
- Large PDF uploads (up to **2 GiB**) are kept as **3 MiB parts** under private store `vsh-private-book-parts`, with immutable manifests under `vsh-private-recipe-pdfs`.
- Business prefixes are `grannys/` and `clever-cubs/`; every manifest includes a distinct upload UUID, business, filename, total bytes and part count. No new upload or PDF migration is required.

## Important Netlify limit
Netlify Functions' current documented limit is **20 MB for streamed responses**; returning the full large PDF from one Function is not supported. Each private part read must stay at most 3 MiB and must be a distinct authenticated request. Do **NOT** write a Function that concatenates a 2 GiB PDF and returns it as one response.

## Backend protocol requirements
1. Customer pays for 1+ books from either brand using ONE Yoco charge. A raw signed webhook must be verified and stored; redirects never count as payment.
2. Paid order is reconciled into brand-specific sales and email tasks.
3. Each purchased book gets a cryptographically random, time-limited **download grant**, linked in SQL to (paid order, brand, product ID). Only SHA-256 of token is stored. No secret Blob key appears in the customer's email.
4. Customer receives a brand-specific email with a protected download link. Large-book link should open a **download page** (not the bare PDF endpoint), which can request metadata and then fetch numbered parts.
5. On **every request**, check the token hash, expiry, revoked state, paid **LIVE** order, brand and exact purchased product. `netlify/lib/mixed-book-paid-pdf-reader.mjs` is a server-only helper for that check. Return generic errors so callers cannot enumerate books.
6. `netlify/lib/mixed-book-private-pdf-parts.mjs` validates sealed manifest and exact part index/size, checks stored SHA-256 for each large-book part, and returns at most 3 MiB. Do not disclose private Blob keys or access to whole store.
7. Authentication and download tracking should be rate-limited to stop attackers exhausting network credits; do not cache protected responses in a public CDN.

## Browser delivery design — not yet implemented
- For desktop Chromium browsers, a browser-side downloader can request a user-selected file handle and write each authenticated 3 MiB response **incrementally to disk**; this avoids holding a 2 GiB PDF in RAM.
- Other browsers/mobile devices need a separately tested compatible strategy (e.g. supported streaming-to-file download, or an approved external storage delivery architecture). **Do not claim 2 GiB downloads work across all devices until tested.** A simple browser `Blob` assembled in RAM is NOT an acceptable fallback for multi-gigabyte PDFs.
- Present file name, progress, pause/retry for known parts, expiry and customer-support help. All downloaded bytes must be exactly the original file order; PDF header/EOF and per-part hash are checked.
- The downloader and its endpoint are NOT implemented in this branch yet.

## Cost / release controls
- Netlify Database requires an eligible Credit-based plan, and active databases consume compute/bandwidth credits. PDF downloads also consume web bandwidth and Function compute credits; large files can exhaust a free credit quota quickly. Check actual user plan and intended download volume *before* provisioning or promoting this work.
- Review user request to keep a **single Netlify project**. Do not create a second website; develop on GitHub branch, then release only to existing site with explicit approval.
- No `@netlify/database` package added; no database auto-provisioned or migration activated. The SQL still lives ONLY in `docs/database/mixed-book-orders-DRAFT.sql`.
- Do not turn on Yoco real payments, SMTP, PDF public routes, or emails before signed payment verification, real DB transactional tests, resilient outbox, full browser tests, credit review and rollback checklist.
