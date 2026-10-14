# Large private PDF book uploads — Van Schalkwyk Holdings

**Status:** Admin-only upload feature built. This is not a Yoco checkout or customer download service.

## How the uploader works

- Applies to **Granny's Recipe Books** and **CleverCubs Learning PDF books** in the single admin dashboard.
- Choose a PDF file **up to 2 GiB (2,147,483,648 bytes)**.
- Press **Save product**. The browser computes a small file fingerprint then streams 3 MiB chunks through the authenticated Netlify Function `book-upload`, with at most three concurrent requests.
- Each part is checked against a client SHA-256 checksum, with a server-side checksum, exact byte length, valid PDF header and PDF end marker, then saved in a **private** Netlify Blob store.
- The admin displays the completed parts and percentage; **Pause upload** cancels in-flight requests. To resume, stay signed in, select the **same PDF on the same browser/device**, then press **Save product**. The server reports which parts already exist, so previously uploaded parts are skipped.
- After all parts are stored, the server creates a sealed private `.manifest.json` record referencing the chunk keys. The product editor saves only the opaque manifest reference. A missing or forged manifest cannot be published.
- A completed upload is retained across normal Netlify production redeploys. Small (legacy) PDFs stored as single `.pdf` blobs continue to be recognised.
- Expired **unfinished** upload sessions are cleaned up by the daily `book-upload-cleanup` scheduled function, starting after 7 days. Sealed manifests and completed books are explicitly excluded.
- The public product catalogue never includes the manifest path, private part keys, raw book files or upload session information.

## Netlify architecture / size limitations

Netlify Functions have a 6 MB buffered request limit, approximately **4.5 MB effective binary**, so a 500 MB file cannot be POSTed in one request. Each chunk is kept at **3 MiB** to stay below this restriction. Netlify Blobs supports large individual objects, but doesn't provide a native browser-upload API.

- Server: `netlify/functions/book-upload.mjs`, `netlify/functions/book-upload-cleanup.mjs`.
- Browser: `assets/book-uploader.js` and master `assets/admin.js`.
- Stores: `vsh-book-upload-sessions`, `vsh-private-book-parts`, `vsh-private-recipe-pdfs`.
- Production stores are persistent; development Deploy Preview stores remain isolated. The admin key is required on every upload/status request; don't share it.
- Large uploads will consume **Netlify storage, bandwidth, function and Blob operation quotas**. Check Netlify usage before loading many very large books. A 500 MiB PDF requires about 167 upload requests, plus metadata operations.

## Important restrictions

- **This does not yet provide large customer downloads.** Future paid fulfillment must check signed Yoco webhooks and issue expiring per-book download links. It must retrieve/stream the stored chunks only after authorisation, and must not mistake the `.manifest.json` record for a raw PDF.
- **No automatic emails or live Yoco payments are enabled** by this change.
- Do not attach 500 MB+ PDFs to Gmail messages. Use secure, expiring download links for the precise purchased files. Each business's sender email will be configured independently.
- The upload process is designed to resume after connection drops; serverless networks are variable, so test actual 500 MB+ sample files on live Netlify before relying on it for important content.
- Chunks are encrypted at rest by Netlify, but the app's authorization and download-gating logic remains our responsibility.
- Very large files may take some time depending on the internet connection. Keep the admin tab open while uploading; if disconnected, reselect the same file and retry.

## Acceptance tests

- [ ] Log into production admin and upload a 500 MB+ PDF for Granny's as a **draft**.
- [ ] Pause midway, select the same PDF and confirm resume starts from the already uploaded parts.
- [ ] Confirm the progress indicator reaches 100%, then save the product and refresh the page.
- [ ] Verify correct cover, price, description, `Private PDF attached` and published/unpublished state.
- [ ] Switch to CleverCubs Learning and repeat with a different book.
- [ ] Verify anonymous browser requests to the upload and status endpoints return an authorization error.
- [ ] Verify public listings never include the private PDF key; no customer file access is enabled.
- [ ] Verify Netlify Functions logs, storage footprint and cleanup schedule before uploading many books.

Official platform details:
- https://docs.netlify.com/build/functions/configuration/
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
