/* Disposable GitHub Actions PostgreSQL integration only.
 * This test MUST NOT connect to the owner's Netlify Database. It uses the
 * existing ephemeral CI_DATABASE_URL and never contacts Yoco/Gmail or blobs.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {getDatabase} from "@netlify/database";
import {ensureCommittedPaidBookLinks}
  from "../netlify/lib/mixed-book-paid-grant-service.mjs";

const url=process.env.CI_DATABASE_URL;
if(!url || !/^postgresql?:\/\/ci_test:/.test(url) ||
   !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(url))
 throw Error("Paid-grant integration requires disposable local CI Postgres.");

const linkKey="vshlk_"+Buffer.alloc(32,0x67).toString("base64");
const gr="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const cc="ac20bc30-83b6-4fa2-b034-e5129232a210";
test("One verified paid LIVE order commits/reconstructs isolated links in actual disposable PostgreSQL",async()=>{
 const db=getDatabase({connectionString:url});
 const pool=db.pool;
 const orderId=crypto.randomUUID();
 const at=new Date("2026-11-01T10:00:00.000Z");
 try{
   await pool.query(
     "INSERT INTO vsh_mixed_orders"+
     " (id,customer_name,customer_email,amount_cents,processing_mode,"+
     " status,checkout_id,payment_id,snapshot)"+
     " VALUES ($1,'CI Synthetic','ci-grants@example.invalid',21499,'live',"+
     " 'paid',$2,$3,$4::jsonb)",
     [orderId,"checkout_CIGR"+orderId.replaceAll("-",""),
      "pay_CIGR"+orderId.replaceAll("-",""),
      JSON.stringify({id:orderId,items:[]})]
   );
   for(const [business,productId,amount] of [
     ["grannys",gr,12999],["clever-cubs",cc,8500]
   ]){
     await pool.query(
       "INSERT INTO vsh_mixed_order_lines"+
       " (order_id,business,product_id,title,price_cents,private_pdf_path)"+
       " VALUES ($1,$2,$3,'CI Synthetic PDF',$4,$5)",
       [orderId,business,productId,amount,
         business+"/"+productId+".pdf"]
     );
     await pool.query(
       "INSERT INTO vsh_mixed_brand_sales"+
       " (order_id,business,subtotal_cents) VALUES ($1,$2,$3)",
       [orderId,business,amount]
     );
   }
   const first=await ensureCommittedPaidBookLinks(pool,{
      orderId,business:"grannys",linkKey,now:at
   });
   const repeated=await ensureCommittedPaidBookLinks(pool,{
      orderId,business:"grannys",linkKey,
      now:new Date(at.getTime()+1000)
   });
   const other=await ensureCommittedPaidBookLinks(pool,{
      orderId,business:"clever-cubs",linkKey,now:at
   });
   assert.deepEqual(repeated,first);
   assert.equal(first.length,1);
   assert.equal(other.length,1);
   assert.notEqual(first[0].url,other[0].url);
   assert.ok(first[0].url.includes("book-download.html#token="));
   const saved=await pool.query(
     "SELECT business,product_id,token_hash,token_nonce"+
     " FROM vsh_mixed_download_grants WHERE order_id=$1 ORDER BY business",
     [orderId]
   );
   assert.equal(saved.rows.length,2);
   assert.deepEqual(saved.rows.map(x=>x.business),["clever-cubs","grannys"]);
   assert.ok(saved.rows.every(x=>/^[a-f0-9]{64}$/.test(x.token_hash)));
   assert.ok(saved.rows.every(x=>/^[a-f0-9-]{36}$/.test(x.token_nonce)));
   assert.ok(!JSON.stringify(saved.rows).includes(first[0].url.split("#token=")[1]));
   assert.ok(!JSON.stringify(saved.rows).includes(other[0].url.split("#token=")[1]));
   await pool.query(
     "UPDATE vsh_mixed_orders SET status='refunded' WHERE id=$1",
     [orderId]
   );
   await assert.rejects(ensureCommittedPaidBookLinks(pool,{
      orderId,business:"grannys",linkKey,now:at
   }),/Verified live brand payment/);
   const count=await pool.query(
     "SELECT count(*)::integer AS n"+
     " FROM vsh_mixed_download_grants WHERE order_id=$1",[orderId]
   );
   assert.equal(count.rows[0].n,2);
 }finally{
   // Disposable local CI database only. Do not use CASCADE in shared DBs.
   try{
     await pool.query("DELETE FROM vsh_mixed_download_grants WHERE order_id=$1",[orderId]);
     await pool.query("DELETE FROM vsh_mixed_brand_sales WHERE order_id=$1",[orderId]);
     await pool.query("DELETE FROM vsh_mixed_order_lines WHERE order_id=$1",[orderId]);
     await pool.query("DELETE FROM vsh_mixed_orders WHERE id=$1",[orderId]);
   }finally{await pool.end()}
 }
});
