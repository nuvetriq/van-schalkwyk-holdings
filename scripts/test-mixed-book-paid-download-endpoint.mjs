import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {issueBookDownloadGrant} from "../netlify/lib/mixed-book-download-grants.mjs";
import {PDF_PART_BYTES} from "../netlify/lib/mixed-book-private-pdf-parts.mjs";
import {createMixedBookPrivatePdfStore}
  from "../netlify/lib/mixed-book-private-blob-store.mjs";
import {makePaidBookDownloadHandler,config}
  from "../netlify/functions/paid-book-download.mjs";

const ROOT="https://vanschalkwykholdings.com/.netlify/functions/paid-book-download";
const context={deploy:{context:"production"}};
const env={
  VSH_MIXED_BOOK_DB_ENABLED:"true",VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true"
};
const now=new Date("2026-11-01T15:00:00.000Z");
const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const grBook="ac20bc30-83b6-4fa2-b034-e5129232a210";
const grUpload="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const ccBook="09cb4c75-9c5d-4978-b417-a53b9680bbf0";
const ccUpload="c0af7828-aa67-4a7f-b1a3-5a2baf118739";
const smallKey="clever-cubs/"+ccUpload+".pdf";
const largeKey="grannys/"+grUpload+".manifest.json";
const first=Buffer.alloc(PDF_PART_BYTES,0x20);first.write("%PDF-1.7",0);
const last=Buffer.alloc(111,0x20);last.write("%%EOF",106);
const small=Buffer.from("%PDF-1.7\nsmall example PDF file contents\n%%EOF");
const largeManifest={
  version:1,kind:"chunked-pdf",business:"grannys",id:grUpload,
  filename:"Grannys collection.pdf",size_bytes:first.length+last.length,
  part_bytes:PDF_PART_BYTES,part_count:2
};
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
function makeTest({business="grannys",pdfPath=largeKey,
  productId=grBook,status="paid",mode="live",revokedAt=null,
  expiryHours=48,blobBytes=null}={}){
  const {token,grant}=issueBookDownloadGrant({
    orderId,business,productId,paymentStatus:"paid",
    processingMode:"live",issuedAt:now,hours:expiryHours
  });
  grant.revokedAt=revokedAt;
  const order={
    id:orderId,status,processingMode:mode,
    items:[{business,id:productId,pdfPath}]
  };
  const calls=[];
  const stores={
    "vsh-private-recipe-pdfs":{
      async get(key,{type}){
        calls.push("getManifest:"+key);
        assert.equal(type,"json");
        return key===largeKey?largeManifest:null;
      },
      async getWithMetadata(key,{type}){
        calls.push("smallPDF:"+key);
        assert.equal(type,"arrayBuffer");
        if(key!==smallKey)return null;
        const bytes=blobBytes||small;
        return {data:Uint8Array.from(bytes).buffer,
          etag:"test-etag",metadata:{}};
      }
    },
    "vsh-private-book-parts":{
      async getWithMetadata(key,{type}){
        calls.push("part:"+key);
        assert.equal(type,"arrayBuffer");
        const bytes=key==="grannys/"+grUpload+"/part/00000"?first:
          key==="grannys/"+grUpload+"/part/00001"?last:null;
        if(!bytes)return null;
        return {data:Uint8Array.from(blobBytes||bytes).buffer,
          etag:"test-etag",
          metadata:{sha256:hash(bytes),bytes:bytes.length}};
      }
    }
  };
  const blobFactory=()=>createMixedBookPrivatePdfStore({
    openStore(name){
      calls.push("open:"+name);
      if(!stores[name])throw Error("Attempted to read a forbidden Blob store");
      return stores[name];
    }
  });
  const databaseFactory=()=>({
    grantStore:{async findByHash(tokenHash){
      calls.push("grant:"+tokenHash);
      return tokenHash===grant.tokenHash?grant:null;
    }},
    orderStore:{async findById(id){
      calls.push("order:"+id);
      return id===order.id?order:null;
    }}
  });
  const handler=makePaidBookDownloadHandler({
    env,databaseFactory,blobFactory,now:()=>now
  });
  const url=(part=null)=>ROOT+"?token="+token+(part===null?"":"&part="+part);
  return {token,grant,order,calls,handler,url};
}
test("Paid live grant serves only one 3 MiB verified Granny's PDF part",async()=>{
  const f=makeTest();
  const res=await f.handler(new Request(f.url(0)),context);
  assert.equal(res.status,200);
  assert.equal(res.headers.get("content-type"),"application/octet-stream");
  assert.equal(res.headers.get("content-length"),String(PDF_PART_BYTES));
  assert.equal(res.headers.get("x-book-part-index"),"0");
  assert.equal(res.headers.get("x-book-part-count"),"2");
  assert.equal(res.headers.get("x-book-total-bytes"),String(first.length+last.length));
  assert.equal(res.headers.get("cache-control"),"private, no-store");
  assert.equal(res.headers.get("referrer-policy"),"no-referrer");
  assert.equal(res.headers.get("cross-origin-resource-policy"),"same-origin");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),first);
  assert.ok(f.calls.includes("part:grannys/"+grUpload+"/part/00000"));
  assert.ok(f.calls.every(x=>!x.includes("clever-cubs")));
  assert.equal(config.rateLimit.windowLimit,120);
});
test("Second part is bounded, checks SHA256 and has correct EOF",async()=>{
  const f=makeTest();
  const res=await f.handler(new Request(f.url(1)),context);
  assert.equal(res.status,200);
  assert.equal(res.headers.get("x-book-part-index"),"1");
  assert.equal(res.headers.get("content-length"),"111");
  const bytes=Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.length,111);
  assert.equal(bytes.subarray(-5).toString(),"%%EOF");
});
test("Small CleverCubs PDF can be read from the private manifest store without guessing upload ID",async()=>{
  const f=makeTest({
    business:"clever-cubs",productId:ccBook,pdfPath:smallKey
  });
  const res=await f.handler(new Request(f.url()),context);
  assert.equal(res.status,200);
  assert.equal(res.headers.get("x-book-part-count"),"1");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),small);
  assert.ok(f.calls.includes("smallPDF:"+smallKey));
  assert.equal(f.calls.filter(x=>x==="smallPDF:"+smallKey).length,1);
  assert.ok(f.calls.every(x=>!x.startsWith("part:")));
});
test("Invalid, expired, revoked, refunded, test-only and cross-brand access never reads private PDF",async()=>{
  const fixtures=[
    {expiryHours:1},
    {revokedAt:now.toISOString()},
    {status:"refunded"},
    {mode:"test"},
    {business:"grannys",pdfPath:smallKey}
  ];
  for(const patch of fixtures){
    const f=makeTest(patch);
    const res=await f.handler(new Request(f.url()),context);
    assert.equal(res.status,404);
    assert.ok(!f.calls.some(x=>x.startsWith("part:")||x.startsWith("smallPDF:")));
  }
  const f=makeTest();
  assert.equal((await f.handler(new Request(ROOT+"?token=nope"),context)).status,404);
  assert.equal(f.calls.length,0);
});
test("Malformed part numbers and extra query parameters never reach the database",async()=>{
  const f=makeTest();
  for(const url of [
    f.url(-1),f.url("01"),f.url(3.5),f.url("10000"),
    f.url(0)+"&token=repeat",
    f.url(0)+"&merchant=secret",
    ROOT+"?part=0",
    ROOT+"?token="+f.token+"&part=0&part=1"
  ]){
    assert.equal((await f.handler(new Request(url),context)).status,404);
  }
  assert.equal(f.calls.length,0);
});
test("Feature disabled, wrong website or preview context cannot touch Blob or DB",async()=>{
  for(const settings of [
    {...env,VSH_MIXED_BOOK_DB_ENABLED:"false"},
    {...env,VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"false"},
    {},
  ]){
    const f=makeTest();
    const handler=makePaidBookDownloadHandler({
      env:settings,databaseFactory:()=>{throw Error("Unwanted database access");},
      blobFactory:()=>{throw Error("Unwanted blob access");}
    });
    assert.equal((await handler(new Request(f.url()),context)).status,503);
  }
  const f=makeTest();
  assert.equal((await f.handler(
    new Request(f.url().replace("vanschalkwykholdings.com","wrong.example")),context
  )).status,503);
  assert.equal((await f.handler(new Request(f.url()),{
    deploy:{context:"deploy-preview"}
  })).status,503);
  assert.equal(f.calls.length,0);
});
test("A corrupt or too-large private blob fails closed with no PDF bytes",async()=>{
  const f=makeTest({blobBytes:Buffer.alloc(PDF_PART_BYTES,0)});
  const res=await f.handler(new Request(f.url()),context);
  assert.equal(res.status,503);
  const data=await res.json();
  assert.equal(data.error,"Book download unavailable.");
  assert.ok(!JSON.stringify(data).includes("grannys/"));
  const big=makeTest({
    business:"clever-cubs",productId:ccBook,pdfPath:smallKey,
    blobBytes:Buffer.alloc(PDF_PART_BYTES+1)
  });
  assert.equal((await big.handler(new Request(big.url()),context)).status,503);
});
test("Refuses non-GET method and never exposes private tokens or data in errors",async()=>{
  const f=makeTest();
  const res=await f.handler(new Request(f.url(),{method:"POST"}),context);
  assert.equal(res.status,405);
  const raw=JSON.stringify(await res.json());
  assert.ok(!raw.includes(f.token));
  assert.ok(!raw.includes("vsh-private"));
  assert.equal(f.calls.length,0);
});
