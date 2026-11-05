import {test} from "node:test";
import assert from "node:assert/strict";
import {buildMixedYocoTestCheckout,validateYocoTestCheckoutResponse,
 requestMixedYocoTestCheckout} from "../netlify/lib/mixed-book-yoco-test-checkout.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const recipe="ac20bc30-83b6-4fa2-b034-e5129232a210";
const rr="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const master={
  id:orderId,paymentProvider:"yoco",currency:"ZAR",amountCents:21499,
  items:[
    {business:"grannys",id:recipe,title:"Granny's Recipe Book",
      priceCents:12999,pdfPath:"grannys/"+recipe+".pdf"},
    {business:"clever-cubs",id:rr,title:"Grade RR Afrikaans",
      priceCents:8500,pdfPath:"clever-cubs/"+rr+".manifest.json"}
  ]
};
const good={
 id:"checkout_yocoTEST987654",status:"created",amount:21499,
 currency:"ZAR",processingMode:"test",
 redirectUrl:"https://c.yoco.com/checkout/yocoTEST987654",
 clientReferenceId:orderId,externalId:orderId,
 metadata:{purpose:"vsh-mixed-book-test",orderId}
};
const testKey="sk_test_"+("x".repeat(30));
test("One mixed-brand order -> exactly ONE server-authoritative Yoco checkout charge",()=>{
 const request=buildMixedYocoTestCheckout(master);
 assert.equal(request.url,"https://payments.yoco.com/api/checkouts");
 assert.equal(request.payload.amount,21499);
 assert.equal(request.payload.currency,"ZAR");
 assert.deepEqual(request.payload.metadata,{
   purpose:"vsh-mixed-book-test",orderId
 });
 assert.equal(request.payload.clientReferenceId,orderId);
 assert.equal(request.payload.externalId,orderId);
 assert.equal(request.idempotencyKey,"vsh-mixed-test-"+orderId);
 assert.equal(Object.hasOwn(request.payload,"lineItems"),false);
 assert.equal(Object.hasOwn(request.payload,"pdfPath"),false);
 assert.equal(Object.hasOwn(request.payload,"paymentKey"),false);
});
test("Repeat checkout request uses same safe idempotency key",()=>{
 const first=buildMixedYocoTestCheckout(master);
 const second=buildMixedYocoTestCheckout({...master});
 assert.equal(first.idempotencyKey,second.idempotencyKey);
 assert.equal(first.payload.amount,second.payload.amount);
});
test("Cannot trust browser price, invalid brand, duplicate licence or subtotal mismatch",()=>{
 for(const candidate of [
   {...master,amountCents:1},
   {...master,amountCents:21498},
   {...master,items:[]},
   {...master,items:[master.items[0],master.items[0]]},
   {...master,items:[{...master.items[0],business:"unknown"},master.items[1]]},
   {...master,items:[{...master.items[0],priceCents:12998},master.items[1]]},
   {...master,items:[{...master.items[0],pdfPath:"clever-cubs/"+rr+".pdf"},master.items[1]]},
   {...master,currency:"USD"},
   {...master,paymentProvider:"anything else"}
 ])assert.throws(()=>buildMixedYocoTestCheckout(candidate));
});
test("Yoco response must be TEST mode and exactly match checkout amount and identity",()=>{
 const result=validateYocoTestCheckoutResponse(master,good);
 assert.deepEqual(result,{
   checkoutId:good.id,redirectUrl:good.redirectUrl,
   amountCents:21499,currency:"ZAR",processingMode:"test"
 });
 for(const patch of [
  {amount:1},{currency:"USD"},{processingMode:"live"},
  {status:"completed"},{id:"unsafe"},
  {externalId:"other"},{clientReferenceId:"other"},
  {metadata:{orderId:"other"}},
  {metadata:{orderId,purpose:"other"}}
 ])assert.throws(()=>validateYocoTestCheckoutResponse(master,{...good,...patch}));
});
test("Refuses malicious or untrusted Yoco redirect destination",()=>{
 for(const redirectUrl of [
   "http://c.yoco.com/checkout/checkout_xxx",
   "https://yoco.com/checkout/checkout_xxx",
   "https://c.yoco.com.evil.example/checkout/xx",
   "https://c.yoco.com@evil.example/checkout/x",
   "https://c.yoco.com/other",
   "https://c.yoco.com/checkout/x#fragment",
   "https://c.yoco.com/checkout/x?secret=1",
   "javascript:alert(1)",
   "https://c.yoco.com:8443/checkout/x"
 ])assert.throws(()=>validateYocoTestCheckoutResponse(master,{...good,redirectUrl}));
});
test("Creating Yoco TEST checkout requires explicit flag, fake test key, and injected sender",async()=>{
 let calls=0;
 const postCheckout=async request=>{
   calls++;
   assert.equal(request.url,"https://payments.yoco.com/api/checkouts");
   assert.equal(request.headers.Authorization,"Bearer "+testKey);
   assert.equal(request.headers["Idempotency-Key"],"vsh-mixed-test-"+orderId);
   assert.deepEqual(JSON.parse(request.body).metadata,{purpose:"vsh-mixed-book-test",orderId});
   return {ok:true,data:good};
 };
 for(const opts of [
  {enabled:false,secretKey:testKey,postCheckout},
  {enabled:true,secretKey:"sk_live_BADKEY0123456789",postCheckout},
  {enabled:true,secretKey:"sk_test_bad",postCheckout},
  {enabled:true,secretKey:testKey}
 ])await assert.rejects(requestMixedYocoTestCheckout(master,opts));
 assert.equal(calls,0);
 const result=await requestMixedYocoTestCheckout(master,{
   enabled:true,secretKey:testKey,postCheckout
 });
 assert.equal(result.checkoutId,good.id);
 assert.equal(calls,1);
 assert.ok(!JSON.stringify(result).includes(testKey));
});
test("An HTTP failure or unmatched Yoco response never returns checkout redirect",async()=>{
 for(const response of [
   {ok:false,data:good},
   {ok:true,data:{...good,amount:199}},
   {ok:true,data:{...good,processingMode:"live"}},
   {ok:true,data:{...good,redirectUrl:"https://phishing.test/pay"}}
 ]){
   await assert.rejects(requestMixedYocoTestCheckout(master,{
     enabled:true,secretKey:testKey,postCheckout:async()=>response
   }));
 }
});
test("Successful redirect is never an order settlement proof",()=>{
 const request=buildMixedYocoTestCheckout(master);
 assert.ok(request.payload.successUrl.includes("bookCheckout=returned"));
 assert.ok(!request.payload.successUrl.includes("paid"));
 assert.equal(Object.hasOwn(request,"paymentVerified"),false);
 assert.equal(Object.hasOwn(request,"sendEmail"),false);
});
