import {test} from "node:test";
import assert from "node:assert/strict";
import {
  snapshotMixedOrder, validateMixedCheckout, partitionBrandSales,
  brandEmailPayload, centsFromStoredPrice
} from "../netlify/lib/mixed-book-order.mjs";

const a="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const b="ac20bc30-83b6-4fa2-b034-e5129232a210";
const pdf=(brand,id)=>brand+"/"+id+".pdf";
const product=(brand,id,title,price)=>({
  business:brand,id,title,price,is_active:true,
  category:brand==="grannys"?"Recipe Books":"Preschool",
  pdf_path:pdf(brand,id)
});
const records=new Map([
 ["grannys:"+a,product("grannys",a,"Granny's Recipe Book",129.99)],
 ["clever-cubs:"+b,product("clever-cubs",b,"Grade RR Afrikaans",85)]
]);
const deps={
  async getProduct(brand,id){return records.get(brand+":"+id)||null;},
  async getPrivateFile(){return {metadata:{size:10240}};}
};
const input={
 name:"Test Customer",
 email:"Customer@Example.com",
 items:[{business:"grannys",id:a},{business:"clever-cubs",id:b}]
};
test("One master payment, two brand-specific internal sales",async()=>{
 const {master,sales}=await snapshotMixedOrder(input,deps);
 assert.equal(master.amountCents,21499);
 assert.equal(master.currency,"ZAR");
 assert.equal(master.paymentProvider,"yoco");
 assert.equal(master.items.length,2);
 assert.equal(sales.length,2);
 assert.equal(sales[0].subtotalCents,12999);
 assert.equal(sales[1].subtotalCents,8500);
 assert.equal(sales[0].masterOrderId,master.id);
 assert.equal(sales[1].masterOrderId,master.id);
 assert.equal(master.email,"customer@example.com");
});
test("Brand delivery/owner notifications cannot include other brand titles or files",async()=>{
 const {sales}=await snapshotMixedOrder(input,deps);
 const granny=brandEmailPayload(sales[0]);
 const cubs=brandEmailPayload(sales[1]);
 assert.deepEqual(granny.purchasedTitles,["Granny's Recipe Book"]);
 assert.deepEqual(cubs.purchasedTitles,["Grade RR Afrikaans"]);
 assert.deepEqual(granny.bookPaths,[pdf("grannys",a)]);
 assert.deepEqual(cubs.bookPaths,[pdf("clever-cubs",b)]);
 assert.equal(JSON.stringify(granny).includes("Grade RR"),false);
 assert.equal(JSON.stringify(cubs).includes("Granny"),false);
 assert.equal(granny.brandSubtotalCents+cubs.brandSubtotalCents,21499);
});
test("One-brand purchase generates only that brand's sale",async()=>{
 for(const brand of ["grannys","clever-cubs"]){
  const entry=input.items.find(x=>x.business===brand);
  const {master,sales}=await snapshotMixedOrder({...input,items:[entry]},deps);
  assert.equal(master.items.length,1);
  assert.equal(sales.length,1);
  assert.equal(sales[0].business,brand);
 }
});
test("Input never supplies trusted price, title or PDF path",async()=>{
 const hacked={...input,items:input.items.map(p=>({...p,price:0,title:"FREE",pdf_path:"wrong.pdf"}))};
 const {master}=await snapshotMixedOrder(hacked,deps);
 assert.equal(master.amountCents,21499);
 assert.equal(master.items[0].title,"Granny's Recipe Book");
 assert.equal(master.items[0].pdfPath,pdf("grannys",a));
});
test("Reject invalid books, duplicate brand SKUs, and malformed details",async()=>{
 assert.throws(()=>validateMixedCheckout({...input,items:[]}));
 assert.throws(()=>validateMixedCheckout({...input,items:[input.items[0],input.items[0]]}));
 assert.throws(()=>validateMixedCheckout({...input,items:[{business:"unknown",id:a}]}));
 assert.throws(()=>validateMixedCheckout({...input,items:[{business:"grannys",id:"../../file"}]}));
 assert.throws(()=>validateMixedCheckout({...input,email:"nope"}));
 assert.throws(()=>validateMixedCheckout({...input,name:"x"}));
 assert.equal(centsFromStoredPrice(129.99),12999);
 assert.equal(centsFromStoredPrice(129.999),null);
 assert.equal(centsFromStoredPrice(true),null);
});
test("Reject wrong-brand ownership, unpublished products and missing PDF",async()=>{
 const wrongProduct={...deps,async getProduct(brand,id){
   const p=records.get(brand+":"+id);
   return p?{...p,business:"another"}:null;
 }};
 await assert.rejects(snapshotMixedOrder(input,wrongProduct));
 const hidden={...deps,async getProduct(brand,id){
   const p=records.get(brand+":"+id);
   return p?{...p,is_active:false}:null;
 }};
 await assert.rejects(snapshotMixedOrder(input,hidden));
 await assert.rejects(snapshotMixedOrder(input,{
    ...deps,async getPrivateFile(){return {metadata:null}}
 }));
});
test("Reject incomplete/wrong-brand large PDF manifest",async()=>{
 const manifestRecord={...product("grannys",a,"Chunked Recipe Book",129),
   pdf_path:"grannys/"+a+".manifest.json"};
 const dynamic={...deps,
  async getProduct(brand,id){return brand==="grannys"?manifestRecord:null},
  async getPrivateFile(){return {metadata:{size:200},manifest:{
    kind:"chunked-pdf",version:1,business:"clever-cubs",
    size_bytes:4000000,part_bytes:3145728,part_count:2
  }}}
 };
 await assert.rejects(snapshotMixedOrder({...input,items:[input.items[0]]},dynamic));
});
test("Brand subtotal reconciliation and purchase currency remain consistent",async()=>{
 const {master}=await snapshotMixedOrder(input,deps);
 const sales=partitionBrandSales(master);
 assert.equal(sales.reduce((sum,item)=>sum+item.subtotalCents,0),master.amountCents);
 assert.ok(sales.every(item=>item.currency==="ZAR"));
});
