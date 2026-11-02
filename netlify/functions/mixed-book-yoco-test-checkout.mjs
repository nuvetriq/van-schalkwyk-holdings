/* Existing Van Schalkwyk Holdings project: admin-only Yoco TEST checkout.
 *
 * This function is DENY-BY-DEFAULT and remains UNDEPLOYED on the branch.
 * No real customer payments, email tasks or download grants. Production-only
 * origin, separate explicit flags, test key, signing-secret configuration and
 * VSH_ADMIN_KEY are all required BEFORE the server can make a test checkout.
 * Do not enable until production DB migration and webhook are installed.
 */
import {authStatus,json} from "../lib/auth.mjs";
import {createMixedBookCatalogueSource} from "../lib/mixed-book-catalogue-source.mjs";
import {createMixedBookServices} from "../lib/mixed-book-db-service.mjs";
import {
  createMixedBookTestCheckout,postYocoTestCheckout
} from "../lib/mixed-book-yoco-test-operation.mjs";

const SITE="https://vanschalkwykholdings.com";
const noStore={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"};
const respond=(value,status)=>Response.json(value,{status,headers:noStore});
function enabled(request,context,env){
  let url;
  try{url=new URL(request.url);}catch{return false}
  return url.origin===SITE &&
    context?.deploy?.context==="production" &&
    env.VSH_MIXED_BOOK_DB_ENABLED==="true" &&
    env.VSH_MIXED_YOCO_TEST_ENABLED==="true" &&
    env.VSH_ENABLE_PAYMENTS!=="true" &&
    /^sk_test_[A-Za-z0-9_-]{8,}$/.test(env.VSH_MIXED_YOCO_TEST_KEY||"") &&
    /^whsec_[A-Za-z0-9+/]{20,}={0,2}$/.test(env.VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET||"");
}
export function makeMixedBookTestCheckoutHandler({
  env=process.env,authorize=authStatus,
  catalogueFactory=createMixedBookCatalogueSource,
  databaseFactory=createMixedBookServices,
  operate=createMixedBookTestCheckout,
  postCheckout=postYocoTestCheckout
}={}){
  return async function handler(request,context){
    if(request.method!=="POST")return respond({error:"Method not allowed."},405);
    if(!enabled(request,context,env))
      return respond({error:"Test-only checkout is disabled."},503);
    const origin=request.headers.get("origin");
    if(origin!==null && origin!==SITE)
      return respond({error:"Request origin not allowed."},403);
    const auth=authorize(request);
    if(!auth?.ok)
      return respond({error:"Administrator authentication required."},
        auth?.status===503?503:401);
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")||""))
      return respond({error:"Expected JSON body."},415);
    const bytes=Number(request.headers.get("content-length"));
    if(Number.isFinite(bytes) && bytes>4096)
      return respond({error:"Checkout request too large."},413);
    let input;
    try{
      const raw=await request.text();
      if(Buffer.byteLength(raw,"utf8")>4096)
        return respond({error:"Checkout request too large."},413);
      input=JSON.parse(raw);
      if(!input || typeof input!=="object" || Array.isArray(input))
        return respond({error:"Invalid checkout request."},400);
    }catch{return respond({error:"Invalid checkout request."},400)}
    try{
      const catalogue=catalogueFactory();
      const ledger=databaseFactory({context});
      const result=await operate(input,{
        catalogue,ledger,
        secretKey:env.VSH_MIXED_YOCO_TEST_KEY,
        postCheckout
      });
      return respond({
        orderId:result.orderId,checkoutId:result.checkoutId,
        redirectUrl:result.redirectUrl,amountCents:result.amountCents,
        currency:"ZAR",processingMode:"test",
        paymentVerified:false
      },201);
    }catch(error){
      // Secret keys, private PDF paths, server SQL details or the customer
      // email must never appear in HTTP error responses.
      console.error("Mixed Yoco TEST checkout unavailable",error?.name||"Error");
      return respond({error:"The test checkout could not be prepared."},503);
    }
  };
}

export default makeMixedBookTestCheckoutHandler();
export const config={
  method:"POST",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:4}
};
