/* Server-only LIVE order orchestration, intentionally unconnected to any
 * Netlify Function. This module cannot enable public checkout on its own.
 * Durable pending order -> provider checkout -> durable binding.
 * A provider response never marks an order paid or grants book downloads.
 */
import {snapshotMixedOrder} from "./mixed-book-order.mjs";
import {requestMixedYocoLiveCheckout} from "./mixed-book-yoco-live-checkout.mjs";
import {CheckoutDiagnosticError,checkoutDiagnostic} from "./mixed-book-checkout-diagnostics.mjs";

export async function prepareMixedBookLiveCheckout(input,{
  enabled=false,operatorApproved=false,
  catalogue,ledger,secretKey,postCheckout
}={}){
  if(enabled!==true || operatorApproved!==true)
    throw checkoutDiagnostic("dependencies_invalid");
  if(!catalogue || typeof catalogue.getProduct!=="function" ||
     typeof catalogue.getPrivateFile!=="function" ||
     !ledger || typeof ledger.createPendingOrder!=="function" ||
     typeof ledger.bindYocoCheckout!=="function" ||
     typeof postCheckout!=="function")
    throw checkoutDiagnostic("dependencies_invalid");

  let master;
  try {({master}=await snapshotMixedOrder(input,catalogue))}
  catch {throw checkoutDiagnostic("catalogue_snapshot_failed");}

  let pending;
  try {pending=await ledger.createPendingOrder(master,"live")}
  catch {throw checkoutDiagnostic("pending_order_write_failed");}
  if(pending?.orderId!==master.id || pending.mode!=="live" ||
     pending.status!=="checkout_pending")
    throw checkoutDiagnostic("pending_order_confirmation_invalid");

  let checkout;
  try {
    checkout=await requestMixedYocoLiveCheckout(master,{
      enabled:true,secretKey,postCheckout
    });
  } catch(error) {
    if(error instanceof CheckoutDiagnosticError)throw error;
    throw checkoutDiagnostic("yoco_request_unexpected");
  }
  let bound;
  try {
    bound=await ledger.bindYocoCheckout({
      orderId:master.id,checkoutId:checkout.checkoutId,
      amountCents:master.amountCents,processingMode:"live"
    });
  } catch {throw checkoutDiagnostic("checkout_binding_failed");}
  if(bound?.orderId!==master.id || bound.checkoutId!==checkout.checkoutId)
    throw checkoutDiagnostic("checkout_binding_confirmation_invalid");
  return {
    orderId:master.id,checkoutId:checkout.checkoutId,
    redirectUrl:checkout.redirectUrl,
    amountCents:checkout.amountCents,currency:"ZAR",
    processingMode:"live",paymentVerified:false
  };
}
