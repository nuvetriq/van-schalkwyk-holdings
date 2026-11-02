/* Server-only preparation of separate brand email tasks following ONE Yoco payment.
 *
 * NOT a webhook verification endpoint or email sender. The caller must have
 * already checked the raw Yoco signature AND authenticated the checkout/order
 * lookup before passing its trusted payment confirmation.
 *
 * Job IDs are deterministic. Persist payment settlement, brand suborders,
 * and these jobs in ONE transactional database commit with unique constraints.
 * Delivery workers must never use this function as proof of payment.
 */
import {BRANDS, BRAND_EMAILS, UUID, partitionBrandSales, brandEmailPayload}
  from "./mixed-book-order.mjs";

const PAYMENT_ID=/^[A-Za-z0-9_-]{3,160}$/;
const CHECKOUT_ID=/^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/;
const STATES=new Set(["test","live"]);

function assert(condition,message) {
  if(!condition)throw Error(message);
}
function validatedMaster(master) {
  assert(master && UUID.test(master.id||""),"Invalid master order ID.");
  assert(typeof master.name==="string" && master.name.length>=2 &&
    typeof master.email==="string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(master.email),
    "Invalid order customer.");
  assert(master.currency==="ZAR" && Number.isSafeInteger(master.amountCents) &&
    master.amountCents>=100,"Invalid master order total.");
  assert(Array.isArray(master.items) && master.items.length>0 &&
    master.items.length<=20,"Invalid master order lines.");
  let total=0;
  const used=new Set();
  for(const item of master.items){
    assert(item && BRANDS.includes(item.business) && UUID.test(item.id||""),
      "Unknown brand or product.");
    assert(typeof item.title==="string" && item.title.trim().length>0 &&
      Number.isSafeInteger(item.priceCents) && item.priceCents>=100,
      "Invalid purchased book data.");
    const sku=item.business+":"+item.id.toLowerCase();
    assert(!used.has(sku),"Duplicate book licence.");
    used.add(sku);
    // Server-side snapshot already checked these files existed. This
    // additionally prevents delivering another brand's private file path.
    assert(typeof item.pdfPath==="string" &&
      item.pdfPath.startsWith(item.business+"/") &&
      /^[a-z0-9-]+\/[a-f0-9-]{36}\.(?:pdf|manifest\.json)$/i.test(item.pdfPath),
      "Private book path is outside its brand.");
    total+=item.priceCents;
  }
  assert(total===master.amountCents,"Brand sales do not reconcile with payment.");
}

export function planAfterSignedPayment(master, trustedConfirmation) {
  validatedMaster(master);
  // Verification is a prerequisite here, NOT established by a caller-controlled
  // boolean. Never expose this function directly through an unauthenticated API.
  assert(trustedConfirmation?.source==="server-verified-yoco-webhook" &&
    trustedConfirmation?.signatureVerified===true &&
    trustedConfirmation?.eventType==="payment.succeeded" &&
    trustedConfirmation?.paymentStatus==="succeeded",
    "Signed successful server-verified payment confirmation required.");
  assert(CHECKOUT_ID.test(master.checkoutId||"") &&
    trustedConfirmation.checkoutId===master.checkoutId,
    "Yoco checkout does not belong to this master order.");
  assert(PAYMENT_ID.test(trustedConfirmation.paymentId||"") &&
    PAYMENT_ID.test(trustedConfirmation.eventId||""),
    "Invalid payment or event reference.");
  assert(Number.isSafeInteger(trustedConfirmation.amountCents) &&
    trustedConfirmation.amountCents===master.amountCents &&
    trustedConfirmation.currency==="ZAR",
    "Yoco amount or currency mismatch.");
  assert(STATES.has(master.processingMode) &&
    trustedConfirmation.processingMode===master.processingMode,
    "Yoco payment mode mismatch.");

  const sales=partitionBrandSales(master);
  assert(sales.length>0 && sales.length<=BRANDS.length &&
    sales.reduce((total,sale)=>total+sale.subtotalCents,0)===master.amountCents,
    "Suborders cannot reconcile.");
  const jobs=[];
  for(const sale of sales){
    const email=brandEmailPayload(sale);
    const brand=BRAND_EMAILS[sale.business];
    assert(email.deliveryFrom===brand.sender &&
      email.salesNotificationTo===brand.salesInbox,
      "Invalid brand email routing.");
    // Brand-scoped, durable outbox job bodies: NO mixed-master line list.
    jobs.push({
      id:master.id+":"+sale.business+":customer-delivery",
      masterOrderId:master.id,
      brandOrderRef:sale.brandOrderRef,
      business:sale.business,type:"customer-delivery",status:"pending",
      sender:brand.sender,recipient:master.email,
      bookTitles:email.purchasedTitles,
      // Server-only private identifiers. Never embed raw PDF paths in an email.
      privateBookPaths:email.bookPaths,
      amountCents:sale.subtotalCents,currency:"ZAR"
    });
    jobs.push({
      id:master.id+":"+sale.business+":merchant-sale-notice",
      masterOrderId:master.id,
      brandOrderRef:sale.brandOrderRef,
      business:sale.business,type:"merchant-sale-notice",status:"pending",
      sender:brand.sender,recipient:brand.salesInbox,
      bookTitles:email.purchasedTitles,
      amountCents:sale.subtotalCents,currency:"ZAR",
      customerName:master.name,customerEmail:master.email
    });
  }

  const testOnly=master.processingMode==="test";
  return {
    masterOrderId:master.id,
    checkoutId:master.checkoutId,
    paymentId:trustedConfirmation.paymentId,
    eventId:trustedConfirmation.eventId,
    amountCents:master.amountCents,
    currency:"ZAR",
    testOnly,
    // Sandbox returns the plan for simulation only. Never enqueue test email.
    canDispatchEmails:!testOnly,
    sales,
    jobs:testOnly ? [] : jobs,
    simulatedJobs:testOnly ? jobs : []
  };
}

// Pure scoped view: for brand notifications and brand-admin views, only select
// that brand's data. It cannot return the mixed master order.
export function visibleToBusiness(plan,business){
  assert(BRANDS.includes(business),"Unknown business.");
  return {
    sales:plan.sales.filter(item=>item.business===business),
    jobs:plan.jobs.filter(item=>item.business===business),
    simulatedJobs:plan.simulatedJobs.filter(item=>item.business===business)
  };
}
