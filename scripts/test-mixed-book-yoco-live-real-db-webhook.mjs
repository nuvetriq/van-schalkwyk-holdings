/* Synthetic LIVE payment webhook -> real DISPOSABLE GitHub Actions Postgres.
 * This test NEVER calls Yoco, Gmail, Netlify Production, or customer downloads.
 * It exercises the exact officially documented Yoco checkoutId-only event
 * shape using a locally generated HMAC signing secret and local test keys.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {getDatabase} from "@netlify/database";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {createMixedBookServices} from "../netlify/lib/mixed-book-db-service.mjs";
import {makeMixedBookYocoLiveWebhookHandler}
  from "../netlify/functions/mixed-book-yoco-live-webhook.mjs";

const databaseUrl=process.env.CI_DATABASE_URL;
if(!databaseUrl ||
   !/^postgresql?:\/\/ci_test:/.test(databaseUrl) ||
   !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(databaseUrl))
  throw Error("Only disposable GitHub Actions PostgreSQL is permitted.");

const grId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const ccId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const url="https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-live-webhook";
const nowSec=1793502000;
const webhookSecret="whsec_"+crypto.randomBytes(32).toString("base64");
const context={deploy:{context:"production"}};
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_YOCO_LIVE_ENABLED:"true",
  VSH_ENABLE_PAYMENTS:"true",
  VSH_MIXED_YOCO_TEST_ENABLED:"false",
  VSH_MIXED_YOCO_LIVE_KEY:"sk_live_"+"L".repeat(32),
  VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET:webhookSecret
};
const records=new Map([
  ["grannys:"+grId,{
    id:grId,business:"grannys",is_active:true,
    title:"Synthetic Granny Book",category:"Recipe Books",
    price:129.99,pdf_path:"grannys/"+grId+".pdf"
  }],
  ["clever-cubs:"+ccId,{
    id:ccId,business:"clever-cubs",is_active:true,
    title:"Synthetic CleverCubs Book",category:"Preschool",
    price:85,pdf_path:"clever-cubs/"+ccId+".pdf"
  }]
]);
const source={
  async getProduct(brand,id){return records.get(brand+":"+id)||null},
  async getPrivateFile(){return {metadata:{size:1024}}}
};

function sign(master,{
  checkoutId,amountCents=master.amountCents,mode="live",
  status="succeeded",webhookId="msg_CiLiveWebHook12345",
  purpose=undefined,includeOrderId=false,tamper=false
}={}){
  const metadata={checkoutId};
  if(purpose!==undefined)metadata.purpose=purpose;
  if(includeOrderId)metadata.orderId=master.id;
  const payload={
    id:"evt_CiLive"+master.id.replaceAll("-",""),
    type:"payment.succeeded",createdDate:"2026-11-16T14:00:00Z",
    payload:{
      id:"pay_CiLive"+master.id.replaceAll("-",""),
      createdDate:"2026-11-16T14:00:00Z",
      amount:amountCents,currency:"ZAR",mode,status,
      type:"payment",metadata
    }
  };
  const raw=JSON.stringify(payload);
  const signature=crypto.createHmac("sha256",
    Buffer.from(webhookSecret.slice(6),"base64"))
      .update(webhookId+"."+nowSec+"."+raw).digest("base64");
  return new Request(url,{
    method:"POST",
    headers:{
      "webhook-id":webhookId,
      "webhook-timestamp":String(nowSec),
      "webhook-signature":"v1,"+signature
    },
    body:tamper?raw.replace('"amount":'+amountCents,'"amount":1'):raw
  });
}

test("Official Yoco LIVE signed checkoutId-only event settles exactly one mixed-brand sale in local PostgreSQL",async()=>{
  const database=getDatabase({connectionString:databaseUrl});
  const service=createMixedBookServices({
    context,enabled:"true",databaseFactory:()=>database
  });
  const webhook=makeMixedBookYocoLiveWebhookHandler({
    env,databaseFactory:()=>service,now:()=>nowSec*1000
  });
  const {master}=await snapshotMixedOrder({
    name:"Synthetic CI Only",email:"only-ci@example.invalid",
    items:[{business:"grannys",id:grId},{business:"clever-cubs",id:ccId}]
  },source);
  const checkoutId="ch_CiLive"+master.id.replaceAll("-","");
  try {
    await service.createPendingOrder(master,"live");
    // A successful webhook racing checkout creation must NOT mark paid.
    assert.equal((await webhook(sign(master,{checkoutId}),context)).status,503);
    let rows=await database.pool.query(
      "SELECT status,checkout_id FROM vsh_mixed_orders WHERE id=$1",
      [master.id]);
    assert.equal(rows.rows[0].status,"checkout_pending");
    assert.equal(rows.rows[0].checkout_id,null);

    await service.bindYocoCheckout({
      orderId:master.id,checkoutId,amountCents:master.amountCents,
      processingMode:"live"
    });
    // Wrong HMAC, TEST mode and amount mismatch must not write any sale.
    assert.equal((await webhook(sign(master,{checkoutId,tamper:true}),context)).status,401);
    assert.equal((await webhook(sign(master,{checkoutId,mode:"test"}),context)).status,503);
    assert.equal((await webhook(sign(master,{checkoutId,amountCents:1}),context)).status,503);
    rows=await database.pool.query(
      "SELECT status FROM vsh_mixed_orders WHERE id=$1",[master.id]);
    assert.equal(rows.rows[0].status,"awaiting_payment");

    // Documented Checkout API event: metadata has ONLY checkoutId.
    const accepted=await webhook(sign(master,{checkoutId}),context);
    assert.equal(accepted.status,200);
    assert.deepEqual(await accepted.json(),{
      ok:true,verified:true,duplicate:false
    });
    const duplicate=await webhook(sign(master,{
      checkoutId,webhookId:"msg_CiLiveRetry54321"
    }),context);
    assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).duplicate,true);

    const status=await database.pool.query(
      "SELECT status,processing_mode,checkout_id,payment_id,amount_cents FROM vsh_mixed_orders WHERE id=$1",
      [master.id]);
    assert.equal(status.rows[0].status,"paid");
    assert.equal(status.rows[0].processing_mode,"live");
    assert.equal(status.rows[0].checkout_id,checkoutId);
    assert.equal(Number(status.rows[0].amount_cents),21499);
    assert.ok(status.rows[0].payment_id.startsWith("pay_CiLive"));

    const sales=await database.pool.query(
      "SELECT business,subtotal_cents FROM vsh_mixed_brand_sales WHERE order_id=$1 ORDER BY business",
      [master.id]);
    assert.deepEqual(sales.rows.map(r=>[r.business,Number(r.subtotal_cents)]),[
      ["clever-cubs",8500],["grannys",12999]
    ]);
    const events=await database.pool.query(
      "SELECT event_id FROM vsh_mixed_payment_events WHERE order_id=$1",
      [master.id]);
    assert.equal(events.rows.length,1);
    const outbox=await database.pool.query(
      "SELECT business,kind FROM vsh_mixed_email_outbox WHERE order_id=$1",
      [master.id]);
    assert.equal(outbox.rows.length,4);
    for(const business of ["grannys","clever-cubs"]){
      assert.equal(outbox.rows.filter(r=>r.business===business).length,2);
      assert.ok(outbox.rows.some(r=>r.business===business &&
        r.kind==="customer-delivery"));
      assert.ok(outbox.rows.some(r=>r.business===business &&
        r.kind==="merchant-sale-notice"));
    }
    const grants=await database.pool.query(
      "SELECT count(*)::int AS n FROM vsh_mixed_download_grants WHERE order_id=$1",
      [master.id]);
    assert.equal(grants.rows[0].n,0);

    // Explicit foreign namespace cannot trigger bookshop settlement.
    const ignored=await webhook(sign(master,{
      checkoutId,purpose:"unrelated-vendor"
    }),context);
    assert.equal(ignored.status,200);
    assert.equal((await ignored.json()).ignored,true);
  }finally{
    try{
      for(const table of [
        "vsh_mixed_download_grants","vsh_mixed_email_outbox",
        "vsh_mixed_payment_events","vsh_mixed_brand_sales",
        "vsh_mixed_order_lines","vsh_mixed_orders"
      ]){
        const column=table==="vsh_mixed_orders"?"id":"order_id";
        await database.pool.query(
          "DELETE FROM "+table+" WHERE "+column+"=$1",[master.id]
        );
      }
    }finally{await database.pool.end()}
  }
});
