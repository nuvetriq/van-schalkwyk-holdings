import {test} from "node:test";
import assert from "node:assert/strict";
import {createMixedBookCatalogueSource} from "../netlify/lib/mixed-book-catalogue-source.mjs";
import {
  createMixedBookTestCheckout,postYocoTestCheckout
} from "../netlify/lib/mixed-book-yoco-test-operation.mjs";
import {
  makeMixedBookTestCheckoutHandler,config
} from "../netlify/functions/mixed-book-yoco-test-checkout.mjs";

const recipe="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const workbook="ac20bc30-83b6-4fa2-b034-e5129232a210";
const web="https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-checkout";
const ctx={deploy:{context:"production"}};
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",VSH_MIXED_YOCO_TEST_ENABLED:"true",
  VSH_ENABLE_PAYMENTS:"false",
  VSH_MIXED_YOCO_TEST_KEY:"sk_test_"+"z".repeat(30),
  VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:"whsec_"+"a".repeat(24)
};
const product=(business,id,title,price)=>({
 id,business,title,price,category:business==="grannys"?"Recipe Books":"Preschool",
 pdf_path:business+"/"+id+".pdf",is_active:true
});
const stored=new Map([
  ["grannys/"+recipe+".json",product("grannys",recipe,"Recipe Book",129.99)],
  ["clever-cubs/"+workbook+".json",product("clever-cubs",workbook,"RR Afrikaans",85)]
]);
function catalogue(){
  return createMixedBookCatalogueSource({
    openStore(name){
      if(name==="vsh-products")return {
        async get(key){return stored.get(key)||null}
      };
      if(name==="vsh-private-recipe-pdfs")return {
        async getMetadata(key){return key.endsWith(".pdf")?{size:10000}:null},
        async get(){return null}
      };
      throw Error("Unfamiliar Blob namespace");
    }
  });
}
const cart={
  name:"Test Buyer",email:"buyer@example.com",
  items:[{business:"grannys",id:recipe},{business:"clever-cubs",id:workbook}]
};
const request=(payload=cart,{origin="https://vanschalkwykholdings.com",
 method="POST",type="application/json",url=web}={})=>new Request(url,{
 method,headers:{"Content-Type":type,...(origin===null?{}:{"Origin":origin}),
    "X-Admin-Key":"test-secret-admin"},
 ...(method==="POST"?{body:JSON.stringify(payload)}:{})
});
function deps(log=[]){
 let snapshot=null;
 return {
  catalogue:catalogue(),
  ledger:{
    async createPendingOrder(order,mode){
      assert.equal(mode,"test");
      log.push("save:pending");
      snapshot=order;
      return {orderId:order.id,status:"checkout_pending",mode:"test"};
    },
    async bindYocoCheckout(value){
      log.push("bind:checkout");
      assert.equal(value.orderId,snapshot.id);
      assert.equal(value.amountCents,21499);
      assert.equal(value.processingMode,"test");
      assert.equal(value.checkoutId,"checkout_MixedTest12345");
      return {...value,duplicate:false};
    }
  },
  secretKey:env.VSH_MIXED_YOCO_TEST_KEY,
  async postCheckout(req){
    log.push("provider:checkout");
    assert.equal(req.url,"https://payments.yoco.com/api/checkouts");
    assert.ok(req.headers.Authorization.startsWith("Bearer sk_test_"));
    const sent=JSON.parse(req.body);
    assert.equal(sent.amount,21499);
    assert.equal(sent.currency,"ZAR");
    assert.equal(sent.metadata.orderId,snapshot.id);
    return {ok:true,data:{
      id:"checkout_MixedTest12345",
      status:"created",amount:21499,currency:"ZAR",processingMode:"test",
      redirectUrl:"https://c.yoco.com/checkout/mixedTest12345",
      externalId:snapshot.id,clientReferenceId:snapshot.id
    }};
  }
 };
}
test("Server-only catalogue reads the right active brand PDFs, never client prices",async()=>{
 const c=catalogue();
 const a=await c.getProduct("grannys",recipe);
 const b=await c.getProduct("clever-cubs",workbook);
 assert.equal(a.price,129.99);
 assert.equal(b.price,85);
 assert.equal(await c.getProduct("clever-cubs",recipe),null);
 assert.equal(await c.getProduct("evil",recipe),null);
 assert.equal(await c.getPrivateFile("clever-cubs","grannys/"+recipe+".pdf"),null);
 assert.ok((await c.getPrivateFile("grannys",a.pdf_path)).metadata);
 assert.ok((await c.getPrivateFile("clever-cubs",b.pdf_path)).metadata);
});
test("One TEST payment request is saved, then created at Yoco, then bound BEFORE redirect",async()=>{
 const log=[];
 const result=await createMixedBookTestCheckout({
   ...cart,items:cart.items.map(x=>({...x,price:0,title:"FREE"}))
 },deps(log));
 assert.deepEqual(log,["save:pending","provider:checkout","bind:checkout"]);
 assert.equal(result.amountCents,21499);
 assert.equal(result.processingMode,"test");
 assert.equal(result.emailsSent,0);
 assert.equal(result.pdfsDelivered,0);
 assert.equal(result.redirectUrl,"https://c.yoco.com/checkout/mixedTest12345");
});
test("Provider failure or DB binding failure cannot reveal a checkout redirect",async()=>{
 for(const fail of ["provider","binding"]){
   let bound=false;
   const d=deps();
   const originalPost=d.postCheckout;
   d.postCheckout=async req=>{
     if(fail==="provider")throw Error("Yoco unavailable");
     return originalPost(req);
   };
   const originalBind=d.ledger.bindYocoCheckout;
   d.ledger.bindYocoCheckout=async value=>{
     bound=true;
     if(fail==="binding")throw Error("Database unavailable");
     return originalBind(value);
   };
   await assert.rejects(createMixedBookTestCheckout(cart,d));
   assert.equal(bound,fail==="binding");
 }
});
test("Official transport never calls the network for fake Yoco URL/key",async()=>{
 let called=0;
 const valid={
   url:"https://payments.yoco.com/api/checkouts",
   headers:{
     Authorization:"Bearer "+env.VSH_MIXED_YOCO_TEST_KEY,
     "Content-Type":"application/json","Idempotency-Key":"test-only"
   },
   body:JSON.stringify({amount:21499,currency:"ZAR"})
 };
 await assert.rejects(postYocoTestCheckout({...valid,url:"https://example.com"} ,{
   transport:async()=>{called++;return {ok:true}}
 }));
 assert.equal(called,0);
 const outcome=await postYocoTestCheckout(valid,{
   transport:async(url,req)=>{
     called++;
     assert.equal(url,valid.url);
     assert.equal(req.method,"POST");
     assert.equal(req.redirect,"error");
     assert.ok(req.signal);
     return {
       ok:true,headers:new Headers({"content-length":"6"}),
       async text(){return '{"id":1}'}
     };
   }
 });
 assert.equal(called,1);
 assert.equal(outcome.data.id,1);
});
function handler(extra={}){
 const calls=[];
 const f=makeMixedBookTestCheckoutHandler({
   env,
   authorize:()=>({ok:true}),
   catalogueFactory:()=>{calls.push("catalogue");return catalogue()},
   databaseFactory:()=>{calls.push("database");return deps().ledger},
   operate:async()=>{
     calls.push("operation");return{
       orderId:recipe,checkoutId:"checkout_MixedTest12345",
       redirectUrl:"https://c.yoco.com/checkout/mixedTest12345",
       amountCents:21499
     }
   },
   ...extra
 });
 return {f,calls};
}
test("Endpoint OFF by default, wrong host or preview never reaches database",async()=>{
 for(const options of [
   {env:{...env,VSH_MIXED_YOCO_TEST_ENABLED:"false"},context:ctx},
   {env:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"},context:ctx},
   {env:{...env,VSH_ENABLE_PAYMENTS:"true"},context:ctx},
   {env:{...env,VSH_MIXED_YOCO_TEST_KEY:"sk_live_bad"},context:ctx},
   {env:{...env,VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:""},context:ctx},
   {env,context:{deploy:{context:"deploy-preview"}}},
   {env,context:ctx,url:"https://preview.netlify.app/.netlify/functions/mixed-book-yoco-test-checkout"}
 ]){
   const {f,calls}=handler({env:options.env});
   const response=await f(request(cart,{url:options.url||web}),options.context);
   assert.equal(response.status,503);
   assert.deepEqual(calls,[]);
 }
});
test("Endpoint requires admin and same-origin requests before any storage access",async()=>{
 const unauth=handler({authorize:()=>({ok:false,status:401})});
 assert.equal((await unauth.f(request(),ctx)).status,401);
 assert.deepEqual(unauth.calls,[]);
 const cross=handler();
 assert.equal((await cross.f(request(cart,{origin:"https://phishing.example"}),ctx)).status,403);
 assert.deepEqual(cross.calls,[]);
 const wrongType=handler();
 assert.equal((await wrongType.f(request(cart,{type:"text/plain"}),ctx)).status,415);
 assert.deepEqual(wrongType.calls,[]);
 const wrongMethod=handler();
 assert.equal((await wrongMethod.f(request(cart,{method:"GET"}),ctx)).status,405);
 assert.deepEqual(wrongMethod.calls,[]);
});
test("Successful endpoint returns only test redirect, never admin/DB keys or paid state",async()=>{
 const {f,calls}=handler();
 const result=await f(request(),ctx);
 assert.equal(result.status,201);
 const body=await result.json();
 assert.equal(body.amountCents,21499);
 assert.equal(body.paymentVerified,false);
 assert.equal(body.processingMode,"test");
 assert.equal(body.redirectUrl,"https://c.yoco.com/checkout/mixedTest12345");
 assert.equal(result.headers.get("cache-control"),"no-store");
 assert.ok(!JSON.stringify(body).includes(env.VSH_MIXED_YOCO_TEST_KEY));
 assert.deepEqual(calls,["catalogue","database","operation"]);
 assert.equal(config.rateLimit.windowLimit,4);
});
test("Failed operation suppresses internal errors and cannot return redirect",async()=>{
 const {f}=handler({operate:async()=>{throw Error("postgres password or PDF key secret")}});
 const result=await f(request(),ctx);
 assert.equal(result.status,503);
 const body=await result.json();
 assert.equal(body.error,"The test checkout could not be prepared.");
 assert.ok(!JSON.stringify(body).includes("password"));
});
