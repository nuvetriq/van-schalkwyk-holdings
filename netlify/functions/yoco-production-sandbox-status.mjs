import {authStatus} from "../lib/auth.mjs";
import {UUID, PURPOSE, AMOUNT, CURRENCY, json, disabled,
  sandboxEnabled, orders, orderKey} from "../lib/production-sandbox.mjs";

export default async function handler(request, context) {
  if(request.method!=="GET")return json({error:"Method not allowed."},405);
  if(!sandboxEnabled(request,context))return disabled();
  const auth=authStatus(request);
  if(!auth.ok)return json({error:auth.error},auth.status);
  const id=new URL(request.url).searchParams.get("order")||"";
  if(!UUID.test(id))return json({error:"Invalid sandbox order."},400);
  try{
    const o=await orders().get(orderKey(id),{type:"json"});
    if(!o || o.id!==id || o.purpose!==PURPOSE || o.amount!==AMOUNT ||
       o.currency!==CURRENCY || o.mode!=="test")
      return json({error:"Sandbox order not found."},404);
    return json({testOnly:true,orderId:id,business:o.business,status:o.status,
      testPaymentVerified:o.status==="test_payment_verified" && o.testPaymentVerified===true,
      realPaymentVerified:false,emailSent:false,pdfDelivered:false});
  }catch{return json({error:"Sandbox status unavailable."},503)}
}
