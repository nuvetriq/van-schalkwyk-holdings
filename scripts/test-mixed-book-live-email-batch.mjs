import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createControlledMixedBookEmailBatch}
 from "../netlify/lib/mixed-book-live-email-batch.mjs";

const context={deploy:{context:"production"}};
const env={
 VSH_MIXED_BOOK_DB_ENABLED:"true",
 VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true",
 VSH_MIXED_BOOK_EMAIL_ENABLED:"true",
 VSH_MIXED_YOCO_LIVE_ENABLED:"true",
 VSH_MIXED_YOCO_TEST_ENABLED:"false",
 VSH_ENABLE_PAYMENTS:"true"
};
const gr="grannys",cc="clever-cubs";
const result=(status,business=gr,kind="customer-delivery")=>({
 status,business,kind
});
function fixture(sequence=[],opts={}){
 const calls=[],queue=[...sequence];
 const factory=params=>{
   calls.push({type:"factory",enabled:params.enabled,
     operatorApproved:params.operatorApproved,context:params.context,
     env:params.env});
   return {async runOne(){
     calls.push({type:"job"});
     return queue.shift()||{status:"empty"};
   }};
 };
 return {calls,factory,make(options={}){
   return createControlledMixedBookEmailBatch({
     enabled:true,operatorApproved:true,context,env,maxJobs:4,
     workerFactory:factory,...opts,...options
   });
 }};
}
test("One 2-brand LIVE sale produces four brand-scoped jobs at most",async()=>{
 const x=fixture([
   result("sent",gr,"customer-delivery"),
   result("sent",gr,"merchant-sale-notice"),
   result("sent",cc,"customer-delivery"),
   result("sent",cc,"merchant-sale-notice"),
   result("sent",gr,"customer-delivery")
 ]);
 const outcome=await x.make().runBatch();
 assert.deepEqual(outcome,{
  jobsAttempted:4,sent:4,retry:0,failed:0,unknown:0,
  queueExhausted:false,
  byBrand:{
   grannys:{sent:2,retry:0,failed:0,unknown:0},
   "clever-cubs":{sent:2,retry:0,failed:0,unknown:0}
  },emailsMayHaveBeenAccepted:4
 });
 assert.equal(x.calls.filter(x=>x.type==="job").length,4);
 assert.equal(x.calls.filter(x=>x.type==="factory").length,1);
 assert.equal("customer_email" in outcome,false);
 assert.equal("private_pdf_path" in outcome,false);
 assert.ok(Object.isFrozen(outcome));
});
test("An ambiguous SMTP result remains quarantined; runner processes only separate jobs",async()=>{
 const x=fixture([
  result("unknown",gr,"customer-delivery"),
  result("sent",gr,"merchant-sale-notice"),
  result("sent",cc,"customer-delivery"),
  {status:"empty"}
 ]);
 const answer=await x.make().runBatch();
 assert.equal(answer.unknown,1);
 assert.equal(answer.sent,2);
 assert.equal(answer.jobsAttempted,3);
 assert.equal(answer.queueExhausted,true);
 assert.equal(answer.emailsMayHaveBeenAccepted,3);
 assert.equal(x.calls.filter(x=>x.type==="job").length,4);
 assert.equal(answer.byBrand.grannys.unknown,1);
 assert.equal(answer.byBrand["clever-cubs"].sent,1);
});
test("No queued jobs means no email attempts beyond the first empty read",async()=>{
 const x=fixture();
 const output=await x.make().runBatch();
 assert.equal(output.jobsAttempted,0);
 assert.equal(output.queueExhausted,true);
 assert.equal(x.calls.filter(x=>x.type==="job").length,1);
});
test("All LIVE flags, approval, production context and bounded job count are mandatory",()=>{
 const x=fixture();
 const cases=[
  {enabled:false},{operatorApproved:false},
  {context:{deploy:{context:"deploy-preview"}}},
  {context:{deploy:{context:"branch-deploy"}}},
  {maxJobs:0},{maxJobs:5},{maxJobs:Infinity},{maxJobs:"4"},
  {env:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"}},
  {env:{...env,VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"false"}},
  {env:{...env,VSH_MIXED_BOOK_EMAIL_ENABLED:"false"}},
  {env:{...env,VSH_MIXED_YOCO_LIVE_ENABLED:"false"}},
  {env:{...env,VSH_MIXED_YOCO_TEST_ENABLED:"true"}},
  {env:{...env,VSH_ENABLE_PAYMENTS:"false"}}
 ];
 for(const item of cases){
  assert.throws(()=>x.make(item),/not enabled/);
 }
 assert.deepEqual(x.calls,[]);
});
test("Invalid worker result never silently passes as successful email delivery",async()=>{
 for(const item of [
   null,{status:"paid"},{status:"sent",business:"third-party",kind:"customer-delivery"},
   {status:"retry",business:gr,kind:"unknown"}
 ]){
   const x=fixture([item]);
   await assert.rejects(x.make().runBatch(),/not enabled/);
 }
});
test("Batch runner is never an HTTP function, timer or scheduled Netlify trigger",async()=>{
 const code=await readFile("netlify/lib/mixed-book-live-email-batch.mjs","utf8");
 assert.match(code,/maxJobs=4/);
 assert.match(code,/maxJobs>4/);
 assert.match(code,/VSH_MIXED_YOCO_TEST_ENABLED/);
 assert.doesNotMatch(code,/export\s+default/);
 assert.doesNotMatch(code,/export\s+const\s+config\s*=/);
 assert.doesNotMatch(code,/\.schedule\(/);
 assert.doesNotMatch(code,/setInterval\(/);
 assert.doesNotMatch(code,/createServer\(/);
 assert.doesNotMatch(code,/sendMail\(/);
 assert.doesNotMatch(code,/createCheckout\(/);
 const netlify=await readFile("netlify.toml","utf8");
 assert.ok(!netlify.includes("mixed-book-live-email-batch"));
});
