import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
 buildMixedYocoLiveCheckout,validateMixedYocoLiveCheckout,
 verifyYocoLiveRedirect,requestMixedYocoLiveCheckout,postYocoLiveCheckout
} from "../netlify/lib/mixed-book-yoco-live-checkout.mjs";
import {prepareMixedBookLiveCheckout} from "../netlify/lib/mixed-book-yoco-live-operation.mjs";
import {prepareVerifiedMixedBookLiveSettlement} from "../netlify/lib/mixed-book-yoco-live-payment-handoff.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const book1="ac20bc30-83b6-4fa2-b034-e5129232a210";
const book2="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const secretKey="sk_live_"+("L".repeat(32));
const master={
 id:orderId,name:"Example Buyer",email:"buyer@example.com",
 paymentProvider:"yoco",currency:"ZAR",amountCents:14500,
 items:[
  {business:"grannys",id:book1,title:"Recipe Book",priceCents:7500,
   pdfPath:"grannys/"+book1+".pdf"},
  {business:"clever-cubs",id:book2,title:"Learning Book",priceCents:7000,
   pdfPath:"clever-cubs/"+book2+".manifest.json"}
 ]
};
const provider={
 id:"ch_LiveCheckout98765",status:"created",amount:14500,
 currency:"ZAR",processingMode:"live",
 redirectUrl:"https://c.yoco.com/checkout/LiveCheckout98765",
 clientReferenceId:orderId,externalId:orderId,
 metadata:{purpose:"vsh-mixed-book-live",orderId}
};

test("LIVE checkout request is from server snapshot, has unique LIVE idempotency key and excludes secrets",()=>{
 const request=buildMixedYocoLiveCheckout(master);
 assert.equal(request.url,"https://payments.yoco.com/api/checkouts");
 assert.equal(request.payload.amount,14500);
 assert.equal(request.payload.currency,"ZAR");
 assert.equal(request.idempotencyKey,"vsh-mixed-live-"+orderId);
 assert.notEqual(request.idempotencyKey,"vsh-mixed-test-"+orderId);
 assert.deepEqual(request.payload.metadata,{purpose:"vsh-mixed-book-live",orderId});
 assert.equal(request.payload.clientReferenceId,orderId);
 assert.equal(request.payload.externalId,orderId);
 assert.equal(Object.hasOwn(request.payload,"pdfPath"),false);
 assert.equal(Object.hasOwn(request.payload,"email"),false);
 assert.deepEqual(request,buildMixedYocoLiveCheckout({...master}));
 for(const bad of [
  {...master,amountCents:0},
  {...master,amountCents:14499},
  {...master,currency:"USD"},
  {...master,items:[master.items[0],master.items[0]]},
  {...master,items:[{...master.items[0],pdfPath:"clever-cubs/"+book1+".pdf"},master.items[1]]},
  {...master,items:[{...master.items[0],priceCents:1},master.items[1]]}
 ]) assert.throws(()=>buildMixedYocoLiveCheckout(bad));
});

test("LIVE response is rejected unless matching amount, currency, reference and explicit live mode",()=>{
 const valid=validateMixedYocoLiveCheckout(master,provider);
 assert.deepEqual(valid,{
  checkoutId:provider.id,redirectUrl:provider.redirectUrl,
  amountCents:14500,currency:"ZAR",processingMode:"live"
 });
 assert.equal(validateMixedYocoLiveCheckout(master,{...provider,id:"checkout_Live98765"}).checkoutId,
  "checkout_Live98765");
 for(const change of [
  {id:"unsafe"},{status:"completed"},{amount:14501},
  {currency:"USD"},{processingMode:"test"},{processingMode:undefined},
  {clientReferenceId:"other"},{externalId:"other"},
  {metadata:{purpose:"vsh-mixed-book-test",orderId}},
  {metadata:{purpose:"vsh-mixed-book-live",orderId:"other"}}
 ])assert.throws(()=>validateMixedYocoLiveCheckout(master,{...provider,...change}));
});

