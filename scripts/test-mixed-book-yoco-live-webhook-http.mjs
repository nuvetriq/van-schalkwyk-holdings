import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  makeMixedBookYocoLiveWebhookHandler,config
} from "../netlify/functions/mixed-book-yoco-live-webhook.mjs";

const SITE="https://vanschalkwykholdings.com";
const URL=SITE+"/.netlify/functions/mixed-book-yoco-live-webhook";
const epoch=1793502000;
const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const checkoutId="checkout_Live123456789";
const secret="whsec_"+crypto.randomBytes(32).toString("base64");
const settings={
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_YOCO_LIVE_ENABLED:"true",
  VSH_ENABLE_PAYMENTS:"true",
  VSH_MIXED_YOCO_TEST_ENABLED:"false",
  VSH_MIXED_YOCO_LIVE_KEY:"sk_live_"+("L".repeat(32)),
  VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET:secret
};
const production={deploy:{context:"production"}};
const master={
  id:orderId,processing_mode:"live",amount_cents:14500,
  status:"awaiting_payment",checkout_id:checkoutId
};

function signed({
  type="payment.succeeded",purpose="vsh-mixed-book-live",
  amount=14500,mode="live",paymentStatus="succeeded",
  orderRef=orderId,checkout=checkoutId,wrongSignature=false,
  timestamp=epoch,url=URL,rawOverride=null
}={}){
  const event={type,payload:{
    id:"pay_LiveWebhook123456",status:paymentStatus,
    amount,currency:"ZAR",mode,
    metadata:{purpose,orderId:orderRef,checkoutId:checkout}
  }};
  const rawBody=rawOverride??JSON.stringify(event);
  const id="msg_LiveWebhook123456";
  const mac=crypto.createHmac("sha256",Buffer.from(secret.slice(6),"base64"))
    .update(id+"."+timestamp+"."+rawBody).digest("base64");
  return new Request(url,{method:"POST",headers:{
    "Content-Type":"application/json",
    "webhook-id":id,
    "webhook-timestamp":String(timestamp),
    "webhook-signature":"v1,"+(wrongSignature?
      crypto.randomBytes(32).toString("base64"):mac)
  },body:rawBody});
}

function app({
  env=settings,order=master,settlement={
    testOnly:false,duplicate:false,brandCount:2,insertedEmailJobs:4
  }
}={}){
  const calls=[];
  const handler=makeMixedBookYocoLiveWebhookHandler({
    env,now:()=>epoch*1000,
    databaseFactory:()=>{
      calls.push("db");
      return {
        async loadYocoLiveOrder(id){
          calls.push("lookup:"+id);return order;
        },
        async loadYocoLiveOrderByCheckoutId(id){
          calls.push("checkout-lookup:"+id);
          return order && order.checkout_id===id ? order : null;
        },
        async settleAfterVerifiedWebhook(id,confirmation){
          calls.push("settle:"+id);
          assert.equal(confirmation.signatureVerified,true);
          assert.equal(confirmation.processingMode,"live");
          assert.equal(confirmation.checkoutId,checkoutId);
          assert.equal(confirmation.amountCents,14500);
          assert.equal(confirmation.currency,"ZAR");
          return settlement;
        }
      };
    }
  });
  return {handler,calls};
}

test("A signed LIVE payment only settles known master and queues brand jobs; no email or grant",async()=>{
  const {handler,calls}=app();
  const response=await handler(signed(),production);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,verified:true,duplicate:false});
  assert.deepEqual(calls,["db","lookup:"+orderId,"settle:"+orderId]);
  assert.equal(config.method,"POST");
  assert.equal(response.headers.get("cache-control"),"no-store");
});
test("Yoco payment notification without custom orderId securely locates LIVE order using signed checkoutId",async()=>{
  const {handler,calls}=app();
  const response=await handler(signed({orderRef:null}),production);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    ok:true,verified:true,duplicate:false
  });
  assert.deepEqual(calls,[
    "db","checkout-lookup:"+checkoutId,"settle:"+orderId
  ]);
});
test("Unknown checkoutId-only signed event cannot settle a different customer's order",async()=>{
  const {handler,calls}=app();
  const response=await handler(signed({
    orderRef:null,checkout:"checkout_Unrelated12345"
  }),production);
  assert.equal(response.status,503);
  assert.deepEqual(calls,["db","checkout-lookup:checkout_Unrelated12345"]);
});

