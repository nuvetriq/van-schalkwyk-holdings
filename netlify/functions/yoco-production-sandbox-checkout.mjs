import crypto from "node:crypto";
import {authStatus} from "../lib/auth.mjs";
import {SITE, PURPOSE, AMOUNT, CURRENCY, CHECKOUT_ID, json, disabled,
  sandboxEnabled, orders, checkouts, orderKey, checkoutKey} from "../lib/production-sandbox.mjs";

// NO product IDs, PDFs, Gmail, delivery, or live Yoco keys are used here.
const safeRedirect=value=>{
  try{
    const url=new URL(value);
    if(url.protocol!=="https:" || !["pay.yoco.com","checkout.yoco.com","c.yoco.com"].includes(url.hostname) ||
       url.username || url.password)return null;
    return url.toString();
  }catch{return null}
};
export default async function handler(request, context) {
  if(request.method!=="POST")return json({error:"Method not allowed."},405);
  if(!sandboxEnabled(request,context))return disabled();
  const auth=authStatus(request);
  if(!auth.ok)return json({error:auth.error},auth.status);
  if(request.headers.get("origin") && request.headers.get("origin")!==SITE)
    return json({error:"Invalid request origin."},403);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type")||""))
    return json({error:"JSON request required."},415);
  const raw=await request.text();
  if(raw.length>256)return json({error:"Request too large."},413);
  let body;
  try {body=JSON.parse(raw);}catch{return json({error:"Invalid request."},400)}
  if(!body || !["grannys","clever-cubs"].includes(body.business) ||
     Object.keys(body).some(k=>k!=="business"))
    return json({error:"Choose the business to test."},400);
  const id=crypto.randomUUID(), now=new Date().toISOString(), store=orders();
  const order={id,business:body.business,purpose:PURPOSE,amount:AMOUNT,currency:CURRENCY,
    status:"checkout_pending",checkoutId:null,mode:"test",paymentVerified:false,
    testPaymentVerified:false,emailSent:false,pdfDelivered:false,
    created_at:now,updated_at:now};
  try{
    const created=await store.setJSON(orderKey(id),order,{onlyIfNew:true});
    if(!created.modified)return json({error:"Unable to create test order."},503);
    const back=SITE+"/yoco-production-sandbox.html?order="+encodeURIComponent(id);
    const upstream=await fetch("https://payments.yoco.com/api/checkouts",{
      method:"POST",headers:{"Authorization":"Bearer "+process.env.VSH_YOCO_SANDBOX_TEST_KEY,
        "Content-Type":"application/json","Idempotency-Key":"vsh-sandbox-"+id},
      body:JSON.stringify({amount:AMOUNT,currency:CURRENCY,
        externalId:"VSHSB-"+id,
        metadata:{orderId:id,business:body.business,purpose:PURPOSE},
        successUrl:back+"&result=success",cancelUrl:back+"&result=cancelled",
        failureUrl:back+"&result=failed"}),
      signal:AbortSignal.timeout(15000)
    });
    const data=await upstream.json().catch(()=>({}));
    const redirect=upstream.ok?safeRedirect(data.redirectUrl):null;
    if(!redirect || !CHECKOUT_ID.test(data.id||"") || data.amount!==AMOUNT ||
       data.currency!==CURRENCY || data.processingMode!=="test"){
      console.error("Sandbox Yoco checkout rejected or mismatched",upstream.status);
      return json({error:"Yoco test checkout could not be started."},502);
    }
    const mapped=await checkouts().setJSON(checkoutKey(data.id),{
      orderId:id,checkoutId:data.id,business:body.business,purpose:PURPOSE,
      mode:"test",amount:AMOUNT,currency:CURRENCY
    },{onlyIfNew:true});
    if(!mapped.modified)return json({error:"Test checkout conflict."},503);
    for(let i=0;i<5;i++){
      const previous=await store.getWithMetadata(orderKey(id),{type:"json"});
      if(!previous || previous.data.status!=="checkout_pending")
        return json({error:"Test order changed unexpectedly."},503);
      const written=await store.setJSON(orderKey(id),{
        ...previous.data,checkoutId:data.id,status:"awaiting_payment",
        updated_at:new Date().toISOString()
      },{onlyIfMatch:previous.etag});
      if(written.modified)return json({testOnly:true,amount:AMOUNT,currency:CURRENCY,
        orderId:id,redirectUrl:redirect,emailSent:false,pdfDelivered:false},201);
    }
    return json({error:"Test order is busy."},503);
  }catch(error){
    console.error("Yoco production-domain sandbox checkout failure",error?.name||"Error");
    return json({error:"The test checkout is temporarily unavailable."},503);
  }
}
