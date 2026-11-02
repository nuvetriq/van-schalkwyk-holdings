/* Purchased digital-book transfer core, browser ESM with Node test support.
 *
 * Strictly one bounded <=3 MiB POST per part. No token in URL, HTTP
 * referrers, localStorage, or browser history; no full 2 GiB in memory.
 * Auth credentials are not sent to any other origin and every part is
 * validated before writing. No automatic customer delivery in this branch.
 */
export const PART_BYTES=3*1024*1024;
export const MAX_BYTES=2*1024*1024*1024;
export const ENDPOINT="/.netlify/functions/paid-book-download";
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const oneToTen=/^(0|[1-9][0-9]{0,3})$/;
function deny(){throw Error("This book download is unavailable or the link has expired.");}
export function tokenFromFragment(fragment){
  if(typeof fragment!=="string" || !fragment.startsWith("#token="))return null;
  const token=fragment.slice(7);
  return TOKEN.test(token)?token:null;
}
function numericHeader(headers,key){
  const raw=headers?.get?.(key);
  if(typeof raw!=="string" || !oneToTen.test(raw) && !/^[1-9][0-9]{0,9}$/.test(raw))deny();
  const value=Number(raw);
  if(!Number.isSafeInteger(value))deny();
  return value;
}
export async function fetchPaidBookPart(token,part,{
  transport=fetch,signal
}={}){
  if(typeof token!=="string" || !TOKEN.test(token) ||
     !Number.isSafeInteger(part) || part<0 || part>9999 ||
     typeof transport!=="function")deny();
  const response=await transport(ENDPOINT,{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+token,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({part}),
    cache:"no-store",
    credentials:"omit",
    referrerPolicy:"no-referrer",
    redirect:"error",
    mode:"same-origin",
    signal
  });
  if(!response || response.ok!==true)deny();
  if(response.headers.get("content-type")?.split(";")[0]!=="application/octet-stream")deny();
  const index=numericHeader(response.headers,"x-book-part-index");
  const count=numericHeader(response.headers,"x-book-part-count");
  const size=numericHeader(response.headers,"x-book-total-bytes");
  const length=numericHeader(response.headers,"content-length");
  if(index!==part || count<1 || count>Math.ceil(MAX_BYTES/PART_BYTES) ||
     size<8 || size>MAX_BYTES || count!==Math.ceil(size/PART_BYTES) ||
     part>=count || length<1 || length>PART_BYTES ||
     length!==Math.min(PART_BYTES,size-part*PART_BYTES))deny();
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength!==length)deny();
  if(part===0 && new TextDecoder("ascii").decode(bytes.subarray(0,5))!=="%PDF-")deny();
  if(part===count-1){
    // The server checks the final 2048 bytes. Recheck basic EOF on client.
    const last=new TextDecoder("latin1").decode(bytes.subarray(Math.max(0,bytes.length-2048)));
    if(!last.includes("%%EOF"))deny();
  }
  return {bytes,index,count,size,length};
}

/* A desktop File System Access writer is the only safe large-file option:
 * never turn >3 MiB into an in-memory Blob. The caller creates the writable
 * file in response to an actual user click, BEFORE awaiting network work.
 * For a one-part book only, a browser Blob fallback may be supplied.
 *
 * Abort/invalid bytes reject the transfer and discard partial files.
 * The same token is checked by the backend on EVERY part (expiry/refund).
 */
export async function savePaidBook(token,{
  writer=null,saveSmall=null,transport=fetch,signal,
  onProgress=()=>{}
}={}){
  if(!TOKEN.test(token||""))deny();
  if(!writer && typeof saveSmall!=="function")
    throw Error("This browser cannot save PDFs.");
  let closed=false;
  try{
    let saved=0,expectedCount=null,expectedSize=null;
    for(let index=0;;index++){
      if(signal?.aborted)throw Error("Download cancelled.");
      const part=await fetchPaidBookPart(token,index,{transport,signal});
      // A cancellation can arrive while a network request is resolving. Do
      // not write that returned part after the user has cancelled.
      if(signal?.aborted)throw Error("Download cancelled.");
      if(index===0){
        expectedCount=part.count;expectedSize=part.size;
        if(expectedCount>1 && !writer)
          throw Error("For large books, use a desktop browser that supports saving directly to disk (Chrome or Edge).");
      }else if(part.count!==expectedCount || part.size!==expectedSize){
        deny();
      }
      if(writer)await writer.write(part.bytes);
      else await saveSmall(part.bytes);
      saved+=part.length;
      onProgress({saved,total:expectedSize,part:index+1,partCount:expectedCount});
      if(index+1===expectedCount){
        if(saved!==expectedSize)deny();
        if(writer)await writer.close();
        closed=true;
        return {bytes:saved,parts:expectedCount};
      }
    }
  }catch(error){
    if(writer && !closed && typeof writer.abort==="function"){
      try{await writer.abort()}catch{/* Preserve the download error. */}
    }
    throw error;
  }
}
