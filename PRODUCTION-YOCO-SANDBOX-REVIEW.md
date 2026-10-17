# Production-domain R10 Yoco sandbox: isolated release candidate (NOT LIVE)

This branch is based directly on the currently deployed `main` branch, **not** on the unfinished bookshop feature branch. Its only purpose is testing one fixed R10 Yoco TEST payment on vanschalkwykholdings.com.

## Boundaries
- Sandbox is OFF unless `VSH_YOCO_SANDBOX_ENABLED=true` AND `CONTEXT=production` AND the request targets exactly `https://vanschalkwykholdings.com`.
- Requires separate `VSH_YOCO_SANDBOX_TEST_KEY` (`sk_test_`) and `VSH_YOCO_SANDBOX_WEBHOOK_SECRET` (`whsec_`) in Netlify **Production Functions** scope; these are NOT the existing Deploy Preview values. Do not send secrets through GitHub or ChatGPT.
- Server-side checkout and status require the existing private `VSH_ADMIN_KEY`. The publicly reachable webhook must have a valid timestamped Yoco HMAC signature and a matching checkout ID, test mode, currency and fixed amount.
- Uses isolated Blob namespaces `vsh-production-yoco-sandbox-orders` and `vsh-production-yoco-sandbox-checkouts`. No customer PDF, book catalogue, Gmail sender, or existing paid-order code is used.
- NEVER set `VSH_ENABLE_PAYMENTS=true` to test this feature. No live payment, automatic email, download link or PDF is issued by these functions.
- Public HTML test screen has no user order data; protected actions require the admin key.

## Pre-deployment approval checklist
1. Confirm the diff relative to `main` includes only these eight files: 3 sandbox Netlify functions, 2 helper modules, HTML, browser JS and this document. Don't merge the unfinished PR #2.
2. Run `npm run build` and JavaScript syntax checks; test production build's static asset list, including that the sandbox HTML and JS are present but secret server sources are absent. Perform automated/mock webhook tests (valid, invalid, expired, replayed, duplicate, wrong amount, wrong business, wrong checkout).
3. Confirm live canonical domain really is `https://vanschalkwykholdings.com`; update hardcoded exact-origin check before launch if your canonical domain uses `www`.
4. Keep production Yoco sandbox variables absent until approved. Configure them only on the intended Netlify Production deploy context; use **test** credentials, not the live Yoco secret. Register/update the sandbox webhook at `https://vanschalkwykholdings.com/.netlify/functions/yoco-production-sandbox-webhook`; save the returned signing secret in Netlify, not in the repo.
5. Explicitly approve one controlled production deployment, verify public storefronts/admin still work, and only then enable the sandbox flag. Environment updates may require a fresh deploy; plan the settings order to avoid multiple builds.
6. At `/yoco-production-sandbox.html`, authenticate with master admin key, select business, start one R10 test checkout with Yoco's test card, and use the signed verification button on return.
7. Confirm unauthenticated checkout/status -> 401, malformed or unsigned webhook -> 401/400, unrelated events ignored, wrong amount rejected, repeated valid event idempotent, test-only storage isolated and no PDF/email delivery.
8. Disable `VSH_YOCO_SANDBOX_ENABLED` when the checks finish. Live customer purchases remain disabled.

## Constraints
The browser frontend is accessible publicly when deployed, but operations require authentication; do not input other secrets into the frontend. Build/test/deployment are **not yet verified** merely by this GitHub commit. This branch must not be merged without a deliberate release review.
