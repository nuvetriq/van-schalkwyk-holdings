/* Entire paid LIVE -> brand outbox -> committed grants -> SMTP simulation.
 * Disposable GitHub Actions PostgreSQL only. No Yoco requests, Netlify
 * production Database, Gmail connections or actual customer downloads.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {getDatabase} from "@netlify/database";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {createMixedBookServices} from "../netlify/lib/mixed-book-db-service.mjs";
import {createMixedBookDbReads} from "../netlify/lib/mixed-book-db-reads.mjs";
import {createControlledMixedBookEmailWorker}
 from "../netlify/lib/mixed-book-email-worker-draft.mjs";
import {createMixedBookGmailSender}
 from "../netlify/lib/mixed-book-gmail-smtp-draft.mjs";

const url=process.env.CI_DATABASE_URL;
if(!url || !/^postgresql?:\/\/ci_test:/.test(url) ||
  !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(url))
 throw Error("Email worker integration requires isolated local CI PostgreSQL.");
const linkKey="vshlk_"+Buffer.alloc(32,0x59).toString("base64");
const env={
 VSH_MIXED_BOOK_DB_ENABLED:"true",
 VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true",
 VSH_MIXED_BOOK_EMAIL_ENABLED:"true",
 VSH_ENABLE_PAYMENTS:"true",
 VSH_MIXED_BOOK_LINK_KEY:linkKey,
 VSH_GRANNYS_SMTP_APP_PASSWORD:"a".repeat(16),
 VSH_CLEVERCUBS_SMTP_APP_PASSWORD:"b".repeat(16)
};
const brandIds={
 grannys:"f3ff94aa-79f3-4de1-b9e2-0f112fe2df56",
 "clever-cubs":"ac20bc30-83b6-4fa2-b034-e5129232a210"
};
const brands={
 grannys:{title:"Synthetic CI Recipe Book",amount:89.50,email:"grannyspopsandtreats@gmail.com"},
 "clever-cubs":{title:"Synthetic CI Learning Book",amount:110.50,email:"learningclevercubs@gmail.com"}
};
const records=Object.fromEntries(Object.entries(brands).map(([business,entry])=>[
 business+":"+brandIds[business],{
   id:brandIds[business],business,title:entry.title,price:entry.amount,
   category:business==="grannys"?"Recipe Books":"Preschool",
   is_active:true,pdf_path:business+"/"+brandIds[business]+".pdf"
 }
]));
test("Real temporary PostgreSQL: ONE signed synthetic live payment -> FOUR separate claimed and acknowledged brand emails",async()=>{
 const db=getDatabase({connectionString:url});
 const pool=db.pool;
 let master=null;
 const mail=[];
 try{
   ({master}=await snapshotMixedOrder({
     name:"CI Only Buyer",email:"ci-mail-buyer@example.invalid",
     items:Object.keys(brands).map(business=>({business,id:brandIds[business]}))
   },{
     async getProduct(business,id){return records[business+":"+id]||null},
     async getPrivateFile(){return {metadata:{size:2000}}}
   }));
   assert.equal(master.amountCents,20000);
   const checkoutId="checkout_CIMAIL"+master.id.replaceAll("-","");
   const service=createMixedBookServices({
     context:{deploy:{context:"deploy-preview"}},enabled:"true",
     databaseFactory:()=>db
   });
   await service.createPendingOrder(master,"live");
   await service.bindYocoCheckout({
     orderId:master.id,checkoutId,amountCents:20000,processingMode:"live"
   });
   const fakeConfirmed={
     source:"server-verified-yoco-webhook",signatureVerified:true,
     eventType:"payment.succeeded",paymentStatus:"succeeded",
     checkoutId,amountCents:20000,currency:"ZAR",
     processingMode:"live",paymentId:"pay_CIMAIL"+master.id.replaceAll("-",""),
     eventId:"evt_CIMAIL"+master.id.replaceAll("-","")
   };
   const paid=await service.settleAfterVerifiedWebhook(master.id,fakeConfirmed);
   assert.equal(paid.insertedEmailJobs,4);
   const worker=createControlledMixedBookEmailWorker({
     enabled:true,operatorApproved:true,
     context:{deploy:{context:"production"}},env,
     poolFactory:()=>pool,
     readsFactory:createMixedBookDbReads,
     senderFactory:({enabled,context,env})=>createMixedBookGmailSender({
       enabled,context,env,
       transportFactory:options=>({
         async sendMail(message){
           // This is a fake in-memory transport, NEVER Gmail.
           mail.push({user:options.auth.user,from:message.from,
             to:message.to,text:message.text,messageId:message.messageId});
           return {messageId:message.messageId,
             accepted:[message.to],rejected:[],pending:[]};
         },
         close(){}
       })
     })
   });
   const run=[];
   for(let i=0;i<5;i++)run.push(await worker.runOne());
   assert.deepEqual(run.map(x=>x.status),["sent","sent","sent","sent","empty"]);
   assert.equal(mail.length,4);
   assert.deepEqual(new Set(mail.map(x=>x.user)),
     new Set([brands.grannys.email,brands["clever-cubs"].email]));
   for(const m of mail){
     const business=m.user===brands.grannys.email?"grannys":"clever-cubs";
     const wrong=business==="grannys"?"Synthetic CI Learning":"Synthetic CI Recipe";
     assert.ok(m.from.includes(m.user));
     assert.ok(!m.text.includes(wrong));
     if(m.to==="ci-mail-buyer@example.invalid"){
       assert.ok(m.text.includes("book-download.html#token="));
       assert.ok(m.text.includes(brands[business].title));
     }else{
       assert.equal(m.to,brands[business].email);
       assert.ok(!m.text.includes("#token="));
     }
   }
   const outbox=await pool.query(
     "SELECT business,kind,status,provider_message_id"+
     " FROM vsh_mixed_email_outbox WHERE order_id=$1",[master.id]
   );
   assert.equal(outbox.rows.length,4);
   assert.ok(outbox.rows.every(x=>x.status==="sent" && /^<vsh-/.test(x.provider_message_id)));
   const grants=await pool.query(
     "SELECT business,product_id,token_hash,token_nonce"+
     " FROM vsh_mixed_download_grants WHERE order_id=$1",[master.id]
   );
   assert.equal(grants.rows.length,2);
   assert.ok(grants.rows.every(x=>/^[a-f0-9]{64}$/.test(x.token_hash)));
   const repeated=await worker.runOne();
   assert.equal(repeated.status,"empty");
   assert.equal(mail.length,4);
 }finally{
   if(master?.id){
     const id=master.id;
     for(const table of [
       "vsh_mixed_download_grants","vsh_mixed_email_outbox",
       "vsh_mixed_payment_events","vsh_mixed_brand_sales",
       "vsh_mixed_order_lines","vsh_mixed_orders"
     ])await pool.query("DELETE FROM "+table+" WHERE "+
       (table==="vsh_mixed_orders"?"id":"order_id")+"=$1",[id]);
   }
   await pool.end();
 }
});
