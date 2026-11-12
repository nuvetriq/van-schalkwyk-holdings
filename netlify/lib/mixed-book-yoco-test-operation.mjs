/* Admin-controlled test-order orchestration, all calls injected for testing.
 * Pending order is saved BEFORE calling Yoco. Redirect is released ONLY AFTER
 * the provider checkout is durably bound to the stored master order.
 * A failed/mismatched provider call leaves an unpaid pending test order.
 *
 * No email sending, paid PDF grants, real Yoco money or customer checkout here.
 */
import {snapshotMixedOrder} from "./mixed-book-order.mjs";
import {requestMixedYocoTestCheckout} from "./mixed-book-yoco-test-checkout.mjs";
import {CheckoutDiagnosticError,checkoutDiagnostic} from "./mixed-book-checkout-diagnostics.mjs";

export async function createMixedBookTestCheckout(input,{
  catalogue,ledger,secretKey,postCheckout
}={}){
  if(!catalogue || typeof catalogue.getProduct!=="function" ||
    typeof catalogue.getPrivateFile!=="function" ||
    !ledger || typeof ledger.createPendingOrder!=="function" ||
    typeof ledger.bindYocoCheckout!=="function" ||
    typeof postCheckout!=="function")
    throw checkoutDiagnostic("dependencies_invalid");

  let master;
  try {
    ({master}=await snapshotMixedOrder(input,catalogue));
  } catch {
    throw checkoutDiagnostic("catalogue_snapshot_failed");
  }
  let pending;
  try {
    pending=await ledger.createPendingOrder(master,"test");
  } catch {
    throw checkoutDiagnostic("pending_order_write_failed");
  }
  if(pending?.orderId!==master.id || pending.status!=="checkout_pending" ||
    pending.mode!=="test")
    throw checkoutDiagnostic("pending_order_confirmation_invalid");

  let checkout;
  try {
    checkout=await requestMixedYocoTestCheckout(master,{
      enabled:true,secretKey,postCheckout
    });
  } catch(error) {
    // Only carry forward our own allowlisted, secret-free codes.
    if(error instanceof CheckoutDiagnosticError)throw error;
    throw checkoutDiagnostic("yoco_request_unexpected");
  }
  let bound;
  try {
    bound=await ledger.bindYocoCheckout({
      orderId:master.id,
      checkoutId:checkout.checkoutId,
      amountCents:master.amountCents,
      processingMode:"test"
    });
  } catch {
    throw checkoutDiagnostic("checkout_binding_failed");
  }
  if(bound?.orderId!==master.id || bound.checkoutId!==checkout.checkoutId)
    throw checkoutDiagnostic("checkout_binding_confirmation_invalid");
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
    throw checkoutDiagnostic("yoco_transport_invalid");
  let res;
  try {
    res=await transport(url,{
      method:"POST",
      headers,
      body,
      signal:AbortSignal.timeout(12_000),
      redirect:"error"
    });
  } catch {
    // Never log a fetch exception: some transports include request metadata.
    throw checkoutDiagnostic("yoco_network_failed");
  }
  if(!res || res.ok!==true)
    throw checkoutDiagnostic("yoco_http_rejected",res?.status);
  const len=Number(res.headers?.get?.("content-length"));
  if(Number.isFinite(len) && len>32_768)
    throw checkoutDiagnostic("yoco_response_too_large");
  // External data remains untrusted; validation happens before binding.
  const raw=await res.text();
  if(raw.length>32_768)
    throw checkoutDiagnostic("yoco_response_too_large");
  let data;
  try {data=JSON.parse(raw);}catch{
    throw checkoutDiagnostic("yoco_response_json_invalid");
  }
  return {ok:true,data};
}
