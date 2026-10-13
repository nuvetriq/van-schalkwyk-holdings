# Van Schalkwyk Holdings — Netlify master admin

## What we've built

A separate link at `/admin.html` for the **one master administrator** to manage two business catalogues from one login.

- **Granny's** — create/edit treats AND **recipe books**. The `+ Recipe book` button automatically selects `Recipe Books` as the product category. Add the cover image, title, description, price, and optional format (printed/digital). Published books display in their own `#recipe-books` collection, separately from treat listings; each book has a WhatsApp enquiry link. No payment or book-file delivery happens on the site.
- **Clever Cubs Learning** — create/edit digital book product *listings* with covers, grade and prices. Publish/unpublish. The Clever Cubs checkout **remains test-only**, independently of Granny's recipe-book checkout.
- The two legacy admin links redirect to the shared page, preserving old bookmarks.
- Private admin key and all product modifications are validated server-side in Netlify Functions.
- Product records and image files are stored in separate **Netlify Blobs** site-wide stores. No Supabase, Coolify or Xneelo required.

## Complete the activation in Netlify

1. In the **Van Schalkwyk Holdings Netlify project** open **Project configuration → Environment variables**.
2. Add `VSH_ADMIN_KEY` with a **long, unique randomly generated secret** (at least 32 characters). Set the scope to **Functions** or **All scopes**. Do not use Nuvetriq's admin key; give Holdings its own. Never store it in GitHub, code, screenshots or chat.
3. Save and trigger a new deploy after the feature branch is reviewed and merged (or use a branch deploy specifically configured for this app).
4. Ensure this project deploys the repo via **Netlify Git-based builds** so Functions are bundled and the `@netlify/blobs` package from `package.json` is installed. The `netlify.toml` runs `npm run build`, publishes `dist`, and bundles `netlify/functions` separately. This keeps private sources out of public hosting.
5. Open `https://YOUR-SITE-DOMAIN/admin.html`, enter the key. The key is kept only in the browser tab's `sessionStorage` until the tab/session ends or you sign out.
6. Select **Granny's**; create an **unpublished** test treat. Refresh, edit and verify it remains saved. Publish it to see it in the public treat listing. Then choose **+ Recipe book**, give it a test cover/title/price, save it as a draft, and finally publish. Confirm that it appears **only in Recipe Books** and not in the treats grid. Both product types must retain the correct business.
7. Switch to **Clever Cubs** without signing in again. Create an unpublished book listing, verify isolation, then publish and check its catalogue. **Do not upload paid master PDFs** — only cover images are supported.
8. Sign out and confirm an invalid key cannot access draft products or publish changes. Verify the public endpoint shows only published products.

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
