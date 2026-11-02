/* Strictly brand-scoped email composition for shared checkout.
 * Pure function: sends NOTHING and does not access customer orders/PDFs.
 * Input job/sale must be loaded via server-side permissions; customer links
 * must have been issued + committed to a real paid order beforehand.
 *
 * A master combined receipt is separate; these are BRAND delivery and sale
 * notifications, never an extra Yoco charge or an extra payment receipt.
 */
import {BRAND_EMAILS,BRANDS} from "./mixed-book-order.mjs";

const urlOrigin="https://vanschalkwykholdings.com";
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const clean=(v,max=150)=>String(v??"").replace(/[\r\n]+/g," ").trim().slice(0,max);
const html=v=>String(v).replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);
const money=cents=>"R"+(cents/100).toFixed(2);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function requireSale(job,sale) {
  if(!job || !sale || !BRANDS.includes(job.business) ||
     job.business!==sale.business ||
     job.masterOrderId!==sale.masterOrderId ||
     job.brandOrderRef!==sale.brandOrderRef ||
     !["customer-delivery","merchant-sale-notice"].includes(job.type) ||
     job.id!==job.masterOrderId+":"+job.business+":"+job.type ||
     job.status!=="claimed" ||
     !Array.isArray(sale.items) || !sale.items.length ||
     !Number.isSafeInteger(sale.subtotalCents) ||
     sale.subtotalCents<100 || job.amountCents!==sale.subtotalCents ||
     job.currency!=="ZAR" || sale.currency!=="ZAR")
    throw Error("Invalid brand-scoped email task.");
  const brand=BRAND_EMAILS[job.business];
  if(job.sender!==brand.sender)throw Error("Email sender does not match the brand.");
  if(!sale.customer || typeof sale.customer.email!=="string" ||
     !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sale.customer.email))
    throw Error("Missing customer email.");
  const titles=sale.items.map(x=>x.title);
  if(!equal(job.bookTitles,titles))throw Error("Outbox titles do not match brand sale.");
  if(sale.items.some(line=>!line.pdfPath?.startsWith(job.business+"/")))
    throw Error("Private PDF belongs to another business.");
  if(job.type==="customer-delivery"){
    if(job.recipient!==sale.customer.email ||
       !equal(job.privateBookPaths,sale.items.map(x=>x.pdfPath)))
      throw Error("Customer delivery does not match purchased PDFs.");
  }else if(job.recipient!==brand.salesInbox ||
    "privateBookPaths" in job || job.customerEmail!==sale.customer.email ||
    job.customerName!==sale.customer.name) {
    throw Error("Merchant notice is not strictly brand scoped.");
  }
  return brand;
}
function validPaidDownloadLink(link,id) {
  if(!link || link.id!==id || typeof link.url!=="string")return false;
  try {
    const url=new URL(link.url);
    const token=url.hash.startsWith("#token=")?url.hash.slice(7):"";
    return url.origin===urlOrigin &&
      url.pathname==="/book-download.html" &&
      url.search==="" && TOKEN.test(token) &&
      url.hash==="#token="+token &&
      !url.username && !url.password;
  }catch{return false}
}

export function composeMixedBookBrandEmail({job,sale,downloadLinks=[]}) {
  const brand=requireSale(job,sale);
  const title=brand.name;
  const books=sale.items.map(item=>clean(item.title,120));
  const summary=books.map(book=>"• "+book).join("\n");
  let subject,body,items;
  if(job.type==="customer-delivery"){
    if(!Array.isArray(downloadLinks) || downloadLinks.length!==sale.items.length ||
      !downloadLinks.every((link,i)=>validPaidDownloadLink(link,sale.items[i].id)) ||
      new Set(downloadLinks.map(x=>x.url)).size!==downloadLinks.length)
      throw Error("Committed paid-book download links required for all purchased books.");
    items=books.map((book,i)=>({book,url:downloadLinks[i].url}));
    subject="Your "+title+" digital books";
    body="Hello "+clean(sale.customer.name,120)+",\n\n"+
      "Thank you for purchasing digital books from "+title+".\n\n"+
      items.map(x=>x.book+"\nDownload: "+x.url).join("\n\n")+
      "\n\nBrand subtotal: "+money(sale.subtotalCents)+
      "\nThese private links expire. This is not an additional payment receipt."+
      "\n\n"+title;
  }else{
    if(downloadLinks.length)throw Error("Do not include download links in merchant notifications.");
    subject="New digital-book sale — "+title;
    body="New sale for "+title+"\n\n"+
      "Brand order: "+clean(sale.brandOrderRef,120)+"\n"+
      "Customer: "+clean(sale.customer.name,120)+"\n"+
      "Email: "+clean(sale.customer.email,254)+"\n\n"+
      summary+"\n\nBrand subtotal: "+money(sale.subtotalCents)+
      "\nOne shared Yoco checkout may include another brand, but only this brand's items appear here.";
    items=books.map(book=>({book}));
  }
  const htmlBody="<div style=\"font-family:Arial,sans-serif;color:#17314b\">"+
    "<h2>"+html(subject)+"</h2>"+
    "<p>"+(job.type==="customer-delivery" ?
      "Thanks for your order. Your private download links are below." :
      "A digital-book sale was recorded for this business.")+"</p>"+
    "<ul>"+items.map(entry=>"<li><strong>"+html(entry.book)+"</strong>"+
      (entry.url?" — <a href=\""+html(entry.url)+"\">Download</a>":"")+
      "</li>").join("")+"</ul>"+
    "<p><strong>Brand subtotal:</strong> "+html(money(sale.subtotalCents))+"</p>"+
    "<p>"+(job.type==="customer-delivery" ?
      "Private links expire. This is not a separate payment receipt." :
      "Only this business's books are listed.")+"</p></div>";
  return {
    from:brand.name+" <"+brand.sender+">",
    to:job.recipient,subject,text:body,html:htmlBody,
    // Never return raw private storage paths or other brand records.
    brand:job.business,
    idempotencyKey:job.id
  };
}
