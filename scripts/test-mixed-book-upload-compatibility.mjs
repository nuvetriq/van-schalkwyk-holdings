/* Compatibility test against the ACTUAL admin-products and book-upload data
 * contracts, not a made-up checkout-only fixture. No live Netlify Blob calls.
 *
 * Product IDs and PDF upload IDs are independent UUIDs; every private PDF
 * lives in a site-wide, business-scoped Blob namespace. Large books use a
 * manifest with 3 MiB parts and must never be read as an inline PDF.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createMixedBookCatalogueSource} from "../netlify/lib/mixed-book-catalogue-source.mjs";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {validateSealedBookManifest}
  from "../netlify/lib/mixed-book-private-pdf-parts.mjs";

const grProduct="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const grUpload="c0af7828-aa67-4a7f-b1a3-5a2baf118739";
const ccProduct="ac20bc30-83b6-4fa2-b034-e5129232a210";
const ccUpload="09cb4c75-9c5d-4978-b417-a53b9680bbf0";
const partBytes=3*1024*1024, size=partBytes+3452;
const grPdf="grannys/"+grUpload+".manifest.json";
const ccPdf="clever-cubs/"+ccUpload+".pdf";
const products={
  ["grannys/"+grProduct+".json"]:{
    id:grProduct,business:"grannys",category:"Recipe Books",
    title:"Granny's Big Recipe Collection",price:199.95,
    pdf_path:grPdf,is_active:true
  },
  ["clever-cubs/"+ccProduct+".json"]:{
    id:ccProduct,business:"clever-cubs",category:"Preschool",
    title:"CleverCubs Grade RR",price:85.00,
    pdf_path:ccPdf,is_active:true
  }
};
// Manifest fields are identical to book-upload.mjs?action=finalize
const manifest={
  version:1,kind:"chunked-pdf",business:"grannys",id:grUpload,
  filename:"granny-recipe-collection.pdf",size_bytes:size,
  part_bytes:partBytes,part_count:2,
  created_at:"2026-10-31T08:00:00.000Z",
  completed_at:"2026-10-31T08:10:00.000Z"
};
const customer={name:"CI Test Customer",email:"ci-test@example.invalid",
  items:[{business:"grannys",id:grProduct},
         {business:"clever-cubs",id:ccProduct}]};
function source({recordOverride={},manifestValue=manifest,missingFiles=[]}={}){
  const calls=[];
  const records={...products,...recordOverride};
  const files={
    [grPdf]:manifestValue,
    [ccPdf]:"small-pdf-data-stored-as-bytes"
  };
  const adapter=createMixedBookCatalogueSource({
    openStore(name){
      if(name==="vsh-products")return {
        async get(key,{type}){
          assert.equal(type,"json");
          calls.push("product:"+key);
          return records[key]||null;
        }
      };
      if(name==="vsh-private-recipe-pdfs")return {
        async getMetadata(key){
          calls.push("metadata:"+key);
          return Object.hasOwn(files,key) && !missingFiles.includes(key)
            // Netlify's documented getMetadata returns etag+metadata, NOT
            // necessarily a "size" field.
            ? {etag:'"etag-in-ci"',metadata:{}}:null;
        },
        async get(key,{type}){
          assert.equal(type,"json");
          calls.push("manifest:"+key);
          return files[key]||null;
        }
      };
      throw Error("Unexpected public/private storage namespace");
    }
  });
  return {adapter,calls};
}
test("Large PDF upload manifest and small PDF fit a single combined, server-priced cart",async()=>{
  const {adapter,calls}=source();
  const result=await snapshotMixedOrder(customer,adapter);
  assert.equal(result.master.amountCents,28495);
  assert.deepEqual(result.master.items.map(x=>x.pdfPath),[grPdf,ccPdf]);
  assert.equal(result.sales.length,2);
  assert.equal(result.sales[0].subtotalCents,19995);
  assert.equal(result.sales[1].subtotalCents,8500);
  assert.equal(result.master.items[0].id,grProduct);
  assert.notEqual(result.master.items[0].id,grUpload);
  assert.equal(result.master.items[1].id,ccProduct);
  assert.notEqual(result.master.items[1].id,ccUpload);
  assert.ok(calls.includes("metadata:"+grPdf));
  assert.ok(calls.includes("manifest:"+grPdf));
  assert.ok(calls.includes("metadata:"+ccPdf));
  assert.equal(calls.includes("manifest:"+ccPdf),false);
  assert.equal(validateSealedBookManifest("grannys",grPdf,manifest).partCount,2);
});
test("Never accept missing private PDFs or missing large PDF manifests",async()=>{
  for(const path of [grPdf,ccPdf]){
    const {adapter}=source({missingFiles:[path]});
    await assert.rejects(snapshotMixedOrder(customer,adapter),
      /complete private PDF/);
  }
  const {adapter}=source({manifestValue:null});
  await assert.rejects(snapshotMixedOrder(customer,adapter),
    /complete private PDF/);
});
test("Reject a forged manifest belonging to the other brand or upload ID",async()=>{
  for(const patch of [
    {business:"clever-cubs"},
    {id:ccUpload},
    {part_bytes:1024},
    {part_count:1},
    {kind:"public-pdf"},
    {version:2},
    {size_bytes:0}
  ]){
    const {adapter}=source({manifestValue:{...manifest,...patch}});
    await assert.rejects(snapshotMixedOrder(customer,adapter),
      /complete private PDF/);
  }
});
test("Never substitute a different business's PDF path into a published product",async()=>{
  const modified={...products["grannys/"+grProduct+".json"],pdf_path:ccPdf};
  const {adapter}=source({recordOverride:{
    ["grannys/"+grProduct+".json"]:modified
  }});
  await assert.rejects(snapshotMixedOrder(customer,adapter),
    /no longer available/);
});
test("Admin product and large-upload formats remain compatible with our checkout",async()=>{
  const upload=await readFile("netlify/functions/book-upload.mjs","utf8");
  const admin=await readFile("netlify/functions/admin-products.mjs","utf8");
  const reader=await readFile("netlify/lib/mixed-book-private-pdf-parts.mjs","utf8");
  assert.ok(upload.includes('kind:"chunked-pdf"'));
  assert.ok(upload.includes('const PART_BYTES = 3 * 1024 * 1024'));
  assert.ok(upload.includes('"vsh-private-book-parts"'));
  assert.ok(upload.includes('"vsh-private-recipe-pdfs"'));
  assert.ok(admin.includes('vsh-products'));
  assert.ok(admin.includes('vsh-private-recipe-pdfs'));
  assert.ok(reader.includes('vsh-private-book-parts'));
});
