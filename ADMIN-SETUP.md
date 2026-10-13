# Shared Van Schalkwyk Holdings admin — setup

The new `admin.html` is a **single master login** with an in-dashboard business switcher for **Granny's** and **Clever Cubs**. It provides product create/edit/publish, optional image upload, category, size/grade, and prices. No ability to delete records is exposed.

## Current deployment status

The interface and supporting SQL have been committed on `feature/unified-product-admin`, deliberately not deployed to `main`. **There is no functioning login until Supabase is configured.** Neither a password nor a Supabase secret/service-role key belongs in the repo.

## Connect the secure backend

1. Create a Supabase project at https://supabase.com/dashboard and note its **Project URL** and **publishable / anon key** in Settings → API Keys. These are intended for browser use and do NOT grant administrative rights on their own.
2. In SQL Editor, run `supabase/setup.sql`. This creates product and admin tables, row-level security (RLS) policies and a **public, images-only** bucket named `product-images`.
3. Under Authentication → Users, create/invite the one master admin user with a strong unique password. For now, turn off public email/password registration (Auth → Providers/Settings as appropriate). Enable MFA when available.
4. Run the final commented `insert into public.admin_users ...` statement from `setup.sql`, replacing the example email with the email of the account just created. Check that one row was inserted. This role is **assigned server-side**, never by a public registration form.
5. In `assets/admin-config.js`, add the Supabase project URL and **publishable / anon key**. Do not add a service_role / secret key, database password or login password. RLS is what prevents outsiders from changing products.
6. Test by opening `admin.html`: sign in, switch between the businesses, create an unpublished product, and then publish it. The catalogue/product display should be connected to Supabase on both storefronts before merging into `main`.
7. After testing, review and merge the feature branch into `main` to deploy with your existing website hosting workflow.

## Security and limits

- The dashboard's page itself can be opened by anyone; only the verified master user can **read drafts or write products**. HTML `noindex` is NOT authentication.
- Public shoppers can only read products whose `is_active` is true.
- The product-images bucket is public for photographs only. Never upload private digital books or customer information to it.
- Live checkout, Yoco payment verification, customer records, and secure book download links have not been implemented. The Clever Cubs cart remains a **test-order preview**.
- Replacing an image uploads a new object; stale images can be cleaned up later by an authenticated maintenance workflow.
- Adding future staff accounts requires deliberate updates to the database role model and policies; the current policy is intentionally master-only.
