import {test} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  PDF_PART_BYTES,PDF_MAX_BYTES,validateSealedBookManifest,
  privatePdfPartPlan,validatePrivatePdfPartBytes,safePrivatePdfFileName
} from "../netlify/lib/mixed-book-private-pdf-parts.mjs";

const id="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const path="grannys/"+id+".manifest.json";
const size=PDF_PART_BYTES*2+127;
const manifest={
  version:1,kind:"chunked-pdf",business:"grannys",id,
  filename:"Granny's Recipes.pdf",size_bytes:size,
  part_bytes:PDF_PART_BYTES,part_count:3
};
const part=(index,bytes)=>{
  const buf=Buffer.alloc(bytes,0x20);
  if(index===0)buf.write("%PDF-",0);
  if(index===2)buf.write("%%EOF",bytes-5);
  return buf;
};
const metadata=buf=>({metadata:{
  sha256:crypto.createHash("sha256").update(buf).digest("hex"),
  bytes:buf.length
}});
test("A sealed PDF manifest plans 3 MiB pieces in the correct private Blob store",()=>{
  const m=validateSealedBookManifest("grannys",path,manifest);
  assert.equal(m.partCount,3);
  assert.equal(m.sizeBytes,size);
  const first=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index:0});
  const middle=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index:1});
  const final=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index:2});
  assert.equal(first.storeName,"vsh-private-book-parts");
  assert.equal(first.storeKey,"grannys/"+id+"/part/00000");
  assert.equal(middle.storeKey,"grannys/"+id+"/part/00001");
  assert.equal(final.storeKey,"grannys/"+id+"/part/00002");
  assert.equal(first.expectedPartBytes,PDF_PART_BYTES);
  assert.equal(middle.expectedPartBytes,PDF_PART_BYTES);
  assert.equal(final.expectedPartBytes,127);
  assert.equal(final.offset,PDF_PART_BYTES*2);
});
test("Each part enforces stored checksum, exact bytes, first PDF header and last EOF",()=>{
  for(let index=0;index<3;index++){
    const p=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index});
    const bytes=part(index,p.expectedPartBytes);
    const checked=validatePrivatePdfPartBytes(p,bytes,metadata(bytes));
    assert.equal(checked.length,p.expectedPartBytes);
    assert.equal(checked.contentRange,
      "bytes "+p.offset+"-"+(p.offset+bytes.length-1)+"/"+size);
    assert.throws(()=>validatePrivatePdfPartBytes(p,bytes,{
      metadata:{sha256:"0".repeat(64),bytes:bytes.length}
    }));
    assert.throws(()=>validatePrivatePdfPartBytes(p,bytes.subarray(0,bytes.length-1),metadata(bytes)));
  }
  const first=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index:0});
  const badHeader=Buffer.alloc(first.expectedPartBytes,0x20);
  assert.throws(()=>validatePrivatePdfPartBytes(first,badHeader,metadata(badHeader)));
  const last=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index:2});
  const badEnd=Buffer.alloc(last.expectedPartBytes,0x20);
  assert.throws(()=>validatePrivatePdfPartBytes(last,badEnd,metadata(badEnd)));
});
test("Reject cross-brand paths, forged manifests and out-of-range part requests",()=>{
  for(const m of [
    {...manifest,business:"clever-cubs"},
    {...manifest,size_bytes:PDF_MAX_BYTES+1},
    {...manifest,part_count:4},
    {...manifest,part_bytes:1024},
    {...manifest,id:"ac20bc30-83b6-4fa2-b034-e5129232a210"},
    {...manifest,filename:"../secret.pdf"},
    {...manifest,filename:"invalid.txt"}
  ])assert.throws(()=>validateSealedBookManifest("grannys",path,m));
  for(const x of [-1,3,Infinity,1.5])
    assert.throws(()=>privatePdfPartPlan({business:"grannys",pdfPath:path,manifest,index:x}));
  assert.throws(()=>privatePdfPartPlan({
    business:"clever-cubs",pdfPath:path,manifest,index:0
  }));
  assert.throws(()=>privatePdfPartPlan({
    business:"grannys",pdfPath:"grannys/../secret.pdf",manifest,index:0
  }));
});
test("Maximum-size 2GiB PDF is handled as many independent 3MiB requests",()=>{
  const large={...manifest,size_bytes:PDF_MAX_BYTES,
    part_count:Math.ceil(PDF_MAX_BYTES/PDF_PART_BYTES)};
  assert.equal(large.part_count,683);
  const last=privatePdfPartPlan({business:"grannys",pdfPath:path,
    manifest:large,index:large.part_count-1});
  assert.ok(last.expectedPartBytes<=PDF_PART_BYTES);
  assert.equal(last.offset+last.expectedPartBytes,PDF_MAX_BYTES);
  assert.ok(PDF_PART_BYTES<20*1024*1024);
});
test("Small private PDF uses its existing secure store and remains one part",()=>{
  const smallPath="clever-cubs/"+id+".pdf";
  const p=privatePdfPartPlan({business:"clever-cubs",pdfPath:smallPath,
    smallPdfBytes:1024,index:0});
  assert.equal(p.storeName,"vsh-private-recipe-pdfs");
  assert.equal(p.storeKey,smallPath);
  const buf=Buffer.alloc(1024,0x20);
  buf.write("%PDF-",0);buf.write("%%EOF",1019);
  assert.equal(validatePrivatePdfPartBytes(p,buf).length,1024);
  assert.throws(()=>privatePdfPartPlan({business:"clever-cubs",pdfPath:smallPath,
    smallPdfBytes:PDF_PART_BYTES+1,index:0}));
  assert.throws(()=>privatePdfPartPlan({business:"clever-cubs",pdfPath:smallPath,
    smallPdfBytes:1024,index:1}));
});
test("Chunked single-part manifests still require a stored SHA256 checksum",()=>{
  const tiny={...manifest,size_bytes:1024,part_count:1};
  const p=privatePdfPartPlan({business:"grannys",pdfPath:path,manifest:tiny,index:0});
  const buf=Buffer.alloc(1024,0x20);
  buf.write("%PDF-",0);buf.write("%%EOF",1019);
  assert.equal(validatePrivatePdfPartBytes(p,buf,metadata(buf)).length,1024);
  assert.throws(()=>validatePrivatePdfPartBytes(p,buf));
});
test("Book filename sanitizer blocks header/control/path injection",()=>{
  assert.equal(safePrivatePdfFileName("../pwn\\file.pdf"),".._pwn_file.pdf");
  assert.equal(safePrivatePdfFileName("Not a book"),"Purchased-book.pdf");
  assert.equal(safePrivatePdfFileName("Book\r\nX-Test:1.pdf"),"Book__X-Test_1.pdf");
});
