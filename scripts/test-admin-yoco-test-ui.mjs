import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");
const page=read("admin-yoco-test.html");
const script=read("assets/admin-yoco-test.js");
const admin=read("admin.html");
const cart=read("assets/shared-book-cart.js");

test("Only authenticated dashboard links to a separate administrator-only lab",()=>{
  assert.match(admin,/<section id="dashboard" hidden/);
  assert.match(admin,/href="admin-yoco-test\.html"/);
  assert.match(page,/<meta name="robots" content="noindex,nofollow">/);
  assert.match(page,/id="no-admin"/);
  assert.match(page,/id="test-workspace" hidden/);
  assert.match(script,/sessionStorage\.getItem\("vsh_master_admin_key"\)/);
  assert.match(script,/headers\.set\("X-Admin-Key", adminKey\)/);
  assert.match(script,/if \(!adminKey\) \{\s*showLogin\(\);/);
  assert.doesNotMatch(cart,/mixed-book-yoco-test-checkout/);
});

test("Checkout requires two eligible private PDF books, example data, acknowledgement, and human confirmation",()=>{
  assert.match(script,/product\.is_active !== true \|\| !product\.pdf_path/);
  assert.match(script,/business === "grannys"/);
  assert.match(page,/id="test-grannys".*required/);
  assert.match(page,/id="test-clever".*required/);
  assert.match(page,/id="test-confirm" type="checkbox" required/);
  assert.match(script,/window\.confirm\(/);
  assert.match(script,/if \(!confirmed\) return;/);
  assert.match(script,/created = true; \/\/ One checkout per page load/);
  assert.match(script,/method: "POST"/);
  assert.match(script,/business: "grannys", id: a\.id/);
  assert.match(script,/business: "clever-cubs", id: b\.id/);
  assert.match(script,/loadCatalogue\(\);/);
  assert.doesNotMatch(script,/setInterval|setTimeout\(.*submit|\.click\(\)/);
});

test("Only an official Yoco HTTPS TEST checkout is shown; payment is verified by read-only status",()=>{
  assert.match(script,/url\.protocol !== "https:" \|\| url\.hostname !== "c\.yoco\.com"/);
  assert.match(script,/data\.processingMode !== "test" \|\| data\.paymentVerified !== false/);
  assert.match(script,/data\.currency !== "ZAR"/);
  assert.match(script,/status === "paid"/);
  assert.match(script,/testPaymentVerified === true/);
  assert.match(script,/customerDeliveryEnabled !== false/);
  assert.match(page,/target="_blank" rel="noopener noreferrer" hidden/);
  assert.match(page,/id="test-check-status".*disabled/);
  assert.doesNotMatch(page+script,/sk_live_|whsec_[A-Za-z0-9+/]{20,}/);
});

test("Built site includes admin lab but no public cart checkout activation",()=>{
  assert.match(read("dist/admin-yoco-test.html"),/TEST checkout lab/);
  assert.match(read("dist/assets/admin-yoco-test.js"),/X-Admin-Key/);
  assert.match(read("dist/assets/admin-yoco-test.css"),/test-notice/);
  assert.match(read("dist/assets/shared-book-cart.js"),/checkout\.disabled=true/);
});
