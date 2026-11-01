/* Protect EXISTING Yoco TEST registration on PR #2 during a future cutover.
 *
 * Owner's read-only GET /api/webhooks showed one TEST subscription:
 *   Van Schalkwyk Holdings - Book Test
 *   deploy-preview-2--van-schalkwyk-holdings.netlify.app
 *   /.netlify/functions/yoco-books-webhook
 *
 * Old single-brand events contain orderId, business, checkoutId metadata and
 * are recorded in Netlify Blobs. New mixed-brand events additionally require
 * purpose=vsh-mixed-book-test and settle into PostgreSQL. Mixing them would
 * risk corrupting separate order ledgers. These tests NEVER contact Yoco.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {readFile} from "node:fs/promises";
import {
  makeMixedBookYocoTestWebhookHandler
} from "../netlify/functions/mixed-book-yoco-test-webhook.mjs";

const NOW=1793502000;
const URL="https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-webhook";
const oldPreview="https://deploy-preview-2--van-schalkwyk-holdings.netlify.app/.netlify/functions/yoco-books-webhook";
const secret="whsec_"+crypto.randomBytes(32).toString("base64");
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_YOCO_TEST_ENABLED:"true",
  VSH_ENABLE_PAYMENTS:"false",
  VSH_MIXED_YOCO_TEST_KEY:"sk_test_"+("x".repeat(24)),
  VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:secret
};
const context={deploy:{context:"production"}};
function signedOldEvent({kind="payment.succeeded",metadata={
  orderId:"f3ff94aa-79f3-4de1-b9e2-0f112fe2df56",
  business:"grannys",checkoutId:"checkout_LegacyTest12345"
},signatureValid=true,mode="test"}={}){
  const id="msg_LegacyBooks12345";
  const body=JSON.stringify({
    id,type:kind,
    payload:{
      id:"pay_LegacyYoco12345",mode,status:"succeeded",
      currency:"ZAR",amount:7500,metadata
    }
  });
  const digest=crypto.createHmac("sha256",
    Buffer.from(secret.slice(6),"base64"))
    .update(id+"."+NOW+"."+body).digest("base64");
  return new Request(URL,{method:"POST",headers:{
    "webhook-id":id,
    "webhook-timestamp":String(NOW),
    "webhook-signature":"v1,"+(signatureValid?digest:crypto.randomBytes(32).toString("base64"))
  },body});
}
function app(){
  const calls=[];
  const handler=makeMixedBookYocoTestWebhookHandler({
    env,now:()=>NOW*1000,
    databaseFactory(){
      calls.push("opened-postgres");
      throw Error("Legacy webhook events MUST NOT open mixed-cart DB");
    }
  });
  return {handler,calls};
}

test("Actual old single-brand Yoco TEST event shape is ignored before PostgreSQL access",async()=>{
  const {handler,calls}=app();
  for(const metadata of [
    {orderId:"f3ff94aa-79f3-4de1-b9e2-0f112fe2df56",
      business:"grannys",checkoutId:"checkout_LegacyTest12345"},
    {orderId:"f3ff94aa-79f3-4de1-b9e2-0f112fe2df56",
      business:"clever-cubs",checkoutId:"checkout_LegacyTest12345"},
    {orderId:"f3ff94aa-79f3-4de1-b9e2-0f112fe2df56",
      checkoutId:"checkout_LegacyTest12345"},
    {}
  ]){
    const res=await handler(signedOldEvent({metadata}),context);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{ok:true,ignored:true});
  }
  assert.deepEqual(calls,[]);
});
test("Invalid legacy signature is NEVER acknowledged as a trusted merchant event",async()=>{
  const {handler,calls}=app();
  const response=await handler(signedOldEvent({signatureValid:false}),context);
  assert.equal(response.status,401);
  assert.deepEqual(calls,[]);
});
test("Older failed/refund notifications never create or settle a new mixed order",async()=>{
  const {handler,calls}=app();
  for(const kind of ["payment.failed","refund.succeeded","refund.failed"]){
    const response=await handler(signedOldEvent({kind}),context);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,ignored:true});
  }
  assert.deepEqual(calls,[]);
});
test("New test-only webhook cannot run on old Deploy Preview 2",async()=>{
  const {handler,calls}=app();
  const oldRequest=signedOldEvent();
  const previewUrl=new URL(oldPreview);
  assert.equal(previewUrl.hostname,"deploy-preview-2--van-schalkwyk-holdings.netlify.app");
  const res=await handler(new Request(oldPreview,{
    method:"POST",
    headers:oldRequest.headers,
    body:await oldRequest.text()
  }),{deploy:{context:"deploy-preview"}});
  assert.equal(res.status,503);
  assert.deepEqual(calls,[]);
});
test("New code does not reference old single-brand order blob namespaces or old webhook route",async()=>{
  const files=[
    "netlify/functions/mixed-book-yoco-test-webhook.mjs",
    "netlify/functions/mixed-book-yoco-test-checkout.mjs",
    "netlify/lib/mixed-book-yoco-test-payment-handoff.mjs",
    "netlify/lib/mixed-book-db-service.mjs"
  ];
  for(const path of files){
    const src=await readFile(path,"utf8");
    assert.ok(!src.includes("vsh-book-checkouts"));
    assert.ok(!src.includes("vsh-book-orders"));
    assert.ok(!src.includes("/yoco-books-webhook"));
    assert.ok(!src.includes("deploy-preview-2--"));
    assert.ok(!src.includes("YOCO_SECRET_KEY"));
  }
});
