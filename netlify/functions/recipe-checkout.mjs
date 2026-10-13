import crypto from "node:crypto";
import { json } from "../lib/auth.mjs";
import { productsStore, ordersStore, checkoutStore, privatePDFStore, UUID, isRecipe, cents, safeUrl, orderKey, checkoutKey, casOrder } from "../lib/recipe-orders.mjs";
const MAX_CART = 4;
export default async function handler(request) {
  if(request.method !== "POST") return json({error:"Method not allowed."},405);
  const apiKey=process.env.YOCO_SECRET_KEY || "";
  const base=(process.env.VSH_SITE_URL || "").replace(/\/$/,"");
  if(!/^sk_(test|live)_/.test(apiKey) || !/^https:\/\/[^/]+$/i.test(base) || !process.env.YOCO_WEBHOOK_SECRET || !(process.env.RESEND_API_KEY && process.env.VSH_RECIPE_EMAIL_FROM) && !(process.env.VSH_GMAIL_USER && process.env.VSH_GMAIL_APP_PASSWORD))
    return json({error:"Online payments and email delivery are not configured yet."},503);
  let input;
  try { const raw=await request.text(); if(raw.length>5000) return json({error:"Order too large."},413);input=JSON.parse(raw); }
  catch{return json({error:"Invalid checkout details."},400);}
  const name=String(input?.name || "").trim().slice(0,120);
  const email=String(input?.email || "").trim().toLowerCase().slice(0,254);
  const ids=input?.ids;
  if(name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Array.isArray(ids) || ids.length<1 || ids.length>MAX_CART
      || ids.some(id=>typeof id!=="string" || !UUID.test(id)) || new Set(ids).size!==ids.length)
    return json({error:"Enter your name, valid email, and up to four different recipe books."},400);
  try {
    const productDB=productsStore(), pdfDB=privatePDFStore();
    const products=await Promise.all(ids.map(id=>productDB.get("grannys/"+id+".json",{type:"json"})));
    if(products.some(p=>!p || !p.is_active || !isRecipe(p) || !p.pdf_path || !Number.isSafeInteger(cents(p.price)) || cents(p.price)<100))
      return json({error:"One or more books cannot be purchased at the moment."},409);
    const metadata=await Promise.all(products.map(p=>pdfDB.getMetadata(p.pdf_path)));
    if(metadata.some(m=>!m)) return json({error:"A recipe PDF is currently unavailable."},409);
    const amount=products.reduce((sum,p)=>sum+cents(p.price),0);
    if(!Number.isSafeInteger(amount)||amount<=0) return json({error:"Invalid total."},400);
    const id=crypto.randomUUID();
    const items=products.map(p=>({id:p.id,title:p.title,priceCents:cents(p.price),pdfPath:p.pdf_path}));
    const created=new Date().toISOString();
    const order={id,name,email,items,amount,currency:"ZAR",status:"checkout_pending",checkoutId:null,
      created_at:created,updated_at:created,email_status:"not_sent",attempts:0};
    await ordersStore().setJSON(orderKey(id),order,{onlyIfNew:true});
    const reply=await fetch("https://payments.yoco.com/api/checkouts",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json","Idempotency-Key":id},
      body:JSON.stringify({amount,currency:"ZAR",externalId:id,metadata:{orderId:id},
        successUrl:base+"/recipe-order.html?order="+id,
        cancelUrl:base+"/recipe-order.html?order="+id+"&cancelled=1",
        failureUrl:base+"/recipe-order.html?order="+id+"&failed=1"})
    });
    const data=await reply.json().catch(()=>({}));
    if(!reply.ok || !data.id || !safeUrl(data.redirectUrl)){
      console.error("Yoco checkout rejected",reply.status);
      return json({error:"Payment checkout could not be started. Please try again."},502);
    }
    await checkoutStore().setJSON(checkoutKey(data.id),{orderId:id,checkoutId:data.id,amount,created_at:created},{onlyIfNew:true});
    await casOrder(id,current=>{
      if(current.checkoutId && current.checkoutId!==data.id) return null;
      return {...current,checkoutId:data.id,
        status:current.status==="checkout_pending" ? "awaiting_payment" : current.status,
        updated_at:new Date().toISOString()};
    });
    return json({orderId:id,redirectUrl:safeUrl(data.redirectUrl)},201);
  } catch(error) {
    console.error("Recipe book checkout error",error);
    return json({error:"Unable to start checkout. Please try again."},500);
  }
}
