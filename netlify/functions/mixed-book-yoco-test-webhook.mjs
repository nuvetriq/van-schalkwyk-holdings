/* Yoco Checkout API signed TEST webhook for existing Holdings website.
 * DENY-BY-DEFAULT, branch-only; NO production deployment or migration yet.
 * Unlike the admin-only checkout endpoint, Yoco must call this without any
 * browser Origin or admin key, so signed raw-body authentication is mandatory.
 *
 * Only an HMAC-authenticated, namespace-matched TEST payment can reach the
 * atomic order ledger. The ledger never enqueues emails/downloads in TEST.
 */
import {
  verifyMixedYocoWebhookEnvelope
} from "../lib/mixed-book-yoco-webhook-verify.mjs";
import {handleMixedBookYocoTestEvent} from "../lib/mixed-book-yoco-test-payment-handoff.mjs";
import {createMixedBookServices} from "../lib/mixed-book-db-service.mjs";

const ORIGIN="https://vanschalkwykholdings.com";
const MAX_BODY=50_000;
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const response=(value,status)=>Response.json(value,{status,headers});
function configured(request,context,env){
  try{
    return new URL(request.url).origin===ORIGIN &&
      context?.deploy?.context==="production" &&
      env.VSH_MIXED_BOOK_DB_ENABLED==="true" &&
      env.VSH_MIXED_YOCO_TEST_ENABLED==="true" &&
      env.VSH_ENABLE_PAYMENTS!=="true" &&
      /^sk_test_[A-Za-z0-9_-]{8,}$/.test(env.VSH_MIXED_YOCO_TEST_KEY||"") &&
      /^whsec_[A-Za-z0-9+/]{20,}={0,2}$/.test(env.VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET||"");
  }catch{return false}
}
export function makeMixedBookYocoTestWebhookHandler({
  env=process.env,
  databaseFactory=createMixedBookServices,
  processEvent=handleMixedBookYocoTestEvent,
  verifyEnvelope=verifyMixedYocoWebhookEnvelope,
  now=()=>Date.now()
}={}){
  return async function handler(request,context){
    if(request.method!=="POST")return response({error:"Method not allowed."},405);
    if(!configured(request,context,env))
      return response({error:"Test webhook disabled."},503);
    const len=request.headers.get("content-length");
    if(len!==null && Number.isFinite(Number(len)) && Number(len)>MAX_BODY)
      return response({error:"Event too large."},413);
    let raw;
    try{
      raw=await request.text();
      if(Buffer.byteLength(raw,"utf8")>MAX_BODY)
        return response({error:"Event too large."},413);
    }catch{return response({error:"Invalid event body."},400)}
    let authenticated;
    try{
      authenticated=verifyEnvelope({
        rawBody:raw,headers:request.headers,
        secret:env.VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET,
        nowMs:now()
      });
    }catch{
      return response({error:"Invalid webhook authentication."},401);
    }
    // The registered Yoco webhook may receive other merchant events. Only
    // explicitly namespaced successful TEST book payments concern us; NEVER
    // query the orders table for an unrelated signed merchant notification.
    const evt=authenticated.event;
    if(evt.type!=="payment.succeeded" ||
      evt.payload?.metadata?.purpose!=="vsh-mixed-book-test")
      return response({ok:true,ignored:true},200);
    // A matching namespace is now present inside authenticated signed bytes.
    let ledger;
    try{
      ledger=databaseFactory({context});
      const result=await processEvent({
        enabled:true,rawBody:raw,headers:request.headers,
        secret:env.VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET,nowMs:now(),
        loadStoredOrder:id=>ledger.loadYocoTestOrder(id),
        settleAfterVerifiedWebhook:(id,verified)=>
          ledger.settleAfterVerifiedWebhook(id,verified)
      });
      if(result.retryable)
        return response({error:"Test order is not ready for verification."},503);
      if(result.ignored)return response({ok:true,ignored:true},200);
      if(result.testVerified===true && result.emailsSent===0 &&
        result.pdfsDelivered===0)
        return response({ok:true,testVerified:true,duplicate:result.duplicate===true},200);
      throw Error("Unsafe TEST payment result.");
    }catch(error){
      // Invalid/suspicious data is not acknowledged as paid; do not reveal
      // customer names, book selections, bank details, DB or signing secrets.
      console.error("Yoco TEST webhook withheld",error?.name||"Error");
      return response({error:"Payment notification not processed."},503);
    }
  };
}
export default makeMixedBookYocoTestWebhookHandler();
export const config={method:"POST"};
