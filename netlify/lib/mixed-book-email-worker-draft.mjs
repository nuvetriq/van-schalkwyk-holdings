/* SERVER-ONLY release candidate wiring for a branded paid-book email worker.
 * NO DEFAULT EXPORT, Netlify Function, scheduled trigger, or API route.
 * Off by default. Does NOT run at import time, on deploy, or after webhooks.
 *
 * When deliberately enabled in an approved future production deployment, this
 * composes existing restricted PostgreSQL reads, the outbox-claim dispatcher,
 * and the brand-locked Gmail TLS transport. Every payment is rechecked as
 * PAID LIVE by DB readers; the outbox rejects Yoco TEST orders.
 *
 * All credentials are Functions-scoped environment variables. Do not log
 * environment objects, customer addresses, raw PDF tokens, or errors.
 */
import {openMixedBookPool} from "./mixed-book-db-runtime.mjs";
import {createMixedBookDbReads} from "./mixed-book-db-reads.mjs";
import {createMixedBookGmailSender} from "./mixed-book-gmail-smtp-draft.mjs";
import {dispatchOneMixedBrandEmail} from "./mixed-book-brand-email-dispatch-draft.mjs";

const FLAGS=[
 "VSH_MIXED_BOOK_DB_ENABLED",
 "VSH_MIXED_BOOK_DOWNLOADS_ENABLED",
 "VSH_MIXED_BOOK_EMAIL_ENABLED",
 "VSH_ENABLE_PAYMENTS"
];
const SECRET_NAMES=[
 "VSH_GRANNYS_SMTP_APP_PASSWORD",
 "VSH_CLEVERCUBS_SMTP_APP_PASSWORD"
];
const secretFormat=/^vshlk_[A-Za-z0-9+/]{43}=$/;
const stop=()=>{throw Error("Branded email worker is not enabled.");};

// Fail BEFORE opening the DB, reserving a job, or creating a transport.
// This does not prove actual mail account auth, only that secret formats exist.
export function assertMixedBookEmailWorkerReadiness({
 enabled=false,operatorApproved=false,context,env={}
}={}){
 if(enabled!==true || operatorApproved!==true ||
   context?.deploy?.context!=="production" ||
   !FLAGS.every(name=>env[name]==="true"))stop();
 const key=env.VSH_MIXED_BOOK_LINK_KEY;
 if(typeof key!=="string" || !secretFormat.test(key))stop();
 const bytes=Buffer.from(key.slice(6),"base64");
 if(bytes.length!==32 || bytes.toString("base64")!==key.slice(6))stop();
 for(const name of SECRET_NAMES){
   const value=env[name];
   if(typeof value!=="string" || /[\r\n\t]/.test(value) ||
     !/^[A-Za-z0-9]{16}$/.test(value.trim().replaceAll(" ","")))stop();
 }
 return true;
}

export function createControlledMixedBookEmailWorker({
 enabled=false,
 operatorApproved=false,
 context,
 env=process.env,
 poolFactory=openMixedBookPool,
 readsFactory=createMixedBookDbReads,
 senderFactory=createMixedBookGmailSender,
 dispatch=dispatchOneMixedBrandEmail
}={}){
 assertMixedBookEmailWorkerReadiness({enabled,operatorApproved,context,env});
 if(typeof poolFactory!=="function" || typeof readsFactory!=="function" ||
   typeof senderFactory!=="function" || typeof dispatch!=="function")stop();
 // Construct transport validation BEFORE accessing any order rows.
 const sendEmail=senderFactory({enabled:true,context,env});
 if(typeof sendEmail!=="function")stop();
 // The pool is Netlify's existing single-project database connection; no
 // other Netlify site, extra DB, migration or external service is provisioned.
 const pool=poolFactory({context,enabled:"true"});
 if(!pool || typeof pool.query!=="function" ||
   typeof pool.connect!=="function")stop();
 const reads=readsFactory(pool);
 if(!reads || typeof reads.loadPaidBrandSale!=="function")stop();
 return Object.freeze({
   async runOne(){
     const result=await dispatch({
       enabled:true,pool,
       loadPaidBrandSale:reads.loadPaidBrandSale,
       linkKey:env.VSH_MIXED_BOOK_LINK_KEY,
       sendEmail
     });
     if(!result ||
       !["empty","sent","retry","failed","unknown"].includes(result.status))
       throw Error("Email worker result unavailable.");
     // Safe summary only. NEVER serialize claims, private links, secrets,
     // full email messages, order IDs, or customer identity.
     return result.status==="empty" ? {status:"empty"} : {
       status:result.status,kind:result.kind,business:result.business
     };
   }
 });
}
