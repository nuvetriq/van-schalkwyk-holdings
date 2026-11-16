/* Yoco Checkout API signed LIVE webhook — fail-closed candidate.
 * This endpoint is deployed only as INERT code until ALL separately
 * authorised Production switches and the matching live signing secret exist.
 * It never sends email or serves PDF downloads. Public checkout remains OFF.
 *
 * A Yoco webhook must NOT require browser Origin or administrator headers.
 * Authentication is HMAC-SHA256 over the untouched raw body, with timestamp
 * replay protection and independent checkout/order reconciliation.
 */
import {verifyMixedYocoWebhookEnvelope} from "../lib/mixed-book-yoco-webhook-verify.mjs";
import {prepareVerifiedMixedBookLiveSettlement} from "../lib/mixed-book-yoco-live-payment-handoff.mjs";
import {createMixedBookServices} from "../lib/mixed-book-db-service.mjs";

const SITE="https://vanschalkwykholdings.com";
const MAX_BODY=50_000;
const SECRET=/^whsec_[A-Za-z0-9+/]{20,}={0,2}$/;
const LIVE_KEY=/^sk_live_[A-Za-z0-9_-]{8,}$/;
const headers={
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "Cross-Origin-Resource-Policy":"same-origin"
};
const reply=(value,status)=>Response.json(value,{status,headers});

function enabled(request,context,env){
  try {
    return new URL(request.url).origin===SITE &&
      context?.deploy?.context==="production" &&
      env.VSH_MIXED_BOOK_DB_ENABLED==="true" &&
      env.VSH_MIXED_YOCO_LIVE_ENABLED==="true" &&
      env.VSH_ENABLE_PAYMENTS==="true" &&
      env.VSH_MIXED_YOCO_TEST_ENABLED!=="true" &&
      LIVE_KEY.test(env.VSH_MIXED_YOCO_LIVE_KEY||"") &&
      SECRET.test(env.VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET||"");
  } catch {return false;}
}

export function makeMixedBookYocoLiveWebhookHandler({
  env=process.env,
  databaseFactory=createMixedBookServices,
  verifyEnvelope=verifyMixedYocoWebhookEnvelope,
  processEvent=prepareVerifiedMixedBookLiveSettlement,
  now=()=>Date.now()
}={}){
  return async function handler(request,context){
    if(request.method!=="POST")return reply({error:"Method not allowed."},405);
    if(!enabled(request,context,env))
      return reply({error:"Live webhook disabled."},503);

    const size=request.headers.get("content-length");
    if(size!==null && (!/^\d+$/.test(size) || Number(size)>MAX_BODY))
      return reply({error:"Invalid event length."},413);

    let raw;
    try {
      raw=await request.text();
      if(Buffer.byteLength(raw,"utf8")>MAX_BODY)
        return reply({error:"Event too large."},413);
    } catch {return reply({error:"Invalid event body."},400);}

    // Invalid signatures never look up an order.
    let event;
    try {
      ({event}=verifyEnvelope({
        rawBody:raw,headers:request.headers,
        secret:env.VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET,nowMs:now()
      }));
    } catch {return reply({error:"Invalid webhook authentication."},401);}

    // An authenticated subscription can contain unrelated merchant events:
    // avoid database reads and false acknowledgements for other namespaces.
    if(event.type!=="payment.succeeded" ||
       event.payload?.metadata?.purpose!=="vsh-mixed-book-live")
      return reply({ok:true,ignored:true},200);

    try {
      const ledger=databaseFactory({context});
      const result=await processEvent({
        enabled:true,operatorApproved:true,
        rawBody:raw,headers:request.headers,
        secret:env.VSH_MIXED_YOCO_LIVE_WEBHOOK_SECRET,
        nowMs:now(),
        loadStoredOrder:id=>ledger.loadYocoLiveOrder(id),
        loadStoredOrderByCheckoutId:id=>
          ledger.loadYocoLiveOrderByCheckoutId(id),
        settleAfterVerifiedWebhook:(id,verified)=>
          ledger.settleAfterVerifiedWebhook(id,verified)
      });
      if(result.retryable)
        return reply({error:"Live order not ready for verification."},503);
      if(result.ignored)return reply({ok:true,ignored:true},200);
      if(result.liveVerified===true &&
         result.emailsSent===0 && result.pdfsDelivered===0)
        return reply({
          ok:true,verified:true,duplicate:result.duplicate===true
        },200);
      throw Error("Unconfirmed LIVE ledger result.");
    } catch {
      // Never log the original error, raw webhook, signing secret, customer
      // identity or private file reference.
      console.error("Mixed Yoco LIVE webhook not processed");
      return reply({error:"Payment notification not processed."},503);
    }
  };
}

export default makeMixedBookYocoLiveWebhookHandler();
export const config={method:"POST"};