test("Duplicate LIVE payment leaves no new outbox tasks",async()=>{
  const {handler,calls}=app({
    order:{...master,status:"paid"},
    settlement:{testOnly:false,duplicate:true,brandCount:2,insertedEmailJobs:0}
  });
  assert.equal((await handler(signed(),production)).status,200);
  assert.deepEqual(calls,["db","lookup:"+orderId,"settle:"+orderId]);
});
test("Invalid HMAC and expired timestamps never touch database",async()=>{
  for(const change of [
    {wrongSignature:true},{timestamp:epoch-181},{timestamp:epoch+181}
  ]){
    const {handler,calls}=app();
    const response=await handler(signed(change),production);
    assert.equal(response.status,401);
    assert.deepEqual(calls,[]);
  }
});
test("Foreign merchant events and failed/refund events cannot settle or query DB",async()=>{
  for(const change of [
    {purpose:"vsh-mixed-book-test"},
    {purpose:"other-app"},
    {type:"refund.succeeded",paymentStatus:"refunded"},
    {type:"payment.failed",paymentStatus:"failed"}
  ]){
    const {handler,calls}=app();
    const response=await handler(signed(change),production);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,ignored:true});
    assert.deepEqual(calls,[]);
  }
});
test("LIVE gate requires approved switches, LIVE key, signing secret and production domain",async()=>{
  for(const change of [
    {env:{...settings,VSH_MIXED_BOOK_DB_ENABLED:"false"}},
    {env:{...settings,VSH_MIXED_YOCO_LIVE_ENABLED:"false"}},
    {env:{...settings,VSH_ENABLE_PAYMENTS:"false"}},
    {env:{...settings,VSH_MIXED_YOCO_TEST_ENABLED:"true"}},
    {env:{...settings,VSH_MIXED_YOCO_LIVE_KEY:"sk_test_"+("x".repeat(32))}},
    {env:{...settings,VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET:""}},
    {context:{deploy:{context:"deploy-preview"}}},
    {url:"https://other.example/.netlify/functions/mixed-book-yoco-live-webhook"}
  ]){
    const {handler,calls}=app({env:change.env||settings});
    const response=await handler(signed({url:change.url||URL}),
      change.context||production);
    assert.equal(response.status,503);
    assert.deepEqual(calls,[]);
  }
});
test("Mismatching checkout, TEST payment, amount, missing order never settle",async()=>{
  for(const change of [
    {payment:{checkout:"checkout_Wrong987654"}},
    {payment:{mode:"test"}},
    {payment:{amount:14501}},
    {order:null}
  ]){
    const {handler,calls}=app({order:Object.hasOwn(change,"order")?
      change.order:master});
    const response=await handler(signed(change.payment||{}),production);
    assert.equal(response.status,503);
    assert.ok(!calls.includes("settle:"+orderId));
  }
});
test("Provider callback racing checkout binding is retryable, not paid",async()=>{
  const {handler,calls}=app({order:{
    ...master,status:"checkout_pending",checkout_id:null
  }});
  const response=await handler(signed(),production);
  assert.equal(response.status,503);
  assert.ok(!calls.some(x=>x.startsWith("settle:")));
});
test("Failed ledger invariant is never falsely acknowledged or exposed",async()=>{
  const original=console.error;
  const seen=[];
  const {handler}=app({settlement:{
    testOnly:true,duplicate:false,brandCount:2,insertedEmailJobs:4
  }});
  let result;
  try {
    console.error=(...args)=>seen.push(args.join(" "));
    result=await handler(signed(),production);
  } finally {console.error=original;}
  assert.equal(result.status,503);
  const response=JSON.stringify(await result.json());
  assert.equal(response.includes(secret),false);
  assert.equal(seen.join(" ").includes(orderId),false);
  assert.equal(seen.join(" ").includes(secret),false);
});
test("HTTP method and payload size are limited, no browser auth on signed calls",async()=>{
  const {handler,calls}=app();
  assert.equal((await handler(new Request(URL,{method:"GET"}),production)).status,405);
  assert.equal((await handler(signed({rawOverride:" ".repeat(50001)}),production)).status,413);
  assert.equal(signed().headers.get("X-Admin-Key"),null);
  assert.equal(signed().headers.get("Origin"),null);
  assert.deepEqual(calls,[]);
});
