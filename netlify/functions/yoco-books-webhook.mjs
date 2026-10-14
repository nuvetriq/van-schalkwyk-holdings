import { openVSHStore } from "../lib/catalogue-store.mjs";
import { verifyBookYocoWebhook } from "../lib/yoco-books-verification.mjs";

// Stage 1: accept authentic TEST webhooks only, record minimal diagnostics,
// NEVER mark orders paid, issue book links, or send mail.
// Stage 2 (future): atomically apply verified event to a matching paid order
// only after checkout creation, payment mapping and delivery are implemented.
const reply=(body,status=200)=>Response.json(body,{status,
  headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export default async function handler(request) {
  if(request.method!=="POST")return reply({error:"Method not allowed."},405);
  if(process.env.VSH_YOCO_VERIFY_ONLY!=="true" ||
     !String(process.env.YOCO_SECRET_KEY||"").startsWith("sk_test_"))
    return reply({error:"Test webhook receiver is not enabled."},503);
  const size=Number(request.headers.get("content-length"));
  if(Number.isFinite(size)&&size>50000)return reply({error:"Event too large."},413);
  const raw=await request.text();
  if(raw.length>50000)return reply({error:"Event too large."},413);
  if(!verifyBookYocoWebhook(request,raw))
    return reply({error:"Webhook signature verification failed."},401);
  let event;
  try{event=JSON.parse(raw)}catch{return reply({error:"Invalid event JSON."},400)}
  const id=request.headers.get("webhook-id");
  if(event?.id!==id || typeof event.type!=="string" ||
     typeof event.payload!=="object" || !event.payload)
    return reply({error:"Malformed Yoco webhook event."},400);
  // Signed test-mode events only: never let a live event leak into test stage.
  if(event.payload.mode!=="test")
    return reply({error:"Only test-mode events are accepted."},403);
  if(!["payment.succeeded","payment.failed","refund.succeeded","refund.failed"].includes(event.type))
    return reply({ok:true,ignored:true});
  const checkoutId=event.payload.metadata?.checkoutId;
  if(typeof checkoutId!=="string" || !/^ch_[a-zA-Z0-9_-]{6,150}$/.test(checkoutId))
    return reply({error:"No valid checkout reference in event."},400);
  if(!Number.isSafeInteger(event.payload.amount) || event.payload.amount<=0 ||
     event.payload.currency!=="ZAR")
    return reply({error:"Payment data did not pass validation."},400);
  try{
    const recorded=await openVSHStore("vsh-yoco-book-test-events").setJSON("event/"+id+".json",{
      id,type:event.type,checkoutId,
      amount:event.payload.amount,currency:"ZAR",mode:"test",
      received_at:new Date().toISOString(),
      status:"verified_received_only",
      // Explicitly no payment approval or fulfilment in this receiver.
      order_modified:false,email_sent:false,download_link_issued:false
    },{onlyIfNew:true});
    return reply({ok:true,test_only:true,duplicate:!recorded.modified});
  }catch(error){
    console.error("Failed to record verified Yoco test event:",error?.name||"Error");
    return reply({error:"Temporary event recording failure."},503);
  }
}