test("Only strict official Yoco HTTPS checkout URLs pass; no open redirect",()=>{
 for(const unsafe of [
  "https://evil.example/checkout/LiveCheckout98765",
  "http://c.yoco.com/checkout/LiveCheckout98765",
  "https://c.yoco.com.evil.test/checkout/LiveCheckout98765",
  "https://evil.test@c.yoco.com/checkout/LiveCheckout98765",
  "https://c.yoco.com:8443/checkout/LiveCheckout98765",
  "https://c.yoco.com/checkout/LiveCheckout98765?next=https://evil.test",
  "https://c.yoco.com/checkout/LiveCheckout98765#fragment",
  "https://c.yoco.com/checkout/%2e%2e/",
  "https://c.yoco.com/checkout/LiveCheckout98765/extra",
  "https://pay.yoco.com/r/LiveCheckout98765",
  "https://c.yoco.com/other/LiveCheckout98765",
  "javascript:alert(1)"
 ]){
  assert.equal(verifyYocoLiveRedirect(unsafe),null);
  assert.throws(()=>validateMixedYocoLiveCheckout(master,{
    ...provider,redirectUrl:unsafe
  }),error=>error.code==="yoco_response_redirect_invalid");
 }
});

test("Disabled LIVE sender or any TEST API key makes zero provider requests",async()=>{
 let calls=0;
 const postCheckout=async()=>{calls++;return {ok:true,data:provider}};
 for(const opts of [
  {enabled:false,secretKey,postCheckout},
  {enabled:true,secretKey:"sk_test_"+("t".repeat(30)),postCheckout},
  {enabled:true,secretKey:"sk_live_short",postCheckout},
  {enabled:true,secretKey}
 ]){
  await assert.rejects(requestMixedYocoLiveCheckout(master,opts));
 }
 assert.equal(calls,0);
 const valid=await requestMixedYocoLiveCheckout(master,{
  enabled:true,secretKey,postCheckout:async request=>{
   calls++;
   assert.equal(request.headers.Authorization,"Bearer "+secretKey);
   assert.equal(request.headers["Idempotency-Key"],"vsh-mixed-live-"+orderId);
   assert.deepEqual(JSON.parse(request.body).metadata,{
    purpose:"vsh-mixed-book-live",orderId
   });
   return {ok:true,data:provider};
  }
 });
 assert.equal(valid.checkoutId,provider.id);
 assert.equal(calls,1);
 assert.equal(JSON.stringify(valid).includes(secretKey),false);
});

test("Provider failures expose only fixed categories; never read declined response body",async()=>{
 let read=false;
 await assert.rejects(postYocoLiveCheckout({
  url:"https://payments.yoco.com/api/checkouts",
  headers:{Authorization:"Bearer "+secretKey},
  body:JSON.stringify({amount:14500,currency:"ZAR"})
 },{transport:async()=>({ok:false,status:401,text:async()=>{
   read=true;return "secret API key";
 }})}),error=>error.code==="yoco_http_rejected"&&error.httpStatus===401);
 assert.equal(read,false);
 await assert.rejects(postYocoLiveCheckout({
  url:"https://payments.yoco.com/api/checkouts",
  headers:{Authorization:"Bearer sk_test_not-a-live-key"},
  body:JSON.stringify({amount:14500})
 },{transport:async()=>{throw Error("should never call")}}),
 error=>error.code==="yoco_transport_invalid");
});

test("An operator must explicitly enable LIVE orchestration; binding requires durable live ID",async()=>{
 const names=[];
 const catalogue={
  async getProduct(business,id){
   return {business,id,is_active:true,category:business==="grannys"?"Recipe Books":"Primary School",
    title:"Private Book",price:business==="grannys"?75:70,
    pdf_path:business+"/"+id+".pdf"};
  },
  async getPrivateFile(){return {metadata:{size:1024}}}
 };
 const ledger={
  async createPendingOrder(order,mode){
   names.push("pending:"+mode);return {orderId:order.id,status:"checkout_pending",mode};
  },
  async bindYocoCheckout(input){
   names.push("binding:"+input.processingMode);
   return {orderId:input.orderId,checkoutId:input.checkoutId};
  }
 };
 const input={name:"Example Buyer",email:"buyer@example.com",
  items:[{business:"grannys",id:book1},{business:"clever-cubs",id:book2}]};
 await assert.rejects(prepareMixedBookLiveCheckout(input,{
  enabled:false,operatorApproved:true,catalogue,ledger,secretKey,
  postCheckout:async()=>({ok:true,data:provider})
 }));
 assert.deepEqual(names,[]);
 const final=await prepareMixedBookLiveCheckout(input,{
  enabled:true,operatorApproved:true,catalogue,ledger,secretKey,
  postCheckout:async request=>{
   const saved=JSON.parse(request.body);
   return {ok:true,data:{...provider,clientReferenceId:saved.clientReferenceId,
    externalId:saved.externalId,metadata:saved.metadata}};
  }
 });
 assert.deepEqual(names,["pending:live","binding:live"]);
 assert.equal(final.paymentVerified,false);
 assert.equal(final.processingMode,"live");
});

