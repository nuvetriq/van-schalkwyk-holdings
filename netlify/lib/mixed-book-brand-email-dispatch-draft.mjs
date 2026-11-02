/* Strictly server-only, dependency-injected EMAIL DELIVERY DRAFT.
 *
 * Nothing invokes this from a Netlify Function, timer, or webhook. Explicit
 * enabled:true is required for local simulations; no Gmail/SMTP transport
 * exists. An actual provider adapter and owner release approval are missing.
 *
 * The claimed outbox task is rechecked against a PAID LIVE, brand-restricted
 * sale in the DB. Customer links are issued/committed BEFORE any send.
 * After a provider request begins, ALL errors are ambiguous and move the job
 * to 'unknown', never automatically retry. An expired claim is quarantined
 * by the separate outbox helper, avoiding duplicate customer emails.
 */
import {
  claimMixedBookEmail,
  markMixedEmailAccepted,
  retryMixedEmailBeforeSend,
  holdMixedEmailUnknown
} from "./mixed-book-email-outbox.mjs";
import {composeMixedBookBrandEmail} from "./mixed-book-email-templates.mjs";
import {ensureCommittedPaidBookLinks} from "./mixed-book-paid-grant-service.mjs";
import {BRANDS,UUID} from "./mixed-book-order.mjs";

const KIND=new Set(["customer-delivery","merchant-sale-notice"]);
function checkedJob(row){
  if(!row || !UUID.test(row.order_id||"") ||
    !BRANDS.includes(row.business) || !KIND.has(row.kind) ||
    row.status!=="claimed" || row.id!==row.order_id+":"+
    row.business+":"+row.kind ||
    !row.payload || typeof row.payload!=="object")
    throw Error("Invalid claimed brand email.");
  const p=row.payload;
  if(p.id!==row.id || p.masterOrderId!==row.order_id ||
    p.business!==row.business || p.type!==row.kind ||
    p.sender!==row.sender || p.recipient!==row.recipient ||
    p.brandOrderRef!==row.order_id+":"+row.business)
    throw Error("Claimed email payload was modified.");
  // No browser-provided email body, sender or paid proof is accepted.
  return {...p,status:"claimed"};
}
function requireSale(sale,job){
  if(!sale || sale.business!==job.business ||
    sale.masterOrderId!==job.masterOrderId ||
    sale.brandOrderRef!==job.brandOrderRef ||
    !Array.isArray(sale.items) || !sale.items.length ||
    !sale.customer || typeof sale.customer.email!=="string")
    throw Error("Paid brand sale is unavailable.");
}

export async function dispatchOneMixedBrandEmail({
  enabled=false,pool,loadPaidBrandSale,
  ensureLinks=ensureCommittedPaidBookLinks,
  linkKey,sendEmail,now=new Date()
}={}){
  if(enabled!==true || !pool || typeof pool.query!=="function" ||
    typeof loadPaidBrandSale!=="function" ||
    typeof ensureLinks!=="function" || typeof sendEmail!=="function")
    throw Error("Branded email delivery is not configured.");
  const claimed=await claimMixedBookEmail(pool);
  if(!claimed)return {status:"empty"};
  const {job:row,claimToken}=claimed;
  let sentStarted=false;
  try{
    const job=checkedJob(row);
    const sale=await loadPaidBrandSale(row.order_id,row.business);
    requireSale(sale,job);
    let links=[];
    if(row.kind==="customer-delivery"){
      links=await ensureLinks(pool,{
        orderId:job.masterOrderId,business:job.business,
        linkKey,now
      });
    }
    const message=composeMixedBookBrandEmail({
      job,sale,downloadLinks:links
    });
    // ALL failures after this line are ambiguous; do not auto-retry.
    sentStarted=true;
    const ack=await sendEmail(message);
    if(!ack || typeof ack.messageId!=="string" ||
      ack.messageId.length<3 || ack.messageId.length>250 ||
      /[\r\n]/.test(ack.messageId))
      throw Error("Email provider did not return an unambiguous acknowledgement.");
    const marked=await markMixedEmailAccepted(pool,row.id,claimToken,ack.messageId);
    if(marked?.status!=="sent")
      throw Error("Provider acknowledged email but outbox acknowledgement failed.");
    // Do not expose customer addresses, message tokens, private link or body.
    return {status:"sent",kind:row.kind,business:row.business};
  }catch(error){
    // No error string or provider response is logged or returned to the UI.
    if(sentStarted){
      try{
        const held=await holdMixedEmailUnknown(pool,row.id,claimToken);
        if(held?.status!=="unknown")
          throw Error("Unconfirmed email must remain quarantined.");
      }catch{
        // A still-claimed row MUST be quarantined by
        // quarantineExpiredMixedEmailClaims; never auto-retry it.
        throw Error("Email delivery state could not be confirmed.");
      }
      return {status:"unknown",kind:row.kind,business:row.business};
    }
    const retry=await retryMixedEmailBeforeSend(pool,row.id,claimToken);
    if(!retry || !["retry","failed"].includes(retry.status))
      throw Error("Email preparation state could not be recorded.");
    return {status:retry.status,kind:row.kind,business:row.business};
  }
}
