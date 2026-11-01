import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createMixedBookEmailOperatorReview}
  from "../netlify/lib/mixed-book-email-operator-review.mjs";

const context={deploy:{context:"production"}};
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED:"true"
};
function fixture({rows=[],error=null}={}){
  const calls=[];
  const poolFactory=options=>{
    calls.push({kind:"open",options});
    return {async query(sql,params){
      calls.push({kind:"query",sql,params});
      if(error)throw Error("private-db-error@example.invalid");
      return {rows};
    }};
  };
  return {calls,poolFactory};
}
function create(f,overrides={}){
  return createMixedBookEmailOperatorReview({
    enabled:true,operatorApproved:true,context,env,
    poolFactory:f.poolFactory,...overrides
  });
}
test("Requires explicit review approval and flags before opening database",()=>{
  const f=fixture();
  for(const values of [
    {enabled:false},
    {operatorApproved:false},
    {env:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"}},
    {env:{...env,VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED:"false"}},
    {context:{deploy:{context:"deploy-preview"}}},
    {context:{deploy:{context:"branch-deploy"}}},
    {context:{}}
  ]){
    assert.throws(()=>create(f,values),/not enabled/);
  }
  assert.equal(f.calls.length,0);
  assert.throws(()=>createMixedBookEmailOperatorReview(),/not enabled/);
});
test("Inspects only LIVE brand-grouped counts, never email addresses or private links",async()=>{
  const rows=[
    {business:"grannys",kind:"customer-delivery",status:"pending",
      order_status:"paid",jobs:3,expired_claims:0},
    {business:"grannys",kind:"merchant-sale-notice",status:"unknown",
      order_status:"paid",jobs:2,expired_claims:0},
    {business:"clever-cubs",kind:"customer-delivery",status:"claimed",
      order_status:"paid",jobs:1,expired_claims:1},
    {business:"clever-cubs",kind:"merchant-sale-notice",status:"sent",
      order_status:"refunded",jobs:1,expired_claims:0}
  ];
  const f=fixture({rows});
  const result=await create(f).inspect();
  assert.deepEqual({
    reviewOnly:result.reviewOnly,canSend:result.canSend,
    processingMode:result.processingMode,total:result.total,
    eligiblePending:result.eligiblePending,
    needsManualReview:result.needsManualReview,
    nonPaidOrderJobs:result.nonPaidOrderJobs,
    byBrand:result.byBrand
  },{
    reviewOnly:true,canSend:false,processingMode:"live",
    total:7,eligiblePending:3,needsManualReview:3,
    nonPaidOrderJobs:1,
    byBrand:{"grannys":5,"clever-cubs":2}
  });
  assert.equal(f.calls[0].kind,"open");
  assert.deepEqual(f.calls[0].options,{context,enabled:"true"});
  assert.equal(f.calls[1].kind,"query");
  assert.equal(f.calls[1].params,undefined);
  assert.match(f.calls[1].sql,/o\.processing_mode='live'/);
  assert.match(f.calls[1].sql,/SELECT j\.business,j\.kind,j\.status,o\.status/);
  assert.doesNotMatch(f.calls[1].sql,/j\.recipient|j\.sender|customer_email|customer_name|j\.payload|SELECT \*/);
  assert.doesNotMatch(f.calls[1].sql,/UPDATE|DELETE|INSERT|TRUNCATE|RETURNING|FOR UPDATE/i);
  const serialized=JSON.stringify(result);
  for(const forbidden of ["@", "#token=","token_hash","provider_message_id","orderId","recipient","private_pdf_path"])
    assert.ok(!serialized.includes(forbidden));
});
test("No paid LIVE email jobs yields a safe empty, never-send preview",async()=>{
  const f=fixture();
  const report=await create(f).inspect();
  assert.equal(report.total,0);
  assert.equal(report.eligiblePending,0);
  assert.equal(report.canSend,false);
  assert.deepEqual(report.byBrand,{"grannys":0,"clever-cubs":0});
  assert.deepEqual(report.groups,[]);
});
test("Unexpected, invalid and oversized DB data fail closed without message details",async()=>{
  for(const rows of [
    [{business:"other",kind:"customer-delivery",status:"pending",order_status:"paid",jobs:1,expired_claims:0}],
    [{business:"grannys",kind:"other",status:"pending",order_status:"paid",jobs:1,expired_claims:0}],
    [{business:"grannys",kind:"customer-delivery",status:"queued",order_status:"paid",jobs:1,expired_claims:0}],
    [{business:"grannys",kind:"customer-delivery",status:"pending",order_status:"test",jobs:1,expired_claims:0}],
    [{business:"grannys",kind:"customer-delivery",status:"pending",order_status:"paid",jobs:-1,expired_claims:0}],
    [{business:"grannys",kind:"customer-delivery",status:"pending",order_status:"paid",jobs:1,expired_claims:2}],
    Array.from({length:121},()=>({
      business:"grannys",kind:"customer-delivery",status:"pending",
      order_status:"paid",jobs:1,expired_claims:0
    }))
  ]){
    await assert.rejects(create(fixture({rows})).inspect(),/not enabled/);
  }
});
test("SQL/connection errors do not enable a worker or send an email",async()=>{
  const f=fixture({error:true});
  await assert.rejects(create(f).inspect(),error=>{
    assert.equal(error.message,"Email outbox review unavailable.");
    assert.ok(!error.message.includes("@"));
    return true;
  });
  assert.deepEqual(f.calls.map(c=>c.kind),["open","query"]);
});
test("Preview is server-only; no scheduled/HTTP handler or public secret added",async()=>{
  const source=await readFile("netlify/lib/mixed-book-email-operator-review.mjs","utf8");
  const config=await readFile("netlify.toml","utf8");
  for(const pattern of [
    /export default/,/schedule\s*:/,
    /sendMail\s*\(/,/createControlledMixedBookEmailWorker/,
    /dispatchOneMixedBrandEmail/,/claimMixedBookEmail/,
    /setTimeout\(/, /process\.env\.VSH_GRANNYS_SMTP_APP_PASSWORD/
  ])assert.doesNotMatch(source,pattern);
  assert.match(source,/enabled=false,operatorApproved=false/);
  assert.match(source,/VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED/);
  assert.doesNotMatch(config,/VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED/);
});
