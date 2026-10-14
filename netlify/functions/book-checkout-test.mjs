import { authStatus } from "../lib/auth.mjs";
import { snapshotCart, createPendingOrder, bindTestCheckout } from "../lib/book-orders.mjs";

/*
 * SHARED DEVELOPMENT CHECKOUT — never available on the production website.
 *
 * Only a signed-in master admin on a Netlify Deploy Preview can create a
 * sandbox Yoco checkout. Any storefront activation is a separate release.
 */
const reply=(body,status=200)=>Response.json(body,{status,
  headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const allowedYocoRedirect=url=>{
  try{
    const parsed=new URL(url);
    return parsed.protocol==="https:" &&
      ["c.yoco.com","checkout.yoco.com"].includes(parsed.hostname) &&
      !parsed.username && !parsed.password ? parsed.toString():null;
  }catch{return null}
};

export default async function handler(request) {
  if(request.method!=="POST")return reply({error:"Method not allowed."},405);
  if(process.env.CONTEXT!=="deploy-preview" ||
     process.env.VSH_YOCO_TEST_CHECKOUT!=="true" ||
     !String(process.env.YOCO_SECRET_KEY||"").startsWith("sk_test_"))
    return reply({error:"Test checkout is not enabled in this deployment."},503);

  const auth=authStatus(request);
  if(!auth.ok)return reply({error:auth.error},auth.status);
  let origin;
  try{
    origin=new URL(request.url).origin;
    const expected=new URL(process.env.DEPLOY_PRIME_URL).origin;
    if(origin!==expected || !expected.endsWith(".netlify.app"))
      throw Error("Unexpected origin.");
    const supplied=request.headers.get("origin");
    if(supplied && supplied!==origin)throw Error("Cross-site checkout request.");
  }catch{return reply({error:"This test checkout can only run on its own Deploy Preview."},403)}

  if(!(request.headers.get("content-type")||"").toLowerCase().startsWith("application/json"))
    return reply({error:"Expected JSON checkout details."},415);
  const length=Number(request.headers.get("content-length"));
  if(Number.isFinite(length)&&length>5000)return reply({error:"Checkout request too large."},413);

  let input;
  try{
    const body=await request.text();
    if(body.length>5000)throw Error("Checkout details are too long.");
    input=JSON.parse(body);
  }catch{return reply({error:"Enter valid checkout details."},400)}

  let snapshot;
  try {snapshot=await snapshotCart(input)}
  catch(error){return reply({error:error?.message||"The selected books are unavailable."},400)}

  let order;
  try{
    order=await createPendingOrder(snapshot);
    const base=origin;
    const back=base+"/book-order-test.html?business="+encodeURIComponent(order.business)+
      "&order="+encodeURIComponent(order.id);
    const yoco=await fetch("https://payments.yoco.com/api/checkouts",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+process.env.YOCO_SECRET_KEY,
        "Content-Type":"application/json",
        "Idempotency-Key":order.id
      },
      body:JSON.stringify({
        amount:order.amount,currency:"ZAR",
        externalId:order.id,
        metadata:{orderId:order.id,business:order.business},
        successUrl:back+"&result=success",
        cancelUrl:back+"&result=cancelled",
        failureUrl:back+"&result=failed"
      }),
      signal:AbortSignal.timeout(15000)
    });
    const response=await yoco.json().catch(()=>({}));
    if(!yoco.ok || !allowedYocoRedirect(response.redirectUrl)){
      console.error("Yoco test checkout creation rejected:",yoco.status);
      return reply({error:"Test checkout could not be started. Try again later."},502);
    }
    await bindTestCheckout(order,{
      id:response.id,amount:response.amount,currency:response.currency,
      processingMode:response.processingMode
    });
    return reply({
      testOnly:true,orderId:order.id,business:order.business,
      amount:order.amount,currency:"ZAR",
      redirectUrl:allowedYocoRedirect(response.redirectUrl),
      deliveryEnabled:false
    },201);
  }catch(error){
    console.error("Shared test checkout error:",error?.name||"Error");
    return reply({error:"Test checkout could not be completed. No books have been delivered."},503);
  }
}