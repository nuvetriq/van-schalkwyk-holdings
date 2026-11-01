/* SERVER-ONLY test checkout request builder. No Netlify Function imports this.
 *
 * One mixed-brand order = ONE Yoco Checkout API payment. All amounts are the
 * immutable server-authoritative order snapshot in integer ZAR cents. No
 * browser-provided price, no private PDF reference, and no secret in output.
 *
 * Yoco Checkout API docs:
 * https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
 * The checkoutId is minted BY Yoco, so it cannot be in initial metadata.
 */
import {BRANDS,UUID} from "./mixed-book-order.mjs";

const SITE="https://vanschalkwykholdings.com";
const URL="https://payments.yoco.com/api/checkouts";
const CHECKOUT=/^checkout_[A-Za-z0-9_-]{5,150}$/;
const KEY=/^sk_test_[A-Za-z0-9_-]{8,}$/;

function requireSnapshot(order){
  if(!order || !UUID.test(order.id||"") ||
     order.currency!=="ZAR" || order.paymentProvider!=="yoco" ||
     !Number.isSafeInteger(order.amountCents) ||
     order.amountCents<100 || order.amountCents>5000000 ||
     !Array.isArray(order.items) || order.items.length<1 || order.items.length>20)
    throw Error("Invalid server-approved digital-book order.");
  const seen=new Set();
  let total=0;
  for(const line of order.items){
    if(!line || !BRANDS.includes(line.business) ||
       !UUID.test(line.id||"") || !Number.isSafeInteger(line.priceCents) ||
       line.priceCents<100 || typeof line.title!=="string" ||
       !line.title.trim() || typeof line.pdfPath!=="string" ||
       !line.pdfPath.startsWith(line.business+"/"))
      throw Error("Invalid stored book line.");
    const sku=line.business+":"+line.id.toLowerCase();
    if(seen.has(sku))throw Error("Duplicate digital-book licence.");
    seen.add(sku);total+=line.priceCents;
  }
  if(total!==order.amountCents)throw Error("Book totals do not reconcile.");
}
export function buildMixedYocoTestCheckout(order){
  requireSnapshot(order);
  return Object.freeze({
    url:URL,
    idempotencyKey:"vsh-mixed-test-"+order.id.toLowerCase(),
    payload:{
      amount:order.amountCents,
      currency:"ZAR",
      clientReferenceId:order.id,
      externalId:order.id,
      metadata:{purpose:"vsh-mixed-book-test",orderId:order.id},
      successUrl:SITE+"/index.html?bookCheckout=returned",
      cancelUrl:SITE+"/index.html?bookCheckout=cancelled",
      failureUrl:SITE+"/index.html?bookCheckout=failed"
    }
  });
}

export function validateYocoTestCheckoutResponse(order,data){
  requireSnapshot(order);
  if(!data || typeof data!=="object" || Array.isArray(data) ||
    !CHECKOUT.test(data.id||"") ||
    data.status!=="created" || data.amount!==order.amountCents ||
    data.currency!=="ZAR" || data.processingMode!=="test" ||
    (data.clientReferenceId!=null && data.clientReferenceId!==order.id) ||
    (data.externalId!=null && data.externalId!==order.id) ||
    (data.metadata?.orderId!=null && data.metadata.orderId!==order.id) ||
    (data.metadata?.purpose!=null && data.metadata.purpose!=="vsh-mixed-book-test"))
    throw Error("Yoco TEST checkout response did not match the stored order.");
  if(typeof data.redirectUrl!=="string")throw Error("Missing Yoco checkout redirect.");
  let destination;
  try{destination=new URL(data.redirectUrl)}catch{
    throw Error("Invalid Yoco checkout redirect.");
  }
  if(destination.protocol!=="https:" ||
     destination.hostname!=="c.yoco.com" ||
     !destination.pathname.startsWith("/checkout/") ||
     destination.username || destination.password ||
     destination.port || destination.search || destination.hash)
    throw Error("Unsafe Yoco checkout redirect.");
  // Never copy untrusted provider JSON into a public order response.
  return {checkoutId:data.id,redirectUrl:destination.toString(),
    amountCents:order.amountCents,currency:"ZAR",processingMode:"test"};
}

/* Explicit dependency-injected HTTP sender so tests NEVER call Yoco.
 * Payment key remains server-only and never appears in returned object.
 * Do NOT call until a durable pending order exists. A provider response must
 * then be bound to the stored order before returning its redirect to customer.
 */
export async function requestMixedYocoTestCheckout(order,{
  enabled=false,secretKey,postCheckout
}={}){
  if(enabled!==true || typeof secretKey!=="string" || !KEY.test(secretKey) ||
     typeof postCheckout!=="function")
    throw Error("Yoco test checkout is disabled or unconfigured.");
  const request=buildMixedYocoTestCheckout(order);
  const response=await postCheckout({
    url:request.url,
    headers:{
      "Authorization":"Bearer "+secretKey,
      "Content-Type":"application/json",
      "Idempotency-Key":request.idempotencyKey
    },
    body:JSON.stringify(request.payload)
  });
  if(!response || response.ok!==true || !response.data)
    throw Error("Yoco TEST checkout could not be created.");
  return validateYocoTestCheckoutResponse(order,response.data);
}
