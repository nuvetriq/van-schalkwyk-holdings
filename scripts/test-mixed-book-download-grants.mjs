import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  issueBookDownloadGrant,isValidBookGrant,bookDownloadUrl
} from "../netlify/lib/mixed-book-download-grants.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const grannyId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const cleverId="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const base=new Date("2026-11-01T12:00:00.000Z");
const product=(business,id)=>({id,business,pdfPath:business+"/"+id+".pdf"});
const order={
  id:orderId,status:"paid",processingMode:"live",
  items:[product("grannys",grannyId),product("clever-cubs",cleverId)]
};
function issued(business="grannys",productId=grannyId) {
  return issueBookDownloadGrant({
    orderId,business,productId,paymentStatus:"paid",processingMode:"live",
    issuedAt:base,hours:48
  });
}
test("Creates unique random links and only stores SHA-256 token digest",()=>{
  const a=issued(),b=issued();
  assert.equal(a.token.length,43);
  assert.match(a.grant.tokenHash,/^[a-f0-9]{64}$/);
  assert.notEqual(a.token,b.token);
  assert.notEqual(a.grant.tokenHash,b.grant.tokenHash);
  assert.ok(!JSON.stringify(a.grant).includes(a.token));
  assert.match(bookDownloadUrl(a.token),/^https:\/\/vanschalkwykholdings.com\/\.netlify\/functions\/paid-book-download\?token=/);
});
test("Valid only for same paid order, brand and immutable purchased book",()=>{
  const {token,grant}=issued();
  assert.equal(isValidBookGrant(token,grant,order,{now:base}),true);
  assert.equal(isValidBookGrant(token,{...grant,business:"clever-cubs"},order,{now:base}),false);
  assert.equal(isValidBookGrant(token,{...grant,productId:cleverId},order,{now:base}),false);
  assert.equal(isValidBookGrant(token,grant,{...order,status:"refunded"},{now:base}),false);
  assert.equal(isValidBookGrant(token,grant,{...order,processingMode:"test"},{now:base}),false);
  assert.equal(isValidBookGrant(token,grant,{...order,items:[order.items[1]]},{now:base}),false);
  assert.equal(isValidBookGrant(token,grant,{...order,id:cleverId},{now:base}),false);
});
test("Incorrect, expired, revoked or invalid-format grants are rejected",()=>{
  const {token,grant}=issued();
  assert.equal(isValidBookGrant("invalid",grant,order,{now:base}),false);
  assert.equal(isValidBookGrant(issued().token,grant,order,{now:base}),false);
  assert.equal(isValidBookGrant(token,grant,order,{now:new Date("2026-11-03T12:00:00Z")}),false);
  assert.equal(isValidBookGrant(token,{...grant,revokedAt:base.toISOString()},order,{now:base}),false);
  assert.equal(isValidBookGrant(token,{...grant,tokenHash:"x"},order,{now:base}),false);
});
test("No grant for unverified payment, test payment or invalid brand",()=>{
  for(const patch of [
    {paymentStatus:"awaiting_payment"},{paymentStatus:"refunded"},
    {processingMode:"test"},{business:"invalid"},
    {hours:169},{issuedAt:"not a date"}
  ]){
    assert.throws(()=>issueBookDownloadGrant({
      orderId,business:"grannys",productId:grannyId,
      paymentStatus:"paid",processingMode:"live",issuedAt:base,hours:48,
      ...patch
    }));
  }
  const {token}=issued();
  assert.throws(()=>bookDownloadUrl(token,"https://evil.example"));
});
test("Draft SQL describes transaction-safe brand tables, without auto-migration",async()=>{
  const sql=await readFile("docs/database/mixed-book-orders-DRAFT.sql","utf8");
  for(const table of [
    "vsh_mixed_orders","vsh_mixed_order_lines","vsh_mixed_brand_sales",
    "vsh_mixed_payment_events","vsh_mixed_email_outbox",
    "vsh_mixed_download_grants"
  ])assert.ok(sql.includes("CREATE TABLE "+table));
  assert.ok(sql.includes("UNIQUE(order_id,business,kind)"));
  assert.ok(sql.includes("PRIMARY KEY (order_id,business)"));
  assert.ok(sql.includes("REFERENCES vsh_mixed_order_lines(order_id,business,product_id)"));
  assert.ok(sql.includes("CHECK (token_hash ~ '^[a-f0-9]{64}$')"));
  assert.ok(sql.includes("BEGIN;")&&sql.includes("COMMIT;"));
  assert.equal((await readFile("netlify.toml","utf8")).includes("database/migrations"),false);
});