const signingSecret="whsec_"+crypto.randomBytes(32).toString("base64");
const time=1793502000;
const stored={
 id:orderId,processing_mode:"live",amount_cents:14500,
 status:"awaiting_payment",checkout_id:provider.id
};
function signedLiveEvent({mode="live",purpose="vsh-mixed-book-live",
 order=stored,checkoutId=provider.id,secret=signingSecret}={}){
 const event={
  type:"payment.succeeded",
  payload:{id:"pay_ExampleLive123",status:"succeeded",
   amount:14500,currency:"ZAR",mode,
   metadata:{orderId,checkoutId,purpose}}
 };
 const rawBody=JSON.stringify(event),id="msg_ExampleLiveWebhook123";
 const mac=crypto.createHmac("sha256",Buffer.from(signingSecret.slice(6),"base64"))
  .update(id+"."+time+"."+rawBody).digest("base64");
 const calls=[];
 return {calls,options:{
  enabled:true,operatorApproved:true,rawBody,nowMs:time*1000,secret,
  headers:new Headers({
   "webhook-id":id,"webhook-timestamp":String(time),
   "webhook-signature":"v1,"+mac
  }),
  async loadStoredOrder(id){calls.push("lookup:"+id);return order},
  async settleAfterVerifiedWebhook(id,confirmation){
   calls.push("settle:"+id);
   assert.equal(confirmation.signatureVerified,true);
   assert.equal(confirmation.processingMode,"live");
   assert.equal(confirmation.checkoutId,provider.id);
   return {testOnly:false,duplicate:false,brandCount:2,insertedEmailJobs:4};
  }
 }};
}
test("A signed matching LIVE event can only prepare durable outbox records, never email or PDF",async()=>{
 const {options,calls}=signedLiveEvent();
 const result=await prepareVerifiedMixedBookLiveSettlement(options);
 assert.deepEqual(result,{liveVerified:true,duplicate:false,
  brandCount:2,emailsSent:0,pdfsDelivered:0});
 assert.deepEqual(calls,["lookup:"+orderId,"settle:"+orderId]);
});
test("No unsigned, wrong-mode, unbound or unrelated event can settle LIVE orders",async()=>{
 for(const patch of [
  {secret:"whsec_"+crypto.randomBytes(32).toString("base64")},
  {mode:"test"},{checkoutId:"ch_Wrong12345"},
  {order:{...stored,status:"checkout_pending",checkout_id:null}},
  {order:{...stored,processing_mode:"test"}}
 ]){
  const {options,calls}=signedLiveEvent(patch);
  if(patch.order?.checkout_id===null){
   const result=await prepareVerifiedMixedBookLiveSettlement(options);
   assert.equal(result.retryable,true);
  }else await assert.rejects(prepareVerifiedMixedBookLiveSettlement(options));
  assert.ok(!calls.some(x=>x.startsWith("settle:")));
 }
 const other=signedLiveEvent({purpose:"other-provider-order"});
 assert.equal((await prepareVerifiedMixedBookLiveSettlement(other.options)).ignored,true);
 assert.deepEqual(other.calls,[]);
 const disabled=signedLiveEvent();
 await assert.rejects(prepareVerifiedMixedBookLiveSettlement({
  ...disabled.options,enabled:false
 }));
 assert.deepEqual(disabled.calls,[]);
});
