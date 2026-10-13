import { json } from "../lib/auth.mjs";
import { checkoutStore, ordersStore, orderKey, checkoutKey, verifyYocoSignature, casOrder } from "../lib/recipe-orders.mjs";
import { deliverRecipeOrder } from "../lib/recipe-delivery.mjs";
export default async function handler(request) {
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const raw=await request.text();
  if(raw.length>50000) return json({error:"Event too large"},413);
  if(!verifyYocoSignature(request,raw)) return json({error:"Invalid Yoco webhook signature"},401);
  let event;
  try{event=JSON.parse(raw);}catch{return json({error:"Malformed event"},400);}
  if(event.type!=="payment.succeeded")return json({ok:true,ignored:true});
  const data=event.payload || {};
  const checkoutId=data.metadata?.checkoutId;
  if(typeof checkoutId!=="string" || checkoutId.length>200) return json({error:"Missing checkout ID"},400);
  try {
    const map=await checkoutStore().get(checkoutKey(checkoutId),{type:"json"});
    if(!map?.orderId) return json({error:"Checkout record not yet available"},503);
    const order=await ordersStore().get(orderKey(map.orderId),{type:"json"});
    if(!order || order.checkoutId!==checkoutId || map.amount!==order.amount ||
        data.status!=="succeeded" || data.currency!=="ZAR" ||
        Number(data.amount)!==order.amount ||
        (data.mode==="test" && !process.env.YOCO_SECRET_KEY?.startsWith("sk_test_")) ||
        (data.mode==="live" && !process.env.YOCO_SECRET_KEY?.startsWith("sk_live_"))) {
      console.error("Webhook checkout/order verification mismatch",checkoutId);
      return json({error:"Checkout verification failed"},400);
    }
    await casOrder(order.id,current=>{
      if(current.status==="paid")return null;
      if(current.status!=="awaiting_payment")return null;
      return {...current,status:"paid",paid_at:new Date().toISOString(),
        payment_id:String(data.id||"").slice(0,160),updated_at:new Date().toISOString()};
    });
    const confirmed=await ordersStore().get(orderKey(order.id),{type:"json"});
    if(confirmed?.status!=="paid")return json({error:"Could not confirm order yet"},503);
    await deliverRecipeOrder(order.id);
    return json({ok:true});
  }catch(error){
    // A non-2xx reply instructs Yoco to retry. Order payment remains marked as paid,
    // and the independent scheduled retry also attempts email delivery.
    console.error("Yoco recipe webhook processing failed",error);
    return json({error:"Temporary processing failure"},500);
  }
}
