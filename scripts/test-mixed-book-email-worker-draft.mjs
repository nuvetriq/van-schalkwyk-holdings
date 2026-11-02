/* No real SMTP, Yoco, Netlify DB or Gmail calls in this suite.
 * Exercises the actual outbox dispatcher, email composer, and Gmail transport
 * through injected in-memory Postgres and Nodemailer fake transport.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
 assertMixedBookEmailWorkerReadiness,createControlledMixedBookEmailWorker
} from "../netlify/lib/mixed-book-email-worker-draft.mjs";
import {createMixedBookGmailSender}
 from "../netlify/lib/mixed-book-gmail-smtp-draft.mjs";
import {dispatchOneMixedBrandEmail}
 from "../netlify/lib/mixed-book-brand-email-dispatch-draft.mjs";
import {bookDownloadUrl}
 from "../netlify/lib/mixed-book-download-grants.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const grId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const ccId="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const secret="vshlk_"+Buffer.alloc(32,0x65).toString("base64");
const token="T".repeat(43);
const ctx={deploy:{context:"production"}};
const env={
 VSH_MIXED_BOOK_DB_ENABLED:"true",
 VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true",
 VSH_MIXED_BOOK_EMAIL_ENABLED:"true",
 VSH_ENABLE_PAYMENTS:"true",
 VSH_MIXED_BOOK_LINK_KEY:secret,
 VSH_GRANNYS_SMTP_APP_PASSWORD:"a".repeat(16),
 VSH_CLEVERCUBS_SMTP_APP_PASSWORD:"b".repeat(16)
};
const biz={
 grannys:{product:grId,name:"Granny's",email:"grannyspopsandtreats@gmail.com",
          title:"Granny recipe PDF",price:12999},
 "clever-cubs":{product:ccId,name:"CleverCubs Learning",
                email:"learningclevercubs@gmail.com",title:"CleverCubs RR",price:8500}
};
function fixture({smtpFailure=false}={}){
 const jobs=[];
 const sales={};
 for(const business of ["grannys","clever-cubs"]){
   const b=biz[business];
   const ref=orderId+":"+business;
   const file=business+"/"+b.product+".pdf";
   sales[business]={
     business,masterOrderId:orderId,brandOrderRef:ref,
     subtotalCents:b.price,currency:"ZAR",
     customer:{name:"Synthetic Buyer",email:"ci-buyer@example.invalid"},
     items:[{id:b.product,title:b.title,priceCents:b.price,pdfPath:file}]
   };
   for(const kind of ["customer-delivery","merchant-sale-notice"]){
     const id=ref+":"+kind, sender=b.email;
     const recipient=kind==="customer-delivery"?"ci-buyer@example.invalid":sender;
     const payload={
       id,masterOrderId:orderId,brandOrderRef:ref,
       business,type:kind,status:"pending",sender,recipient,
       bookTitles:[b.title],amountCents:b.price,currency:"ZAR",
       ...(kind==="customer-delivery"
         ?{privateBookPaths:[file]}
         :{customerName:"Synthetic Buyer",customerEmail:"ci-buyer@example.invalid"})
     };
     jobs.push({id,order_id:orderId,business,kind,
       status:"pending",payload,sender,recipient});
   }
 }
 const calls={databaseOpened:0,readers:0,provider:0,emails:[],claims:0,links:[],sql:[]};
 const pool={
   async connect(){throw Error("Real grant SQL is stubbed in this mock worker test");},
   async query(sql,args=[]){
     calls.sql.push(sql);
     if(sql.includes("WITH candidate AS")){
       const job=jobs.find(x=>x.status==="pending");
       if(!job)return {rows:[]};
       job.status="claimed";calls.claims++;
       return {rows:[{...job,claim_token:args[0]}]};
     }
     if(sql.includes("UPDATE vsh_mixed_email_outbox")){
       const item=jobs.find(x=>x.id===args[0]);
       assert.equal(item?.status,"claimed");
       item.status=sql.includes("status='sent'")?"sent":
         sql.includes("status='unknown'")?"unknown":
         sql.includes("status=CASE")?"retry":"invalid";
       return {rows:[{id:item.id,status:item.status}]};
     }
     throw Error("Unexpected synthetic SQL");
   }
 };
 const factory={
   poolFactory(){calls.databaseOpened++;return pool;},
   readsFactory(received){
     assert.equal(received,pool);calls.readers++;
     return {async loadPaidBrandSale(id,business){
       assert.equal(id,orderId);
       return sales[business]||null;
     }};
   },
   senderFactory({enabled,env:settings,context}){
     assert.equal(enabled,true);
     return createMixedBookGmailSender({
       enabled,env:settings,context,
       transportFactory:options=>{
         calls.provider++;
         return {
           async sendMail(message){
             calls.emails.push({options,message});
             if(smtpFailure && calls.emails.length===1)
               throw Error("Simulated SMTP uncertain send");
             return {messageId:message.messageId,accepted:[message.to],rejected:[],pending:[]};
           },
           close(){}
         };
       }
     });
   },
   dispatch: options=>dispatchOneMixedBrandEmail({
     ...options,ensureLinks:async(p,{orderId:paid,business,linkKey})=>{
       assert.equal(p,pool);
       assert.equal(paid,orderId);
       assert.equal(linkKey,secret);
       calls.links.push(business);
       return [{id:biz[business].product,url:bookDownloadUrl(token)}];
     }
   })
 };
 return {jobs,calls,factory};
}
test("All feature flags, both secrets, context and explicit approval required BEFORE DB or SMTP",()=>{
 const fixtureData=fixture();
 const proposals=[
   {enabled:false,operatorApproved:true},
   {enabled:true,operatorApproved:false},
   {enabled:true,operatorApproved:true,context:{deploy:{context:"deploy-preview"}}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_ENABLE_PAYMENTS:"false"}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_MIXED_BOOK_EMAIL_ENABLED:"false"}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"false"}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_MIXED_BOOK_LINK_KEY:"invalid"}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_CLEVERCUBS_SMTP_APP_PASSWORD:""}},
   {enabled:true,operatorApproved:true,environment:{...env,VSH_GRANNYS_SMTP_APP_PASSWORD:"injected\nheader"}}
 ];
 for(const variant of proposals){
   assert.throws(()=>createControlledMixedBookEmailWorker({
     enabled:variant.enabled,operatorApproved:variant.operatorApproved,
     env:variant.environment||env,
     context:variant.context||ctx,
     ...fixtureData.factory
   }),/not enabled/);
 }
 assert.equal(fixtureData.calls.databaseOpened,0);
 assert.equal(fixtureData.calls.provider,0);
 assert.equal(fixtureData.calls.claims,0);
});
test("Controlled worker composes exactly FOUR scoped email jobs for two-brand order",async()=>{
 const f=fixture();
 const worker=createControlledMixedBookEmailWorker({
   enabled:true,operatorApproved:true,context:ctx,env,...f.factory
 });
 const results=[];
 for(let i=0;i<5;i++)results.push(await worker.runOne());
 assert.deepEqual(results.map(x=>x.status),
   ["sent","sent","sent","sent","empty"]);
 assert.equal(f.calls.databaseOpened,1);
 assert.equal(f.calls.readers,1);
 assert.equal(f.calls.claims,4);
 assert.equal(f.calls.emails.length,4);
 assert.deepEqual(f.calls.links,["grannys","clever-cubs"]);
 assert.equal(f.jobs.filter(x=>x.status==="sent").length,4);
 for(const {options,message} of f.calls.emails){
   const brand=message.from.startsWith("Granny's")?"grannys":"clever-cubs";
   assert.equal(options.auth.user,biz[brand].email);
   assert.equal(message.to,options.auth.user===biz[brand].email?
     (message.subject.startsWith("New digital-book")?biz[brand].email:"ci-buyer@example.invalid")
     :"wrong");
   assert.ok(!message.text.includes("private_pdf_path"));
   const foreign=brand==="grannys"?"CleverCubs RR":"Granny recipe PDF";
   assert.ok(!message.text.includes(foreign));
   assert.equal(message.disableFileAccess,true);
 }
 for(const email of f.calls.emails.filter(x=>x.message.to==="ci-buyer@example.invalid")){
   assert.ok(email.message.text.includes("book-download.html#token="));
 }
 for(const email of f.calls.emails.filter(x=>x.message.to!=="ci-buyer@example.invalid")){
   assert.ok(!email.message.text.includes("#token="));
 }
 assert.ok(f.calls.sql.some(s=>s.includes("o.status='paid' AND o.processing_mode='live'")));
});
test("Ambiguous SMTP failure is quarantined and not resent by next worker run",async()=>{
 const f=fixture({smtpFailure:true});
 const worker=createControlledMixedBookEmailWorker({
   enabled:true,operatorApproved:true,context:ctx,env,...f.factory
 });
 const first=await worker.runOne();
 assert.equal(first.status,"unknown");
 const later=await worker.runOne();
 assert.equal(later.status,"sent");
 assert.equal(f.jobs[0].status,"unknown");
 assert.equal(f.calls.emails.filter(e=>e.message.messageId===f.calls.emails[0].message.messageId).length,1);
});
test("Worker never sends anything merely by importing it and has no public HTTP trigger",async()=>{
 const module=await readFile("netlify/lib/mixed-book-email-worker-draft.mjs","utf8");
 const site=await readFile("netlify.toml","utf8");
 assert.ok(!module.includes("export default async function handler"));
 assert.ok(!module.includes("schedule("));
 assert.ok(!module.includes("console.log"));
 assert.ok(!site.includes("VSH_MIXED_BOOK_EMAIL_ENABLED"));
 assert.ok(!site.includes("VSH_GRANNYS_SMTP_APP_PASSWORD"));
 assert.equal(assertMixedBookEmailWorkerReadiness({
   enabled:true,operatorApproved:true,context:ctx,env
 }),true);
});
