# Production-domain R10 Yoco sandbox: isolated release candidate (NOT LIVE)

This branch is based directly on the currently deployed `main` branch, **not** on the unfinished bookshop feature branch. Its only purpose is testing one fixed R10 Yoco TEST payment on vanschalkwykholdings.com.

## Boundaries
- Sandbox is OFF unless `VSH_YOCO_SANDBOX_ENABLED=true`, Netlify supplies `context.deploy.context === "production"`, and the request targets exactly `https://vanschalkwykholdings.com`. Do not rely on build-only `process.env.CONTEXT` in Functions.
- Requires separate `VSH_YOCO_SANDBOX_TEST_KEY` (`sk_test_`) and `VSH_YOCO_SANDBOX_WEBHOOK_SECRET` (`whsec_`) in Netlify **Production Functions** scope; these are NOT the existing Deploy Preview values. Do not send secrets through GitHub or ChatGPT.
- Server-side checkout and status require the existing private `VSH_ADMIN_KEY`. The publicly reachable webhook must have a valid timestamped Yoco HMAC signature and a matching checkout ID, test mode, currency and fixed amount.
- Uses isolated Blob namespaces `vsh-production-yoco-sandbox-orders` and `vsh-production-yoco-sandbox-checkouts`. No customer PDF, book catalogue, Gmail sender, or existing paid-order code is used.
- NEVER set `VSH_ENABLE_PAYMENTS=true` to test this feature. No live payment, automatic email, download link or PDF is issued by these functions.
- Public HTML test screen has no user order data; protected actions require the admin key.

## Pre-deployment approval checklist
1. Confirm the diff relative to `main` includes only the 10 expected files: 3 sandbox Netlify functions, 2 helper modules, HTML, browser JS, this document, a Node test script and a GitHub Actions workflow. Don't merge unfinished PR #2. Don't merge the unfinished PR #2.
2. Automated Node 22 build, real HMAC signature tests, sandbox runtime gating, JavaScript syntax and static-output containment completed successfully in [isolated GitHub Actions run #40829256293](https://github.com/nuvetriq/van-schalkwyk-holdings/actions/runs/40829256293). This is not a live Yoco or deployed Netlify integration test. Before deployment, add/verify realistic end-to-end signed webhook order-matching tests (duplicates, wrong amount/business/checkout, races and failure paths) against the real Function integration.
3. Confirm live canonical domain really is `https://vanschalkwykholdings.com`; update hardcoded exact-origin check before launch if your canonical domain uses `www`.
4. Keep production Yoco sandbox variables absent and `VSH_YOCO_SANDBOX_ENABLED` unset/false until explicitly approved. Configure `VSH_YOCO_SANDBOX_TEST_KEY` (`sk_test_`) and `VSH_YOCO_SANDBOX_WEBHOOK_SECRET` (`whsec_`) as **separate secrets** in the intended Netlify **Production, Functions** context (never in GitHub/chat). Confirm Yoco is using the test account. Register/update the sandbox webhook at `https://vanschalkwykholdings.com/.netlify/functions/yoco-production-sandbox-webhook` only when the intended receiving function is publicly reachable; save the returned signing secret privately. Never reuse a live key or set `VSH_ENABLE_PAYMENTS=true`.
5. Explicitly approve one controlled production deployment, verify public storefronts/admin still work, and only then enable the sandbox flag. Environment updates may require a fresh deploy; plan the settings order to avoid multiple builds.
6. At `/yoco-production-sandbox.html`, authenticate with master admin key, select business, start one R10 test checkout with Yoco's test card, and use the signed verification button on return.
7. Confirm unauthenticated checkout/status -> 401, malformed or unsigned webhook -> 401/400, unrelated events ignored, wrong amount rejected, repeated valid event idempotent, test-only storage isolated and no PDF/email delivery.
8. Disable `VSH_YOCO_SANDBOX_ENABLED` when the checks finish. Live customer purchases remain disabled.

## Constraints
The browser frontend is accessible publicly when deployed, but operations require authentication; do not input other secrets into the frontend. GitHub build/tests are **verified** for the isolated branch. Production-domain deployment, Netlify Functions access, secret configuration, actual webhook delivery, signed payment matching and Yoco sandbox checkout are **NOT verified**. The default branch and live checkout/payment settings remain unchanged. No new customer email or PDF delivery was enabled. This branch must not be merged without a deliberate release review.
