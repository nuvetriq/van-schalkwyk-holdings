import { openVSHStore } from "./catalogue-store.mjs";

export const SITE = "https://vanschalkwykholdings.com";
export const PURPOSE = "vsh-production-sandbox";
export const AMOUNT = 1000; // R10.00 in cents, never user controlled
export const CURRENCY = "ZAR";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHECKOUT_ID = /^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/;

export const orders = () => openVSHStore("vsh-production-yoco-sandbox-orders");
export const checkouts = () => openVSHStore("vsh-production-yoco-sandbox-checkouts");
export const orderKey = id => "order/" + id + ".json";
export const checkoutKey = id => "checkout/" + id + ".json";

export const json = (data, status=200) => Response.json(data, {status,
  headers: {"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer"}});
export function sandboxEnabled(request, context) {
  try {
    const url = new URL(request.url);
    return context?.deploy?.context === "production" &&
      process.env.CONTEXT === "production" &&
      url.origin === SITE &&
      process.env.VSH_YOCO_SANDBOX_ENABLED === "true" &&
      /^sk_test_[A-Za-z0-9_-]+$/.test(process.env.VSH_YOCO_SANDBOX_TEST_KEY || "") &&
      (process.env.VSH_YOCO_SANDBOX_WEBHOOK_SECRET || "").startsWith("whsec_");
  } catch { return false; }
}
export const disabled = () => json({error:"The production-domain Yoco sandbox is disabled."},503);
