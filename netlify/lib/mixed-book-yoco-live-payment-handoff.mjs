/* Server-only signed LIVE payment handoff. REVIEW-ONLY FOUNDATION.
 * NO Netlify Function, HTTP handler, scheduled job, email sender or grant
 * generator invokes this module. Signed LIVE events are never sufficient by
 * themselves: matching pending order and provider checkout ID are required.
 */
import {
  verifySignedMixedYocoWebhook,reconcileSignedYocoEventForOrder
} from "./mixed-book-yoco-webhook-verify.mjs";

const reject=()=>{throw Error("Unverified LIVE book payment.");};

export async function prepareVerifiedMixedBookLiveSettlement({
  enabled=false,operatorApproved=false,rawBody,headers,secret,
  nowMs=Date.now(),loadStoredOrder,loadStoredOrderByCheckoutId,
  settleAfterVerifiedWebhook
}={}){
  if(enabled!==true || operatorApproved!==true ||
     typeof loadStoredOrder!=="function" ||
     (loadStoredOrderByCheckoutId!==undefined &&
      typeof loadStoredOrderByCheckoutId!=="function") ||
     typeof settleAfterVerifiedWebhook!=="function")reject();

  // This performs timestamp-bounded HMAC verification over the original
  // raw body, never over parsed / re-serialized JSON.
  const signed=verifySignedMixedYocoWebhook({rawBody,headers,secret,nowMs});
  if(signed.ignored)return {ignored:true};

  let event;
  try {event=JSON.parse(rawBody)}catch{reject();}
  if(event?.payload?.metadata?.purpose!=="vsh-mixed-book-live")
    return {ignored:true};
  if(signed.processingMode!=="live")reject();

  // Yoco's official payload includes metadata.checkoutId. If its custom
  // metadata.orderId is absent, look up the stored LIVE order by that signed
  // checkout ID; do not guess from buyer email, amount or the browser.
  if(signed.orderId===null &&
     (signed.checkoutCandidate===null ||
      typeof loadStoredOrderByCheckoutId!=="function"))reject();
  const order=signed.orderId===null
    ? await loadStoredOrderByCheckoutId(signed.checkoutCandidate)
    : await loadStoredOrder(signed.orderId);
  if(!order)return {retryable:true,reason:"live-order-not-found"};
  if((signed.orderId!==null && order.id!==signed.orderId) ||
     order.processing_mode!=="live" ||
     Number(order.amount_cents)!==signed.amountCents)reject();
  if(order.status==="checkout_pending" && !order.checkout_id)
    return {retryable:true,reason:"live-checkout-not-yet-bound"};
  if(!["awaiting_payment","paid"].includes(order.status))reject();

  const matched=reconcileSignedYocoEventForOrder(signed,order);
  if(!matched.ready)return {retryable:true,reason:matched.reason};
  const result=await settleAfterVerifiedWebhook(order.id,matched.confirmation);
  if(result?.testOnly!==false || !Number.isInteger(result.brandCount) ||
     result.brandCount<1 || result.brandCount>2)reject();
  if(result.duplicate===true){
    if(result.insertedEmailJobs!==0)reject();
  }else if(result.insertedEmailJobs!==2*result.brandCount)reject();

  // Ledger records brand-specific outbox entries; it never sends emails or
  // grants PDFs in this function. Delivery requires later approved workers.
  return {liveVerified:true,duplicate:result.duplicate===true,
    brandCount:result.brandCount,
    emailsSent:0,pdfsDelivered:0};
}
