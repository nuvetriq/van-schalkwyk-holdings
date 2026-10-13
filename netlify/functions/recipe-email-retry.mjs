import { ordersStore, UUID } from "../lib/recipe-orders.mjs";
import { deliverRecipeOrder } from "../lib/recipe-delivery.mjs";
export const config={schedule:"@hourly"};
export default async function handler() {
  if(!process.env.RESEND_API_KEY || !process.env.VSH_RECIPE_EMAIL_FROM) return;
  const store=ordersStore();
  const {blobs}=await store.list({prefix:"order/"});
  let attempted=0;
  for (const blob of blobs) {
    if(attempted>=25) break;
    const id=blob.key.slice(6).replace(/\.json$/,"");
    if(!UUID.test(id))continue;
    const record=await store.get(blob.key,{type:"json"});
    if(record?.status==="paid" && record?.email_status!=="sent") {
      attempted++;
      try { await deliverRecipeOrder(id); }
      catch(e) { console.error("Retry delivery failed",id,e.message); }
    }
  }
}
