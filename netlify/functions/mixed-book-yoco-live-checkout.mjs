/* REVIEW-ONLY: public LIVE digital-book checkout endpoint, default OFF.
 *
 * IMPORTANT: This Function must remain uncallable until a separate owner
 * release approves the complete signed LIVE webhook, branded email worker,
 * paid download route and corresponding production keys.
 * It does NOT mark orders as paid, send email, grant PDFs or change the
 * still-disabled customer basket button. The POST is rate-limited per IP.
 */
import {createMixedBookCatalogueSource}
  from "../lib/mixed-book-catalogue-source.mjs";
import {createMixedBookServices} from "../lib/mixed-book-db-service.mjs";
import {prepareMixedBookLiveCheckout}
  from "../lib/mixed-book-yoco-live-operation.mjs";
import {postYocoLiveCheckout}
  from "../lib/mixed-book-yoco-live-checkout.mjs";
import {safeCheckoutDiagnostic}
  from "../lib/mixed-book-checkout-diagnostics.mjs";
import {BRAND_EMAILS}
  from "../lib/mixed-book-order.mjs";

const SITE="https://vanschalkwykholdings.com";
const KEY=/^sk_live_[A-Za-z0-9_-]{8,}$/;
const WEBHOOK_SECRET=/^whsec_[A-Za-z0-9+/]{20,}={0,2}$/;
const LINK_KEY=/^vshlk_[A-Za-z0-9+/]{43}=$/;
const GMAIL_PASSWORD=/^[A-Za-z0-9]{16}$/;
const BODY_MAX=4096;
const MAX_ITEMS=20;
const reply=(value,status)=>Response.json(value,{
  status,
  headers:{
    "Cache-Control":"no-store",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff",
    "Cross-Origin-Resource-Policy":"same-origin"
  }
});

function allowed(context,env,request){
  try{
    const url=new URL(request.url);
    if(url.origin!==SITE || url.search || url.hash ||
      context?.deploy?.context!=="production" ||
      env?.VSH_MIXED_BOOK_PUBLIC_CHECKOUT_ENABLED!=="true" ||
      env?.VSH_MIXED_BOOK_DB_ENABLED!=="true" ||
      env?.VSH_MIXED_YOCO_LIVE_ENABLED!=="true" ||
      env?.VSH_ENABLE_PAYMENTS!=="true" ||
      env?.VSH_MIXED_YOCO_TEST_ENABLED==="true" ||
      env?.VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED!=="true" ||
      env?.VSH_MIXED_BOOK_EMAIL_ENABLED!=="true" ||
      env?.VSH_MIXED_BOOK_DOWNLOADS_ENABLED!=="true" ||
      !KEY.test(env?.VSH_MIXED_YOCO_LIVE_KEY||"") ||
      !WEBHOOK_SECRET.test(env?.VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET||"") ||
      !LINK_KEY.test(env?.VSH_MIXED_BOOK_LINK_KEY||""))
      return false;
    for(const [business,prefix] of [
      ["grannys","VSH_GRANNYS"],
      ["clever-cubs","VSH_CLEVERCUBS"]
    ]){
      if(env[prefix+"_GMAIL_USER"]!==BRAND_EMAILS[business].sender ||
        !GMAIL_PASSWORD.test(
          String(env[prefix+"_GMAIL_APP_PASSWORD"]||"").replaceAll(" ","")))
        return false;
    }
    return true;
  }catch{return false;}
}

function strictBody(input){
  if(!input || typeof input!=="object" || Array.isArray(input) ||
     Object.keys(input).some(k=>!["name","email","items"].includes(k)) ||
     typeof input.name!=="string" || typeof input.email!=="string" ||
     !Array.isArray(input.items) || input.items.length<1 ||
     input.items.length>MAX_ITEMS)
    return false;
  for(const item of input.items){
    if(!item || typeof item!=="object" || Array.isArray(item) ||
       Object.keys(item).some(k=>!["business","id"].includes(k)) ||
       typeof item.business!=="string" || typeof item.id!=="string")
      return false;
  }
  return true;
}

export function makeMixedBookYocoLiveCheckoutHandler({
  env=process.env,
  catalogueFactory=createMixedBookCatalogueSource,
  databaseFactory=createMixedBookServices,
  operate=prepareMixedBookLiveCheckout,
  postCheckout=postYocoLiveCheckout
}={}){
  return async function handler(request,context){
    if(request.method!=="POST")
      return reply({error:"Method not allowed."},405);
    // OFF-by-default check happens BEFORE any body read, DB or Yoco call.
    if(!allowed(context,env,request))
      return reply({error:"LIVE book checkout is not available."},503);

    // A direct same-origin checkout fetch carries Origin. Fail closed on
    // missing/mismatched Origin, including cross-site CSRF attempts.
    if(request.headers.get("origin")!==SITE ||
       (request.headers.has("sec-fetch-site") &&
         request.headers.get("sec-fetch-site")!=="same-origin"))
      return reply({error:"Request origin not allowed."},403);
    if(!/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type")||""))
      return reply({error:"Expected JSON body."},415);

    const len=request.headers.get("content-length");
    if(len!==null && (!/^\d+$/.test(len) || Number(len)>BODY_MAX))
      return reply({error:"Checkout request too large."},413);
    let input;
    try{
      const raw=await request.text();
      if(Buffer.byteLength(raw,"utf8")>BODY_MAX)
        return reply({error:"Checkout request too large."},413);
      input=JSON.parse(raw);
      if(!strictBody(input))
        return reply({error:"Invalid checkout request."},400);
    }catch{return reply({error:"Invalid checkout request."},400)}

    try{
      const catalogue=catalogueFactory();
      const ledger=databaseFactory({context});
      const result=await operate(input,{
        enabled:true,operatorApproved:true,
        catalogue,ledger,
        secretKey:env.VSH_MIXED_YOCO_LIVE_KEY,
        postCheckout
      });
      if(result?.paymentVerified!==false ||
         result.processingMode!=="live" ||
         result.currency!=="ZAR" ||
         typeof result.redirectUrl!=="string" ||
         !Number.isSafeInteger(result.amountCents))
        throw Error("Unconfirmed server LIVE checkout result.");
      // Redirect is only payment initiation; webhook verification must
      // independently persist a PAID live order before delivery.
      return reply({
        orderId:result.orderId,
        redirectUrl:result.redirectUrl,
        amountCents:result.amountCents,
        currency:"ZAR",paymentVerified:false
      },201);
    }catch(error){
      const safe=safeCheckoutDiagnostic(error);
      // Fixed, allowlisted diagnostic codes only; no customer data,
      // private book paths, Yoco error bodies or keys in logs/responses.
      if(safe.httpStatus!==undefined)
        console.error("Mixed LIVE checkout rejected",safe.code,
          "http_status",safe.httpStatus);
      else console.error("Mixed LIVE checkout rejected",safe.code);
      return reply({error:"LIVE checkout could not be prepared."},503);
    }
  };
}

export default makeMixedBookYocoLiveCheckoutHandler();
export const config={
  path:"/api/books/live-checkout",
  method:"POST",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:3}
};
