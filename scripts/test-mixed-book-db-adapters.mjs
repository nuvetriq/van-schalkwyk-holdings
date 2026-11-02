import {test} from "node:test";
import assert from "node:assert/strict";
import {openMixedBookPool} from "../netlify/lib/mixed-book-db-runtime.mjs";
import {createMixedBookDbReads} from "../netlify/lib/mixed-book-db-reads.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const recipeId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const cleverId="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const dummyPool={connect:async()=>({release(){}}),query:async()=>({rows:[]})};
const production={deploy:{context:"production"}};
const preview={deploy:{context:"deploy-preview"}};
test("Database access is OFF by default, no connection or queries happen",()=>{
  let called=0;
  assert.throws(()=>openMixedBookPool({
    context:production,enabled:"false",
    databaseFactory(){called++;return {pool:dummyPool}}
  }));
  assert.equal(called,0);
});
test("Authorised production/preview branch gets Netlify transactional pool",()=>{
  for(const context of [production,preview]){
    const result=openMixedBookPool({
      context,enabled:"true",databaseFactory:()=>({pool:dummyPool})
    });
    assert.equal(result,dummyPool);
    assert.equal(typeof result.connect,"function");
  }
});
test("Invalid deploy context and missing pool cannot access database",()=>{
  for(const context of [undefined,{}, {deploy:{context:"branch-deploy"}}, {deploy:{context:"dev"}}]){
    assert.throws(()=>openMixedBookPool({
      context,enabled:"true",databaseFactory:()=>({pool:dummyPool})
    }));
  }
  assert.throws(()=>openMixedBookPool({
    context:preview,enabled:"true",databaseFactory:()=>({pool:{query(){}}})
  }));
});
const fixtures={
  grannys:{
    business:"grannys",subtotal_cents:"12999",currency:"ZAR",
    order_id:orderId,customer_name:"Test Customer",customer_email:"buyer@example.com"
  },
  "clever-cubs":{
    business:"clever-cubs",subtotal_cents:"8500",currency:"ZAR",
    order_id:orderId,customer_name:"Test Customer",customer_email:"buyer@example.com"
  }
};
const lines={
  grannys:[{product_id:recipeId,title:"Recipe Book",price_cents:"12999",
    private_pdf_path:"grannys/"+recipeId+".pdf"}],
  "clever-cubs":[{product_id:cleverId,title:"Grade RR Afrikaans",price_cents:"8500",
    private_pdf_path:"clever-cubs/"+cleverId+".manifest.json"}]
};
const makePool=()=>({
  queries:[],
  async query(sql,args){
    this.queries.push({sql,args});
    if(sql.includes("FROM vsh_mixed_brand_sales"))return {rows:[fixtures[args[1]]]};
    if(sql.includes("FROM vsh_mixed_order_lines"))return {rows:lines[args[1]]};
    if(sql.includes("FROM vsh_mixed_download_grants"))return{rows:[{
      token_hash:args[0],order_id:orderId,business:"grannys",product_id:recipeId,
      expires_at:"2026-11-02T12:00:00Z",revoked_at:null
    }]};
    if(sql.includes("FROM vsh_mixed_orders WHERE id=$1"))return{rows:[{
      id:orderId,status:"paid",processing_mode:"live",
      snapshot:{id:orderId,items:[{
        business:"grannys",id:recipeId,pdfPath:"grannys/"+recipeId+".pdf"
      }]}
    }]};
    throw Error("Unexpected query");
  }
});
test("Granny's paid sale contains ONLY Granny's titles, totals and private files",async()=>{
  const pool=makePool(),db=createMixedBookDbReads(pool);
  const gr=await db.loadPaidBrandSale(orderId,"grannys");
  const cc=await db.loadPaidBrandSale(orderId,"clever-cubs");
  assert.equal(gr.items[0].title,"Recipe Book");
  assert.equal(cc.items[0].title,"Grade RR Afrikaans");
  assert.equal(gr.subtotalCents,12999);
  assert.equal(cc.subtotalCents,8500);
  assert.equal(gr.items[0].pdfPath,"grannys/"+recipeId+".pdf");
  assert.ok(!JSON.stringify(gr).includes("Grade RR"));
  assert.ok(!JSON.stringify(cc).includes("Recipe Book"));
  for(const call of pool.queries){
    assert.deepEqual(call.args[0],orderId);
    assert.ok(["grannys","clever-cubs"].includes(call.args[1]));
    assert.ok(call.sql.includes("business=$2"));
  }
  assert.ok(pool.queries[0].sql.includes("o.status='paid'"));
  assert.ok(pool.queries[0].sql.includes("o.processing_mode='live'"));
  assert.ok(!pool.queries[0].sql.includes("o.snapshot"));
});
test("Reject malformed brand, bad private file, or unreconciled totals",async()=>{
  const pool=makePool(),db=createMixedBookDbReads(pool);
  await assert.rejects(db.loadPaidBrandSale(orderId,"unknown"));
  await assert.rejects(db.loadPaidBrandSale("../../","grannys"));
  assert.equal(pool.queries.length,0);
  pool.query=async(sql,args)=>{
    if(sql.includes("FROM vsh_mixed_brand_sales"))return{rows:[fixtures.grannys]};
    return{rows:[{...lines.grannys[0],private_pdf_path:"clever-cubs/"+cleverId+".pdf"}]};
  };
  await assert.rejects(db.loadPaidBrandSale(orderId,"grannys"));
});
test("Hashed download grant and paid master order are loaded with bound parameters",async()=>{
  const pool=makePool(),db=createMixedBookDbReads(pool);
  const hash="b".repeat(64);
  const grant=await db.grantStore.findByHash(hash);
  const order=await db.orderStore.findById(orderId);
  assert.equal(grant.tokenHash,hash);
  assert.equal(grant.business,"grannys");
  assert.equal(order.status,"paid");
  assert.equal(order.processingMode,"live");
  assert.equal(order.items[0].business,"grannys");
  assert.equal(pool.queries.length,2);
  assert.deepEqual(pool.queries[0].args,[hash]);
  assert.deepEqual(pool.queries[1].args,[orderId]);
  assert.equal(await db.grantStore.findByHash("nope"),null);
  assert.equal(await db.orderStore.findById("bad"),null);
  assert.equal(pool.queries.length,2);
});
test("Never stores DB credentials or activates migration in public site bundle",async()=>{
  const {readFile}=await import("node:fs/promises");
  const runtime=await readFile("netlify/lib/mixed-book-db-runtime.mjs","utf8");
  const conf=await readFile("netlify.toml","utf8");
  assert.ok(runtime.includes("getDatabase"));
  assert.ok(runtime.includes("VSH_MIXED_BOOK_DB_ENABLED"));
  assert.ok(!runtime.includes("postgres://"));
  assert.ok(!conf.includes("netlify/database/migrations"));
  const fs=await import("node:fs");
  const {requireApprovedPreviewMigration}=await import("./preview-only-migration-guard.mjs");
  assert.equal(requireApprovedPreviewMigration(),true);
});

test("Mixed-book database service exposes gated transactional and scoped operations",async()=>{
  const {createMixedBookServices}=await import("../netlify/lib/mixed-book-db-service.mjs");
  let created=0;
  const options={
    context:preview,enabled:"true",
    databaseFactory(){created++;return {pool:dummyPool}}
  };
  const service=createMixedBookServices(options);
  assert.equal(created,1);
  assert.equal(typeof service.createPendingOrder,"function");
  assert.equal(typeof service.bindYocoCheckout,"function");
  assert.equal(typeof service.settleAfterVerifiedWebhook,"function");
  assert.equal(typeof service.loadPaidBrandSale,"function");
  assert.equal(typeof service.grantStore.findByHash,"function");
  assert.equal(typeof service.orderStore.findById,"function");
  assert.equal(await service.loadPaidBrandSale(orderId,"grannys"),null);
  assert.throws(()=>createMixedBookServices({...options,enabled:"false"}));
});
