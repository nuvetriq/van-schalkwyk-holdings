import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {readFile} from "node:fs/promises";
import {
 derivePaidBookToken,ensureCommittedPaidBookLinks
} from "../netlify/lib/mixed-book-paid-grant-service.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const grId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const ccId="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const nonce="c0af7828-aa67-4a7f-b1a3-5a2baf118739";
const linkKey="vshlk_"+Buffer.alloc(32,0x37).toString("base64");
const otherKey="vshlk_"+Buffer.alloc(32,0x38).toString("base64");
const at=new Date("2026-11-01T10:00:00Z");
const books={
 grannys:[{product_id:grId,title:"Granny's recipe",price_cents:"12999",
   private_pdf_path:"grannys/"+grId+".manifest.json"}],
 "clever-cubs":[{product_id:ccId,title:"CleverCubs RR",price_cents:"8500",
   private_pdf_path:"clever-cubs/"+ccId+".pdf"}]
};
function fakePool({mode="live",status="paid",failInsert=false,subtotalExtra=0}={}){
 const data={grants:[],sql:[],release:0,rollbacks:0,commits:0};
 const pool={
  async connect(){
   let staged=null;
   return {
    async query(sql,args=[]){
     data.sql.push(sql);
     if(sql==="BEGIN"){staged=[...data.grants];return {rows:[]};}
     if(sql==="COMMIT"){
       data.grants=staged;data.commits++;return {rows:[]};
     }
     if(sql==="ROLLBACK"){data.rollbacks++;staged=null;return {rows:[]};}
     if(sql.includes("FROM vsh_mixed_orders o")){
       const business=args[1];
       return {rows:[{
         id:orderId,business,status,processing_mode:mode,
         payment_id:"pay_Test123",checkout_id:"checkout_Test123",
         subtotal_cents:String(books[business].reduce((sum,b)=>sum+Number(b.price_cents),subtotalExtra))
       }]};
     }
     if(sql.includes("FROM vsh_mixed_order_lines")){
       return {rows:books[args[1]]||[]};
     }
     if(sql.includes("FROM vsh_mixed_download_grants")){
       return {rows:staged.filter(x=>x.business===args[1]&&x.order_id===args[0])};
     }
     if(sql.includes("INSERT INTO vsh_mixed_download_grants")){
       if(failInsert)throw Error("fake SQL failure");
       const [token_hash,order_id,business,product_id,token_nonce,expires_at]=args;
       const known=staged.find(x=>x.business===business&&x.product_id===product_id);
       if(known)return {rows:[]};
       staged.push({token_hash,order_id,business,product_id,token_nonce,
         expires_at,revoked_at:null});
       return {rows:[{token_hash}]};
     }
     throw Error("Unexpected SQL in synthetic grant transaction: "+sql);
    },
    release(){data.release++;}
   };
  }
 };
 return {pool,data};
}
test("Stable HMAC token survives worker restart without DB plaintext secret",()=>{
 const args={linkKey,orderId,business:"grannys",productId:grId,nonce};
 const token=derivePaidBookToken(args);
 assert.match(token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(derivePaidBookToken(args),token);
 assert.notEqual(derivePaidBookToken({...args,linkKey:otherKey}),token);
 assert.notEqual(derivePaidBookToken({...args,nonce:crypto.randomUUID()}),token);
 assert.notEqual(derivePaidBookToken({...args,business:"clever-cubs"}),token);
 assert.throws(()=>derivePaidBookToken({...args,linkKey:"vshlk_bad"}));
});
test("Paid LIVE book's grant commits before return; replay reconstructs same link",async()=>{
 const f=fakePool();
 const first=await ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey,now:at,
   nonceFactory:()=>nonce
 });
 assert.equal(first.length,1);
 assert.equal(f.data.commits,1);
 assert.equal(f.data.grants.length,1);
 assert.equal(f.data.grants[0].token_nonce,nonce);
 assert.equal(f.data.grants[0].token_hash.length,64);
 assert.ok(!JSON.stringify(f.data.grants).includes(first[0].url.split("#token=")[1]));
 assert.ok(first[0].url.startsWith("https://vanschalkwykholdings.com/book-download.html#token="));
 const second=await ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey,now:new Date(at.getTime()+1000),
   nonceFactory:()=>{throw Error("Nonce must not be recreated on retries");}
 });
 assert.deepEqual(second,first);
 assert.equal(f.data.grants.length,1);
 assert.equal(f.data.commits,2);
 assert.equal(f.data.release,2);
 assert.ok(f.data.sql.some(x=>x.includes("FOR UPDATE OF o")));
});
test("Same paid mixed order generates isolated brand links, not duplicated grants",async()=>{
 const f=fakePool();
 const a=await ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey,now:at,nonceFactory:()=>nonce
 });
 const b=await ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"clever-cubs",linkKey,now:at,
   nonceFactory:()=>crypto.randomUUID()
 });
 assert.equal(f.data.grants.length,2);
 assert.notEqual(a[0].url,b[0].url);
 assert.deepEqual(a.map(x=>x.id),[grId]);
 assert.deepEqual(b.map(x=>x.id),[ccId]);
 assert.equal(f.data.grants.find(x=>x.business==="grannys").product_id,grId);
 assert.equal(f.data.grants.find(x=>x.business==="clever-cubs").product_id,ccId);
});
test("TEST or unpaid orders never create usable book grants",async()=>{
 for(const args of [{mode:"test"},{status:"awaiting_payment"},{status:"refunded"},
   {status:"checkout_pending"}]){
   const f=fakePool(args);
   await assert.rejects(ensureCommittedPaidBookLinks(f.pool,{
     orderId,business:"grannys",linkKey,now:at
   }),/Verified live brand payment/);
   assert.equal(f.data.commits,0);
   assert.equal(f.data.rollbacks,1);
   assert.deepEqual(f.data.grants,[]);
 }
});
test("Database failure rolls back all grants and leaks no links",async()=>{
 const f=fakePool({failInsert:true});
 await assert.rejects(ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey,now:at,nonceFactory:()=>nonce
 }),/fake SQL failure/);
 assert.equal(f.data.commits,0);
 assert.equal(f.data.rollbacks,1);
 assert.equal(f.data.release,1);
 assert.deepEqual(f.data.grants,[]);
});
test("Revoked, expired or changed signing key will never silently reissue a link",async()=>{
 const f=fakePool();
 await ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey,now:at,nonceFactory:()=>nonce
 });
 const old=f.data.grants[0];
 for(const patch of [
   {revoked_at:at.toISOString()},
   {expires_at:new Date(at.getTime()-1000).toISOString()},
   {token_hash:"0".repeat(64)}
 ]){
   f.data.grants[0]={...old,...patch};
   await assert.rejects(ensureCommittedPaidBookLinks(f.pool,{
     orderId,business:"grannys",linkKey,now:at
   }));
 }
 f.data.grants[0]=old;
 await assert.rejects(ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey:otherKey,now:at
 }),/does not match/);
 assert.equal(f.data.grants.length,1);
});
test("Incorrect sale subtotal, missing key or unsafe brand fails closed",async()=>{
 const f=fakePool({subtotalExtra:1});
 await assert.rejects(ensureCommittedPaidBookLinks(f.pool,{
   orderId,business:"grannys",linkKey,now:at
 }),/does not reconcile/);
 assert.equal(f.data.grants.length,0);
 const invalid=fakePool();
 await assert.rejects(ensureCommittedPaidBookLinks(invalid.pool,{
   orderId,business:"grannys",linkKey:"bad",now:at
 }));
 await assert.rejects(ensureCommittedPaidBookLinks(invalid.pool,{
   orderId,business:"other-brand",linkKey,now:at
 }));
 assert.equal(invalid.data.sql.length,0);
});
test("Approved schema preserves unique recoverable grant nonces",async()=>{
 const sql=await readFile("docs/database/mixed-book-orders-DRAFT.sql","utf8");
 assert.match(sql,/token_nonce uuid NOT NULL UNIQUE/);
 assert.match(sql,/UNIQUE\(order_id,business,product_id\)/);
 assert.match(sql,/CHECK \(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
 assert.match(sql,/DRAFT ONLY/);
 const release=await readFile("scripts/test-mixed-book-release-gates.mjs","utf8");
 assert.ok(release.includes('requireApprovedProductionSchemaBaseline'));
 const baseline=await readFile('scripts/approved-production-schema-baseline.mjs','utf8');
 assert.ok(baseline.includes('netlify/database/migrations'));
 assert.ok(baseline.includes('Exactly one previously approved migration'));
});
