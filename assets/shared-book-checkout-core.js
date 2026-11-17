/* REVIEW-ONLY customer LIVE checkout helper; NO automatic requests.
 * The shared cart's customer checkout switch remains hardcoded OFF until a
 * separately authorised release. Browser data is NEVER proof of payment.
 * The backend independently validates all prices and PDF ownership.
 */
(function (root) {
  "use strict";
  const ENDPOINT="/api/books/live-checkout";
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CHECKOUT=/^https:\/\/c\.yoco\.com\/checkout\/[A-Za-z0-9_-]{5,150}\/?$/;
  const BRANDS=new Set(["grannys","clever-cubs"]);
  const invalid=()=>new Error("The checkout details could not be verified.");
  const unavailable=()=>new Error("Secure checkout is not available. Please try again later.");

  function prepareBuyerOrder({name,email,items}={}) {
    if(typeof name!=="string" || typeof email!=="string" ||
       !Array.isArray(items) || items.length<1 || items.length>20)throw invalid();
    const cleanName=name.trim().replace(/\s+/g," ");
    const cleanEmail=email.trim().toLowerCase();
    if(cleanName.length<2 || cleanName.length>120 ||
       /[\x00-\x1f\x7f]/.test(cleanName) ||
       cleanEmail.length<3 || cleanEmail.length>254 ||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
       /[\x00-\x1f\x7f]/.test(cleanEmail))throw invalid();
    const unique=new Set();
    const safe=[];
    for(const item of items){
      if(!item || typeof item!=="object" ||
         !BRANDS.has(item.business) ||
         typeof item.id!=="string" || !UUID.test(item.id))throw invalid();
      const key=item.business+":"+item.id.toLowerCase();
      if(unique.has(key))throw invalid();
      unique.add(key);
      safe.push({business:item.business,id:item.id.toLowerCase()});
    }
    return {name:cleanName,email:cleanEmail,items:safe};
  }

  function validateRedirectReply(data){
    if(!data || typeof data!=="object" || Array.isArray(data) ||
       typeof data.orderId!=="string" || !UUID.test(data.orderId) ||
       typeof data.redirectUrl!=="string" ||
       !CHECKOUT.test(data.redirectUrl) ||
       data.currency!=="ZAR" ||
       !Number.isSafeInteger(data.amountCents) ||
       data.amountCents<100 || data.amountCents>5_000_000 ||
       data.paymentVerified!==false)throw unavailable();
    return {orderId:data.orderId,redirectUrl:data.redirectUrl,
      amountCents:data.amountCents,currency:"ZAR",paymentVerified:false};
  }

  async function createYocoCheckout(input,{transport}={}){
    const safe=prepareBuyerOrder(input);
    if(typeof transport!=="function")throw unavailable();
    let response;
    try{
      response=await transport(ENDPOINT,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(safe),credentials:"omit",
        cache:"no-store",redirect:"error",mode:"same-origin"
      });
    }catch{throw unavailable();}
    // A network timeout / 5xx might mean the provider created a session.
    // Do NOT retry automatically; never clear the basket.
    if(response?.status!==201)throw unavailable();
    let body;
    try{body=await response.json()}catch{throw unavailable();}
    return validateRedirectReply(body);
  }

  root.VSH_BOOK_CHECKOUT_CORE=Object.freeze({
    ENDPOINT,prepareBuyerOrder,validateRedirectReply,createYocoCheckout
  });
})(typeof window!=="undefined"?window:globalThis);
