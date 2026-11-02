import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {handleMixedBookYocoTestEvent} from "../netlify/lib/mixed-book-yoco-test-payment-handoff.mjs";

const secret="whsec_"+crypto.randomBytes(32).toString("base64");
const time=1793502000;
const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const checkoutId="checkout_TestCombined1234";
const baseOrder={id:orderId,status:"awaiting_payment",processing_mode:"test",
 amount_cents:21499,checkout_id:checkoutId};
function input({
 paymentPatch={},metaPatch={},order=baseOrder,
 webhookId="msg_ExampleWebhook1234",secretKey=secret,
 settled={orderId,testOnly:true,duplicate:false,brandCount:2,insertedEmailJobs:0},
 received
}={}){
 const payload={
  type:"payment.succeeded",payload:{
   id:"pay_Example123",amount:21499,currency:"ZAR",
   status:"succeeded",mode:"test",
   metadata:{orderId,checkoutId,purpose:"vsh-mixed-book-test",...metaPatch},
   ...paymentPatch
  }
 };
 const rawBody=JSON.stringify(payload);
 const timestamp=String(time);
 const hmac=crypto.createHmac("sha256",Buffer.from(secret.slice(6),"base64"))
   .update(webhookId+"."+timestamp+"."+rawBody).digest("base64");
 const calls=[];
 const props={
  rawBody,headers:new Headers({
   "webhook-id":webhookId,"webhook-timestamp":timestamp,
   "webhook-signature":"v1,"+hmac
  }),
  secret:secretKey,nowMs:time*1000,enabled:true,
  async loadStoredOrder(id){calls.push("lookup:"+id);return order},
  async settleAfterVerifiedWebhook(id,confirmation){
   calls.push("settle:"+id);
   assert.equal(confirmation.signatureVerified,true);
   assert.equal(confirmation.checkoutId,checkoutId);
   assert.equal(confirmation.amountCents,21499);
   assert.equal(confirmation.processingMode,"test");
   return settled;
  }
 };
 return {props,calls};
}
test("A signed matching TEST webhook settles ONE master order and dispatches ZERO emails",async()=>{
 const {props,calls}=input();
 const r=await handleMixedBookYocoTestEvent(props);
 assert.deepEqual(r,{
  testVerified:true,duplicate:false,brandCount:2,emailsSent:0,pdfsDelivered:0
 });
 assert.deepEqual(calls,["lookup:"+orderId,"settle:"+orderId]);
});
test("A repeated signed event is a safe duplicate with ZERO new email tasks",async()=>{
 const {props,calls}=input({
  order:{...baseOrder,status:"paid"},
  settled:{orderId,testOnly:true,duplicate:true,brandCount:2,insertedEmailJobs:0}
 });
 assert.equal((await handleMixedBookYocoTestEvent(props)).duplicate,true);
 assert.equal(calls.length,2);
});
test("Checkout-binding race is retryable, never acknowledged as settled",async()=>{
 const {props,calls}=input({order:{
  ...baseOrder,status:"checkout_pending",checkout_id:null
 }});
 const r=await handleMixedBookYocoTestEvent(props);
 assert.equal(r.retryable,true);
 assert.equal(r.reason,"test-checkout-not-yet-bound");
 assert.equal(calls.length,1);
});
test("Missing order and signed event lacking checkoutId require retryable work",async()=>{
 const missing=input({order:null});
 assert.equal((await handleMixedBookYocoTestEvent(missing.props)).retryable,true);
 assert.equal(missing.calls.length,1);
 const noCheckout=input({metaPatch:{checkoutId:undefined}});
 // JSON.stringify omits the undefined metadata.checkoutId.
 const later=await handleMixedBookYocoTestEvent(noCheckout.props);
 assert.equal(later.retryable,true);
 assert.equal(later.reason,"independent-checkout-reconciliation-required");
 assert.equal(noCheckout.calls.length,1);
});
test("Unrelated signed Yoco test checkout does not search orders or settle",async()=>{
 const {props,calls}=input({metaPatch:{purpose:"some-other-test"}});
 const r=await handleMixedBookYocoTestEvent(props);
 assert.equal(r.ignored,true);
 assert.equal(calls.length,0);
});
test("Live mode and wrong amount, checkout, or stored status can NEVER settle",async()=>{
 for(const opts of [
  {paymentPatch:{mode:"live"}},
  {paymentPatch:{amount:21500}},
  {metaPatch:{checkoutId:"checkout_WrongPay1234"}},
  {order:{...baseOrder,processing_mode:"live"}},
  {order:{...baseOrder,status:"refunded"}}
 ]){
  const {props,calls}=input(opts);
  await assert.rejects(handleMixedBookYocoTestEvent(props));
  assert.ok(!calls.some(call=>call.startsWith("settle:")));
 }
});
test("Invalid signature and disabled processing fail before database access",async()=>{
 const signed=input({secretKey:"whsec_"+crypto.randomBytes(32).toString("base64")});
 await assert.rejects(handleMixedBookYocoTestEvent(signed.props));
 assert.equal(signed.calls.length,0);
 const disabled=input();
 await assert.rejects(handleMixedBookYocoTestEvent({...disabled.props,enabled:false}));
 assert.equal(disabled.calls.length,0);
});
test("TEST ledger refusing no-send invariant is treated as an error",async()=>{
 for(const patch of [
  {testOnly:false},{insertedEmailJobs:1}
 ]){
  const {props,calls}=input({settled:{
   orderId,testOnly:true,duplicate:false,brandCount:2,insertedEmailJobs:0,...patch
  }});
  await assert.rejects(handleMixedBookYocoTestEvent(props));
  assert.equal(calls.length,2);
 }
});
