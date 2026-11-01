/* Verify Yoco CHECKOUT API Standard Webhooks, server-side only.
 *
 * IMPORTANT: this module is NOT an HTTP endpoint, does not trigger payment
 * settlement, and is not imported by any production Netlify Function.
 *
 * Official Yoco docs, November 2026:
 * https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
 * - webhook-id.webhook-timestamp.RAW_BODY is signed with HMAC-SHA256
 * - whsec_ prefix is stripped, remainder base64 decoded
 * - webhook-signature may contain multiple space-separated "v1,<base64>"
 * - keep timestamp within ±180s; never mark paid via successUrl.
 *
 * Signature authentication alone does not authorize fulfilling a particular
 * order: use independent stored checkout and merchant/account reconciliation
 * and call the paid-order ledger ONLY after all relevant data match.
 */
import crypto from "node:crypto";

const MAX_BYTES=50_000;
const WINDOW_SECONDS=180;
const EVENT_ID=/^[A-Za-z0-9_-]{4,200}$/;
const MODE=new Set(["test","live"]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_ID=/^[A-Za-z0-9_-]{3,160}$/;
const CHECKOUT_ID=/^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/;
const HEADER_VALUE_MAX=4000;

function reject() {throw Error("Yoco webhook verification failed.");}
function secretBytes(secret) {
  if(typeof secret!=="string" || !secret.startsWith("whsec_"))reject();
  const base64=secret.slice("whsec_".length);
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length>200 ||
     base64.length%4===1)reject();
  const bytes=Buffer.from(base64,"base64");
  if(bytes.length<16 || bytes.length>128 || bytes.toString("base64")!==base64)reject();
  return bytes;
}
function header(headers,key){
  if(!headers || typeof headers.get!=="function")reject();
  const value=headers.get(key);
  if(typeof value!=="string" || value.length>HEADER_VALUE_MAX)reject();
  return value;
}
function signedBody({rawBody,headers,secret,nowMs}) {
  // Do not stringify JSON or alter its encoding. Take the exact raw body
  // string from request.text() before parsing.
  if(typeof rawBody!=="string" ||
     Buffer.byteLength(rawBody,"utf8")<2 ||
     Buffer.byteLength(rawBody,"utf8")>MAX_BYTES)reject();
  const id=header(headers,"webhook-id");
  const timestamp=header(headers,"webhook-timestamp");
  const signatureHeader=header(headers,"webhook-signature");
  if(!EVENT_ID.test(id)||!/^[0-9]{10}$/.test(timestamp)||!signatureHeader)reject();
  const unix=Number(timestamp);
  if(!Number.isSafeInteger(unix) ||
     !Number.isFinite(nowMs) ||
     Math.abs(Math.floor(nowMs/1000)-unix)>WINDOW_SECONDS)reject();
  const mac=crypto.createHmac("sha256",secretBytes(secret))
    .update(id+"."+timestamp+"."+rawBody,"utf8").digest();
  const variants=signatureHeader.split(/\s+/).filter(Boolean);
  if(variants.length<1 || variants.length>12)reject();
  let matched=false;
  for(const variant of variants){
    if(!variant.startsWith("v1,"))continue;
    const encoded=variant.slice(3);
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
       encoded.length>100 || encoded.length%4===1)continue;
    const candidate=Buffer.from(encoded,"base64");
    if(candidate.length!==mac.length ||
       candidate.toString("base64")!==encoded)continue;
    matched=crypto.timingSafeEqual(candidate,mac)||matched;
  }
  if(!matched)reject();
  return {signedWebhookId:id,timestampSeconds:unix};
}
function eventBody(rawBody){
  let event;
  try{event=JSON.parse(rawBody)}catch{reject()}
  if(!event || typeof event!=="object" || Array.isArray(event) ||
     typeof event.type!=="string" ||
     (event.id!==undefined && !EVENT_ID.test(event.id)))reject();
  return event;
}
export function verifyMixedYocoWebhookEnvelope({
  rawBody,headers,secret,nowMs=Date.now()
}={}) {
  const signature=signedBody({rawBody,headers,secret,nowMs});
  const event=eventBody(rawBody);
  return {signature,event};
}
export function verifySignedMixedYocoWebhook({
  rawBody,headers,secret,nowMs=Date.now()
}={}) {
  const {signature,event}=verifyMixedYocoWebhookEnvelope({rawBody,headers,secret,nowMs});
  // The authenticated webhook-id header is a provider event identifier even
  // when the JSON body omits its own id. Do not require optional event.id.
  const eventId=event.id ?? signature.signedWebhookId;
  const acceptedEvents=new Set(["payment.succeeded","payment.failed",
    "refund.succeeded","refund.failed"]);
  if(!acceptedEvents.has(event.type))
    return {ignored:true,type:event.type,eventId,
      signedWebhookId:signature.signedWebhookId};
  if(event.type!=="payment.succeeded")
    return {ignored:true,type:event.type,eventId,
      signedWebhookId:signature.signedWebhookId};
  const payment=event.payload;
  if(!payment || typeof payment!=="object" || Array.isArray(payment) ||
    !PAYMENT_ID.test(payment.id||"") || payment.status!=="succeeded" ||
    !Number.isSafeInteger(payment.amount) || payment.amount<100 ||
    payment.currency!=="ZAR")reject();
  const meta=payment.metadata;
  if(!meta || typeof meta!=="object" || Array.isArray(meta) ||
    !UUID.test(meta.orderId||""))reject();
  // Yoco uses "mode" in Checkout-API payment webhooks. We also accept the
  // explicit processingMode shape, but NEVER infer test/live from the key.
  const mode=payment.mode??payment.processingMode;
  if(!MODE.has(mode))reject();
  if(payment.mode!==undefined && payment.processingMode!==undefined &&
     payment.mode!==payment.processingMode)reject();
  const checkoutCandidate=meta.checkoutId??payment.checkoutId??null;
  if(checkoutCandidate!==null && !CHECKOUT_ID.test(checkoutCandidate))reject();
  if(meta.checkoutId && payment.checkoutId &&
     meta.checkoutId!==payment.checkoutId)reject();
  return {
    ignored:false,eventId,
    signedWebhookId:signature.signedWebhookId,
    orderId:meta.orderId.toLowerCase(),checkoutCandidate,
    paymentId:payment.id,amountCents:payment.amount,
    currency:"ZAR",processingMode:mode,
    eventType:"payment.succeeded",paymentStatus:"succeeded"
  };
}

