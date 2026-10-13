# Van Schalkwyk Holdings — Netlify master admin

## What we've built

A separate link at `/admin.html` for the **one master administrator** to manage two business catalogues from one login.

- **Granny's** — create/edit baked treats and digital **recipe books**. The `+ Recipe book` button selects the `Recipe Books` category. Add book title, description, price, cover and the *private PDF*. Book listings appear only under `#recipe-books` when published. Physical treats remain separate.
- **Clever Cubs Learning** — create/edit **digital PDF books**, with a private PDF file, public cover, grade, category, description and price. Use `+ PDF learning book` inside the same master login. The Clever Cubs cart/checkout **remains test-only**, and no actual paid email fulfillment is enabled.
- The two legacy admin links redirect to the shared page, preserving old bookmarks.
- Private admin key and all product modifications are validated server-side in Netlify Functions.
- Product records, cover images and private book PDFs use **Netlify Blobs**. Production uses persistent site-wide stores; non-production previews use isolated deploy stores, so test changes never touch production catalogues. No Supabase, Coolify or Xneelo required.

## Private PDFs and publishing rules

- **Both businesses:** PDF uploads are limited to 3 MB per file. Files must have a PDF signature and an end-of-file marker, and they are stored in private paths prefixed by `grannys/` or `clever-cubs/`.
- The server verifies the existence and correct business ownership of a private PDF **before saving its product listing**. It rejects a forged path, a wrong-business PDF, or attaching a paid PDF to a normal baked treat.
- A digital book **cannot be published without a private PDF** or if its price is below R1.00. It can be saved as an unpublished draft without one.
- Replacing a PDF saves a new private version. Detaching an old PDF is allowed only when the listing is unpublished. Original private files are retained for future paid-order history.
- The **public API only returns** the book's description, price and whether a PDF exists; it never returns the private file location or original file data. The PDF upload endpoint accepts authenticated POST only, no GET/download route.
- The admin key is never embedded in public HTML/JS. Private product management is enforced in Netlify Functions.
- **Digital checkout and automatic PDF emails are NOT live**, even if products are published as catalogue entries in the draft. Clever Cubs remains test-only and Yoco/email activation needs separate work.
- **Important:** This branch includes unfinished payment features from earlier development. Never merge the whole draft into the live site merely to test the admin dashboard.

## Complete the activation in Netlify

1. In the **Van Schalkwyk Holdings Netlify project** open **Project configuration → Environment variables**.
2. Add `VSH_ADMIN_KEY` with a **long, unique randomly generated secret** (at least 32 characters). Set the scope to **Functions** or **All scopes**. Do not use Nuvetriq's admin key; give Holdings its own. Never store it in GitHub, code, screenshots or chat.
3. Save and trigger a new deploy after the feature branch is reviewed and merged (or use a branch deploy specifically configured for this app).
4. Ensure this project deploys the repo via **Netlify Git-based builds** so Functions are bundled and the `@netlify/blobs` package from `package.json` is installed. The `netlify.toml` runs `npm run build`, publishes `dist`, and bundles `netlify/functions` separately. This keeps private sources out of public hosting.
5. Open `https://YOUR-SITE-DOMAIN/admin.html`, enter the key. The key is kept only in the browser tab's `sessionStorage` until the tab/session ends or you sign out.
6. On an isolated **Deploy Preview**, sign in and select **Granny's**. Create an unpublished test treat and an unpublished recipe book with a cover and private PDF. Confirm the recipe book appears only in the recipe-books section if published, not among baked treats.
7. Without signing in again, switch to **Clever Cubs**. Select **+ PDF learning book**, add a cover, grade, price and private PDF, then save as a draft. Check that editing, replacing and detaching the PDF all work. Publishing without a PDF or with a price below R1.00 must be rejected.
8. Verify a direct GET to `/.netlify/functions/book-pdf` cannot download book files (HTTP 405), an anonymous POST gets HTTP 401, and a public product listing does not expose `pdf_path`.
9. Verify no Granny's book can be attached to Clever Cubs and vice versa. Confirm public API hides draft products entirely.
10. Check the admin works on phone/desktop, that product edits persist during that single Deploy Preview, and that the live site remains unchanged. (Deploy Preview data is intentionally ephemeral and may be reset by a new preview deployment.)

11. Sign out and confirm an invalid key cannot access draft products or publish changes. Verify the public endpoint shows only published products.

## Paths

- Login page: `/admin.html`
- Admin API: `/.netlify/functions/admin-products`
- Product images: `/.netlify/functions/product-image`
- Secret server environment variable: `VSH_ADMIN_KEY`
- Persistent product store: `vsh-products`
- Persistent image store: `vsh-product-images`

## Security and limitations

- **The URL is not the security barrier**. The Functions verify the key for all private reads and all writes. Anonymous users only see published products.
- Use HTTPS and a password manager to store the key. In this first version the key is presented to the server on each admin request using the `X-Admin-Key` header, like Nuvetriq's private-key flow; it is **not** an email/password account and does not provide per-user accounts, MFA, or audit logs.
- For multiple staff logins, upgrade to individual user sessions with multi-factor authentication later.
- Photos: JPG, PNG and WebP only, up to **3 MB**. They are public when their unguessable URL is known. Never upload private documents or customer information.
- Netlify Blobs stores are **site-wide and shared across deploy contexts**. Use only drafts and dummy test products in branch previews; changes in a preview can persist into production stores if the same site is used. Product keys are per-item, reducing simultaneous edit conflicts.
- No deletion action is implemented. Hide an item by toggling off Published. Recipe books are identified by category `Recipe Books` (case-insensitive) rather than a separate user account or database.
- Recipe book listings are for enquiries only. Do NOT upload a digital recipe book master file into the public photo bucket; only cover images are supported.\n- Granny's recipe PDF payment and email features have been coded in the draft branch, but are **not deployed, configured or production tested**. Read [RECIPE-BOOK-PAYMENTS.md](RECIPE-BOOK-PAYMENTS.md) before activating Yoco. Clever Cubs payment is still test-only. Product details are not an inventory or accounting system.
- This feature is deliberately isolated on branch `feature/unified-product-admin`. It has not been merged into the live `main` branch or deployed/tested on Netlify yet.

## Granny's private recipe books and automated fulfillment

Recipe books now support a private PDF upload (max 3 MB), one basket for up to 4 books, server-side Yoco checkout, a signed webhook receiver and automatic email of paid PDFs. Select **+ Recipe book** in the Granny's dashboard, upload the cover AND the PDF, then publish.

**Payment is not active until Yoco and email secrets have been configured and tested.** Please see [RECIPE-BOOK-PAYMENTS.md](RECIPE-BOOK-PAYMENTS.md) for activation, testing, privacy and reliability notes.

## Development status — shared admin PDF upgrades

The private upload handler and product validation now support **both** businesses. Mocked backend tests passed for authenticated uploads, PDF verification, publication requirements, business isolation, draft visibility and forbidden public downloads. **No real file upload to Netlify and no real email/payment has been tested in this work yet**. Review the preview before any isolated admin-only production release.
