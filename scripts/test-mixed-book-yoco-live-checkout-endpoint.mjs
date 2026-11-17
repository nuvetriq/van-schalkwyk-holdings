import {test} from "node:test";
import assert from "node:assert/strict";
import {
 makeMixedBookYocoLiveCheckoutHandler,config
} from "../netlify/functions/mixed-book-yoco-live-checkout.mjs";

const SITE="https://vanschalkwykholdings.com";
const URL=SITE+"/api/books/live-checkout";
const production={deploy:{context:"production"}};
const key="sk_live_"+("L".repeat(32));
const whsec="whsec_"+Buffer.alloc(32,0x62).toString("base64");
const env={
 VSH_MIXED_BOOK_PUBLIC_CHECKOUT_ENABLED:"true",
 VSH_MIXED_BOOK_DB_ENABLED:"true",
 VSH_MIXED_YOCO_LIVE_ENABLED:"true",
 VSH_ENABLE_PAYMENTS:"true",
 VSH_MIXED_YOCO_TEST_ENABLED:"false",
 VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED:"true",
 VSH_MIXED_BOOK_EMAIL_ENABLED:"true",
 VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true",
 VSH_MIXED_YOCO_LIVE_KEY:key,
 VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET:whsec,
 VSH_MIXED_BOOK_LINK_KEY:"vshlk_"+Buffer.alloc(32,0x65).toString("base64"),
 VSH_GRANNYS_GMAIL_USER:"grannyspopsandtreats@gmail.com",
 VSH_GRANNYS_GMAIL_APP_PASSWORD:"a".repeat(16),
 VSH_CLEVERCUBS_GMAIL_USER:"learningclevercubs@gmail.com",
 VSH_CLEVERCUBS_GMAIL_APP_PASSWORD:"b".repeat(16)
};
const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const id1="ac20bc30-83b6-4fa2-b034-e5129232a210";
const id2="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const body={name:"Test Buyer",email:"customer@example.com",items:[
 {business:"grannys",id:id1},{business:"clever-cubs",id:id2}
]};
const response={
 orderId,redirectUrl:"https://c.yoco.com/checkout/LiveCheckout98765",
 amountCents:14500,currency:"ZAR",processingMode:"live",paymentVerified:false
};
function request(input=body,options={}){
 return new Request(options.url||URL,{
  method:options.method||"POST",
  headers:{
   origin:options.origin===undefined?SITE:options.origin,
   "content-type":options.contentType||"application/json",
   ...(options.headers||{})
  },
  body:options.method==="GET"?undefined:
   options.raw===undefined?JSON.stringify(input):options.raw
 });
}
function app(settings=env,extra={}){
 const calls=[];
 const handler=makeMixedBookYocoLiveCheckoutHandler({
  env:settings,
  catalogueFactory:()=>{calls.push("catalogue");return {getProduct(){},getPrivateFile(){}};},
  databaseFactory:()=>{calls.push("database");return {createPendingOrder(){},bindYocoCheckout(){}};},
  operate:async(input,opts)=>{
   calls.push("operate");
   assert.deepEqual(input,body);
   assert.equal(opts.enabled,true);
   assert.equal(opts.operatorApproved,true);
   assert.equal(opts.secretKey,key);
   assert.equal(typeof opts.postCheckout,"function");
   return extra.outcome||response;
  }
 });
 return {calls,handler};
}

test("The checkout endpoint is rate-limited and never routed from the public cart",()=>{
 assert.equal(config.path,"/api/books/live-checkout");
 assert.equal(config.method,"POST");
 assert.equal(config.rateLimit.aggregateBy,"ip");
 assert.equal(config.rateLimit.windowLimit,3);
 assert.equal(config.rateLimit.windowSize,60);
});

