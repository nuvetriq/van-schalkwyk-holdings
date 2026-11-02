/* Pure, server-only contract for ONE future Yoco checkout containing books from
   Granny's and CleverCubs Learning. No payment, email or storage writes here.
   Never calculate charge amounts from browser/cart-supplied price fields. */
import crypto from "node:crypto";

export const BRANDS = Object.freeze(["grannys", "clever-cubs"]);
// Public mailbox identities only. Credentials stay exclusively in Netlify.
export const BRAND_EMAILS = Object.freeze({
  grannys:Object.freeze({
    name:"Granny's",sender:"grannyspopsandtreats@gmail.com",
    salesInbox:"grannyspopsandtreats@gmail.com"
  }),
  "clever-cubs":Object.freeze({
    name:"CleverCubs Learning",sender:"learningclevercubs@gmail.com",
    salesInbox:"learningclevercubs@gmail.com"
  })
});
export const BOOK_LIMIT = 20;
export const MAX_CENTS = 5_000_000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PART_BYTES = 3 * 1024 * 1024;
const pdfPattern = brand => new RegExp("^" + brand +
  "/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:pdf|manifest\\.json)$","i");

export function centsFromStoredPrice(value) {
  if(value === null || typeof value==="boolean" || value === "" ||
     !Number.isFinite(Number(value)) || Number(value)<1)return null;
  const raw=Number(value)*100, cents=Math.round(raw);
  return Number.isSafeInteger(cents) && cents<=MAX_CENTS && Math.abs(raw-cents)<0.000001
    ? cents:null;
}
export function validateMixedCheckout(input) {
  if(!input || typeof input!=="object" || !Array.isArray(input.items) ||
    input.items.length<1 || input.items.length>BOOK_LIMIT)
    throw Error("Choose between 1 and 20 digital books.");
  const items=[], seen=new Set();
  for(const entry of input.items) {
    if(!entry || typeof entry!=="object" ||
       !BRANDS.includes(entry.business) ||
       typeof entry.id!=="string" || !UUID.test(entry.id))
      throw Error("Invalid digital book selection.");
    // Quantity is one per digital licence; duplicate lines must be rejected.
    const id=entry.id.toLowerCase(),sku=entry.business+":"+id;
    if(seen.has(sku))throw Error("The same book was selected more than once.");
    seen.add(sku);items.push({business:entry.business,id});
  }
  const name=String(input.name||"").trim(),email=String(input.email||"").trim().toLowerCase();
  if(name.length<2 || name.length>120 || /[\r\n]/.test(name) ||
     email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error("Enter a customer name and valid email.");
  return {name,email,items};
}
export function validBookRecord(product,business,id) {
  return product && product.business===business && product.id?.toLowerCase()===id &&
    product.is_active===true && String(product.title||"").trim() &&
    pdfPattern(business).test(product.pdf_path||"") &&
    centsFromStoredPrice(product.price)!==null &&
    (business!=="grannys" || /^recipe books?$/i.test(String(product.category||"").trim()));
}
export function validPrivateFile(business,pdfPath,meta,manifest) {
  if(!pdfPattern(business).test(pdfPath||"") || !meta)return false;
  if(!pdfPath.endsWith(".manifest.json"))return true;
  return manifest && manifest.kind==="chunked-pdf" && manifest.version===1 &&
    manifest.business===business && Number.isSafeInteger(manifest.size_bytes) &&
    manifest.size_bytes>=8 && Number.isInteger(manifest.part_count) &&
    manifest.part_count>0 && manifest.part_bytes===PART_BYTES &&
    manifest.part_count===Math.ceil(manifest.size_bytes/PART_BYTES);
}
export function partitionBrandSales(master) {
  if(!master || !UUID.test(master.id||"") || !Array.isArray(master.items))
    throw Error("Invalid master order.");
  const sales=[];
  for(const business of BRANDS) {
    const lines=master.items.filter(x=>x.business===business);
    if(!lines.length)continue;
    const subtotalCents=lines.reduce((sum,x)=>sum+x.priceCents,0);
    sales.push({
      business,
      brandOrderRef:master.id+":"+business,
      masterOrderId:master.id,
      customer:{name:master.name,email:master.email},
      items:lines.map(x=>({
        id:x.id,title:x.title,priceCents:x.priceCents,pdfPath:x.pdfPath
      })),
      subtotalCents,currency:"ZAR"
    });
  }
  return sales;
}
export async function snapshotMixedOrder(input,dependencies) {
  if(!dependencies || typeof dependencies.getProduct!=="function" ||
    typeof dependencies.getPrivateFile!=="function")
    throw Error("Bookshop server dependencies are missing.");
  const {name,email,items}=validateMixedCheckout(input);
  const lines=await Promise.all(items.map(async ({business,id})=>{
    // This lookup MUST use an authenticated server-side catalogue, not public
    // browser price/title/PDF data supplied with the cart.
    const product=await dependencies.getProduct(business,id);
    if(!validBookRecord(product,business,id))
      throw Error("A selected book is no longer available.");
    const ready=await dependencies.getPrivateFile(business,product.pdf_path);
    if(!validPrivateFile(business,product.pdf_path,ready?.metadata,ready?.manifest))
      throw Error("A selected book does not have a complete private PDF.");
    return {business,id,title:String(product.title).slice(0,120),
      priceCents:centsFromStoredPrice(product.price),pdfPath:product.pdf_path};
  }));
  const amountCents=lines.reduce((sum,line)=>sum+line.priceCents,0);
  if(!Number.isSafeInteger(amountCents) || amountCents<100 || amountCents>MAX_CENTS)
    throw Error("Invalid combined total.");
  const master={id:crypto.randomUUID(),name,email,items:lines,
    amountCents,currency:"ZAR",paymentProvider:"yoco"};
  const sales=partitionBrandSales(master);
  if(sales.reduce((sum,s)=>sum+s.subtotalCents,0)!==amountCents)
    throw Error("Brand subtotal reconciliation failed.");
  return {master,sales};
}

/* Brand-only email records: one delivery and one owner notification per brand
   after VERIFIED payment. This function sends nothing. All internal routing
   uses the brand, never the mixed master line list. */
export function brandEmailPayload(sale) {
  if(!BRANDS.includes(sale?.business)||!Array.isArray(sale.items))
    throw Error("Unknown brand sale.");
  const titles=sale.items.map(item=>String(item.title).slice(0,120));
  return {
    business:sale.business,brandOrderRef:sale.brandOrderRef,
    deliveryFrom:BRAND_EMAILS[sale.business].sender,
    salesNotificationTo:BRAND_EMAILS[sale.business].salesInbox,
    customerEmail:sale.customer.email,customerName:sale.customer.name,
    purchasedTitles:titles,brandSubtotalCents:sale.subtotalCents,
    bookPaths:sale.items.map(item=>item.pdfPath)
  };
}
