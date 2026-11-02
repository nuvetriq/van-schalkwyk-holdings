/* Future approved LIVE branded Gmail SMTP adapter. SERVER-ONLY DRAFT.
 *
 * Never imported by a Netlify HTTP Function or any public asset. No scheduler,
 * webhook, or admin route can invoke it. The sender is strictly OFF by default.
 *
 * This adapter is invoked ONLY by the already validated/claimed brand outbox
 * worker with verified PAID LIVE order data. It is NOT payment verification,
 * does not create downloads and does not store/send private PDF attachments.
 *
 * All tests inject a fake Nodemailer transport (or JSON transport), so CI
 * NEVER connects to a real SMTP server or sends any emails.
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import {BRAND_EMAILS} from "./mixed-book-order.mjs";

const HOST="smtp.gmail.com";
const MAX_MESSAGE=48_000;
const MAIL=/^[^\s@<>,;\r\n]+@[^\s@<>,;\r\n]+\.[^\s@<>,;\r\n]+$/;
const jobId=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:grannys|clever-cubs):(?:customer-delivery|merchant-sale-notice)$/i;
const secrets=Object.freeze({
  "grannys":"VSH_GRANNYS_SMTP_APP_PASSWORD",
  "clever-cubs":"VSH_CLEVERCUBS_SMTP_APP_PASSWORD"
});
function fail(){throw Error("Branded SMTP delivery is disabled or unconfigured.");}
function approved(env,context){
  return context?.deploy?.context==="production" &&
    env?.VSH_MIXED_BOOK_EMAIL_ENABLED==="true" &&
    env?.VSH_MIXED_BOOK_DB_ENABLED==="true" &&
    env?.VSH_MIXED_BOOK_DOWNLOADS_ENABLED==="true" &&
    env?.VSH_ENABLE_PAYMENTS==="true";
}
function password(env,business) {
  const raw=env[secrets[business]];
  if(typeof raw!=="string" || /[\r\n\t]/.test(raw))fail();
  // Google may display four groups of four app-password characters.
  const normalized=raw.trim().replaceAll(" ","");
  if(!/^[A-Za-z0-9]{16}$/.test(normalized))fail();
  return normalized;
}
function messageForBrand(message){
  if(!message || typeof message!=="object" ||
    !Object.hasOwn(BRAND_EMAILS,message.brand) ||
    !jobId.test(message.idempotencyKey||""))fail();
  const brand=BRAND_EMAILS[message.brand];
  if(message.idempotencyKey.split(":")[1]!==message.brand ||
    message.from!==brand.name+" <"+brand.sender+">" ||
    typeof message.to!=="string" || !MAIL.test(message.to) ||
    typeof message.subject!=="string" ||
    !message.subject || /[\r\n]/.test(message.subject) ||
    typeof message.text!=="string" || !message.text ||
    typeof message.html!=="string" || !message.html ||
    Buffer.byteLength(message.text)+Buffer.byteLength(message.html)>MAX_MESSAGE)
    fail();
  const nonce=crypto.createHash("sha256")
    .update("vsh-mixed-email-v1\0"+message.idempotencyKey)
    .digest("hex").slice(0,48);
  // Stable Message-ID aids mailbox reconciliation. It does NOT provide
  // exactly-once delivery; ambiguous SMTP results remain quarantined.
  return {
    from:message.from,to:message.to,
    subject:message.subject,text:message.text,html:message.html,
    messageId:"<vsh-"+nonce+"@vanschalkwykholdings.com>",
    disableFileAccess:true,disableUrlAccess:true,
    headers:{"X-VSH-Book-Delivery":"brand"}
  };
}
export function createMixedBookGmailSender({
  enabled=false,
  env=process.env,
  context,
  transportFactory=nodemailer.createTransport
}={}){
  if(enabled!==true || !approved(env,context) ||
    typeof transportFactory!=="function")fail();
  return async function sendEmail(message) {
    // Sender selection comes from the trusted brand record, not the
    // recipient, caller-selected server, HTML, private download URL, etc.
    const options=messageForBrand(message);
    const brand=message.brand;
    const pass=password(env,brand);
    let transport;
    try{
      transport=transportFactory({
        host:HOST,port:465,secure:true,
        auth:{user:BRAND_EMAILS[brand].sender,pass},
        tls:{serverName:HOST,minVersion:"TLSv1.2"},
        connectionTimeout:12000,greetingTimeout:12000,socketTimeout:20000,
        pool:false,logger:false,debug:false,
        disableFileAccess:true,disableUrlAccess:true
      });
      if(!transport || typeof transport.sendMail!=="function")
        throw Error("Unavailable SMTP transport.");
      // This method is only called after claimed job + committed token links.
      const receipt=await transport.sendMail(options);
      const accepted=Array.isArray(receipt?.accepted)?receipt.accepted:[];
      if(receipt?.messageId!==options.messageId ||
         accepted.length!==1 || accepted[0].toLowerCase()!==message.to.toLowerCase() ||
         (Array.isArray(receipt?.rejected) && receipt.rejected.length) ||
         (Array.isArray(receipt?.pending) && receipt.pending.length))
        throw Error("Unconfirmed SMTP recipient acceptance.");
      return {messageId:options.messageId};
    }catch{
      // Never surface connection info, passwords, email addresses,
      // private link tokens or SMTP responses in logs.
      throw Error("Branded SMTP result is unconfirmed.");
    }finally{
      if(typeof transport?.close==="function"){
        try{transport.close()}catch{/* no secrets in logs */}
      }
    }
  };
}
