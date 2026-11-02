import {test} from "node:test";
import assert from "node:assert/strict";
import {
  makeMixedBookTestStatusHandler,config
} from "../netlify/functions/mixed-book-yoco-test-order-status.mjs";

const id="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const site="https://vanschalkwykholdings.com";
const base=site+"/.netlify/functions/mixed-book-yoco-test-order-status";
const ctx={deploy:{context:"production"}};
const env={
 VSH_MIXED_BOOK_DB_ENABLED:"true",
 VSH_MIXED_YOCO_TEST_ENABLED:"true",
 VSH_ENABLE_PAYMENTS:"false"
};
const row={
 id,processing_mode:"test",status:"paid",
 amount_cents:"21499",checkout_id:"checkout_CiExample1234",
 customer_name:"NEVER LEAK NAME",customer_email:"private@example.invalid",
 snapshot:{items:[{private_pdf_path:"grannys/private.pdf"}]},
 payment_id:"pay_NeverExpose"
};
function request({url=base+"?orderId="+id,method="GET"}={}){
 return new Request(url,{method});
}
function app({settings=env,admin={ok:true},saved=row,loadError=null}={}){
 const calls=[];
 const handler=makeMixedBookTestStatusHandler({
  env:settings,
  authorize(){calls.push("auth");return admin},
  databaseFactory(){
   calls.push("db");
   return {async loadYocoTestOrder(orderId){
    calls.push("get:"+orderId);
    if(loadError)throw Error(loadError);
    return saved;
   }};
  }
 });
 return {handler,calls};
}
test("Admin reads only minimal verified TEST state, no customer or PDF information",async()=>{
 const {handler,calls}=app();
 const res=await handler(request(),ctx);
 assert.equal(res.status,200);
 assert.equal(res.headers.get("cache-control"),"no-store");
 assert.equal(res.headers.get("referrer-policy"),"no-referrer");
 assert.deepEqual(await res.json(),{
   orderId:id,mode:"test",status:"paid",currency:"ZAR",
   amountCents:21499,checkoutBound:true,
   testPaymentVerified:true,customerDeliveryEnabled:false
 });
 assert.deepEqual(calls,["auth","db","get:"+id]);
 assert.equal(config.rateLimit.windowLimit,30);
});
test("Awaiting and pending TEST checkouts are visible but NEVER marked verified",async()=>{
 for(const status of ["checkout_pending","awaiting_payment","failed","refunded"]){
   const {handler}=app({saved:{...row,status,checkout_id:
     status==="checkout_pending"?null:row.checkout_id}});
   const res=await handler(request(),ctx);
   assert.equal(res.status,200);
   const value=await res.json();
   assert.equal(value.testPaymentVerified,false);
   assert.equal(value.customerDeliveryEnabled,false);
   assert.equal(value.checkoutBound,status!=="checkout_pending");
 }
});
test("Unconfigured, wrong origin, and preview requests cannot access database",async()=>{
 for(const options of [
  {settings:{...env,VSH_MIXED_YOCO_TEST_ENABLED:"false"},context:ctx},
  {settings:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"},context:ctx},
  {settings:{...env,VSH_ENABLE_PAYMENTS:"true"},context:ctx},
  {settings:env,context:{deploy:{context:"deploy-preview"}}},
  {settings:env,context:ctx,url:"https://other.example/.netlify/functions/mixed-book-yoco-test-order-status?orderId="+id}
 ]){
   const {handler,calls}=app({settings:options.settings});
   const res=await handler(request({url:options.url||base+"?orderId="+id}),options.context);
   assert.equal(res.status,503);
   assert.deepEqual(calls,[]);
 }
});
test("Access denied before searching any TEST order",async()=>{
 const {handler,calls}=app({admin:{ok:false,status:401}});
 const res=await handler(request(),ctx);
 assert.equal(res.status,401);
 assert.deepEqual(calls,["auth"]);
 const missing=app({admin:{ok:false,status:503}});
 assert.equal((await missing.handler(request(),ctx)).status,503);
});
test("Rejects malformed IDs, suspicious token parameters and non-GET methods",async()=>{
 const failures=[
   {url:base+"?orderId=not-uuid"},
   {url:base+"?orderId="+id+"&token=sensitive"},
   {url:base+"?orderId="+id+"&secret=abc"},
   {url:base},
   {method:"POST"}
 ];
 for(const f of failures){
   const {handler,calls}=app();
   const res=await handler(request(f),ctx);
   assert.equal(res.status, f.method==="POST"?405:400);
   assert.ok(!calls.includes("db"));
 }
});
test("Unknown and LIVE orders do not reveal their existence or data",async()=>{
 for(const saved of [
   null,
   {...row,processing_mode:"live"},
   {...row,id:"ac20bc30-83b6-4fa2-b034-e5129232a210"},
   {...row,status:"unknown"}
 ]){
   const {handler}=app({saved});
   const res=await handler(request(),ctx);
   assert.equal(res.status,404);
   assert.ok(!JSON.stringify(await res.json()).includes("private"));
 }
});
test("Inconsistent paid status, invalid amount or database error fail closed",async()=>{
 for(const saved of [
  {...row,checkout_id:null},
  {...row,amount_cents:0},
  {...row,amount_cents:"wrong"},
  {...row,amount_cents:999999999999}
 ]){
   const {handler}=app({saved});
   const res=await handler(request(),ctx);
   assert.equal(res.status,503);
 }
 const {handler}=app({loadError:"password=never-show"});
 const res=await handler(request(),ctx);
 assert.equal(res.status,503);
 assert.ok(!JSON.stringify(await res.json()).includes("password"));
});
test("The status endpoint never references Yoco network requests or email delivery",async()=>{
 const {readFile}=await import("node:fs/promises");
 const source=await readFile("netlify/functions/mixed-book-yoco-test-order-status.mjs","utf8");
 assert.ok(!source.includes("payments.yoco.com"));
 assert.ok(!source.includes("requestMixedYocoTestCheckout"));
 assert.ok(!source.includes("settleAfterVerifiedWebhook"));
 assert.ok(!source.includes("grantStore"));
 assert.ok(!source.includes("email_outbox"));
 assert.ok(source.includes("loadYocoTestOrder"));
});
