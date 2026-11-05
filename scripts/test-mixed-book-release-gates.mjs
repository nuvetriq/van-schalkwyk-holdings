/* Release safety gates: this branch MUST remain non-customer-facing.
 *
 * A passing CI build is NOT approval to merge or publish. This test checks
 * the repository before any controlled Netlify production migration.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync, readdirSync,readFileSync} from "node:fs";
import path from "node:path";
import {requireApprovedProductionSchemaBaseline} from "./approved-production-schema-baseline.mjs";

const read=name=>readFileSync(name,"utf8");
const expectedTables=[
  "vsh_mixed_orders","vsh_mixed_order_lines",
  "vsh_mixed_brand_sales","vsh_mixed_payment_events",
  "vsh_mixed_email_outbox","vsh_mixed_download_grants"
];
const checkout=read("netlify/functions/mixed-book-yoco-test-checkout.mjs");
const webhook=read("netlify/functions/mixed-book-yoco-test-webhook.mjs");
const statusPage=read("netlify/functions/mixed-book-yoco-test-order-status.mjs");
const pdfDownload=read("netlify/functions/paid-book-download.mjs");
const emailDispatch=read("netlify/lib/mixed-book-brand-email-dispatch-draft.mjs");
const smtpDraft=read("netlify/lib/mixed-book-gmail-smtp-draft.mjs");
const workerDraft=read("netlify/lib/mixed-book-email-worker-draft.mjs");
const operatorReview=read("netlify/lib/mixed-book-email-operator-review.mjs");
const privateLink=read("netlify/lib/mixed-book-paid-grant-service.mjs");
const schema=read("docs/database/mixed-book-orders-DRAFT.sql");
const site=read("netlify.toml");
const tree=(dir,base=dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const name=path.join(dir,e.name);
  return e.isDirectory()?tree(name,base):[name];
});

test("Only the previously approved production migration remains present and unchanged",()=>{
  assert.equal(requireApprovedProductionSchemaBaseline(),true);
  assert.equal(existsSync("docs/database/mixed-book-orders-DRAFT.sql"),true);
  assert.match(schema,/DRAFT ONLY/);
  for(const table of expectedTables)
    assert.match(schema,new RegExp("\\bCREATE TABLE "+table+"\\b"));
  const declares=[...schema.matchAll(/\bCREATE TABLE ([a-z_]+)\s*\(/g)]
    .map(x=>x[1]);
  assert.deepEqual(declares,expectedTables);
  assert.doesNotMatch(schema,/\b(?:DROP|TRUNCATE|DELETE FROM|ALTER TABLE|UPDATE)\b/i);
  assert.doesNotMatch(site,/netlify\/database\/migrations/);
});
test("Production build stays public-only without leaked customer PDF or SQL server code",()=>{
  const files=tree("dist");
  assert.ok(files.length>5);
  assert.ok(files.every(f=>!/\.(?:sql|env|pem|key|mjs|map)$/i.test(f)));
  assert.ok(files.every(f=>!/(?:private|netlify|database|functions|scripts)/i.test(f)));
  assert.ok(files.every(f=>f.startsWith("dist/")));
  const publicFiles=files.filter(f=>/\.(?:html|js|css)$/i.test(f));
  for(const f of publicFiles){
    const content=read(f);
    assert.doesNotMatch(content,/sk_(?:live|test)_[A-Za-z0-9_-]{15,}/);
    assert.doesNotMatch(content,/whsec_[A-Za-z0-9+/]{15,}/);
    assert.doesNotMatch(content,/vshlk_[A-Za-z0-9+/]{43}=/);
    assert.doesNotMatch(content,/VSH_(?:GRANNYS|CLEVERCUBS)_SMTP_APP_PASSWORD/);
    assert.doesNotMatch(content,/nodemailer/);

    assert.doesNotMatch(content,/postgres(?:ql)?:\/\/[^ \n"'<>]+/i);
  }
});
test("Both Yoco endpoints are disabled until explicit test flags and database setup",()=>{
  for(const source of [checkout,webhook,statusPage]){
    assert.match(source,/VSH_MIXED_BOOK_DB_ENABLED\s*===\s*"true"/);
    assert.match(source,/VSH_MIXED_YOCO_TEST_ENABLED\s*===\s*"true"/);
    assert.match(source,/VSH_ENABLE_PAYMENTS\s*!==\s*"true"/);
    assert.match(source,/context\s*===\s*"production"/);
    assert.match(source,/\.origin===/);
    assert.match(source,/^export default /m);
    assert.doesNotMatch(source,/sk_live_[A-Za-z0-9]{15,}/);
  }
  assert.match(checkout,/authStatus/);
  assert.match(webhook,/verifyMixedYocoWebhookEnvelope/);
  assert.match(webhook,/handleMixedBookYocoTestEvent/);
  assert.match(checkout,/rateLimit/);
  assert.match(statusPage,/authStatus/);
  assert.match(statusPage,/loadYocoTestOrder/);
  assert.match(pdfDownload,/VSH_MIXED_BOOK_DB_ENABLED\s*===\s*"true"/);
  assert.match(pdfDownload,/VSH_MIXED_BOOK_DOWNLOADS_ENABLED\s*===\s*"true"/);
  assert.match(pdfDownload,/context\s*===\s*"production"/);
  assert.match(pdfDownload,/readAuthorizedPaidBookPart/);
  assert.match(pdfDownload,/Cross-Origin-Resource-Policy/);
  assert.doesNotMatch(pdfDownload,/payments\.yoco\.com/);
  assert.doesNotMatch(pdfDownload,/getStore\("vsh-products"\)/);
  assert.match(emailDispatch,/enabled=false/);
  assert.match(emailDispatch,/claimMixedBookEmail/);
  assert.match(emailDispatch,/holdMixedEmailUnknown/);
  assert.match(smtpDraft,/enabled=false/);
  assert.match(workerDraft,/operatorApproved=false/);
  assert.match(workerDraft,/enabled=false/);
  assert.doesNotMatch(workerDraft,/export default async function handler/);
  assert.match(operatorReview,/enabled=false,operatorApproved=false/);
  assert.match(operatorReview,/VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED/);
  assert.doesNotMatch(operatorReview,/dispatchOneMixedBrandEmail/);
  assert.doesNotMatch(operatorReview,/UPDATE vsh_mixed_email_outbox/);
  assert.doesNotMatch(site,/VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED/);
  assert.match(smtpDraft,/VSH_MIXED_BOOK_EMAIL_ENABLED/);
  assert.match(smtpDraft,/VSH_ENABLE_PAYMENTS/);
  assert.match(smtpDraft,/smtp\.gmail\.com/);
  assert.doesNotMatch(site,/VSH_MIXED_BOOK_EMAIL_ENABLED/);

  assert.match(privateLink,/VSH_MIXED_BOOK_LINK_KEY/);
  assert.doesNotMatch(emailDispatch,/smtp\.gmail\.com/);
  assert.doesNotMatch(emailDispatch,/https:\/\/payments\.yoco\.com/);
  assert.doesNotMatch(site,/VSH_MIXED_BOOK_LINK_KEY/);
  for(const name of tree("netlify/functions")){
    const source=read(name);
    assert.doesNotMatch(source,/dispatchOneMixedBrandEmail/,
      "No deployed HTTP handler may invoke draft email dispatch");
    assert.doesNotMatch(source,/ensureCommittedPaidBookLinks/,
      "No unapproved HTTP handler may create paid book links");
    assert.doesNotMatch(source,/mixed-book-gmail-smtp-draft/,
      "No deployed HTTP handler may import draft SMTP");
    assert.doesNotMatch(source,/createMixedBookGmailSender/,
      "No deployed HTTP handler may send branded mail");
    assert.doesNotMatch(source,/mixed-book-email-worker-draft/,
      "No unapproved HTTP handler may import email worker");
    assert.doesNotMatch(source,/createControlledMixedBookEmailWorker/,
      "No unapproved HTTP handler may run email worker");
    assert.doesNotMatch(source,/mixed-book-email-operator-review/,
      "Operator preview must never be a public Netlify Function");
    assert.doesNotMatch(source,/createMixedBookEmailOperatorReview/,
      "Operator preview may not be invoked by HTTP");



  }

  assert.doesNotMatch(statusPage,/payments\.yoco\.com/);
});
test("No checkout function added to public cart or Netlify config enables payments",()=>{
  const assets=[
    read("assets/shared-book-cart.js"),
    read("assets/shared-book-cart-core.js"),
    read("assets/clever-cubs-shop.js")
  ].join("\n");
  assert.doesNotMatch(assets,/mixed-book-yoco-test-(?:checkout|webhook)/);
  assert.doesNotMatch(assets,/VSH_MIXED_YOCO_TEST_ENABLED/);
  assert.doesNotMatch(assets,/paid-book-download/);
  assert.doesNotMatch(assets,/VSH_MIXED_BOOK_DOWNLOADS_ENABLED/);

  assert.doesNotMatch(site,/^\s*VSH_(?:ENABLE_PAYMENTS|MIXED_YOCO_TEST_ENABLED|MIXED_BOOK_DB_ENABLED)\s*=/m);
  assert.match(site,/publish\s*=\s*"dist"/);
});
test("No actual production checkout or payment webhook is reachable from the new public pages",()=>{
  for(const file of ["dist/grannys-little-bakery.html",
     "dist/clever-cubs-learning.html"]){
    const page=read(file);
    assert.doesNotMatch(page,/mixed-book-yoco-test-(?:checkout|webhook)/);
  }
  assert.ok(!existsSync("netlify/functions/mixed-book-yoco-live-checkout.mjs"));
  assert.ok(!existsSync("netlify/functions/mixed-book-yoco-live-webhook.mjs"));
});
