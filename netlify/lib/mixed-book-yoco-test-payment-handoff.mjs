/* Test-only signed payment handoff for mixed-brand book orders.
 * PRIVATE SERVER HELPER, NOT an HTTP handler. No customer-facing payment flow.
 *
 * Only the signed webhook verifier constructs the payment confirmation.
 * Existing durable ledger creates TWO separated brand sales, ZERO outbound
 * emails and ZERO download grants for Yoco TEST payments.
 */
import {
  verifySignedMixedYocoWebhook,
  reconcileSignedYocoEventForOrder
} from "./mixed-book-yoco-webhook-verify.mjs";

const reject=()=>{throw Error("Unverifiable Yoco test payment.");};

export async function handleMixedBookYocoTestEvent({
  rawBody,headers,secret,nowMs=Date.now(),
  enabled=false,loadStoredOrder,settleAfterVerifiedWebhook
}={}) {
  if(enabled!==true ||
     typeof loadStoredOrder!=="function" ||
     typeof settleAfterVerifiedWebhook!=="function")
    throw Error("Yoco mixed-book test webhook processing is disabled.");
  const verified=verifySignedMixedYocoWebhook({
    rawBody,headers,secret,nowMs
  });
  if(verified.ignored)return {ignored:true};
  // This handler must NEVER settle a live payment, even with a signed event.
  if(verified.processingMode!=="test")reject();
  // Our account may send other payments to the same webhook. Namespace the
  // mixed cart test flow to exclude unrelated checkout notifications.
  let source;
  try{source=JSON.parse(rawBody)}catch{reject()}
  if(source?.payload?.metadata?.purpose!=="vsh-mixed-book-test")
    return {ignored:true};

  const order=await loadStoredOrder(verified.orderId);
  if(!order) return {retryable:true,reason:"test-order-not-indexed"};
  if(order.processing_mode!=="test" ||
     order.id!==verified.orderId ||
     Number(order.amount_cents)!==verified.amountCents)
    reject();
  // A Yoco callback can race the DB checkout-binding transaction; return
  // a RETRYABLE response signal, never an unprocessed 2xx acknowledgement.
  if(order.status==="checkout_pending" && !order.checkout_id)
    return {retryable:true,reason:"test-checkout-not-yet-bound"};
  const match=reconcileSignedYocoEventForOrder(verified,order);
  if(!match.ready)
    return {retryable:true,reason:match.reason};
  if(!["awaiting_payment","paid"].includes(order.status))reject();

  const result=await settleAfterVerifiedWebhook(order.id,match.confirmation);
  // Assert the ledger cannot dispatch real mail or PDFs in TEST mode.
  if(result?.testOnly!==true || result.insertedEmailJobs!==0)
    throw Error("Unsafe test payment ledger result.");
  return {
    testVerified:true,duplicate:result.duplicate===true,
    brandCount:result.brandCount,emailsSent:0,
    pdfsDelivered:0
  };
}
