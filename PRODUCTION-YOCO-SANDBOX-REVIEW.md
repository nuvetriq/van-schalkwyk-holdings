# PROPOSED: Yoco R10 test on the public Holdings domain — NOT LIVE

**Status:** Code prepared for review only. Do not merge or deploy until explicitly approved.
**Branch:** feature/production-domain-yoco-sandbox-prep (based on the unfinished bookshop branch).
**Current production main does NOT include the unfinished books checkout flow.**

## Safety boundary
- Fixed R10 (1,000 cents), ZAR, Yoco TEST key only; never read the production live Yoco key.
- Only \`https://vanschalkwykholdings.com\` and the published Netlify production context can run it.
- Three separate **production-context-only** environment variables are required:
  - \`VSH_YOCO_SANDBOX_ENABLED=true\` (keep false/missing until approved)
  - \`VSH_YOCO_SANDBOX_TEST_KEY=sk_test_...\` (secret)
  - \`VSH_YOCO_SANDBOX_WEBHOOK_SECRET=whsec_...\` (secret)
- Do not reuse \`YOCO_SECRET_KEY\` or change \`VSH_ENABLE_PAYMENTS\`. Keep \`VSH_ENABLE_PAYMENTS\` false/missing for launch.
- Test data uses dedicated stores: \`vsh-production-yoco-sandbox-orders\` and \`vsh-production-yoco-sandbox-checkouts\`. No private PDF storage or customer orders touched.
- Checkout and status require existing \`VSH_ADMIN_KEY\`. Public webhook validates raw Yoco HMAC signature (±3-minute timestamp) and stored checkout ID, test status, amount and currency.
- No email, PDF download, live paid status, or public product checkout is reachable from this sandbox.
- No buyer name, email or other PII is captured by the sandbox.
- One publicly readable HTML test page exists at \`/yoco-production-sandbox.html\` but operations require server-side admin authorization; public users cannot create orders.
- An isolated test webhook is reachable at \`/.netlify/functions/yoco-production-sandbox-webhook\`; it is designed to ignore unrelated signed test payments.

## Manual release steps — ONLY after review and explicit approval
1. Confirm the full development branch (not only these sandbox files) is safe to merge to production. Existing preview features must be audited.
2. Review this branch's diff and build locally with \`npm run build\` and \`npm run check\`; add automated tests for malformed, replayed, mismatched and duplicate signed webhooks.
3. In Netlify production context (Functions scope), configure **only the new sandbox variables**, using the TEST key and test webhook secret. The current keys in *Deploy Previews* do not automatically apply to production. Keep \`VSH_YOCO_SANDBOX_ENABLED\` unset/false until you are ready to test.
4. Before registering Yoco, deploy reviewed code to production in ONE controlled publication. Do not merge unreviewed PRs or click 'Publish deploy' indiscriminately.
5. Enable \`VSH_YOCO_SANDBOX_ENABLED=true\` and redeploy if required for the environment change. To avoid extra builds, configure the switch before the planned controlled deploy, **only after code review**.
6. Register or update a TEST webhook to \`https://vanschalkwykholdings.com/.netlify/functions/yoco-production-sandbox-webhook\`, saving the associated \`whsec_\` secret. If rotating the secret, update the sandbox secret variable and allow Netlify to reload it.
7. Sign in to \`https://vanschalkwykholdings.com/admin.html\` then open \`/yoco-production-sandbox.html\`; choose either business and start one R10 TEST checkout. Use Yoco's test card, not a real card.
8. After redirect, click **Check signed payment verification**. Require success with \`testPaymentVerified=true\` and \`emailSent=false\`/\`pdfDelivered=false\`. Check webhook logs for 401, 400, 503 if pending.
9. Verify a second business separately only after the first works. Verify a request without admin key is 401, arbitrary checkout requests cannot change R10, wrong webhook signatures are 401, public PDFs remain protected and unrelated events are ignored.
10. Re-disable \`VSH_YOCO_SANDBOX_ENABLED\` after the test and stop using the sandbox webhook. Keep test order records isolated.

**Not a production payment launch.** Real commerce will require a separate approved release of actual customer checkout, per-brand email senders, fulfilment, refunds, and security testing.

## Cost caution
This branch is NOT linked to Pull Request #2; do not open a PR until you want a preview build. Depending on your Netlify settings, a branch push could still trigger a Branch Deploy. Watch Netlify Deploys and keep the production branch untouched.
