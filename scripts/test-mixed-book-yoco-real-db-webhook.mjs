/* Signed Yoco TEST webhook -> real official Netlify DB client -> ephemeral
 * PostgreSQL 16 ledger. No Yoco API requests, no live Netlify DB, no emails.
 * The test asserts REAL SQL rows rather than a mock settlement callback.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {getDatabase} from "@netlify/database";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {createMixedBookServices} from "../netlify/lib/mixed-book-db-service.mjs";
import {makeMixedBookYocoTestWebhookHandler}
  from "../netlify/functions/mixed-book-yoco-test-webhook.mjs";

const databaseUrl=process.env.CI_DATABASE_URL;
if(!databaseUrl ||
   !/^postgresql?:\/\/ci_test:/.test(databaseUrl) ||
   !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(databaseUrl))
  throw Error("Only the disposable GitHub Actions Postgres service is allowed.");

const grId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const ccId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const checkoutOrigin="https://vanschalkwykholdings.com";
const webhookUrl=checkoutOrigin+"/.netlify/functions/mixed-book-yoco-test-webhook";
const nowSec=1793502000;
const webhookSecret="whsec_"+crypto.randomBytes(32).toString("base64");
const context={deploy:{context:"production"}};
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_YOCO_TEST_ENABLED:"true",
  VSH_MIXED_YOCO_TEST_KEY:"sk_test_"+"0".repeat(32),
  VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:webhookSecret,
  VSH_ENABLE_PAYMENTS:"false"
};
const records=new Map([
  ["grannys:"+grId,{
    id:grId,business:"grannys",is_active:true,
    title:"Example Granny Recipe Book",category:"Recipe Books",
    price:129.99,pdf_path:"grannys/"+grId+".pdf"
  }],
  ["clever-cubs:"+ccId,{
    id:ccId,business:"clever-cubs",is_active:true,
    title:"Example CleverCubs RR Afrikaans",category:"Preschool",
    price:85,pdf_path:"clever-cubs/"+ccId+".pdf"
  }]
]);
const source={
  async getProduct(brand,id){return records.get(brand+":"+id)||null},
  async getPrivateFile(){return {metadata:{size:1024}}}
};
const sign=(master,{checkoutId,amountCents=master.amountCents,
  paymentMode="test",paymentStatus="succeeded",purpose="vsh-mixed-book-test",
  webhookId="msg_CiBookTesting12345",tamper=false}={})=>{
  const payload={type:"payment.succeeded",
    payload:{id:"pay_Ci"+master.id.replaceAll("-",""),
      amount:amountCents,currency:"ZAR",mode:paymentMode,
      status:paymentStatus,
      metadata:{purpose,orderId:master.id,
        checkoutId:checkoutId??"checkout_Ci"+master.id.replaceAll("-","")}
    }
  };
  const raw=JSON.stringify(payload);
  const signature=crypto.createHmac("sha256",
    Buffer.from(webhookSecret.slice(6),"base64"))
      .update(webhookId+"."+nowSec+"."+raw).digest("base64");
  return new Request(webhookUrl,{
    method:"POST",
    headers:{
      "webhook-id":webhookId,
      "webhook-timestamp":String(nowSec),
      "webhook-signature":"v1,"+signature
    },
    body:tamper?raw.replace('"amount":'+amountCents,'"amount":1'):raw
  });
};

test("HMAC-confirmed Yoco TEST payment settles one shared order in REAL Postgres with NO deliveries",async()=>{
  const database=getDatabase({connectionString:databaseUrl});
  const service=createMixedBookServices({
    context,enabled:"true",databaseFactory:()=>database
  });
  const webhook=makeMixedBookYocoTestWebhookHandler({
    env,databaseFactory:()=>service,now:()=>nowSec*1000
  });
  const {master}=await snapshotMixedOrder({
    name:"CI Only",email:"integration@example.invalid",
    items:[{business:"grannys",id:grId},{business:"clever-cubs",id:ccId}]
  },source);
  const checkoutId="checkout_Ci"+master.id.replaceAll("-","");
  try{
    await service.createPendingOrder(master,"test");

    // An authenticated event that races checkout creation MUST NOT pay early.
    const early=await webhook(sign(master,{checkoutId}),context);
    assert.equal(early.status,503);
    let row=await database.pool.query(
      "SELECT status,checkout_id FROM vsh_mixed_orders WHERE id=$1",[master.id]);
    assert.equal(row.rows[0].status,"checkout_pending");
    assert.equal(row.rows[0].checkout_id,null);

    const bound=await service.bindYocoCheckout({
      orderId:master.id,checkoutId,amountCents:master.amountCents,
      processingMode:"test"
    });
    assert.equal(bound.duplicate,false);

    // Reject modified HMAC or wrong payment amount without changing DB rows.
    assert.equal((await webhook(sign(master,{checkoutId,tamper:true}),context)).status,401);
    assert.equal((await webhook(sign(master,{checkoutId,amountCents:1}),context)).status,503);
    row=await database.pool.query(
      "SELECT status FROM vsh_mixed_orders WHERE id=$1",[master.id]);
    assert.equal(row.rows[0].status,"awaiting_payment");

    // Correct Yoco simulated event: one payment, two internal brand sales.
    const accepted=await webhook(sign(master,{checkoutId}),context);
    assert.equal(accepted.status,200);
    assert.deepEqual(await accepted.json(),{
      ok:true,testVerified:true,duplicate:false
    });
    // Retried webhook may have a different header ID; same payment must
    // remain idempotent, with no duplicate business records.
    const duplicate=await webhook(sign(master,{
      checkoutId,webhookId:"msg_AnotherCiTestRetry1234"
    }),context);
    assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).duplicate,true);

    const status=await database.pool.query(
      "SELECT status,processing_mode,amount_cents,checkout_id,payment_id FROM vsh_mixed_orders WHERE id=$1",
      [master.id]);
    assert.equal(status.rows[0].status,"paid");
    assert.equal(status.rows[0].processing_mode,"test");
    assert.equal(Number(status.rows[0].amount_cents),21499);
    assert.equal(status.rows[0].checkout_id,checkoutId);
    assert.ok(status.rows[0].payment_id.startsWith("pay_Ci"));

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
      "SELECT count(*)::int AS n FROM vsh_mixed_email_outbox WHERE order_id=$1",
      [master.id]);
    const grants=await database.pool.query(
      "SELECT count(*)::int AS n FROM vsh_mixed_download_grants WHERE order_id=$1",
      [master.id]);
    assert.equal(outbox.rows[0].n,0);
    assert.equal(grants.rows[0].n,0);

    // Signed foreign merchant transaction must never create bookshop rows.
    const ignored=await webhook(sign(master,{
      checkoutId,purpose:"different-merchant-project"
    }),context);
    assert.equal(ignored.status,200);
    assert.equal((await ignored.json()).ignored,true);
  } finally {
    await database.pool.end();
  }
});
