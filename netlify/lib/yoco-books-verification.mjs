import crypto from "node:crypto";

/**
 * Checkout API Standard Webhooks verification (Yoco, October 2026).
 * The body MUST be the exact raw request text, before JSON parsing.
 * https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
 */
export function verifyBookYocoWebhook(request, rawBody, secret=process.env.YOCO_WEBHOOK_SECRET) {
  if(typeof rawBody!=="string" || rawBody.length>50000 ||
     typeof secret!=="string" || !secret.startsWith("whsec_"))return false;
  const eventId=request.headers.get("webhook-id") || "";
  const timestamp=request.headers.get("webhook-timestamp") || "";
  const signatures=request.headers.get("webhook-signature") || "";
  if(!/^[\w-]{4,200}$/.test(eventId) || !/^\d{10}$/.test(timestamp) ||
     Math.abs(Math.floor(Date.now()/1000)-Number(timestamp))>180)return false;
  const key=Buffer.from(secret.slice(6),"base64");
  if(key.byteLength<16 || key.byteLength>128)return false;
  const expected=crypto.createHmac("sha256",key)
    .update(eventId+"."+timestamp+"."+rawBody).digest();
  return signatures.split(/\s+/).some(item=>{
    if(!item.startsWith("v1,"))return false;
    const given=Buffer.from(item.slice(3),"base64");
    return given.byteLength===expected.byteLength &&
      crypto.timingSafeEqual(given,expected);
  });
}
