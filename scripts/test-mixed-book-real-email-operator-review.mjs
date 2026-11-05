/* Read-only operator review with disposable GitHub Actions PostgreSQL 16.
 * One transaction inserts fake CI-only outbox rows, inspects them without
 * claiming/sending anything, and ROLLBACKS all records even on failure.
 * Do not run against Netlify production/preview database or any Gmail account.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {getDatabase} from "@netlify/database";
import {createMixedBookEmailOperatorReview}
 from "../netlify/lib/mixed-book-email-operator-review.mjs";

const url=process.env.CI_DATABASE_URL;
if(!url || !/^postgresql?:\/\/ci_test:/.test(url) ||
   !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(url))
 throw Error("Email review integration only supports isolated local CI PostgreSQL.");

test("Real SQL review is read-only, excludes test orders, never claims emails",async()=>{
 const db=getDatabase({connectionString:url});
 const client=await db.pool.connect();
 const view=createMixedBookEmailOperatorReview({
   enabled:true,operatorApproved:true,
   context:{deploy:{context:"production"}},
   env:{
     VSH_MIXED_BOOK_DB_ENABLED:"true",
     VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED:"true"
   },
   poolFactory:()=>client
 });
 try{
   await client.query("BEGIN");
   const prior=await view.inspect();
   const synthetic=[
     {business:"grannys",mode:"live",order:"paid",job:"pending"},
     {business:"clever-cubs",mode:"live",order:"refunded",job:"unknown"},
     {business:"clever-cubs",mode:"test",order:"paid",job:"pending"}
   ];
   const ids=[];
   for(const entry of synthetic){
     const id=crypto.randomUUID();
     ids.push({id,...entry});
     await client.query(
       "INSERT INTO vsh_mixed_orders"+
       " (id,customer_name,customer_email,amount_cents,processing_mode,"+
       " status,checkout_id,payment_id,snapshot)"+
       " VALUES ($1,'Synthetic CI Buyer','synthetic@example.invalid',10000,$2,"+
       " $3,$4,$5,$6::jsonb)",
       [id,entry.mode,entry.order,
        "checkout_CI"+id.replaceAll("-",""),
        "pay_CI"+id.replaceAll("-",""),
        JSON.stringify({id})]
     );
     await client.query(
       "INSERT INTO vsh_mixed_brand_sales"+
       " (order_id,business,subtotal_cents) VALUES ($1,$2,10000)",
       [id,entry.business]
     );
     await client.query(
       "INSERT INTO vsh_mixed_email_outbox"+
       " (id,order_id,business,kind,sender,recipient,payload,status)"+
       " VALUES ($1,$2,$3,'customer-delivery',$4,"+
       " 'synthetic@example.invalid','{}'::jsonb,$5)",
       [id+":"+entry.business+":customer-delivery",id,entry.business,
        entry.business==="grannys"?
         "grannyspopsandtreats@gmail.com":"learningclevercubs@gmail.com",
        entry.job]
     );
   }
   const result=await view.inspect();
   assert.equal(result.reviewOnly,true);
   assert.equal(result.canSend,false);
   assert.equal(result.total-prior.total,2);
   assert.equal(result.eligiblePending-prior.eligiblePending,1);
   assert.equal(result.needsManualReview-prior.needsManualReview,1);
   assert.equal(result.nonPaidOrderJobs-prior.nonPaidOrderJobs,1);
   assert.equal(result.byBrand.grannys-prior.byBrand.grannys,1);
   assert.equal(result.byBrand["clever-cubs"]-prior.byBrand["clever-cubs"],1);
   assert.equal(JSON.stringify(result).includes("synthetic@example.invalid"),false);
   const statuses=await client.query(
     "SELECT j.status,j.claim_token,j.attempt_count"+
     " FROM vsh_mixed_email_outbox j"+
     " WHERE j.order_id = ANY($1::uuid[])",
     [ids.map(x=>x.id)]
   );
   assert.equal(statuses.rows.length,3);
   assert.deepEqual(statuses.rows.map(x=>x.status).sort(),["pending","pending","unknown"]);
   assert.ok(statuses.rows.every(x=>x.claim_token===null && x.attempt_count===0));
 }finally{
   try{await client.query("ROLLBACK")}finally{
     client.release();
     await db.pool.end();
   }
 }
});
