import crypto from "node:crypto";
import { openVSHStore } from "./catalogue-store.mjs";

// PRIVATE helper only; link issuance is NOT exposed through a public HTTP route.
// Trusted, verified Yoco order processing will call issuePaidBookLink later.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS=new Set(["grannys","clever-cubs"]);
const MAX_AGE_SECONDS=72*60*60;
const defaultAge=24*60*60;
const maxBytes=2*1024*1024*1024;
const partBytes=3*1024*1024;
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString("base64url");
const failed=()=>new Error("This private book link is invalid or has expired.");
const secret=()=>{
  const s=process.env.VSH_BOOK_LINK_SECRET||"";
  if(s.length<48)throw new Error("Private download signing key is not configured.");
  return s;
};
function orderKey(business,id){
  if(!BUSINESS.has(business)||!UUID.test(id))throw failed();
  return "orders/"+business+"/"+id+".json";
}
function pathAllowed(path,business){
  const escaped=business.replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&");
  return typeof path==="string" &&
    new RegExp("^"+escaped+"/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:manifest\\.json|pdf)$","i").test(path);
}
async function getPaidOrderItem(business,orderId,bookId){
  const order=await openVSHStore("vsh-book-orders").get(orderKey(business,orderId),{type:"json"});
  if(!order || order.business!==business || order.id!==orderId ||
    order.status!=="paid" || order.paymentVerified!==true ||
    order.paymentProvider!=="yoco" || order.currency!=="ZAR" ||
    !Number.isSafeInteger(order.amount)||order.amount<=0 ||
    !Array.isArray(order.items)||order.items.length<1)return null;
  const matches=order.items.filter(item=>item.id===bookId);
  if(matches.length!==1)return null;
  const item=matches[0];
  if(!pathAllowed(item.pdfPath,business) || !Number.isSafeInteger(item.priceCents) ||
     item.priceCents<100 || !String(item.title||"").trim())return null;
  return {order,item};
}
function assertToken(value){
  if(typeof value!=="string" || value.length>2048 || value.length<40)throw failed();
  const [header,sig,...rest]=value.split(".");
  if(rest.length || !header || !sig)return failedToken();
  let expected;
  const signature=crypto.createHmac("sha256",secret()).update(header).digest();
  try{expected=Buffer.from(sig,"base64url")}catch{throw failed()}
  if(expected.length!==signature.length || !crypto.timingSafeEqual(expected,signature))throw failed();
  let data;
  try{data=JSON.parse(Buffer.from(header,"base64url").toString("utf8"))}catch{throw failed()}
  const now=Math.floor(Date.now()/1000);
  if(data.v!==1 || !BUSINESS.has(data.b) || !UUID.test(data.o||"") ||
    !UUID.test(data.i||"") || !UUID.test(data.n||"") ||
    !Number.isSafeInteger(data.exp) || data.exp<=now ||
    data.exp>now+MAX_AGE_SECONDS ||
    !Number.isSafeInteger(data.iat)||data.iat>now+60 ||
    data.exp-data.iat>MAX_AGE_SECONDS)throw failed();
  return data;
}
function failedToken(){throw failed()}
export async function issuePaidBookLink({business,orderId,bookId,origin,ttlSeconds=defaultAge}){
  if(process.env.VSH_ENABLE_PAYMENTS!=="true"||process.env.CONTEXT!=="production")
    throw new Error("Verified paid-book fulfillment is not enabled.");
  if(!Number.isSafeInteger(ttlSeconds) || ttlSeconds<60 || ttlSeconds>MAX_AGE_SECONDS)
    throw new Error("Invalid private download link lifetime.");
  const originURL=new URL(origin);
  if(originURL.protocol!=="https:" || originURL.pathname!=="/" ||
     originURL.search || originURL.hash)throw new Error("Secure site origin required.");
  const validated=await getPaidOrderItem(business,orderId,bookId);
  if(!validated)throw new Error("No verified paid order for that book.");
  const now=Math.floor(Date.now()/1000);
  const encoded=b64({v:1,b:business,o:orderId,i:bookId,
    iat:now,exp:now+ttlSeconds,n:crypto.randomUUID()});
  const sig=crypto.createHmac("sha256",secret()).update(encoded).digest("base64url");
  return originURL.origin+"/book-download.html?token="+encodeURIComponent(encoded+"."+sig);
}
export async function authorizePaidBookToken(token){
  const claims=assertToken(token);
  const result=await getPaidOrderItem(claims.b,claims.o,claims.i);
  if(!result)throw failed();
  const item=result.item;
  const path=item.pdfPath;
  const fileStore=openVSHStore("vsh-private-recipe-pdfs");
  let file;
  if(path.endsWith(".manifest.json")){
    const manifest=await fileStore.get(path,{type:"json"});
    if(manifest?.version!==1 || manifest.kind!=="chunked-pdf" ||
       manifest.business!==claims.b || !UUID.test(manifest.id||"") ||
       manifest.id!==path.slice(claims.b.length+1,claims.b.length+37) ||
       manifest.part_bytes!==partBytes ||
       !Number.isSafeInteger(manifest.size_bytes) ||
       manifest.size_bytes<8 || manifest.size_bytes>maxBytes ||
       manifest.part_count!==Math.ceil(manifest.size_bytes/partBytes)){
      throw failed();
    }
    file={kind:"chunked",parts:manifest.part_count,
      size:manifest.size_bytes,id:manifest.id,part_bytes:partBytes};
  }else{
    const meta=await fileStore.getMetadata(path);
    if(!meta)throw failed();
    // Legacy small uploads are still served only via this authenticated route.
    file={kind:"legacy",parts:1,size:Number(meta.size)||0,id:null,part_bytes:0};
  }
  const original=String(item.title||"").replace(/[^a-z0-9 _.-]/gi," ").trim().slice(0,90);
  const filename=(original || "Digital-Book")+".pdf";
  return {...claims,business:claims.b,orderId:claims.o,bookId:claims.i,
    title:item.title,filename,path,file};
}
export async function reserveDownloadPart(claims,bytes){
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>partBytes)throw failed();
  const store=openVSHStore("vsh-book-download-usage");
  const key="tickets/"+claims.business+"/"+claims.o+"/"+claims.i+"/"+
    crypto.createHash("sha256").update(claims.n).digest("hex")+".json";
  // Limit bearer-link abuse: at most three entire downloads per issued ticket.
  // Conditional writes make parallel part requests safe.
  const cap=Math.max(claims.file.size||0,1)*3;
  for(let attempt=0;attempt<12;attempt++){
    const old=await store.getWithMetadata(key,{type:"json"});
    const current=Number(old?.data?.bytes||0);
    if(!Number.isSafeInteger(current)||current+bytes>cap)throw new Error("Download limit reached. Please request a new link.");
    const next={bytes:current+bytes,expires_at:new Date(claims.exp*1000).toISOString()};
    const done=await store.setJSON(key,next,old
      ? {onlyIfMatch:old.etag}
      : {onlyIfNew:true});
    if(done.modified)return;
  }
  throw new Error("Download busy. Please try again.");
}