test("Every unavailable, TEST, missing-secret or wrong-brand state makes ZERO database or Yoco calls",async()=>{
 const changes=[
  ["VSH_MIXED_BOOK_PUBLIC_CHECKOUT_ENABLED",undefined],
  ["VSH_MIXED_BOOK_PUBLIC_CHECKOUT_ENABLED","false"],
  ["VSH_MIXED_BOOK_DB_ENABLED","false"],
  ["VSH_MIXED_YOCO_LIVE_ENABLED","false"],
  ["VSH_ENABLE_PAYMENTS","false"],
  ["VSH_MIXED_YOCO_TEST_ENABLED","true"],
  ["VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED","false"],
  ["VSH_MIXED_BOOK_EMAIL_ENABLED","false"],
  ["VSH_MIXED_BOOK_DOWNLOADS_ENABLED","false"],
  ["VSH_MIXED_YOCO_LIVE_KEY","sk_test_"+("T".repeat(32))],
  ["VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET",undefined],
  ["VSH_MIXED_BOOK_LINK_KEY",""],
  ["VSH_GRANNYS_GMAIL_USER","learningclevercubs@gmail.com"],
  ["VSH_CLEVERCUBS_GMAIL_USER","grannyspopsandtreats@gmail.com"],
  ["VSH_GRANNYS_GMAIL_APP_PASSWORD",""],
  ["VSH_CLEVERCUBS_GMAIL_APP_PASSWORD",""]
 ];
 for(const [name,value] of changes){
  const x=app({...env,[name]:value});
  const result=await x.handler(request(),production);
  assert.equal(result.status,503,name);
  assert.deepEqual(x.calls,[],name);
  assert.equal(JSON.stringify(await result.json()).includes(key),false);
 }
 for(const ctx of [{deploy:{context:"deploy-preview"}},
  {deploy:{context:"branch-deploy"}},{}]){
  const x=app();
  assert.equal((await x.handler(request(),ctx)).status,503);
  assert.deepEqual(x.calls,[]);
 }
 const x=app();
 assert.equal((await x.handler(request(body,{url:"https://malicious.example/api/books/live-checkout"}),production)).status,503);
 assert.deepEqual(x.calls,[]);
});

test("Cross-site and missing browser Origin fail before looking at customer data",async()=>{
 for(const origin of ["https://evil.example","null",""]){
  const x=app();
  const r=await x.handler(request(body,{origin}),production);
  assert.equal(r.status,403);
  assert.deepEqual(x.calls,[]);
 }
 const x=app();
 const r=await x.handler(request(body,{headers:{"Sec-Fetch-Site":"cross-site"}}),production);
 assert.equal(r.status,403);
 assert.deepEqual(x.calls,[]);
});

test("Invalid body and unexpected fields fail closed with no stored orders",async()=>{
 const invalid=[
  {...body,amountCents:1},
  {...body,items:[{...body.items[0],priceCents:1}]},
  {...body,items:[]},
  {...body,items:[{business:"grannys",id:id1,private_pdf_path:"fake"}]},
  {...body,items:Array.from({length:21},()=>body.items[0])},
  {...body,name:1}
 ];
 for(const input of invalid){
  const x=app();
  const r=await x.handler(request(input),production);
  assert.equal(r.status,400);
  assert.deepEqual(x.calls,[]);
 }
 const x=app();
 assert.equal((await x.handler(request(body,{raw:"-".repeat(4100)}),production)).status,413);
 assert.equal((await x.handler(request(body,{raw:"not json"}),production)).status,400);
 assert.equal((await x.handler(request(body,{contentType:"text/plain"}),production)).status,415);
 assert.deepEqual(x.calls,[]);
});

test("One correct LIVE checkout returns only a redirect after durable binding",async()=>{
 const x=app();
 const r=await x.handler(request(),production);
 assert.equal(r.status,201);
 assert.equal(r.headers.get("cache-control"),"no-store");
 assert.deepEqual(await r.json(),{
  orderId,redirectUrl:response.redirectUrl,
  amountCents:14500,currency:"ZAR",paymentVerified:false
 });
 assert.deepEqual(x.calls,["catalogue","database","operate"]);
});

test("Unverified, fake or unsafe provider response is never released to customer",async()=>{
 for(const outcome of [
  {...response,paymentVerified:true},
  {...response,processingMode:"test"},
  {...response,orderId:"not-an-order"},
  {...response,redirectUrl:"https://evil.example/checkout/fake123"},
  {...response,amountCents:0},
  {...response,currency:"USD"}
 ]){
  const x=app(env,{outcome});
  const original=console.error;
  const log=[];
  let r;
  try{
   console.error=(...v)=>log.push(v.join(" "));
   r=await x.handler(request(),production);
  }finally{console.error=original;}
  assert.equal(r.status,503);
  const message=JSON.stringify(await r.json());
  assert.ok(!message.includes(key));
  assert.ok(!message.includes(orderId));
  assert.ok(!log.join(" ").includes(key));
 }
});

test("GET cannot create a checkout and caller cannot infer customer secrets",async()=>{
 const x=app();
 assert.equal((await x.handler(request(body,{method:"GET"}),production)).status,405);
 assert.deepEqual(x.calls,[]);
});
