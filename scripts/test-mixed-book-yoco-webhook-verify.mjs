import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifySignedMixedYocoWebhook,reconcileSignedYocoEventForOrder
} from "../netlify/lib/mixed-book-yoco-webhook-verify.mjs";

const secret="whsec_"+crypto.randomBytes(32).toString("base64");
const nowSeconds=1793502000; // arbitrary fixed 2026-era timestamp
const nowMs=nowSeconds*1000;
const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const checkoutId="checkout_ExampleYocoId12345";
const stored={
 id:orderId,amount_cents:21499,processing_mode:"test",checkout_id:checkoutId
};
function event({
 type="payment.succeeded",id="evt_Example001",
 amount=21499,currency="ZAR",mode="test",status="succeeded",
 metadata={orderId,checkoutId},paymentId="pay_Example001"
}={}){
 return {id,type,createdDate:"2026-11-01T12:00:00Z",payload:{
   id:paymentId,amount,currency,mode,status,metadata
 }};
}
function signed(payload=event(),{
 body=JSON.stringify(payload),timestamp=String(nowSeconds),
 webhookId="msg_Example1234",secrets=[secret],extraSignature=""
}={}){
 const signatures=secrets.map(s=>{
   const key=Buffer.from(s.slice(6),"base64");
   const mac=crypto.createHmac("sha256",key)
    .update(webhookId+"."+timestamp+"."+body).digest("base64");
   return "v1,"+mac;
 });
 const headers=new Headers({
   "webhook-id":webhookId,
   "webhook-timestamp":timestamp,
   "webhook-signature":[extraSignature,...signatures].filter(Boolean).join(" ")
 });
 return {rawBody:body,headers,secret,nowMs};
}
test("Valid Yoco Checkout signature authenticates order, amount, currency and test mode",()=>{
 const output=verifySignedMixedYocoWebhook(signed());
 assert.equal(output.ignored,false);
 assert.equal(output.eventId,"evt_Example001");
 assert.equal(output.signedWebhookId,"msg_Example1234");
 assert.equal(output.orderId,orderId);
 assert.equal(output.checkoutCandidate,checkoutId);
 assert.equal(output.paymentId,"pay_Example001");
 assert.equal(output.amountCents,21499);
 assert.equal(output.processingMode,"test");
 const reconciled=reconcileSignedYocoEventForOrder(output,stored);
 assert.equal(reconciled.ready,true);
 assert.equal(reconciled.confirmation.checkoutId,checkoutId);
 assert.equal(reconciled.confirmation.signatureVerified,true);
});
test("Multiple signatures support key rotation and ignore unknown versions",()=>{
 const old="whsec_"+crypto.randomBytes(32).toString("base64");
 const input=signed(event(),{
   secrets:[old,secret],extraSignature:"v2,AAAA"
 });
 const output=verifySignedMixedYocoWebhook(input);
 assert.equal(output.ignored,false);
});
test("Tampered JSON, body reserialization, wrong secret and forged signature fail",()=>{
 const authentic=signed(event(),{body:'{ "id":"evt_Example001", "type":"payment.succeeded", "payload":{"id":"pay_Example001","amount":21499,"currency":"ZAR","mode":"test","status":"succeeded","metadata":{"orderId":"'+orderId+'","checkoutId":"'+checkoutId+'"}}}'});
 const verified=verifySignedMixedYocoWebhook(authentic);
 assert.equal(verified.orderId,orderId);
 assert.throws(()=>verifySignedMixedYocoWebhook({...authentic,
   rawBody:JSON.stringify(JSON.parse(authentic.rawBody))}));
 assert.throws(()=>verifySignedMixedYocoWebhook({...authentic,
   secret:"whsec_"+crypto.randomBytes(32).toString("base64")}));
 const headers=new Headers(authentic.headers);
 headers.set("webhook-signature","v1,"+crypto.randomBytes(32).toString("base64"));
 assert.throws(()=>verifySignedMixedYocoWebhook({...authentic,headers}));
});
test("Webhook-timestamp outside ±180 seconds, invalid signatures and malformed headers rejected",()=>{
 for(const timestamp of [String(nowSeconds+181),String(nowSeconds-181),"invalid","0"]){
   const input=signed(event(),{timestamp});
   assert.throws(()=>verifySignedMixedYocoWebhook(input));
 }
 for(const val of ["","v1,nothingsigned","v2,"+crypto.randomBytes(32).toString("base64")]){
   const input=signed();
   input.headers.set("webhook-signature",val);
   assert.throws(()=>verifySignedMixedYocoWebhook(input));
 }
 const missing=signed();missing.headers.delete("webhook-id");
 assert.throws(()=>verifySignedMixedYocoWebhook(missing));
});
test("Maliciously large raw payload and noncanonical whsec secret rejected",()=>{
 const original=signed();
 const huge="x".repeat(50001);
 assert.throws(()=>verifySignedMixedYocoWebhook({...original,rawBody:huge}));
 for(const badSecret of ["whsec_","whsec_not base64","sk_live_secret","whsec_AA=="]){
   assert.throws(()=>verifySignedMixedYocoWebhook({...original,secret:badSecret}));
 }
});
test("Only explicit successful payment can become a settlement candidate",()=>{
 for(const patch of [
   {amount:21499.5},{amount:0},{currency:"USD"},{status:"failed"},
   {mode:"staging"},{metadata:{orderId:"fake"}},{paymentId:"../unsafe"}
 ]){
   assert.throws(()=>verifySignedMixedYocoWebhook(signed(event(patch))));
 }
 const failed=verifySignedMixedYocoWebhook(signed(event({type:"payment.failed",status:"failed"})));
 assert.equal(failed.ignored,true);
 assert.equal(failed.type,"payment.failed");
 const refund=verifySignedMixedYocoWebhook(signed(event({type:"refund.succeeded"})));
 assert.equal(refund.ignored,true);
});
test("A valid signed orderId without checkoutId cannot settle until independently reconciled",()=>{
 const output=verifySignedMixedYocoWebhook(signed(event({
   metadata:{orderId}
 })));
 assert.equal(output.checkoutCandidate,null);
 const waiting=reconcileSignedYocoEventForOrder(output,stored);
 assert.equal(waiting.ready,false);
 assert.equal(waiting.reason,"independent-checkout-reconciliation-required");
 const independent=reconcileSignedYocoEventForOrder(output,stored,{
   independentlyConfirmedCheckoutId:checkoutId
 });
 assert.equal(independent.ready,true);
 assert.throws(()=>reconcileSignedYocoEventForOrder(output,stored,{
   independentlyConfirmedCheckoutId:"checkout_AnotherCheckout123"
 }));
});
test("Reject checkout mismatch, amount mismatch, mode mismatch and wrong order",()=>{
 const output=verifySignedMixedYocoWebhook(signed());
 for(const patch of [
  {id:"ac20bc30-83b6-4fa2-b034-e5129232a210"},
  {amount_cents:21500},{processing_mode:"live"},
  {checkout_id:"checkout_wrongId123456"},
  {checkout_id:null}
 ])assert.throws(()=>reconcileSignedYocoEventForOrder(output,{...stored,...patch}));
});
test("Conflicting checkout claims in signed event are rejected",()=>{
 const payload=event();
 payload.payload.checkoutId="checkout_wrongId123456";
 assert.throws(()=>verifySignedMixedYocoWebhook(signed(payload)));
});
test("Unsupported types are signed but never trigger paid settlement",()=>{
 const output=verifySignedMixedYocoWebhook(signed(event({type:"unknown.event"})));
 assert.equal(output.ignored,true);
 assert.throws(()=>reconcileSignedYocoEventForOrder(output,stored));
});
