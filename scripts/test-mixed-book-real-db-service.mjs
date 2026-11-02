/* Real integration test against disposable GitHub Actions PostgreSQL 16 only.
 * CI_DATABASE_URL is a short-lived local test credential and MUST NOT point
 * at the user's Netlify production or preview database.
 * No Yoco network calls, no email transport, no customer PDF downloads.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {getDatabase} from "@netlify/database";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {createMixedBookServices} from "../netlify/lib/mixed-book-db-service.mjs";

const url=process.env.CI_DATABASE_URL;
if(!url || !/^postgresql?:\/\/ci_test:/.test(url) ||
   !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(url))
  throw Error("CI database integration test must use the disposable local Postgres service.");

const productId1="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const productId2="ac20bc30-83b6-4fa2-b034-e5129232a210";
const productRecords={
  ["grannys:"+productId1]:{
    id:productId1,business:"grannys",title:"Granny's Test Recipe Book",
    category:"Recipe Books",price:110.00,is_active:true,
    pdf_path:"grannys/"+productId1+".pdf"
  },
  ["clever-cubs:"+productId2]:{
    id:productId2,business:"clever-cubs",title:"CleverCubs Test RR Afrikaans",
    category:"Preschool",price:90.00,is_active:true,
    pdf_path:"clever-cubs/"+productId2+".pdf"
  }
};
test("Official Netlify Database pool commits ONE payment with brand-specific sales and email outbox",async()=>{
  const database=getDatabase({connectionString:url});
  const service=createMixedBookServices({
    context:{deploy:{context:"deploy-preview"}},enabled:"true",
    databaseFactory:()=>database
  });
  const {master}=await snapshotMixedOrder({
    name:"Synthetic CI Customer",email:"only-ci@example.invalid",
    items:[
      {business:"grannys",id:productId1},
      {business:"clever-cubs",id:productId2}
    ]
  },{
    async getProduct(brand,id){return productRecords[brand+":"+id]||null},
    async getPrivateFile(){return {metadata:{size:2048}}}
  });
  const checkoutId="checkout_CI"+master.id.replaceAll("-","");
  const confirmation={
    source:"server-verified-yoco-webhook",signatureVerified:true,
    eventType:"payment.succeeded",paymentStatus:"succeeded",
    checkoutId,paymentId:"pay_CI"+master.id.replaceAll("-",""),
    eventId:"evt_CI"+master.id.replaceAll("-",""),
    currency:"ZAR",amountCents:20000,processingMode:"live"
  };
  try{
    const created=await service.createPendingOrder(master,"live");
    assert.equal(created.status,"checkout_pending");
    const bound=await service.bindYocoCheckout({
      orderId:master.id,checkoutId,amountCents:20000,processingMode:"live"
    });
    assert.equal(bound.duplicate,false);
    const paid=await service.settleAfterVerifiedWebhook(master.id,confirmation);
    assert.equal(paid.brandCount,2);
    assert.equal(paid.insertedEmailJobs,4);
    assert.equal(paid.duplicate,false);
    const duplicate=await service.settleAfterVerifiedWebhook(master.id,{
      ...confirmation,eventId:"evt_DIFFERENT"+master.id.replaceAll("-","")
    });
    assert.equal(duplicate.duplicate,true);
    assert.equal(duplicate.insertedEmailJobs,0);
    const granny=await service.loadPaidBrandSale(master.id,"grannys");
    const clever=await service.loadPaidBrandSale(master.id,"clever-cubs");
    assert.deepEqual(granny.items.map(x=>x.title),["Granny's Test Recipe Book"]);
    assert.deepEqual(clever.items.map(x=>x.title),["CleverCubs Test RR Afrikaans"]);
    assert.equal(granny.subtotalCents,11000);
    assert.equal(clever.subtotalCents,9000);
    assert.equal(JSON.stringify(granny).includes("CleverCubs"),false);
    assert.equal(JSON.stringify(clever).includes("Granny"),false);
    const result=await database.pool.query(
      "SELECT business,kind,recipient FROM vsh_mixed_email_outbox WHERE order_id=$1",
      [master.id]
    );
    assert.equal(result.rows.length,4);
    assert.equal(result.rows.filter(r=>r.business==="grannys").length,2);
    assert.equal(result.rows.filter(r=>r.business==="clever-cubs").length,2);
    const paymentRows=await database.pool.query(
      "SELECT count(*)::int AS count FROM vsh_mixed_payment_events WHERE order_id=$1",
      [master.id]
    );
    assert.equal(paymentRows.rows[0].count,1);
  }finally{
    // DELETE only our synthetic order from disposable local CI PostgreSQL.
    // Avoid leaving dispatchable paid LIVE outbox jobs for later tests.
    const id=master.id;
    try{
      for(const table of [
        "vsh_mixed_download_grants","vsh_mixed_email_outbox",
        "vsh_mixed_payment_events","vsh_mixed_brand_sales",
        "vsh_mixed_order_lines","vsh_mixed_orders"
      ]){
        const column=table==="vsh_mixed_orders"?"id":"order_id";
        await database.pool.query("DELETE FROM "+table+" WHERE "+column+"=$1",[id]);
      }
    }finally{await database.pool.end()}
  }
});
