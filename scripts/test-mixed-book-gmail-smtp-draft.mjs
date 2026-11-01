/* ALL TESTS OFFLINE: no Gmail requests, no real SMTP connection.
 * The fake transport records options only within memory and returns a
 * simulated recipient acceptance. None of these tests has real passwords.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import nodemailer from "nodemailer";
import {createMixedBookGmailSender}
 from "../netlify/lib/mixed-book-gmail-smtp-draft.mjs";

const orderId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const env={
  VSH_MIXED_BOOK_EMAIL_ENABLED:"true",
  VSH_MIXED_BOOK_DB_ENABLED:"true",
  VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"true",
  VSH_ENABLE_PAYMENTS:"true",
  VSH_GRANNYS_SMTP_APP_PASSWORD:"a".repeat(16),
  VSH_CLEVERCUBS_SMTP_APP_PASSWORD:"b".repeat(16)
};
const context={deploy:{context:"production"}};
const settings={
  grannys:{name:"Granny's",sender:"grannyspopsandtreats@gmail.com"},
  "clever-cubs":{name:"CleverCubs Learning",sender:"learningclevercubs@gmail.com"}
};
function message(business="grannys",{
  kind="customer-delivery",recipient="buyer@example.invalid"
}={}){
 const brand=settings[business];
 return {
  brand:business,
  from:brand.name+" <"+brand.sender+">",
  to:kind==="merchant-sale-notice"?brand.sender:recipient,
  idempotencyKey:orderId+":"+business+":"+kind,
  subject:"Your "+brand.name+" digital books",
  text:"Thank you, your private book URL is https://vanschalkwykholdings.com/book-download.html#token="+("A".repeat(43)),
  html:"<h2>Paid book from "+brand.name+"</h2>",
 };
}
function sender({environment=env,releaseContext=context,
  result="accepted"}={}){
 const calls=[];
 const transportFactory=options=>{
   calls.push({type:"create",options});
   return {
     async sendMail(mail){
       calls.push({type:"send",mail});
       if(result==="throws")throw Error("password aaaaaaaaaaaaaaaa leaked? secret!");
       return {
         messageId:result==="wrong-message-id"?"not-ours":mail.messageId,
         accepted:result==="rejected"?[]:[mail.to],
         rejected:result==="rejected"?[mail.to]:[],
         pending:[]
       };
     },
     close(){calls.push({type:"close"})}
   };
 };
 const send=createMixedBookGmailSender({
   enabled:true,env:environment,context:releaseContext,transportFactory
 });
 return {send,calls};
}
test("Granny's and CleverCubs use separate, TLS-only Gmail accounts and app passwords",async()=>{
 for(const business of ["grannys","clever-cubs"]){
   const f=sender();
   const msg=message(business);
   const ack=await f.send(msg);
   assert.match(ack.messageId,/^<vsh-[a-f0-9]{48}@vanschalkwykholdings\.com>$/);
   const [created,attempt,closed]=f.calls;
   assert.deepEqual(f.calls.map(x=>x.type),["create","send","close"]);
   assert.equal(created.options.host,"smtp.gmail.com");
   assert.equal(created.options.port,465);
   assert.equal(created.options.secure,true);
   assert.equal(created.options.tls.serverName,"smtp.gmail.com");
   assert.equal(created.options.tls.minVersion,"TLSv1.2");
   assert.equal(created.options.pool,false);
   assert.equal(created.options.logger,false);
   assert.equal(created.options.debug,false);
   assert.equal(created.options.auth.user,settings[business].sender);
   assert.equal(created.options.auth.pass,business==="grannys"?"a".repeat(16):"b".repeat(16));
   assert.equal(attempt.mail.from,msg.from);
   assert.equal(attempt.mail.to,msg.to);
   assert.equal(attempt.mail.disableFileAccess,true);
   assert.equal(attempt.mail.disableUrlAccess,true);
   assert.equal(closed.type,"close");
   assert.ok(!JSON.stringify(ack).includes("a".repeat(16)));
   assert.ok(!JSON.stringify(ack).includes("b".repeat(16)));
 }
});
test("Merchant notification uses matching account but no other brand credentials",async()=>{
 const f=sender();
 await f.send(message("clever-cubs",{kind:"merchant-sale-notice"}));
 assert.equal(f.calls[0].options.auth.user,"learningclevercubs@gmail.com");
 assert.equal(f.calls[1].mail.to,"learningclevercubs@gmail.com");
});
test("Email Message-ID is stable for same claimed job to help reconcile unknown",async()=>{
 const a=sender(),b=sender();
 const first=await a.send(message("grannys"));
 const repeated=await b.send(message("grannys"));
 assert.equal(first.messageId,repeated.messageId);
 const c=sender();
 const other=await c.send(message("clever-cubs"));
 assert.notEqual(first.messageId,other.messageId);
});
test("No credential or network access when feature is disabled",async()=>{
 let called=0;
 const factory=()=>{called++;throw Error("Should not be created")};
 const cases=[
  {enabled:false,environment:env,deploy:context},
  {enabled:true,environment:{...env,VSH_MIXED_BOOK_EMAIL_ENABLED:"false"},deploy:context},
  {enabled:true,environment:{...env,VSH_MIXED_BOOK_DB_ENABLED:"false"},deploy:context},
  {enabled:true,environment:{...env,VSH_MIXED_BOOK_DOWNLOADS_ENABLED:"false"},deploy:context},
  {enabled:true,environment:{...env,VSH_ENABLE_PAYMENTS:"false"},deploy:context},
  {enabled:true,environment:env,deploy:{deploy:{context:"deploy-preview"}}},
  {enabled:true,environment:env,deploy:{deploy:{context:"branch-deploy"}}}
 ];
 for(const check of cases){
   assert.throws(()=>createMixedBookGmailSender({
     enabled:check.enabled,env:check.environment,context:check.deploy,
     transportFactory:factory
   }),/disabled or unconfigured/);
 }
 assert.equal(called,0);
});
test("Missing, weak or newline-injected brand passwords are denied before SMTP",async()=>{
 for(const value of ["","short","a".repeat(15),"a".repeat(16)+"\n","invalid@password".repeat(2)]){
   const f=sender({environment:{...env,VSH_GRANNYS_SMTP_APP_PASSWORD:value}});
   await assert.rejects(f.send(message("grannys")) ,/disabled or unconfigured/);
   assert.deepEqual(f.calls,[]);
 }
});
test("A forged brand sender, recipient list, header, or mismatched job never creates transport",async()=>{
 const wrong=[
  {brand:"clever-cubs"},
  {from:"Evil <evil@example.com>"},
  {to:"buyer@example.com,attacker@example.com"},
  {to:"buyer@example.com\nBcc:evil@example.com"},
  {subject:"Fine\nBcc:evil@example.com"},
  {idempotencyKey:orderId+":clever-cubs:customer-delivery"},
  {idempotencyKey:"not-an-order-id"},
  {text:"A".repeat(48_001)}
 ];
 for(const patch of wrong){
   const f=sender();
   await assert.rejects(f.send({...message("grannys"),...patch}));
   assert.deepEqual(f.calls,[]);
 }
});
test("Explicit SMTP failure, incomplete acceptance and wrong message ID remain unconfirmed",async()=>{
 for(const result of ["throws","rejected","wrong-message-id"]){
   const f=sender({result});
   await assert.rejects(f.send(message("grannys")),err=>{
     assert.equal(err.message,"Branded SMTP result is unconfirmed.");
     assert.ok(!err.message.includes("password"));
     return true;
   });
   assert.deepEqual(f.calls.map(x=>x.type),["create","send","close"]);
 }
});
test("Nodemailer supports offline JSON transport without Gmail network access",async()=>{
 const transport=nodemailer.createTransport({jsonTransport:true});
 const m=message("grannys");
 const f=sender({result:"accepted"});
 const fakeSend=await f.send(m);
 const result=await transport.sendMail({
   from:m.from,to:m.to,subject:m.subject,text:m.text,html:m.html,
   messageId:fakeSend.messageId,disableFileAccess:true,disableUrlAccess:true
 });
 assert.equal(result.messageId,fakeSend.messageId);
 const serialized=JSON.parse(result.message);
 assert.equal(serialized.from.name,"Granny's");
 assert.equal(serialized.from.address,"grannyspopsandtreats@gmail.com");
 assert.equal(serialized.to.address,"buyer@example.invalid");
 assert.equal(serialized.messageId,fakeSend.messageId);
 assert.ok(!JSON.stringify(serialized).includes(env.VSH_GRANNYS_SMTP_APP_PASSWORD));
});
test("SMTP is imported only by draft helper; no sending function or Netlify config activates it",async()=>{
 const source=await readFile("netlify/lib/mixed-book-gmail-smtp-draft.mjs","utf8");
 assert.match(source,/enabled=false/);
 assert.match(source,/VSH_MIXED_BOOK_EMAIL_ENABLED/);
 assert.match(source,/smtp\.gmail\.com/);
 assert.ok(!source.includes("console.log("));
 const website=await readFile("netlify.toml","utf8");
 assert.ok(!website.includes("VSH_MIXED_BOOK_EMAIL_ENABLED"));
 for(const path of [
  "netlify/functions/mixed-book-yoco-test-checkout.mjs",
  "netlify/functions/mixed-book-yoco-test-webhook.mjs"
 ]){
   const f=await readFile(path,"utf8");
   assert.ok(!f.includes("createMixedBookGmailSender"));
 }
});
