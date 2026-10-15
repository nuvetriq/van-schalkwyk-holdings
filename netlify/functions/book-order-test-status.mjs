import { authStatus } from "../lib/auth.mjs";
import { openVSHStore } from "../lib/catalogue-store.mjs";
import { UUID, BUSINESSES, orderKey } from "../lib/book-orders.mjs";

// Private admin-only status; this function does not expose buyer data or PDFs.
const reply = (body, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export default async function handler(request, context) {
  if (request.method !== "GET") return reply({ error: "Method not allowed." }, 405);
  const auth = authStatus(request);
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (context?.deploy?.context !== "deploy-preview")
    return reply({ error: "Available only in a Deploy Preview." }, 503);
  const search = new URL(request.url).searchParams;
  const business = search.get("business") || "";
  const id = search.get("order") || "";
  if (!BUSINESSES.has(business) || !UUID.test(id))
    return reply({ error: "Invalid test order reference." }, 400);
  try {
    const order = await openVSHStore("vsh-book-orders").get(orderKey(business, id), { type: "json" });
    if (!order || order.business !== business || order.id !== id)
      return reply({ error: "Test order not found." }, 404);
    return reply({ testOnly: true, status: order.status,
      paymentVerified: order.status === "test_payment_verified" &&
                       order.testPaymentVerified === true,
      deliveryEnabled: false, emailSent: false });
  } catch {
    return reply({ error: "Unable to check this order yet." }, 503);
  }
}
