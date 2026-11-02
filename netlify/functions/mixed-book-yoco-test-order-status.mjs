/* Read-only admin status for Yoco TEST mixed-book orders.
 * DEVELOPMENT BRANCH ONLY. Deny by default until explicitly released.
 * No customer contact data, private PDF references, payment token, JSON
 * snapshot, webhook secrets or merchant keys are returned. No DB writes.
 */
import {authStatus} from "../lib/auth.mjs";
import {UUID} from "../lib/mixed-book-order.mjs";
import {createMixedBookServices} from "../lib/mixed-book-db-service.mjs";

const SITE="https://vanschalkwykholdings.com";
const statuses=new Set(["checkout_pending","awaiting_payment","paid","failed","refunded"]);
const headers={
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer"
};
const reply=(data,status)=>Response.json(data,{status,headers});

function configured(request,context,env){
  try{
    const url=new URL(request.url);
    return url.protocol==="https:" && url.origin===SITE &&
      context?.deploy?.context==="production" &&
      env.VSH_MIXED_BOOK_DB_ENABLED==="true" &&
      env.VSH_MIXED_YOCO_TEST_ENABLED==="true" &&
      env.VSH_ENABLE_PAYMENTS!=="true";
  }catch{return false}
}
export function makeMixedBookTestStatusHandler({
  env=process.env,
  authorize=authStatus,
  databaseFactory=createMixedBookServices
}={}){
  return async function handler(request,context){
    if(request.method!=="GET")return reply({error:"Method not allowed."},405);
    if(!configured(request,context,env))
      return reply({error:"Test order status is disabled."},503);
    const auth=authorize(request);
    if(!auth?.ok)
      return reply({error:"Administrator authentication required."},
        auth?.status===503?503:401);
    const url=new URL(request.url);
    const id=url.searchParams.get("orderId");
    if(url.searchParams.has("token") || url.searchParams.has("secret") ||
      !id || !UUID.test(id))
      return reply({error:"Invalid test order reference."},400);
    try{
      const db=databaseFactory({context});
      const row=await db.loadYocoTestOrder(id.toLowerCase());
      // Return 404 for an unknown or non-test order; never fall back to live.
      if(!row || row.id!==id.toLowerCase() ||
        row.processing_mode!=="test" ||
        !statuses.has(row.status))
        return reply({error:"Test order not found."},404);
      const amount=Number(row.amount_cents);
      if(!Number.isSafeInteger(amount) || amount<100 || amount>5_000_000)
        throw Error("Invalid stored test amount.");
      const checkoutBound=typeof row.checkout_id==="string" &&
        /^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/.test(row.checkout_id);
      // Do not return checkout_id; it is used for merchant reconciliation.
      if(row.status==="paid" && !checkoutBound)
        throw Error("Inconsistent paid test order.");
      return reply({
        orderId:row.id,mode:"test",status:row.status,
        currency:"ZAR",amountCents:amount,
        checkoutBound,
        testPaymentVerified:row.status==="paid",
        customerDeliveryEnabled:false
      },200);
    }catch(error){
      console.error("Mixed TEST order status unavailable",error?.name||"Error");
      return reply({error:"Test order status unavailable."},503);
    }
  };
}
export default makeMixedBookTestStatusHandler();
export const config={
  method:"GET",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:30}
};
