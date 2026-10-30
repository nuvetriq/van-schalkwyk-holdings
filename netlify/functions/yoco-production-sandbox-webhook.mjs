import {verifyBookYocoWebhook} from "../lib/yoco-books-verification.mjs";
import {SITE, PURPOSE, AMOUNT, CURRENCY, UUID, CHECKOUT_ID, json, disabled,
  sandboxEnabled, orders, checkouts, orderKey, checkoutKey} from "../lib/production-sandbox.mjs";

// This public endpoint verifies signed TEST events only.
// It never marks customer orders paid, sends email, or issues a private PDF link.
export default async function handler(request, context) {
  if(request.method!=="POST")return json({error:"Method not allowed."},405);
  if(!sandboxEnabled(request,context))return disabled();
  const length=Number(request.headers.get("content-length"));
  if(Number.isFinite(length)&&length>50000)return json({error:"Event too large."},413);
  const raw=await request.text();
  if(raw.length>50000)return json({error:"Event too large."},413);
  if(!verifyBookYocoWebhook(request,raw,process.env.VSH_YOCO_SANDBOX_WEBHOOK_SECRET))
    return json({error:"Invalid webhook signature."},401);
  let event;
  try{event=JSON.parse(raw)}catch{return json({error:"Invalid event JSON."},400)}
  if(!event || typeof event.type!=="string" || !event.payload || typeof event.payload!=="object")
    return json({error:"Malformed webhook event."},400);
  if(event.type!=="payment.succeeded")return json({ok:true,ignored:true});
  const payment=event.payload, metadata=payment.metadata||{};
  if(payment.mode!=="test")return json({ok:true,ignored:true});
  const checkoutId=metadata.checkoutId;
  if(!CHECKOUT_ID.test(checkoutId||""))
    return json({error:"Missing Yoco checkout ID."},400);
  const paymentId=payment.id;
  if(typeof paymentId!=="string" || paymentId.length<3 || paymentId.length>160 ||
     payment.status!=="succeeded" || payment.currency!==CURRENCY ||
     payment.amount!==AMOUNT)return json({error:"Invalid test payment details."},400);

  try{
    const mapping=await checkouts().get(checkoutKey(checkoutId),{type:"json"});
    if(!mapping){
      // This account may have other Yoco TEST checkouts, such as the old private preview.
      // A sandbox checkout can briefly race ahead of its mapping; ask Yoco to retry only ours.
      if(typeof metadata.orderId==="string" && UUID.test(metadata.orderId) &&
         metadata.purpose===PURPOSE)return json({error:"Test checkout not indexed yet."},503);
      return json({ok:true,ignored:true});
    }
    if(mapping.purpose!==PURPOSE || !UUID.test(mapping.orderId||"") ||
       mapping.checkoutId!==checkoutId || !["grannys","clever-cubs"].includes(mapping.business) ||
       mapping.mode!=="test" || mapping.currency!==CURRENCY || mapping.amount!==AMOUNT ||
       (metadata.orderId!=null && metadata.orderId!==mapping.orderId) ||
       (metadata.business!=null && metadata.business!==mapping.business) ||
       (metadata.purpose!=null && metadata.purpose!==PURPOSE))
      return json({error:"Test checkout mapping mismatch."},400);

    const store=orders(), key=orderKey(mapping.orderId);
    for(let attempt=0;attempt<6;attempt++){
      const item=await store.getWithMetadata(key,{type:"json"});
      if(!item)return json({error:"Test order not indexed yet."},503);
      const o=item.data;
      if(o.id!==mapping.orderId || o.business!==mapping.business ||
         o.purpose!==PURPOSE || o.amount!==AMOUNT ||
         o.currency!==CURRENCY || o.mode!=="test" ||
         o.paymentVerified!==false || o.emailSent!==false || o.pdfDelivered!==false)
        return json({error:"Test order verification mismatch."},400);
      // Yoco may deliver a signed callback after the checkout mapping has
      // been saved but before the order's checkout ID has been finalised.
      // Treat this specific state as transient so Yoco can retry the event.
      if(o.status==="checkout_pending" && o.checkoutId===null)
        return json({error:"Test order awaiting checkout mapping."},503);
      if(o.checkoutId!==checkoutId)
        return json({error:"Test order checkout ID mismatch."},400);
      if(o.status==="test_payment_verified"){
        if(o.testPaymentId!==paymentId)return json({error:"Payment ID conflict."},409);
        return json({ok:true,testVerified:true,duplicate:true});
      }
      if(o.status!=="awaiting_payment")return json({error:"Test order awaiting mapping."},503);
      const updated={...o,status:"test_payment_verified",testPaymentVerified:true,
        testPaymentId:paymentId,testEventId:request.headers.get("webhook-id"),
        verified_at:new Date().toISOString(),updated_at:new Date().toISOString(),
        // Always FALSE: sandbox events cannot ever unlock live delivery.
        paymentVerified:false,emailSent:false,pdfDelivered:false};
      const saved=await store.setJSON(key,updated,{onlyIfMatch:item.etag});
      if(saved.modified)return json({ok:true,testVerified:true});
    }
    return json({error:"Concurrent test order update."},503);
  }catch(error){
    console.error("Yoco signed sandbox callback failed",error?.name||"Error");
    return json({error:"Temporary sandbox webhook failure."},503);
  }
}
