/* Audit release instructions, NOT Yoco or Netlify runtime. Neither this
 * script nor the reviewed document performs a network call or DB change.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import {requireApprovedProductionSchemaBaseline} from "./approved-production-schema-baseline.mjs";

const plan=await readFile("docs/database/FIRST-YOCO-TEST-RELEASE-GO-NOGO-CHECKLIST.md","utf8");
const evidence=JSON.parse(await readFile("docs/database/OWNER-NETLIFY-RELEASE-EVIDENCE.json","utf8"));
const checkout=await readFile("netlify/functions/mixed-book-yoco-test-checkout.mjs","utf8");
const webhook=await readFile("netlify/functions/mixed-book-yoco-test-webhook.mjs","utf8");
const site=await readFile("netlify.toml","utf8");

test("Historical first-payment plan remains NO-GO for merchant actions",()=>{
 assert.equal(evidence.release_gate,"NO_GO");
 assert.ok(Object.values(evidence.approvals).every(x=>x===false));
 assert.match(plan,/Current release verdict: NO-GO/);
 assert.match(plan,/separate, explicit/);
 assert.equal(requireApprovedProductionSchemaBaseline(),true);
 assert.equal(existsSync("docs/database/mixed-book-orders-DRAFT.sql"),true);
 assert.doesNotMatch(site,/^\s*VSH_(?:ENABLE_PAYMENTS|MIXED_YOCO_TEST_ENABLED|MIXED_BOOK_DB_ENABLED)\s*=/m);
});
test("Migration, old Yoco webhook and actual backup remain independently gated",()=>{
 assert.match(plan,/Stage A — schema review and isolated preview/);
 assert.match(plan,/Stage B — disabled, controlled production release/);
 assert.match(plan,/Stage C — enable Yoco \*\*TEST only\*\*/);
 assert.match(plan,/Stage D — separate future LIVE release/);
 assert.match(plan,/2 Nov 2026.*5:00 AM/);
 assert.match(plan,/NOT restoration-tested/);
 assert.match(plan,/preview.*database branch is separate from production/i);
 assert.match(plan,/old Blob-only handler could return 503/);
 assert.match(plan,/read-only GET/);
 assert.match(plan,/distinct mutating operations/);
 assert.match(plan,/No new file in this plan goes into/);
});
test("Actual TEST checkout and webhook require production-only TEST flags, LIVE off",()=>{
 for(const source of [checkout,webhook]){
   for(const fragment of [
     'context?.deploy?.context==="production"',
     'env.VSH_MIXED_BOOK_DB_ENABLED==="true"',
     'env.VSH_MIXED_YOCO_TEST_ENABLED==="true"',
     'env.VSH_ENABLE_PAYMENTS!=="true"',
     'VSH_MIXED_YOCO_TEST_KEY',
     'VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET'
   ])assert.ok(source.includes(fragment),fragment);
   assert.doesNotMatch(source,/sk_live_[A-Za-z0-9_-]{12,}/);
 }
 assert.match(checkout,/authStatus/);
 assert.match(webhook,/verifyMixedYocoWebhookEnvelope/);
 assert.match(webhook,/metadata\?\.purpose!=="vsh-mixed-book-test"/);
 assert.match(plan,/ZERO.*customer emails/i);
 assert.match(plan,/ZERO.*private PDF grants/i);
});
test("Plan does not invent a Yoco TEST subscription ID or require secrets in GitHub",()=>{
 assert.doesNotMatch(plan,/sub_[A-Za-z0-9_-]{20,}/);
 assert.doesNotMatch(plan,/sk_test_[A-Za-z0-9_-]{12,}/);
 assert.doesNotMatch(plan,/whsec_[A-Za-z0-9+/]{20,}/);
 assert.match(plan,/never GitHub, chat, console logs or screenshots/);
 assert.match(plan,/No LIVE Yoco API keys/);
});
