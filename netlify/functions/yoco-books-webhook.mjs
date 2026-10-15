import { openVSHStore } from "../lib/catalogue-store.mjs";
import { verifyBookYocoWebhook } from "../lib/yoco-books-verification.mjs";
import { UUID, BUSINESSES, orderKey, checkoutKey } from "../lib/book-orders.mjs";

// DEPLOY-PREVIEW TEST ONLY. Signed Yoco events can confirm a sandbox order.
// Never mark an order "paid", issue private links, or send email from this route.
const reply = (body, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const checkoutIdValid = id => typeof id === "string" &&
  /^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/.test(id);

export default async function handler(request, context) {
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  if (context?.deploy?.context !== "deploy-preview" ||
      process.env.VSH_YOCO_VERIFY_ONLY !== "true" ||
      !String(process.env.YOCO_SECRET_KEY || "").startsWith("sk_test_"))
    return reply({ error: "Sandbox verification is not enabled in this Deploy Preview." }, 503);

  const size = Number(request.headers.get("content-length"));
  if (Number.isFinite(size) && size > 50000) return reply({ error: "Event too large." }, 413);
  const raw = await request.text();
  if (raw.length > 50000) return reply({ error: "Event too large." }, 413);
  if (!verifyBookYocoWebhook(request, raw))
    return reply({ error: "Webhook signature verification failed." }, 401);

  let event;
  try { event = JSON.parse(raw); }
  catch { return reply({ error: "Invalid event JSON." }, 400); }
  const eventId = request.headers.get("webhook-id");
  if (!event || event.id !== eventId || typeof event.type !== "string" ||
      !event.payload || typeof event.payload !== "object")
    return reply({ error: "Malformed Yoco webhook event." }, 400);
  if (event.payload.mode !== "test")
    return reply({ error: "Only test-mode events are accepted." }, 403);
  if (event.type !== "payment.succeeded")
    return reply({ ok: true, ignored: true, test_only: true });

  const payload = event.payload;
  const checkoutId = payload.metadata?.checkoutId;
  const paymentId = payload.id;
  if (!checkoutIdValid(checkoutId) || typeof paymentId !== "string" ||
      !paymentId.trim() || paymentId.length > 160 ||
      payload.status !== "succeeded" ||
      !Number.isSafeInteger(payload.amount) || payload.amount <= 0 ||
      payload.currency !== "ZAR")
    return reply({ error: "Payment confirmation data is invalid." }, 400);

  try {
    const checkoutStore = openVSHStore("vsh-book-checkouts");
    const map = await checkoutStore.get(checkoutKey(checkoutId), { type: "json" });
    // Checkout mapping is always written by our server before the customer pays.
    // A missing mapping may be temporary; return 503 so Yoco can retry.
    if (!map) return reply({ error: "Checkout mapping not ready." }, 503);
    if (map.checkoutId !== checkoutId || !UUID.test(map.orderId || "") ||
        !BUSINESSES.has(map.business) || map.mode !== "test" ||
        map.currency !== "ZAR" || !Number.isSafeInteger(map.amount) ||
        map.amount !== payload.amount ||
        (payload.metadata.orderId != null && payload.metadata.orderId !== map.orderId) ||
        (payload.metadata.business != null && payload.metadata.business !== map.business))
      return reply({ error: "Checkout does not match the payment." }, 400);

    const orders = openVSHStore("vsh-book-orders");
    const key = orderKey(map.business, map.orderId);
    let confirmed = false;
    for (let tries = 0; tries < 6; tries++) {
      const record = await orders.getWithMetadata(key, { type: "json" });
      if (!record) return reply({ error: "Order not ready." }, 503);
      const order = record.data;
      if (order.id !== map.orderId || order.business !== map.business ||
          order.checkoutId !== checkoutId || order.amount !== map.amount ||
          order.currency !== "ZAR" || order.processingMode !== "test" ||
          order.paymentProvider !== "yoco" || order.paymentVerified !== false)
        return reply({ error: "Order failed payment verification." }, 400);
      if (order.status === "test_payment_verified") {
        if (order.testPaymentId !== paymentId)
          return reply({ error: "Another payment was already verified for this checkout." }, 409);
        confirmed = true;
        break;
      }
      if (order.status !== "awaiting_payment")
        return reply({ error: "Order is not awaiting payment." }, 409);
      const updated = { ...order, status: "test_payment_verified",
        testPaymentVerified: true, testPaymentId: paymentId,
        testPaymentEventId: eventId, testVerifiedAt: new Date().toISOString(),
        // Deliberately FALSE: production fulfilment requires genuine live payment.
        paymentVerified: false, email_status: "not_sent",
        updated_at: new Date().toISOString() };
      const written = await orders.setJSON(key, updated, { onlyIfMatch: record.etag });
      if (written.modified) { confirmed = true; break; }
    }
    if (!confirmed) return reply({ error: "Concurrent order update; retry safely." }, 503);

    const events = openVSHStore("vsh-yoco-book-test-events");
    const result = await events.setJSON("event/" + eventId + ".json", {
      id: eventId, type: event.type, checkoutId, orderId: map.orderId,
      business: map.business, amount: map.amount, currency: "ZAR",
      mode: "test", status: "test_payment_verified",
      received_at: new Date().toISOString(), email_sent: false,
      download_link_issued: false
    }, { onlyIfNew: true });
    return reply({ ok: true, test_only: true, payment_verified: true,
      duplicate: !result.modified, email_sent: false });
  } catch (error) {
    console.error("Yoco test payment verification failed:", error?.name || "Error");
    return reply({ error: "Temporary sandbox verification failure." }, 503);
  }
}
