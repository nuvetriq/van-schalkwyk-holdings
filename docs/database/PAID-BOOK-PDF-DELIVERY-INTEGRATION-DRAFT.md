# Paid digital-book PDF delivery — server-side draft (NOT DEPLOYED)

**Status: development only.** This code is under `feature/shared-mixed-brand-cart`; no production website deployment, database migration, Yoco change or email was performed.

## Overview

A future real successful Yoco payment is stored as **one** mixed-brand order. Each purchased book gets its own database record in `vsh_mixed_download_grants` with **only the SHA-256 token hash**, the exact business/product/order ownership tuple, expiry and optional revocation time. A strong random download token is carried in the customer's private book link; it must never be logged or included in public content.

The new function `netlify/functions/paid-book-download.mjs` accepts one **authenticated PDF part per request** after checking the grant and paid LIVE order with `readAuthorizedPaidBookPart`. It uses `createMixedBookServices().grantStore/orderStore` (Postgres) and `createMixedBookPrivatePdfStore()` (existing site-wide private Netlify Blobs). Every download request rechecks paid status, token expiry, revocation, exact brand/product ownership and stored private file path.

Existing private file layouts are unchanged:
- Small: `vsh-private-recipe-pdfs/<business>/<upload-UUID>.pdf`
- Large PDF manifest: `vsh-private-recipe-pdfs/<business>/<upload-UUID>.manifest.json`
- Large data: `vsh-private-book-parts/<business>/<upload-UUID>/part/00000` etc.

The Netlify Blobs adapter uses documented `getWithMetadata(..., {type:"arrayBuffer"})` for raw bytes and checksum metadata. Private large pieces are verified with SHA-256, byte length, PDF header/final EOF; normal PDFs are limited to one part of 3 MiB. Each response uses `ReadableStream` and contains at most 3 MiB, under Netlify's streamed 20 MiB limit. <**No** direct/public Blob URL or 2 GiB response is generated.>

### Safety gates

The paid download function cannot operate unless:
- The same existing site's canonical `https://vanschalkwykholdings.com` hostname is used.
- Netlify production deploy context is used (never Preview 2).
- `VSH_MIXED_BOOK_DB_ENABLED=true` **AND** `VSH_MIXED_BOOK_DOWNLOADS_ENABLED=true` have been deliberately configured in Netlify Functions. Both are OFF/unset today.
- The saved grant matches an independently loaded **PAID LIVE** order in the database. Yoco TEST payments have no grants and can never pass the paid LIVE check.

It returns `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff` and rate limits; it never sends customer details, SQL snapshot, Blob store keys or download tokens back in JSON. Invalid requests fail closed. No public cart pages link to this function yet.

### Tests

`scripts/test-mixed-book-paid-download-endpoint.mjs` covers one paid 3 MiB recipe part, second EOF part, a small CleverCubs PDF, valid cryptographic token, expired/revoked/refunded/test-only grants, cross-brand PDFs, invalid part numbers, corrupt or oversize bytes, unauthorized origins and disabled mode. These tests run in GitHub CI with **local fake Netlify Blobs**, not with owner-uploaded files. Existing real temporary PostgreSQL tests cover the mixed ledger separately; no production database writes occur.

### Release blockers (do not enable yet)

1. **Browser large-file assembly:** The function returns parts, not a ready-to-click complete 2 GiB download. Implement a same-origin client flow that fetches the pieces sequentially, writes them to disk incrementally with streaming/File System Access where available, and provides a supported fallback for browsers without it. Never buffer 2 GiB in JavaScript.
2. **Email links:** Build a real paid-live transactional grant insertion and branded email outbox/SMTP sender; sending is not connected to the download function. Ensure the token is not lost across a crash and is retrievable under a controlled, privacy-safe strategy; do not store raw tokens in plaintext database/logs. Handle expiring links and support resends.
3. **Privacy/access logs:** Bearer tokens in query-string URLs are sensitive. Audit Netlify/CDN access logging, error collection, link previews, browser history and referrer leakage. Consider a short-lived exchange endpoint + secure cookie, or an authorization-header download flow before launch.
4. **Live checkout/migration:** A reviewed schema migration, provider-verified Yoco success callback, real/TEST segregation, test-key cutover, customer purchase flow and recovery procedures are NOT complete. Do not deploy or enable live purchases until all are approved and tested.
5. **Real-world testing:** With explicit owner's approval, test a real *Yoco test-mode* flow on a controlled deployment and both small and large PDFs of various sizes; check Netlify credit consumption and function log behavior without exposing tokens.
6. **Revocation/refunds:** Define and test refund/payment dispute handling so granting/using links is revoked when an order is refunded or reversed.

References: https://docs.netlify.com/build/data-and-storage/netlify-blobs/ ; https://docs.netlify.com/build/functions/configuration/ ; https://docs.netlify.com/build/functions/api/

The existing production `main` and all site-wide Blob data remain unchanged.
