import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
export const productsStore = () => getStore({ name:"vsh-products", consistency:"strong" });
export const ordersStore = () => getStore({ name:"vsh-recipe-orders", consistency:"strong" });
export const checkoutStore = () => getStore({ name:"vsh-yoco-checkouts", consistency:"strong" });
export const privatePDFStore = () => getStore({ name:"vsh-private-recipe-pdfs", consistency:"strong" });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isRecipe = p => p?.business === "grannys" && /^recipe books?$/i.test(String(p.category || "").trim());
export const orderKey = id => "order/" + id + ".json";
export const checkoutKey = id => "checkout/" + id + ".json";
export const cents = price => Math.round(Number(price) * 100);
export const safeUrl = url => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ["c.yoco.com","checkout.yoco.com"].includes(u.hostname) ? u.toString() : null;
  } catch { return null; }
};
export function verifyYocoSignature(request, body) {
  const secret = process.env.YOCO_WEBHOOK_SECRET || "";
  const id = request.headers.get("webhook-id");
  const stamp = request.headers.get("webhook-timestamp");
  const signatures = request.headers.get("webhook-signature") || "";
  if (!secret.startsWith("whsec_") || !id || !stamp || !/^\d{10}$/.test(stamp) ||
      Math.abs(Date.now()/1000 - Number(stamp)) > 180) return false;
  const decoded = Buffer.from(secret.slice(6), "base64");
  if (decoded.length < 16) return false;
  const expected = crypto.createHmac("sha256", decoded)
    .update(id+"."+stamp+"."+body).digest();
  return signatures.split(/\s+/).some(item=>{
    if(!item.startsWith("v1,")) return false;
    const other = Buffer.from(item.slice(3), "base64");
    return other.length === expected.length && crypto.timingSafeEqual(other,expected);
  });
}
export async function casOrder(id, transform) {
  const store = ordersStore();
  const key=orderKey(id);
  for(let i=0;i<4;i++){
    const record=await store.getWithMetadata(key, {type:"json"});
    if(!record) return null;
    const updated=transform(record.data);
    if(!updated) return {changed:false,order:record.data};
    const write=await store.setJSON(key,updated,{onlyIfMatch:record.etag});
    if(write.modified) return {changed:true,order:updated};
  }
  throw Error("Concurrent order update; safe to retry.");
}
