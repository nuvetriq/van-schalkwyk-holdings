import {test} from "node:test";
import assert from "node:assert/strict";
import {
  makeMixedBookLiveEmailScheduler,config
} from "../netlify/functions/mixed-book-live-email-scheduler.mjs";

const context={deploy:{context:"production"}};
const env={
  VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED:"true",
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true",
  VSH_MIXED_BOOK_EMAIL_ENABLED:"true",
  VSH_MIXED_YOCO_LIVE_ENABLED:"true",
  VSH_MIXED_YOCO_TEST_ENABLED:"false",
  VSH_ENABLE_PAYMENTS:"true",
  VSH_MIXED_BOOK_LINK_KEY:"vshlk_"+Buffer.alloc(32,0x56).toString("base64"),
  VSH_GRANNYS_GMAIL_USER:"grannyspopsandtreats@gmail.com",
  VSH_GRANNYS_GMAIL_APP_PASSWORD:"a".repeat(16),
  VSH_CLEVERCUBS_GMAIL_USER:"learningclevercubs@gmail.com",
  VSH_CLEVERCUBS_GMAIL_APP_PASSWORD:"b".repeat(16)
};
function build(settings=env){
  const calls=[];
  const handler=makeMixedBookLiveEmailScheduler({
    env:settings,
    batchFactory:options=>{
      calls.push({name:"created",maxJobs:options.maxJobs,context:options.context,
        approved:options.operatorApproved});
      return {async runBatch(){
        calls.push({name:"executed"});
        return {jobsAttempted:1,sent:1,unknown:0};
      }};
    }
  });
  return {handler,calls};
}
test("Scheduled function is private, UTC cron, and processes one approved job",async()=>{
 const x=build();
 await x.handler(new Request("https://example.invalid/scheduled"),context);
 assert.equal(config.schedule,"*/5 * * * *");
 assert.deepEqual(x.calls.map(x=>x.name),["created","executed"]);
 assert.equal(x.calls[0].maxJobs,1);
 assert.equal(x.calls[0].approved,true);
 assert.equal(x.calls[0].context,context);
});
test("A disabled flag, wrong brand identity, TEST flag, or preview never reaches DB or SMTP",async()=>{
 const variants=[
  {...env,VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED:"false"},
  {...env,VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED:undefined},
  {...env,VSH_MIXED_BOOK_DB_ENABLED:"false"},
  {...env,VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"false"},
  {...env,VSH_MIXED_BOOK_EMAIL_ENABLED:"false"},
  {...env,VSH_MIXED_YOCO_LIVE_ENABLED:"false"},
  {...env,VSH_MIXED_YOCO_TEST_ENABLED:"true"},
  {...env,VSH_ENABLE_PAYMENTS:"false"},
  {...env,VSH_MIXED_BOOK_LINK_KEY:"invalid"},
  {...env,VSH_GRANNYS_GMAIL_USER:"learningclevercubs@gmail.com"},
  {...env,VSH_CLEVERCUBS_GMAIL_USER:"grannyspopsandtreats@gmail.com"},
  {...env,VSH_GRANNYS_GMAIL_APP_PASSWORD:""},
  {...env,VSH_CLEVERCUBS_GMAIL_APP_PASSWORD:"not-a-valid-password"}
 ];
 for(const settings of variants){
   const x=build(settings);
   await x.handler({},context);
   assert.deepEqual(x.calls,[]);
 }
 for(const ctx of [
  {deploy:{context:"deploy-preview"}},
  {deploy:{context:"branch-deploy"}},{}
 ]){
   const x=build();
   await x.handler({},ctx);
   assert.deepEqual(x.calls,[]);
 }
});
test("Error logs never disclose SMTP/DB secrets or customer details",async()=>{
 const logs=[];
 const original=console.error;
 const sneaky="vshlk_SUPER_PRIVATE buy@example.invalid";
 const handler=makeMixedBookLiveEmailScheduler({
  env,batchFactory:()=>({
    async runBatch(){throw Error(sneaky)}
  })
 });
 try {
  console.error=(...parts)=>logs.push(parts.join(" "));
  await handler({},context);
 }finally{console.error=original;}
 assert.deepEqual(logs,["LIVE book delivery scheduler failed safely."]);
 assert.ok(!logs.join(" ").includes(sneaky));
});
test("An ambiguous send prints only an operator-reconciliation reminder",async()=>{
 const logs=[];
 const original=console.warn;
 const handler=makeMixedBookLiveEmailScheduler({
  env,batchFactory:()=>({async runBatch(){
   return {jobsAttempted:1,sent:0,unknown:1};
  }})
 });
 try{
  console.warn=(...parts)=>logs.push(parts.join(" "));
  await handler({},context);
 }finally{console.warn=original}
 assert.deepEqual(logs,["LIVE book email requires operator reconciliation."]);
});
