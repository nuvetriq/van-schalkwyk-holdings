/* Admin-controlled test-order orchestration, all calls injected for testing.
 * Pending order is saved BEFORE calling Yoco. Redirect is released ONLY AFTER
 * the provider checkout is durably bound to the stored master order.
 * A failed/mismatched provider call leaves an unpaid pending test order.
 *
 * No email sending, paid PDF grants, real Yoco money or customer checkout here.
 */
import {snapshotMixedOrder} from "./mixed-book-order.mjs";
import {requestMixedYocoTestCheckout} from "./mixed-book-yoco-test-checkout.mjs";

export async function createMixedBookTestCheckout(input,{
  catalogue,ledger,secretKey,postCheckout
}={}){
  if(!catalogue || typeof catalogue.getProduct!=="function" ||
    typeof catalogue.getPrivateFile!=="function" ||
    !ledger || typeof ledger.createPendingOrder!=="function" ||
    typeof ledger.bindYocoCheckout!=="function" ||
    typeof postCheckout!=="function")
    throw Error("Test-only checkout dependencies are unavailable.");

  const {master}=await snapshotMixedOrder(input,catalogue);
  const pending=await ledger.createPendingOrder(master,"test");
  if(pending?.orderId!==master.id || pending.status!=="checkout_pending" ||
    pending.mode!=="test")
    throw Error("Test checkout was not durably recorded.");

  const checkout=await requestMixedYocoTestCheckout(master,{
    enabled:true,secretKey,postCheckout
  });
  const bound=await ledger.bindYocoCheckout({
    orderId:master.id,
    checkoutId:checkout.checkoutId,
    amountCents:master.amountCents,
    processingMode:"test"
  });
  if(bound?.orderId!==master.id || bound.checkoutId!==checkout.checkoutId)
    throw Error("Yoco test checkout was not bound to the pending order.");
  return {
    orderId:master.id,
    checkoutId:checkout.checkoutId,
    redirectUrl:checkout.redirectUrl,
    amountCents:checkout.amountCents,
    currency:"ZAR",processingMode:"test",
    emailsSent:0,pdfsDelivered:0
  };
}

/* The only permitted HTTP transport sends directly to Yoco from the server.
 * Limit outgoing response size, redact details from errors, never leak token.
 */
export async function postYocoTestCheckout({
  url,headers,body
},{transport=fetch}={}){
  if(url!=="https://payments.yoco.com/api/checkouts" ||
    !headers || typeof headers.Authorization!=="string" ||
    !headers.Authorization.startsWith("Bearer sk_test_") ||
    typeof body!=="string" || Buffer.byteLength(body)>8192 ||
    typeof transport!=="function")
    throw Error("Invalid Yoco TEST transport request.");
  const res=await transport(url,{
    method:"POST",
    headers,
    body,
    signal:AbortSignal.timeout(12_000),
    redirect:"error"
  });
  if(!res || res.ok!==true)
    throw Error("Yoco TEST checkout service is unavailable.");
  const len=Number(res.headers?.get?.("content-length"));
  if(Number.isFinite(len) && len>32_768)
    throw Error("Unexpected Yoco TEST response size.");
  // External data remains untrusted; validation happens before binding.
  const raw=await res.text();
  if(raw.length>32_768)
    throw Error("Unexpected Yoco TEST response size.");
  let data;
  try {data=JSON.parse(raw);}catch{
    throw Error("Invalid Yoco TEST checkout response.");
  }
  return {ok:true,data};
}
