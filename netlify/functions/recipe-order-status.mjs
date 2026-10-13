import { json } from "../lib/auth.mjs";
import { ordersStore, UUID, orderKey } from "../lib/recipe-orders.mjs";
export default async function handler(request) {
  if(request.method!=="GET") return json({error:"Method not allowed."},405);
  const id=new URL(request.url).searchParams.get("order") || "";
  if(!UUID.test(id)) return json({error:"Unknown order."},404);
  const order=await ordersStore().get(orderKey(id),{type:"json"});
  if(!order) return json({error:"Unknown order."},404);
  // Never disclose the buyer's email address, purchased PDF paths or other PII.
  return json({status:order.status,emailSent:order.email_status==="sent"});
}
