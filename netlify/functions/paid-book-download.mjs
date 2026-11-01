/* Private, per-part purchased-book endpoint. UNDEPLOYED & disabled by default.
 *
 * The bearer download token grants access only when its SHA-256 hash matches
 * an unexpired, non-revoked grant for this exact product in a verified
 * PAID LIVE master order; access is checked on EVERY request.
 *
 * Each response contains ONE verified part <= 3 MiB (never a 2 GiB PDF).
 * A future same-origin browser download UI must assemble parts incrementally;
 * this Function alone is NOT a working full-size browser download.
 * Signed Yoco TEST orders never receive valid grants.
 */
import {readAuthorizedPaidBookPart} from "../lib/mixed-book-paid-pdf-reader.mjs";
import {createMixedBookServices} from "../lib/mixed-book-db-service.mjs";
import {createMixedBookPrivatePdfStore} from "../lib/mixed-book-private-blob-store.mjs";
import {PDF_PART_BYTES} from "../lib/mixed-book-private-pdf-parts.mjs";

const ORIGIN="https://vanschalkwykholdings.com";
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const safeHeaders={
  "Cache-Control":"private, no-store",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "Cross-Origin-Resource-Policy":"same-origin",
  "X-Frame-Options":"DENY"
};
const reply=(value,status)=>Response.json(value,{status,headers:safeHeaders});
function enabled(request,context,env){
  try{
    const url=new URL(request.url);
    return url.origin===ORIGIN &&
      context?.deploy?.context==="production" &&
      env.VSH_MIXED_BOOK_DB_ENABLED==="true" &&
      env.VSH_MIXED_BOOK_DOWNLOADS_ENABLED==="true";
  }catch{return false}
}
function parseSelection(request) {
  const url=new URL(request.url);
  if([...url.searchParams.keys()].some(key=>!["token","part"].includes(key)) ||
    url.searchParams.getAll("token").length!==1 ||
    url.searchParams.getAll("part").length>1)
    return null;
  const token=url.searchParams.get("token");
  const part=url.searchParams.get("part");
  if(!TOKEN.test(token||"") || (part!==null && !/^(0|[1-9][0-9]{0,3})$/.test(part)))
    return null;
  const index=part===null?0:Number(part);
  if(!Number.isSafeInteger(index)||index<0||index>9999)return null;
  return {token,index};
}
export function makePaidBookDownloadHandler({
  env=process.env,
  databaseFactory=createMixedBookServices,
  blobFactory=createMixedBookPrivatePdfStore,
  readPart=readAuthorizedPaidBookPart,
  now=()=>new Date()
}={}){
  return async function handler(request,context){
    if(request.method!=="GET")return reply({error:"Method not allowed."},405);
    if(!enabled(request,context,env))
      return reply({error:"Book downloads are not available."},503);
    const selection=parseSelection(request);
    if(!selection)return reply({error:"Book download unavailable."},404);
    try{
      const db=databaseFactory({context});
      const pdfStore=blobFactory();
      const result=await readPart({
        ...selection,
        grantStore:db.grantStore,orderStore:db.orderStore,
        pdfStore,now:now()
      });
      if(!result || !(result.bytes instanceof Uint8Array) ||
        !Number.isSafeInteger(result.partBytes) ||
        result.partBytes!==result.bytes.byteLength ||
        result.partBytes<1 || result.partBytes>PDF_PART_BYTES ||
        !Number.isSafeInteger(result.partIndex) ||
        result.partIndex!==selection.index ||
        !Number.isSafeInteger(result.partCount) ||
        result.partCount<1 || result.partIndex>=result.partCount ||
        !Number.isSafeInteger(result.sizeBytes) ||
        result.sizeBytes<result.partBytes ||
        result.contentType!=="application/octet-stream")
        throw Error("Unexpected private download response.");
      // ReadableStream opts in to Netlify streaming response limits (20 MiB);
      // send only one <=3 MiB part. No public Blob key or private PDF path.
      const body=new ReadableStream({
        start(controller){
          controller.enqueue(result.bytes);
          controller.close();
        }
      });
      return new Response(body,{
        status:200,
        headers:{
          ...safeHeaders,
          "Content-Type":"application/octet-stream",
          "Content-Length":String(result.partBytes),
          "X-Book-Part-Index":String(result.partIndex),
          "X-Book-Part-Count":String(result.partCount),
          "X-Book-Total-Bytes":String(result.sizeBytes)
        }
      });
    }catch(error){
      // A missing grant/expired token should look identical to a revoked
      // token. System or storage errors remain retryable (503), fail closed.
      const invalid=error?.message==="This private book download is unavailable.";
      console.error("Paid book part unavailable",invalid?"Unavailable":error?.name||"Error");
      return reply({error:"Book download unavailable."},invalid?404:503);
    }
  };
}
export default makePaidBookDownloadHandler();
export const config={
  method:"GET",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:120}
};