/* Reconcile verified Yoco event against the database order BEFORE preparing
 * a trustedConfirmation. A checkout ID may be absent from the webhook because
 * Yoco issues it only after checkout creation. In that case return needs
 * independent provider reconciliation instead of trusting orderId alone.
 */
export function reconcileSignedYocoEventForOrder(signed,storedOrder,{
  independentlyConfirmedCheckoutId=null
}={}) {
  if(!signed || signed.ignored!==false || !storedOrder ||
     signed.orderId!==storedOrder.id ||
     signed.currency!=="ZAR" ||
     signed.amountCents!==Number(storedOrder.amount_cents) ||
     signed.processingMode!==storedOrder.processing_mode ||
     !CHECKOUT_ID.test(storedOrder.checkout_id||""))
    reject();
  const corroborated=independentlyConfirmedCheckoutId??signed.checkoutCandidate;
  if(corroborated===null)
    return {ready:false,reason:"independent-checkout-reconciliation-required"};
  if(corroborated!==storedOrder.checkout_id)reject();
  // This proof object may ONLY be consumed inside a private server-only
  // code path AFTER a real HMAC signature has been verified. Do not accept
  // an externally constructed object with these fields over HTTP.
  return {
    ready:true,
    confirmation:{
      source:"server-verified-yoco-webhook",signatureVerified:true,
      eventType:signed.eventType,paymentStatus:signed.paymentStatus,
      paymentId:signed.paymentId,eventId:signed.eventId,
      checkoutId:storedOrder.checkout_id,
      amountCents:signed.amountCents,currency:signed.currency,
      processingMode:signed.processingMode
    }
  };
}
