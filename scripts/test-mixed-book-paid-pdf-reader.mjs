import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {issueBookDownloadGrant} from "../netlify/lib/mixed-book-download-grants.mjs";
import {PDF_PART_BYTES} from "../netlify/lib/mixed-book-private-pdf-parts.mjs";
import {readAuthorizedPaidBookPart} from "../netlify/lib/mixed-book-paid-pdf-reader.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const bookId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const uploadId="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const business="clever-cubs";
const path=business+"/"+uploadId+".manifest.json";
const at=new Date("2026-11-01T10:00:00.000Z");
const first=Buffer.alloc(PDF_PART_BYTES,0x20);first.write("%PDF-1.7",0);
const last=Buffer.alloc(111,0x20);last.write("%%EOF",106);
const files=[first,last];
const m={
  version:1,kind:"chunked-pdf",business,id:uploadId,filename:"RR Afrikaans.pdf",
  size_bytes:PDF_PART_BYTES+111,part_bytes:PDF_PART_BYTES,part_count:2
};
const metadata=bytes=>({metadata:{
 sha256:crypto.createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length
}});
function fixture(){
  const {token,grant}=issueBookDownloadGrant({
    orderId,business,productId:bookId,
    paymentStatus:"paid",processingMode:"live",issuedAt:at,hours:48
  });
  const order={id:orderId,status:"paid",processingMode:"live",
    items:[{business,id:bookId,pdfPath:path}]};
  const accessed=[];
  const pdfStore={
    async getManifest(b,k){accessed.push("manifest:"+b+":"+k);return m},
    async getSmallPdfSize(){throw Error("chunked PDF shouldn't ask small size")},
    async getPart(store,key){
      accessed.push("part:"+store+":"+key);
      const i=Number(key.slice(-5));
      const bytes=files[i];
      return bytes?{bytes,metadata:metadata(bytes)}:null;
    }
  };
  return {token,grant,order,accessed,pdfStore,
    grantStore:{async findByHash(hash){return hash===grant.tokenHash?grant:null}},
    orderStore:{async findById(id){return id===order.id?order:null}}
  };
}
test("Paid customer with valid secret gets only the requested private 3 MiB piece",async()=>{
  const f=fixture();
  const p=await readAuthorizedPaidBookPart({...f,index:0,now:at});
  assert.equal(p.partIndex,0);
  assert.equal(p.partCount,2);
  assert.equal(p.contentType,"application/octet-stream");
  assert.equal(p.cacheControl,"private, no-store");
  assert.equal(p.brand,"clever-cubs");
  assert.equal(p.partBytes,PDF_PART_BYTES);
  assert.equal(p.contentRange,"bytes 0-"+(PDF_PART_BYTES-1)+"/"+(PDF_PART_BYTES+111));
  assert.ok(f.accessed.includes("part:vsh-private-book-parts:clever-cubs/"+uploadId+"/part/00000"));
  assert.ok(f.accessed.every(k=>!k.includes("grannys")));
});
test("Last part is just 111 bytes with checked EOF and correct offset",async()=>{
  const f=fixture();
  const p=await readAuthorizedPaidBookPart({...f,index:1,now:at});
  assert.equal(p.partBytes,111);
  assert.equal(p.contentRange,"bytes "+PDF_PART_BYTES+"-"+(PDF_PART_BYTES+110)+"/"+(PDF_PART_BYTES+111));
  assert.equal(p.bytes.subarray(-5).toString(),"%%EOF");
});
test("Missing, expired, refunded, test-mode or cross-brand grants never read private PDF",async()=>{
  for(const patch of [
    {token:"invalid"}, {now:new Date("2026-11-03T11:00:00Z")},
    {order:{id:orderId,status:"refunded",processingMode:"live",
      items:[{business,id:bookId,pdfPath:path}]}},
    {order:{id:orderId,status:"paid",processingMode:"test",
      items:[{business,id:bookId,pdfPath:path}]}},
    {order:{id:orderId,status:"paid",processingMode:"live",
      items:[{business:"grannys",id:bookId,pdfPath:"grannys/"+uploadId+".pdf"}]}}
  ]){
    const f=fixture();
    if("order" in patch)f.orderStore={async findById(){return patch.order}};
    await assert.rejects(readAuthorizedPaidBookPart({...f,index:0,...patch}));
    assert.deepEqual(f.accessed,[]);
  }
});
test("Unauthorised part numbers never access the Blob store",async()=>{
  const f=fixture();
  for(const index of [-1,2,1.5,"0"]){
    const x=fixture();
    await assert.rejects(readAuthorizedPaidBookPart({...x,index,now:at}));
    if(index!==2)assert.deepEqual(x.accessed,[]);
  }
});
test("Corrupted PDF bytes are rejected even with a trusted purchase grant",async()=>{
  const f=fixture();
  f.pdfStore.getPart=async()=>({
    bytes:Buffer.alloc(PDF_PART_BYTES,0x20),
    metadata:metadata(first)
  });
  await assert.rejects(readAuthorizedPaidBookPart({...f,index:0,now:at}));
});
test("No raw blob store keys or PDFs are exposed to the browser by a public route",async()=>{
  const source=await import("node:fs/promises");
  const file=await source.readFile("netlify/lib/mixed-book-paid-pdf-reader.mjs","utf8");
  assert.ok(file.includes("isValidBookGrant"));
  assert.ok(file.includes("validatePrivatePdfPartBytes"));
  // This file is an imported server helper, NOT a deployed Netlify Function.
  assert.ok(!file.includes("export default async function handler"));
});
