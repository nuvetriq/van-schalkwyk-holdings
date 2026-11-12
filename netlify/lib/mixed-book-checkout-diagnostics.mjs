/* Fixed, non-sensitive diagnostic categories for the admin-only Yoco TEST flow.
 * Never store the underlying error, raw provider responses, keys, URLs,
 * customer details, or PDF paths in these objects or in Netlify logs.
 * Diagnostics do not relax validation, retry failed requests, or expose data.
 */
const codes=new Set([
  "dependencies_invalid",
  "catalogue_snapshot_failed",
  "pending_order_write_failed",
  "pending_order_confirmation_invalid",
  "yoco_request_unexpected",
  "yoco_transport_invalid",
  "yoco_network_failed",
  "yoco_http_rejected",
  "yoco_response_too_large",
  "yoco_response_json_invalid",
  "yoco_response_id_invalid",
  "yoco_response_status_invalid",
  "yoco_response_amount_invalid",
  "yoco_response_mode_invalid",
  "yoco_response_reference_invalid",
  "yoco_response_redirect_invalid",
  "checkout_binding_failed",
  "checkout_binding_confirmation_invalid",
  "internal_unclassified"
]);

function safeStatus(status){
  return Number.isInteger(status) && status>=400 && status<=599 ? status : null;
}

export class CheckoutDiagnosticError extends Error {
  constructor(code,httpStatus=null){
    super("Yoco TEST checkout could not be prepared.");
    this.name="CheckoutDiagnosticError";
    this.code=codes.has(code)?code:"internal_unclassified";
    this.httpStatus=safeStatus(httpStatus);
  }
}

export function checkoutDiagnostic(code,httpStatus=null){
  return new CheckoutDiagnosticError(code,httpStatus);
}
export function safeCheckoutDiagnostic(error){
  if(!(error instanceof CheckoutDiagnosticError))
    return Object.freeze({code:"internal_unclassified"});
  return Object.freeze(error.httpStatus===null ?
    {code:error.code} : {code:error.code,httpStatus:error.httpStatus});
}
