/* REVIEW-ONLY: fail-closed production delivery scheduler.
 *
 * Netlify invokes this scheduled Function every five minutes, but its
 * own activation switch VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED must be "true"
 * AND all LIVE/email/download safety gates must be independently enabled.
 *
 * Scheduled Function cannot be called via a public URL on Netlify.
 * Do not enable or merge without owner approval of the complete LIVE flow.
 * One email per invocation avoids unbounded work under Netlify's 30-second
 * Scheduled Function limit; ambiguous SMTP acknowledgement is quarantined.
 */
import {createControlledMixedBookEmailBatch}
  from "../lib/mixed-book-live-email-batch.mjs";
import {BRAND_EMAILS} from "../lib/mixed-book-order.mjs";

const SECRET=/^vshlk_[A-Za-z0-9+/]{43}=$/;
const ACCOUNT_SECRET=/^[A-Za-z0-9]{16}$/;
const ORIGIN="https://vanschalkwykholdings.com";

function enabled(context,env){
  if(context?.deploy?.context!=="production" ||
     env?.VSH_MIXED_BOOK_EMAIL_RUNNER_ENABLED!=="true" ||
     env?.VSH_MIXED_BOOK_DB_ENABLED!=="true" ||
     env?.VSH_MIXED_BOOK_DOWNLOADS_ENABLED!=="true" ||
     env?.VSH_MIXED_BOOK_EMAIL_ENABLED!=="true" ||
     env?.VSH_MIXED_YOCO_LIVE_ENABLED!=="true" ||
     env?.VSH_MIXED_YOCO_TEST_ENABLED==="true" ||
     env?.VSH_ENABLE_PAYMENTS!=="true" ||
     !SECRET.test(env?.VSH_MIXED_BOOK_LINK_KEY||""))
    return false;
  for(const [business,prefix] of [
    ["grannys","VSH_GRANNYS"],
    ["clever-cubs","VSH_CLEVERCUBS"]
  ]){
    if(env[`${prefix}_GMAIL_USER`]!==BRAND_EMAILS[business].sender ||
       !ACCOUNT_SECRET.test(String(env[`${prefix}_GMAIL_APP_PASSWORD`]||"")
         .replaceAll(" ","")))
      return false;
  }
  return true;
}

export function makeMixedBookLiveEmailScheduler({
  env=process.env,
  batchFactory=createControlledMixedBookEmailBatch
}={}){
  return async function scheduled(_event,context){
    // Never start a database, SMTP transport, send, or claim if disabled.
    if(!enabled(context,env))return;
    try {
      const runner=batchFactory({
        enabled:true,operatorApproved:true,
        context,env,maxJobs:1
      });
      const result=await runner.runBatch();
      if(!result || !Number.isInteger(result.jobsAttempted) ||
         result.jobsAttempted<0 || result.jobsAttempted>1 ||
         !Number.isInteger(result.sent) ||
         !Number.isInteger(result.unknown))
        throw Error("Unconfirmed scheduler result.");
      // Avoid customer names, email addresses, order IDs, claims, tokens
      // and even aggregate purchase details in persistent logs.
      if(result.unknown>0)
        console.warn("LIVE book email requires operator reconciliation.");
    }catch{
      // No original errors, SQL details, SMTP responses or token strings.
      console.error("LIVE book delivery scheduler failed safely.");
    }
  };
}

export default makeMixedBookLiveEmailScheduler();
export const config={schedule:"*/5 * * * *"};
