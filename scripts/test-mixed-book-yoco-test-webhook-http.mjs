import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  makeMixedBookYocoTestWebhookHandler,config
} from "../netlify/functions/mixed-book-yoco-test-webhook.mjs";

const SITE="https://vanschalkwykholdings.com";
const URL=SITE+"/.netlify/functions/mixed-book-yoco-test-webhook";
const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const checkoutId="checkout_CiTest12345";
const webhookId="msg_YocoTestExample12345";
const epoch=1793502000;
const secret="whsec_"+crypto.randomBytes(32).toString("base64");
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_YOCO_TEST_ENABLED:"true",
  VSH_ENABLE_PAYMENTS:"false",
  VSH_MIXED_YOCO_TEST_KEY:"sk_test_"+"x".repeat(30),
  VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:secret
};
const production={deploy:{context:"production"}};
const order={
  id:orderId,processing_mode:"test",amount_cents:21499,
  checkout_id:checkoutId,status:"awaiting_payment"
};
function signed({
  type="payment.succeeded",purpose="vsh-mixed-book-test",
  amount=21499,mode="test",status="succeeded",
  checkout=checkoutId,orderRef=orderId,
  url=URL,timestamp=epoch,wrongSignature=false,rawOverride=null
}={}){
  const data={type,payload:{
    id:"pay_testWebhook001",status,amount,currency:"ZAR",mode,
    metadata:{purpose,orderId:orderRef,checkoutId:checkout}
  }};
  const raw=rawOverride??JSON.stringify(data);
  const hmac=crypto.createHmac("sha256",Buffer.from(secret.slice(6),"base64"))
    .update(webhookId+"."+timestamp+"."+raw).digest("base64");
  return new Request(url,{method:"POST",headers:{
    "Content-Type":"application/json",
    "webhook-id":webhookId,
    "webhook-timestamp":String(timestamp),
    "webhook-signature":"v1,"+(wrongSignature?crypto.randomBytes(32).toString("base64"):hmac)
  },body:raw});
}
function app({settings=env,dbOrder=order,settlement={
  testOnly:true,duplicate:false,brandCount:2,insertedEmailJobs:0
}}={}){
  const calls=[];
  const handler=makeMixedBookYocoTestWebhookHandler({
    env:settings,now:()=>epoch*1000,
    databaseFactory:()=>{
      calls.push("factory");
      return {
        async loadYocoTestOrder(id){
          calls.push("lookup:"+id);return dbOrder;
        },
        async settleAfterVerifiedWebhook(id,confirmation){
          calls.push("settle:"+id);
          assert.equal(confirmation.source,"server-verified-yoco-webhook");
          assert.equal(confirmation.signatureVerified,true);
          assert.equal(confirmation.processingMode,"test");
          assert.equal(confirmation.checkoutId,checkoutId);
          assert.equal(confirmation.amountCents,21499);
          return settlement;
        }
      };
    }
  });
  return {handler,calls};
}
test("Signed matching TEST event verifies master payment without sending books or emails",async()=>{
  const {handler,calls}=app();
  const res=await handler(signed(),production);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,testVerified:true,duplicate:false});
  assert.deepEqual(calls,["factory","lookup:"+orderId,"settle:"+orderId]);
  assert.equal(res.headers.get("cache-control"),"no-store");
  assert.equal(config.method,"POST");
});
test("Repeated signed event acknowledges existing paid test order without new delivery",async()=>{
  const {handler,calls}=app({
    dbOrder:{...order,status:"paid"},
    settlement:{testOnly:true,duplicate:true,brandCount:2,insertedEmailJobs:0}
  });
  const res=await handler(signed(),production);
  assert.equal(res.status,200);
  assert.equal((await res.json()).duplicate,true);
  assert.equal(calls.filter(x=>x.startsWith("settle:")).length,1);
});
test("Foreign merchant webhook and failed/refund events are acknowledged but never access DB",async()=>{
  for(const change of [
    {purpose:"another-merchant-flow"},
    {type:"payment.failed",status:"failed"},
    {type:"refund.succeeded"}
  ]){
    const {handler,calls}=app();
    const res=await handler(signed(change),production);
    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{ok:true,ignored:true});
    assert.deepEqual(calls,[]);
  }
});
test("An invalid HMAC, tampered body or expired timestamp is rejected before DB",async()=>{
  for(const change of [
    {wrongSignature:true},
    {timestamp:epoch-181},
    {timestamp:epoch+181}
  ]){
    const {handler,calls}=app();
    const res=await handler(signed(change),production);
    assert.equal(res.status,401);
    assert.deepEqual(calls,[]);
  }
});
test("Explicit activation gates and production hostname prevent any DB access",async()=>{
  for(const change of [
    {settings:{...env,VSH_MIXED_YOCO_TEST_ENABLED:"false"},ctx:production},
    {settings:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"},ctx:production},
    {settings:{...env,VSH_ENABLE_PAYMENTS:"true"},ctx:production},
    {settings:{...env,VSH_MIXED_YOCO_TEST_KEY:"sk_live_unsafe123456"},ctx:production},
    {settings:{...env,VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:""},ctx:production},
    {settings:env,ctx:{deploy:{context:"deploy-preview"}}},
    {settings:env,ctx:production,url:"https://not-our-site.example/.netlify/functions/mixed-book-yoco-test-webhook"}
  ]){
    const {handler,calls}=app({settings:change.settings});
    assert.equal((await handler(signed({url:change.url||URL}),change.ctx)).status,503);
    assert.deepEqual(calls,[]);
  }
});
test("Checkout binding race is retryable, not a false paid acknowledgement",async()=>{
  const {handler,calls}=app({dbOrder:{...order,status:"checkout_pending",checkout_id:null}});
  const result=await handler(signed(),production);
  assert.equal(result.status,503);
  assert.ok(!calls.some(x=>x.startsWith("settle:")));
});
test("Missing authoritative checkout identity is retryable until Yoco association verified",async()=>{
  const {handler,calls}=app();
  const res=await handler(signed({checkout:undefined}),production);
  assert.equal(res.status,503);
  assert.ok(!calls.some(x=>x.startsWith("settle:")));
});
test("Wrong amount, wrong checkout, wrong mode and missing DB order never settle",async()=>{
  for(const change of [
    {payment:{amount:21500}},
    {payment:{checkout:"checkout_OtherMerchant9876"}},
    {payment:{mode:"live"}},
    {dbOrder:null}
  ]){
    const {handler,calls}=app({dbOrder:change.dbOrder??(Object.hasOwn(change,"dbOrder")?null:order)});
    const res=await handler(signed(change.payment||{}),production);
    assert.equal(res.status,503);
    assert.ok(!calls.some(x=>x.startsWith("settle:")));
  }
});
test("Uncertain DB state never acknowledged; errors do not expose private details",async()=>{
  const {handler}=app({settlement:{testOnly:false,duplicate:false,
    brandCount:2,insertedEmailJobs:4}});
  const res=await handler(signed(),production);
  assert.equal(res.status,503);
  const raw=JSON.stringify(await res.json());
  assert.ok(!raw.includes("Granny"));
  assert.ok(!raw.includes("CleverCubs"));
  assert.ok(!raw.includes(secret));
});
test("Only POST, and max 50k input; no browser credentials required for webhook",async()=>{
  const {handler,calls}=app();
  assert.equal((await handler(new Request(URL,{method:"GET"}),production)).status,405);
  const big=signed({rawOverride:" ".repeat(50001)});
  assert.equal((await handler(big,production)).status,413);
  assert.deepEqual(calls,[]);
  // Signed provider calls have neither an Origin header nor X-Admin-Key.
  assert.equal(signed().headers.get("Origin"),null);
  assert.equal(signed().headers.get("X-Admin-Key"),null);
});
