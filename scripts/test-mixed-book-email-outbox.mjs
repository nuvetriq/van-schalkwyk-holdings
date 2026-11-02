import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {planAfterSignedPayment} from "../netlify/lib/mixed-book-fulfilment-plan.mjs";
import {composeMixedBookBrandEmail} from "../netlify/lib/mixed-book-email-templates.mjs";
import {bookDownloadUrl} from "../netlify/lib/mixed-book-download-grants.mjs";
import {
  claimMixedBookEmail,markMixedEmailAccepted,retryMixedEmailBeforeSend,
  holdMixedEmailUnknown,quarantineExpiredMixedEmailClaims
} from "../netlify/lib/mixed-book-email-outbox.mjs";

const a="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const b="ac20bc30-83b6-4fa2-b034-e5129232a210";
const records=new Map([
["grannys:"+a,{id:a,business:"grannys",title:"Granny's Recipe Book",
  category:"Recipe Books",price:129.99,pdf_path:"grannys/"+a+".pdf",is_active:true}],
["clever-cubs:"+b,{id:b,business:"clever-cubs",title:"Grade RR Afrikaans",
  category:"Preschool",price:85,pdf_path:"clever-cubs/"+b+".pdf",is_active:true}]
]);
const deps={
  async getProduct(brand,id){return records.get(brand+":"+id)||null},
  async getPrivateFile(){return {metadata:{size:1000}}}
};
async function plan(){
  const {master}=await snapshotMixedOrder({
    name:"Buyer Example",email:"buyer@example.com",
    items:[{business:"grannys",id:a},{business:"clever-cubs",id:b}]
  },deps);
  master.checkoutId="checkout_mockExample1234";
  master.processingMode="live";
  return planAfterSignedPayment(master,{
    source:"server-verified-yoco-webhook",signatureVerified:true,
    eventType:"payment.succeeded",paymentStatus:"succeeded",
    paymentId:"pay_Example123",eventId:"evt_Example123",
    amountCents:master.amountCents,currency:"ZAR",
    checkoutId:master.checkoutId,processingMode:"live"
  });
}
const link=id=>({
  id,url:bookDownloadUrl(crypto.randomBytes(32).toString("base64url"))
});
const claimed=job=>({...job,status:"claimed"});
test("Both customer emails use separate senders, brand totals and only owned links",async()=>{
  const p=await plan();
  for(const sale of p.sales){
    const job=claimed(p.jobs.find(j=>j.business===sale.business&&j.type==="customer-delivery"));
    const email=composeMixedBookBrandEmail({
      job,sale,downloadLinks:sale.items.map(item=>link(item.id))
    });
    const other=sale.business==="grannys"?"Grade RR":"Granny";
    assert.equal(email.to,"buyer@example.com");
    assert.equal(email.brand,sale.business);
    assert.equal(email.idempotencyKey,job.id);
    assert.ok(!email.subject.includes("payment receipt"));
    assert.ok(!email.text.includes(other));
    assert.ok(!email.html.includes(other));
    assert.ok(!email.text.includes(".pdf"));
    assert.ok(!email.html.includes(".pdf"));
    assert.ok(email.text.includes("R"+(sale.subtotalCents/100).toFixed(2)));
    assert.ok(email.text.includes("book-download.html"));
    if(sale.business==="grannys")
      assert.ok(email.from.includes("grannyspopsandtreats@gmail.com"));
    else assert.ok(email.from.includes("learningclevercubs@gmail.com"));
  }
});
test("Brand merchant notice has only its own sale, not other lines or PDF links",async()=>{
  const p=await plan();
  for(const sale of p.sales){
    const job=claimed(p.jobs.find(j=>j.business===sale.business&&j.type==="merchant-sale-notice"));
    const email=composeMixedBookBrandEmail({job,sale});
    assert.equal(email.to,job.sender);
    assert.ok(email.text.includes("Buyer Example"));
    assert.ok(!email.text.includes("book-download.html"));
    assert.ok(!email.text.includes(".pdf"));
    assert.ok(!email.html.includes(".pdf"));
    assert.ok(!email.text.includes(sale.business==="grannys"?"Grade RR":"Granny"));
  }
});
test("Refuse pre-claim simulation jobs and mismatched brand sender/recipient",async()=>{
  const p=await plan();
  const sale=p.sales[0];
  const job=p.jobs.find(j=>j.business===sale.business&&j.type==="customer-delivery");
  const links=sale.items.map(item=>link(item.id));
  assert.throws(()=>composeMixedBookBrandEmail({job,sale,downloadLinks:links}));
  for(const patch of [
    {business:"clever-cubs"},{recipient:"victim@example.com"},
    {sender:"learningclevercubs@gmail.com"},{bookTitles:["Grade RR Afrikaans"]},
    {amountCents:999},{privateBookPaths:["clever-cubs/"+b+".pdf"]}
  ])assert.throws(()=>composeMixedBookBrandEmail({
    job:{...claimed(job),...patch},sale,downloadLinks:links
  }));
});
test("Reject missing, foreign, misassigned and duplicated book links",async()=>{
  const p=await plan(),sale=p.sales[0];
  const job=claimed(p.jobs.find(j=>j.business==="grannys"&&j.type==="customer-delivery"));
  for(const links of [
    [],[{id:b,url:link(a).url}],
    [{id:a,url:"https://example.com/.netlify/functions/paid-book-download?token="+crypto.randomBytes(32).toString("base64url")}],
    [{id:a,url:"https://vanschalkwykholdings.com/.netlify/functions/paid-book-download?token=broken"}]
  ])assert.throws(()=>composeMixedBookBrandEmail({job,sale,downloadLinks:links}));
});
test("Claim SQL uses row lock, skips in-flight tasks, requires paid LIVE and sets UUID lease",async()=>{
  const p=await plan();
  const source=p.jobs[0];
  const calls=[];
  const pool={async query(sql,args){
    calls.push({sql,args});
    return {rows:[{
      ...source,id:source.id,order_id:source.masterOrderId,
      business:source.business,kind:source.type,
      status:"claimed",claim_token:args[0]
    }]};
  }};
  const got=await claimMixedBookEmail(pool);
  assert.equal(got.job.status,"claimed");
  assert.equal(got.claimToken,got.job.claim_token);
  assert.match(calls[0].sql,/FOR UPDATE OF j SKIP LOCKED/);
  assert.match(calls[0].sql,/o.status='paid' AND o.processing_mode='live'/);
  assert.match(calls[0].sql,/j.attempt_count < 4/);
  assert.equal(calls[0].args[1],120);
});
test("Outbox empty returns no task; invalid lease fails before DB query",async()=>{
  let called=0;
  const pool={async query(){called++;return {rows:[]}}};
  assert.equal(await claimMixedBookEmail(pool),null);
  await assert.rejects(claimMixedBookEmail(pool,{leaseSeconds:10}));
  assert.equal(called,1);
});
test("Accepted message records provider ID, an uncertain send is held, and pre-send failure may retry",async()=>{
  const p=await plan(),job=p.jobs[0],token=crypto.randomUUID();
  const statements=[];
  const pool={async query(sql,args){
    statements.push({sql,args});
    return {rows:[{id:job.id,status:sql.includes("'sent'")?"sent":sql.includes("'unknown'")?"unknown":"retry"}]};
  }};
  const ack=await markMixedEmailAccepted(pool,job.id,token,"provider-message-123");
  assert.equal(ack.status,"sent");
  assert.match(statements.at(-1).sql,/provider_message_id=\$3/);
  await retryMixedEmailBeforeSend(pool,job.id,token,10);
  assert.match(statements.at(-1).sql,/status=CASE WHEN attempt_count>=4 THEN 'failed' ELSE 'retry' END/);
  const held=await holdMixedEmailUnknown(pool,job.id,token);
  assert.equal(held.status,"unknown");
  assert.match(statements.at(-1).sql,/status='unknown'/);
  assert.ok(!statements.some(x=>x.sql.includes("INSERT INTO")));
  await assert.rejects(markMixedEmailAccepted(pool,job.id,token,"bad\nheader"));
});
test("Expired in-flight jobs are quarantined as unknown and not auto-retried",async()=>{
  let query="";
  const pool={async query(sql){
    query=sql;return {rows:[{id:"job1"},{id:"job2"}]};
  }};
  assert.deepEqual(await quarantineExpiredMixedEmailClaims(pool),["job1","job2"]);
  assert.match(query,/status='unknown'/);
  assert.match(query,/claim_until < now\(\)/);
  assert.doesNotMatch(query,/status='retry'/);
});
test("Customer titles and HTML are safely escaped",async()=>{
  const p=await plan(),sale=p.sales[0],job=claimed(p.jobs[0]);
  sale.items[0].title='<img src=x onerror="alert(1)">';
  job.bookTitles=[sale.items[0].title];
  const email=composeMixedBookBrandEmail({sale,job,downloadLinks:[link(a)]});
  assert.ok(!email.html.includes("<img"));
  assert.ok(email.html.includes("&lt;img"));
});
