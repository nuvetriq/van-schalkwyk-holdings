/* Server-only LIVE Yoco Checkout API contract.
 * IMPORTANT: this module is deliberately NOT a Netlify Function and never
 * creates a checkout on import. No public payment UI or live API call is
 * enabled by this module. Production requires a separately approved release
 * with a live webhook, durable email delivery and PDF grant handling.
 */
import {BRANDS,UUID} from "./mixed-book-order.mjs";
import {checkoutDiagnostic} from "./mixed-book-checkout-diagnostics.mjs";

const SITE="https://vanschalkwykholdings.com";
const CHECKOUT_URL="https://payments.yoco.com/api/checkouts";
const LIVE_KEY=/^sk_live_[A-Za-z0-9_-]{8,}$/;
const CHECKOUT_ID=/^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/;

function validOrder(master){
  if(!master || !UUID.test(master.id||"") ||
     master.currency!=="ZAR" || master.paymentProvider!=="yoco" ||
     !Number.isSafeInteger(master.amountCents) ||
     master.amountCents<100 || master.amountCents>5_000_000 ||
     !Array.isArray(master.items) ||
     master.items.length<1 || master.items.length>20 ||
     typeof master.name!=="string" || master.name.length<2 ||
     typeof master.email!=="string" || master.email.length<3)
    throw Error("Invalid server-approved LIVE order.");
  const seen=new Set();
  let sum=0;
  for(const line of master.items){
    if(!line || !BRANDS.includes(line.business) ||
       !UUID.test(line.id||"") ||
       typeof line.title!=="string" || !line.title.trim() ||
       !Number.isSafeInteger(line.priceCents) || line.priceCents<100 ||
       typeof line.pdfPath!=="string" ||
       !new RegExp("^"+line.business+"/[0-9a-f-]{36}\\.(?:pdf|manifest\\.json)$","i")
         .test(line.pdfPath))
      throw Error("Invalid server-approved LIVE order.");
    const sku=line.business+":"+line.id.toLowerCase();
    if(seen.has(sku))throw Error("Duplicate digital book.");
    seen.add(sku);
    sum+=line.priceCents;
  }
  if(sum!==master.amountCents)
    throw Error("LIVE order amount does not reconcile.");
}

export function buildMixedYocoLiveCheckout(master){
  validOrder(master);
  return Object.freeze({
    url:CHECKOUT_URL,
    idempotencyKey:"vsh-mixed-live-"+master.id.toLowerCase(),
    payload:{
      amount:master.amountCents,currency:"ZAR",
      clientReferenceId:master.id,externalId:master.id,
      metadata:{purpose:"vsh-mixed-book-live",orderId:master.id},
      successUrl:SITE+"/index.html?bookCheckout=returned",
      cancelUrl:SITE+"/index.html?bookCheckout=cancelled",
      failureUrl:SITE+"/index.html?bookCheckout=failed"
    }
  });
}

// Exact host + strict path. Payment redirects are NOT payment confirmation.
// Support only the documented Yoco Checkout host until another destination
// is independently verified by Yoco; never follow provider HTTP redirects.
export function verifyYocoLiveRedirect(value){
  if(typeof value!=="string" || value.length>2048 ||
     !value.startsWith("https://"))return null;
  try {
    const url=new URL(value);
    if(url.href!==value || url.protocol!=="https:" ||
       url.hostname!=="c.yoco.com" ||
       !/^\/checkout\/[A-Za-z0-9_-]{5,150}\/?$/.test(url.pathname) ||
       url.port || url.username || url.password || url.search || url.hash)
      return null;
    return url.href;
  } catch{return null;}
}

export function validateMixedYocoLiveCheckout(master,response){
  validOrder(master);
  if(!response || typeof response!=="object" || Array.isArray(response) ||
     !CHECKOUT_ID.test(response.id||""))
    throw checkoutDiagnostic("yoco_response_id_invalid");
  if(response.status!=="created")
    throw checkoutDiagnostic("yoco_response_status_invalid");
  if(response.amount!==master.amountCents || response.currency!=="ZAR")
    throw checkoutDiagnostic("yoco_response_amount_invalid");
  if(response.processingMode!=="live")
    throw checkoutDiagnostic("yoco_response_mode_invalid");
  if((response.clientReferenceId!=null && response.clientReferenceId!==master.id) ||
     (response.externalId!=null && response.externalId!==master.id) ||
     (response.metadata?.orderId!=null && response.metadata.orderId!==master.id) ||
     (response.metadata?.purpose!=null &&
      response.metadata.purpose!=="vsh-mixed-book-live"))
    throw checkoutDiagnostic("yoco_response_reference_invalid");
  const redirectUrl=verifyYocoLiveRedirect(response.redirectUrl);
  if(!redirectUrl)throw checkoutDiagnostic("yoco_response_redirect_invalid");
  return Object.freeze({
    checkoutId:response.id,redirectUrl,
    amountCents:master.amountCents,currency:"ZAR",processingMode:"live"
  });
}

// Explicitly invoked by an authorised future SERVER endpoint only. The
// integration is not connected to an HTTP function or to a browser.
export async function requestMixedYocoLiveCheckout(master,{
  enabled=false,secretKey,postCheckout
}={}){
  if(enabled!==true || typeof secretKey!=="string" ||
     !LIVE_KEY.test(secretKey) || typeof postCheckout!=="function")
    throw checkoutDiagnostic("yoco_transport_invalid");
  const request=buildMixedYocoLiveCheckout(master);
  const response=await postCheckout({
    url:request.url,
    headers:{
      Authorization:"Bearer "+secretKey,
      "Content-Type":"application/json",
      "Idempotency-Key":request.idempotencyKey
    },
    body:JSON.stringify(request.payload)
  });
  if(response?.ok!==true || !response.data)
    throw checkoutDiagnostic("yoco_request_unexpected");
  return validateMixedYocoLiveCheckout(master,response.data);
}

// Transport must never log error body, request headers, customer data or key.
export async function postYocoLiveCheckout({url,headers,body},{
  transport=fetch
}={}){
  if(url!==CHECKOUT_URL || typeof transport!=="function" ||
     !LIVE_KEY.test(String(headers?.Authorization||"").replace(/^Bearer /,"")) ||
     typeof body!=="string" || Buffer.byteLength(body,"utf8")>8192)
    throw checkoutDiagnostic("yoco_transport_invalid");
  let res;
  try {
    res=await transport(url,{
      method:"POST",headers,body,redirect:"error",signal:AbortSignal.timeout(12000)
    });
  } catch {
    throw checkoutDiagnostic("yoco_network_failed");
  }
  if(!res || res.ok!==true)
    throw checkoutDiagnostic("yoco_http_rejected",res?.status);
  const statedLength=res.headers?.get?.("content-length");
  if(statedLength!=null && Number(statedLength)>32768)
    throw checkoutDiagnostic("yoco_response_too_large");
  let raw;
  try {raw=await res.text()}catch{
    throw checkoutDiagnostic("yoco_response_json_invalid");
  }
  if(typeof raw!=="string" || Buffer.byteLength(raw,"utf8")>32768)
    throw checkoutDiagnostic("yoco_response_too_large");
  let data;
  try {data=JSON.parse(raw)}catch{
    throw checkoutDiagnostic("yoco_response_json_invalid");
  }
  return {ok:true,data};
}
