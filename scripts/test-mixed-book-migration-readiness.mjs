/* Confirm the previously approved schema's shape in disposable GitHub CI PostgreSQL.
 * Reads ONLY local ephemeral CI_DATABASE_URL; never changes DB schema/data.
 * All tests run AFTER the existing CI applies the draft to its test DB.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {getDatabase} from "@netlify/database";
import {requireApprovedProductionSchemaBaseline} from "./approved-production-schema-baseline.mjs";

const url=process.env.CI_DATABASE_URL;
if(!url || !/^postgresql?:\/\/ci_test:/.test(url) ||
   !/127\.0\.0\.1:5432\/vsh_bookshop_ci$/.test(url))
  throw Error("Migration audit must use disposable CI-only PostgreSQL.");

const tables=[
 "vsh_mixed_orders","vsh_mixed_order_lines","vsh_mixed_brand_sales",
 "vsh_mixed_payment_events","vsh_mixed_email_outbox",
 "vsh_mixed_download_grants"
];

test("Previously approved additive migration matches its reviewed SQL and is unchanged",async()=>{
 const sql=await readFile("docs/database/mixed-book-orders-DRAFT.sql","utf8");
 assert.equal(requireApprovedProductionSchemaBaseline(),true);
 assert.match(sql,/^-- DRAFT ONLY\./);
 assert.match(sql,/^BEGIN;/m);
 assert.match(sql,/^COMMIT;/m);
 // Ignore English words in SQL comments; audit actual executable statements.
 const statements=sql.replace(/--[^\n]*/g,"");
 assert.doesNotMatch(statements,/\b(?:DROP\s+TABLE|TRUNCATE\s+(?:TABLE\s+)?vsh_|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s+vsh_|GRANT\s+|REVOKE\s+)\b/i);
 assert.doesNotMatch(statements,/\b(?:CREATE\s+EXTENSION|CREATE\s+FUNCTION|CREATE\s+TRIGGER|COPY|DO\s+\$)\b/i);
 assert.deepEqual([...sql.matchAll(/\bCREATE\s+TABLE\s+(vsh_mixed_[a-z_]+)\s*\(/g)]
   .map(m=>m[1]),tables);
 assert.equal((sql.match(/\bCREATE TABLE\b/g)||[]).length,6);
 assert.ok(!/public\.\s*(?:products|orders|customers)/i.test(sql));
});
test("Temporary real PostgreSQL has all six new tables, proper FK and UNIQUE constraints",async()=>{
 const database=getDatabase({connectionString:url});
 const client=await database.pool.connect();
 try{
   await client.query("BEGIN READ ONLY");
   const {rows}=await client.query(
     "SELECT tablename FROM pg_catalog.pg_tables"+
     " WHERE schemaname='public' AND tablename LIKE 'vsh_mixed_%'"+
     " ORDER BY tablename"
   );
   assert.deepEqual(rows.map(x=>x.tablename),[...tables].sort());
   const q=await client.query(
     "SELECT c.relname AS table_name,ct.contype,"+
     " pg_get_constraintdef(ct.oid) AS definition"+
     " FROM pg_constraint ct JOIN pg_class c ON c.oid=ct.conrelid"+
     " JOIN pg_namespace n ON n.oid=c.relnamespace"+
     " WHERE n.nspname='public' AND c.relname LIKE 'vsh_mixed_%'"
   );
   const constraints=q.rows;
   const forTable=(t,type)=>constraints.filter(x=>x.table_name===t&&x.contype===type);
   assert.ok(forTable("vsh_mixed_orders","p").length>=1);
   for(const table of tables.slice(1)){
     assert.ok(forTable(table,"f").length>=1,
       table+" must reference another bookshop table");
   }
   const foreign=forTable("vsh_mixed_download_grants","f");
   assert.ok(foreign.some(x=>x.definition.includes("business")&&
       x.definition.includes("product_id")&&
       x.definition.includes("vsh_mixed_order_lines")));
   assert.ok(forTable("vsh_mixed_download_grants","u").length>=2,
      "A grant must have a unique nonce and a unique book ownership tuple");
   assert.ok(forTable("vsh_mixed_email_outbox","u").some(x=>
      x.definition.includes("order_id")&&x.definition.includes("business")&&
      x.definition.includes("kind")));
   const cols=await client.query(
     "SELECT column_name,is_nullable FROM information_schema.columns"+
     " WHERE table_schema='public' AND table_name='vsh_mixed_download_grants'"
   );
   const nonce=cols.rows.find(x=>x.column_name==="token_nonce");
   assert.equal(nonce?.is_nullable,"NO");
   const checks=forTable("vsh_mixed_orders","c")
     .map(x=>x.definition).join("\n");
   assert.match(checks,/processing_mode/);
   assert.match(checks,/status/);
   const indexes=await client.query(
     "SELECT indexname FROM pg_indexes WHERE schemaname='public'"+
     " AND tablename LIKE 'vsh_mixed_%'"
   );
   for(const index of [
      "vsh_mixed_payment_events_order_idx",
      "vsh_mixed_outbox_pending_idx",
      "vsh_mixed_grant_expiry_idx"
   ])assert.ok(indexes.rows.some(x=>x.indexname===index));
   await client.query("ROLLBACK");
 }finally{
   try{await client.query("ROLLBACK")}catch{}
   client.release();
   await database.pool.end();
 }
});
