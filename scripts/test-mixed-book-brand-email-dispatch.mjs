import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dispatchOneMixedBrandEmail}
 from "../netlify/lib/mixed-book-brand-email-dispatch-draft.mjs";
import {bookDownloadUrl} from "../netlify/lib/mixed-book-download-grants.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const ids={
 grannys:"ac20bc30-83b6-4fa2-b034-e5129232a210",
 "clever-cubs":"e4b97fe9-294d-49d5-9ae5-d1f155c9d459"
};
const senders={
 grannys:"grannyspopsandtreats@gmail.com",
 "clever-cubs":"learningclevercubs@gmail.com"
};
const names={grannys:"Granny's recipe", "clever-cubs":"RR Afrikaans"};
const token="T".repeat(43);
function fixture({
 business="grannys",kind="customer-delivery",empty=false,
 failPrep=false,sendResult={messageId:"email-provider-ack-0001"},
 failSend=false,claimBroken=false
}={}){
 const productId=ids[business];
 const file=business+"/"+productId+".pdf";
 const sender=senders[business];
 const recipient=kind==="customer-delivery"?"buyer@example.invalid":sender;
 const sale={
   business,masterOrderId:orderId,brandOrderRef:orderId+":"+business,
   subtotalCents:12999,currency:"ZAR",
   customer:{name:"CI Buyer",email:"buyer@example.invalid"},
   items:[{id:productId,title:names[business],priceCents:12999,pdfPath:file}]
 };
 const job={
   id:orderId+":"+business+":"+kind,
   masterOrderId:orderId,brandOrderRef:sale.brandOrderRef,
   business,type:kind,status:"pending",
   sender,recipient,bookTitles:[names[business]],
   amountCents:12999,currency:"ZAR",
   ...(kind==="customer-delivery"
     ?{privateBookPaths:[file]}
     :{customerName:"CI Buyer",customerEmail:"buyer@example.invalid"})
 };
 const row={
   id:job.id,order_id:orderId,business,kind,sender,recipient,
   payload:claimBroken?{...job,sender:"wrong@example.invalid"}:job,
   status:"pending"
 };
 const calls=[], emails=[];
 let outboxStatus="pending";
 const pool={async query(sql,args){
   calls.push({sql,args});
   if(sql.includes("WITH candidate AS")){
     if(empty || outboxStatus!=="pending")return {rows:[]};
     outboxStatus="claimed";
     return {rows:[{...row,status:"claimed",claim_token:args[0]}]};
   }
   if(sql.includes("UPDATE vsh_mixed_email_outbox")){
     if(!sql.includes("claim_token=$2::uuid") ||
       args[0]!==row.id)throw Error("Unsafe transition");
     if(sql.includes("status='sent'"))outboxStatus="sent";
     else if(sql.includes("status='unknown'"))outboxStatus="unknown";
     else if(sql.includes("status=CASE"))outboxStatus="retry";
     else throw Error("Unexpected outbox transition");
     return {rows:[{id:row.id,status:outboxStatus}]};
   }
   throw Error("Unexpected SQL");
 }};
 let prepared=0;
 const options={
   enabled:true,pool,
   async loadPaidBrandSale(id,b){
     assert.equal(id,orderId);assert.equal(b,business);
     return sale;
   },
   async ensureLinks(db,args){
     assert.equal(db,pool);
     assert.equal(args.orderId,orderId);
     assert.equal(args.business,business);
     prepared++;
     if(failPrep)throw Error("Grant persistence failed BEFORE send");
     return [{id:productId,url:bookDownloadUrl(token)}];
   },
   async sendEmail(message){
     emails.push(message);
     if(failSend)throw Error("SMTP connection lost after sending maybe");
     return sendResult;
   }
 };
 return {options,calls,emails,get status(){return outboxStatus},get prepared(){return prepared},sale,row};
}
test("Customer delivery sends only its brand's titles and committed PDF URL",async()=>{
 for(const business of ["grannys","clever-cubs"]){
   const f=fixture({business});
   const result=await dispatchOneMixedBrandEmail(f.options);
   assert.deepEqual(result,{status:"sent",business,kind:"customer-delivery"});
   assert.equal(f.status,"sent");
   assert.equal(f.prepared,1);
   assert.equal(f.emails.length,1);
   const email=f.emails[0];
   assert.ok(email.from.includes(senders[business]));
   assert.equal(email.to,"buyer@example.invalid");
   assert.ok(email.text.includes("book-download.html#token="));
   assert.ok(!email.text.includes("other-brand"));
   assert.ok(!email.text.includes("private_pdf_path"));
   assert.ok(!email.text.includes(".pdf"));
   const other=business==="grannys"?"RR Afrikaans":"Granny's recipe";
   assert.ok(!email.text.includes(other));
   assert.equal(f.calls.filter(x=>x.sql.includes("UPDATE vsh_mixed_email_outbox") && !x.sql.includes("WITH candidate AS")).length,1);
 }
});
test("Merchant notification is brand-only, no link generation or download tokens",async()=>{
 for(const business of ["grannys","clever-cubs"]){
   const f=fixture({business,kind:"merchant-sale-notice"});
   const result=await dispatchOneMixedBrandEmail(f.options);
   assert.equal(result.status,"sent");
   assert.equal(f.prepared,0);
   assert.equal(f.emails[0].to,senders[business]);
   assert.ok(f.emails[0].text.includes("CI Buyer"));
   assert.ok(!f.emails[0].text.includes("#token="));
   assert.ok(!f.emails[0].html.includes("Download</a>"));
 }
});
test("Grant transaction failure is BEFORE network and safe to retry",async()=>{
 const f=fixture({failPrep:true});
 const result=await dispatchOneMixedBrandEmail(f.options);
 assert.equal(result.status,"retry");
 assert.equal(f.status,"retry");
 assert.equal(f.emails.length,0);
});
test("Unknown SMTP result is quarantined and never retried automatically",async()=>{
 for(const input of [
  {failSend:true},
  {sendResult:null},
  {sendResult:{messageId:"bad\nmessage"}}
 ]){
   const f=fixture(input);
   const result=await dispatchOneMixedBrandEmail(f.options);
   assert.equal(result.status,"unknown");
   assert.equal(f.status,"unknown");
   assert.equal(f.emails.length,1);
   const second=await dispatchOneMixedBrandEmail(f.options);
   assert.equal(second.status,"empty");
   assert.equal(f.emails.length,1);
 }
});
test("Corrupt outbox payload fails before provider, allowing secure reconciliation",async()=>{
 const f=fixture({claimBroken:true});
 const result=await dispatchOneMixedBrandEmail(f.options);
 assert.equal(result.status,"retry");
 assert.equal(f.emails.length,0);
 assert.equal(f.prepared,0);
});
test("No outbox row means no grants and no network request",async()=>{
 const f=fixture({empty:true});
 const result=await dispatchOneMixedBrandEmail(f.options);
 assert.deepEqual(result,{status:"empty"});
 assert.equal(f.emails.length,0);
 assert.equal(f.prepared,0);
});
test("Delivery worker disabled by default, never imported into any public handler",async()=>{
 const f=fixture();
 await assert.rejects(dispatchOneMixedBrandEmail({
   ...f.options,enabled:false
 }));
 assert.equal(f.calls.length,0);
 const worker=await readFile("netlify/lib/mixed-book-brand-email-dispatch-draft.mjs","utf8");
 const checkout=await readFile("netlify/functions/mixed-book-yoco-test-checkout.mjs","utf8");
 const webhook=await readFile("netlify/functions/mixed-book-yoco-test-webhook.mjs","utf8");
 assert.ok(!worker.includes("smtp.gmail.com"));
 assert.ok(!worker.includes("nodemailer"));
 assert.ok(!checkout.includes("dispatchOneMixedBrandEmail"));
 assert.ok(!webhook.includes("dispatchOneMixedBrandEmail"));
});
