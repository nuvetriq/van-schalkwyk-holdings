import {test} from "node:test";
import assert from "node:assert/strict";
import {
  snapshotMixedOrder
} from "../netlify/lib/mixed-book-order.mjs";
import {
  planAfterSignedPayment, visibleToBusiness
} from "../netlify/lib/mixed-book-fulfilment-plan.mjs";

const a="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const b="ac20bc30-83b6-4fa2-b034-e5129232a210";
const checkoutId="checkout_mockYoco98765";
const products=new Map([
  ["grannys:"+a,{
    id:a,business:"grannys",title:"Granny's Recipe Book",category:"Recipe Books",
    price:129.99,pdf_path:"grannys/"+a+".pdf",is_active:true
  }],
  ["clever-cubs:"+b,{
    id:b,business:"clever-cubs",title:"Grade RR Afrikaans",
    category:"Preschool",price:85.00,
    pdf_path:"clever-cubs/"+b+".pdf",is_active:true
  }]
]);
const deps={
  async getProduct(brand,id){return products.get(brand+":"+id)||null},
  async getPrivateFile(){return {metadata:{size:300000}}}
};
const input={name:"Test Customer",email:"customer@example.com",
  items:[{business:"grannys",id:a},{business:"clever-cubs",id:b}]};
async function setup(which="both",mode="live"){
  const subset=which==="both"?input.items:input.items.filter(x=>x.business===which);
  const {master}=await snapshotMixedOrder({...input,items:subset},deps);
  master.checkoutId=checkoutId;
  master.processingMode=mode;
  const confirmed={
    source:"server-verified-yoco-webhook",signatureVerified:true,
    eventType:"payment.succeeded",paymentStatus:"succeeded",
    paymentId:"pay_Example123456",eventId:"evt_Example123456",
    checkoutId,amountCents:master.amountCents,
    currency:"ZAR",processingMode:mode
  };
  return {master,confirmed};
}
test("One verified mixed payment prepares four separately routed email jobs",async()=>{
  const {master,confirmed}=await setup();
  const plan=planAfterSignedPayment(master,confirmed);
  assert.equal(plan.amountCents,21499);
  assert.equal(plan.sales.length,2);
  assert.equal(plan.jobs.length,4);
  assert.equal(plan.simulatedJobs.length,0);
  assert.equal(plan.canDispatchEmails,true);
  assert.equal(new Set(plan.jobs.map(job=>job.id)).size,4);
  assert.equal(plan.jobs.filter(job=>job.type==="customer-delivery").length,2);
  assert.equal(plan.jobs.filter(job=>job.type==="merchant-sale-notice").length,2);
  assert.ok(plan.jobs.every(job=>job.status==="pending"));
});
test("Granny's only sees Granny's sales, subjects, recipients and private files",async()=>{
  const {master,confirmed}=await setup();
  const scoped=visibleToBusiness(planAfterSignedPayment(master,confirmed),"grannys");
  assert.equal(scoped.sales.length,1);
  assert.equal(scoped.jobs.length,2);
  for(const job of scoped.jobs) {
    assert.equal(job.business,"grannys");
    assert.equal(job.sender,"grannyspopsandtreats@gmail.com");
    assert.deepEqual(job.bookTitles,["Granny's Recipe Book"]);
    assert.equal(job.amountCents,12999);
    assert.equal(JSON.stringify(job).includes("clever-cubs"),false);
    assert.equal(JSON.stringify(job).includes("Grade RR"),false);
    if(job.type==="customer-delivery"){
      assert.equal(job.recipient,"customer@example.com");
      assert.deepEqual(job.privateBookPaths,["grannys/"+a+".pdf"]);
    }else{
      assert.equal(job.recipient,"grannyspopsandtreats@gmail.com");
      assert.equal(Object.hasOwn(job,"privateBookPaths"),false);
    }
  }
});
test("CleverCubs only sees CleverCubs sales and email details",async()=>{
  const {master,confirmed}=await setup();
  const scoped=visibleToBusiness(planAfterSignedPayment(master,confirmed),"clever-cubs");
  assert.equal(scoped.sales.length,1);
  assert.equal(scoped.jobs.length,2);
  assert.deepEqual(scoped.jobs.map(job=>job.recipient),[
    "customer@example.com","learningclevercubs@gmail.com"
  ]);
  for(const job of scoped.jobs) {
    assert.equal(job.sender,"learningclevercubs@gmail.com");
    assert.deepEqual(job.bookTitles,["Grade RR Afrikaans"]);
    assert.equal(job.amountCents,8500);
    assert.equal(JSON.stringify(job).includes("Granny"),false);
    assert.equal(JSON.stringify(job).includes("grannys"),false);
  }
});
test("Only purchased brand gets two email tasks, other brand gets none",async()=>{
  for(const business of ["grannys","clever-cubs"]){
    const {master,confirmed}=await setup(business);
    const plan=planAfterSignedPayment(master,confirmed);
    assert.equal(plan.sales.length,1);
    assert.equal(plan.jobs.length,2);
    assert.equal(visibleToBusiness(plan,business).jobs.length,2);
    const other=business==="grannys"?"clever-cubs":"grannys";
    assert.equal(visibleToBusiness(plan,other).jobs.length,0);
  }
});
test("Sandbox payments can never queue customer email or merchant sale notice",async()=>{
  const {master,confirmed}=await setup("both","test");
  const plan=planAfterSignedPayment(master,confirmed);
  assert.equal(plan.testOnly,true);
  assert.equal(plan.canDispatchEmails,false);
  assert.equal(plan.jobs.length,0);
  assert.equal(plan.simulatedJobs.length,4);
});
test("Repeated verification yields same deterministic outbox IDs",async()=>{
  const {master,confirmed}=await setup();
  const first=planAfterSignedPayment(master,confirmed);
  const second=planAfterSignedPayment(master,{...confirmed,eventId:"evt_AnotherValidEvent"});
  assert.deepEqual(first.jobs.map(job=>job.id),second.jobs.map(job=>job.id));
  assert.equal(new Set(first.jobs.map(job=>job.id)).size,first.jobs.length);
});
test("Cannot create delivery plan without authenticated signed payment evidence",async()=>{
  const {master,confirmed}=await setup();
  for(const patch of [
    {signatureVerified:false},{source:"browser-redirect"},
    {eventType:"payment.failed"},{paymentStatus:"failed"},
    {checkoutId:"checkout_someoneElse12345"},
    {amountCents:confirmed.amountCents+100},{currency:"USD"},
    {processingMode:"test"},{paymentId:""},{eventId:""}
  ]){
    assert.throws(()=>planAfterSignedPayment(master,{...confirmed,...patch}));
  }
});
test("Reject unsafe cross-brand private PDF paths, duplicate lines and tampered amount",async()=>{
  const {master,confirmed}=await setup();
  assert.throws(()=>planAfterSignedPayment({
    ...master,items:[{...master.items[0],pdfPath:"clever-cubs/"+b+".pdf"},master.items[1]]
  },confirmed));
  assert.throws(()=>planAfterSignedPayment({
    ...master,items:[...master.items,master.items[0]]
  },confirmed));
  assert.throws(()=>planAfterSignedPayment({...master,amountCents:999},confirmed));
});
test("Merchant email job includes only business subtotal, not full cart or PDF paths",async()=>{
  const {master,confirmed}=await setup();
  const jobs=planAfterSignedPayment(master,confirmed).jobs;
  const merchants=jobs.filter(job=>job.type==="merchant-sale-notice");
  assert.equal(merchants.length,2);
  assert.equal(merchants.reduce((sum,j)=>sum+j.amountCents,0),master.amountCents);
  for(const job of merchants){
    assert.equal(Object.hasOwn(job,"privateBookPaths"),false);
    assert.equal(Object.hasOwn(job,"items"),false);
    assert.equal(Object.hasOwn(job,"master"),false);
    assert.ok(job.recipient===job.sender);
  }
});
