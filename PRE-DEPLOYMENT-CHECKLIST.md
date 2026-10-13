# Van Schalkwyk Holdings — Pre-deployment checklist

Last updated: 13 October 2026
Status: **NOT READY TO DEPLOY** — complete and test this checklist before merging the draft GitHub branch into `main` or updating the live Netlify site.

## Project decisions
- **Hosting:** Netlify for Nuvetriq and Van Schalkwyk Holdings (do not plan around Coolify or Xneelo).
- **Source:** GitHub repository `nuvetriq/van-schalkwyk-holdings`; active draft branch `feature/unified-product-admin`; draft PR #2.
- **One master admin:** A separate `/admin.html` link and one private admin key, with a switcher for **Granny's** and **Clever Cubs Learning**. No staff accounts needed for now.
- **Digital book sales:** Both Granny's **recipe books** and Clever Cubs **learning books** will be downloadable **PDFs only**. After a customer pays for one or several books in a basket, **automatically email ONLY the exact PDFs purchased** to the address provided at checkout. This must work independently for each business, including branding and customer messaging.
- **Payment provider:** Yoco Checkout, server-side price calculation and secure webhook verification.
- **Holdings assistant:** Vian, a cute nerdy robot with glasses and clipboard. Vian should know the Holdings businesses (Granny's, Clever Cubs, Nuvetriq, PurEss, Cricut) while **remaining only on the Van Schalkwyk Holdings website**. Nia remains the separate Nuvetriq assistant.

## Work before deployment

### 1. [ ] Complete the shared admin login
Current status: **Code drafted; not deployed or live-verified.**
- [ ] Configure a distinct `VSH_ADMIN_KEY` privately in the Holdings **Netlify** project; do not place secrets in GitHub or chat.
- [ ] Verify login, logout, session behaviour and that unauthorised visitors cannot edit or view drafts.
- [ ] Confirm one login can switch between Granny's and Clever Cubs without logging in again.
- [ ] Verify product creation/editing, image uploads, categories, prices, publish/unpublish and persistence after refresh.
- [ ] Support private master PDF upload for **both** businesses, with safe validation; never expose books through public links.
- [ ] Verify only published products appear on the appropriate public site.

### 2. [ ] Complete Granny's recipe book catalogue
Current status: **Section and basic admin category drafted; not live-tested.**
- [ ] Keep the dedicated Recipe Books area and navigation link separate from physical treats.
- [ ] Add actual PDF books via master admin, including cover, title, description, price, book type/format and private PDF.
- [ ] Verify layout on desktop and mobile, empty state, and links/buttons.
- [ ] Physical treats retain WhatsApp enquiries; PDF recipe books use the digital checkout.

### 3. [ ] Complete Clever Cubs digital PDF bookshop
Current status: **Test catalogue/cart already existed. Must extend secure file upload, real checkout and delivery.**
- [ ] Support secure, private master PDFs uploaded through the shared admin for Clever Cubs books.
- [ ] Enable adding any combination of published books to a cart, with clear item prices and totals.
- [ ] Replace the test checkout with paid Yoco Checkout.
- [ ] Ensure the email contains **only the books purchased**, not other items in the catalogue.
- [ ] Clear test/demo products once real titles are approved; preserve relevant existing school/grade categories.
- [ ] Test different combinations and quantities per supported basket model; avoid mixing Granny's and Clever Cubs orders unless explicitly designed later.

### 4. [ ] Connect Yoco checkout for both brands
Current status: **Granny's draft code exists; production configuration and shared/brand-specific design are outstanding.**
- [ ] Verify the merchant account, website domain and test/live API access with Yoco.
- [ ] Configure Yoco test API key and test webhook secret **server-side in Netlify**; never include secrets in browser code.
- [ ] Ensure order total is computed from server-stored product records, not user-editable prices.
- [ ] Use hosted checkout and validate signed payment webhooks, checkout ID, amount, currency and payment status.
- [ ] Record transactions and prevent duplicate charges or duplicate processing; implement reliable durable order storage and idempotent delivery.
- [ ] Run end-to-end test purchases for **Granny's AND Clever Cubs** and only then switch to live Yoco credentials.

### 5. [ ] Automatic emails with purchased PDF attachments
Current status: **Granny's prototype drafted; Clever Cubs not yet implemented; no real email delivery tested.**
- [ ] Choose and configure the sending method in Netlify (verified sender or each business's Gmail app password).
- [ ] Keep PDFs in private storage, not in public assets or public Netlify URLs.
- [ ] After verified payment, email the PDF attachments matching that order's exact purchased items.
- [ ] Send branded order email, receipt/confirmation details and helpful support information.
- [ ] Use reliable delivery tracking, duplicate-webhook protection and retries if email sending fails.
- [ ] Test 1-book, multi-book, failed/cancelled payment, wrong email, large attachment and duplicate webhook scenarios.
- [ ] Update privacy/POPIA wording for handling customer names, email addresses and order records.

### 6. [ ] Build Vian, the Holdings AI assistant
Current status: **Design/name discussed; not integrated yet.**
- [ ] Finalise Vian robot design, positioning, greeting and UI.
- [ ] Write/maintain accurate knowledge for all five businesses: Granny's, Clever Cubs Learning, Nuvetriq, PurEss (coming soon) and Cricut (coming soon).
- [ ] Vian appears **only on the Holdings website**, not on the individual business sites; Nia stays with Nuvetriq.
- [ ] Answer questions and direct visitors to correct pages and business contact details.
- [ ] Secure API credentials server-side, apply usage limits and test mobile/desktop behaviour.

### 7. [ ] SEO for all three websites/pages
Current status: **Existing metadata varies; comprehensive review needed.**
- [ ] Review **Van Schalkwyk Holdings** homepage and business directory SEO.
- [ ] Review **Granny's** page SEO, including treats and recipe book collection.
- [ ] Review **Clever Cubs Learning** SEO, including CAPS-aligned learning books and grade categories.
- [ ] Add appropriate unique titles, meta descriptions, page headings, canonical URLs, Open Graph/social sharing tags and accessible image descriptions.
- [ ] Add appropriate structured data, sitemap/robots coverage, mobile performance and indexing checks.
- [ ] Confirm no-index for admin, checkout callback/order status pages and private URLs.
- [ ] Verify final public domain/URLs and no broken links.

### 8. [ ] Final pre-launch QA and approval
- [ ] Netlify builds/functions and private storage work in the correct environment.
- [ ] No API keys or PDF masters are exposed in public files.
- [ ] All site flows checked on desktop and mobile.
- [ ] Test Yoco payments, email delivery and cart behaviour for both brands end-to-end.
- [ ] Check customer support, order recovery/refund procedures and POPIA requirements.
- [ ] Review branding, business details and coming-soon pages.
- [ ] Complete all outstanding checklist items, then approve merge/deployment of GitHub draft PR #2.

## Notes for the next session

Do **not** assume drafted code has been deployed, configured or proven in production. Start by checking this checklist and the GitHub draft PR: https://github.com/nuvetriq/van-schalkwyk-holdings/pull/2

Related setup notes: `ADMIN-SETUP.md` and `RECIPE-BOOK-PAYMENTS.md`. The current recipe Yoco/email prototype is for Granny's, and **must be extended securely to Clever Cubs** before launch.
