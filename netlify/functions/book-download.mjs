import { openVSHStore } from "../lib/catalogue-store.mjs";
import { authorizePaidBookToken, reserveDownloadPart } from "../lib/book-link-auth.mjs";

// Each request is independently authorised against a signed expiring token
// AND a paid order stored by the future verified-payment processor.
// No admin keys, PDF store paths, or customer email addresses reach the client.
const bad=()=>Response.json({error:"This private download link is invalid or has expired."},
  {status:403,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});
const responseHeaders={
  "Cache-Control":"private, no-store, max-age=0",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'",
  "Cross-Origin-Resource-Policy":"same-origin"
};
export default async function handler(request) {
  if(request.method!=="GET")return new Response("Method not allowed.",{status:405,headers:responseHeaders});
  const url=new URL(request.url);
  const action=url.searchParams.get("action");
  if(!["info","part"].includes(action))return new Response("Not found.",{status:404,headers:responseHeaders});
  const token=url.searchParams.get("token");
  let granted;
  try{granted=await authorizePaidBookToken(token)}catch{return bad()}
  if(action==="info"){
    const {file,title,filename,exp}=granted;
    return Response.json({
      title,filename,size_bytes:file.size,part_count:file.parts,
      chunk_bytes:file.part_bytes || file.size,
      expires_at:new Date(exp*1000).toISOString()
    },{headers:responseHeaders});
  }
  const idx=Number(url.searchParams.get("index"));
  if(!Number.isSafeInteger(idx)||idx<0||idx>=granted.file.parts)
    return new Response("Invalid part.",{status:400,headers:responseHeaders});
  try {
    let bytes;
    if(granted.file.kind==="chunked"){
      const key=granted.business+"/"+granted.file.id+"/part/"+String(idx).padStart(5,"0");
      const expected=Math.min(granted.file.part_bytes,granted.file.size-idx*granted.file.part_bytes);
      bytes=await openVSHStore("vsh-private-book-parts").get(key,{type:"arrayBuffer"});
      if(!bytes||bytes.byteLength!==expected)throw new Error("Missing or damaged private PDF part.");
    }else{
      bytes=await openVSHStore("vsh-private-recipe-pdfs").get(granted.path,{type:"arrayBuffer"});
      if(!bytes || bytes.byteLength<8 || bytes.byteLength>3*1024*1024)throw new Error("Missing legacy PDF.");
    }
    // Count every delivered part so a shared/leaked link cannot drain bandwidth indefinitely.
    await reserveDownloadPart(granted,bytes.byteLength);
    return new Response(bytes,{status:200,headers:{
      ...responseHeaders,
      "Content-Type":"application/octet-stream",
      "Content-Length":String(bytes.byteLength),
      "Content-Disposition":"attachment; filename=\"book-part-"+String(idx).padStart(5,"0")+"\""
    }});
  }catch(error){
    if(String(error?.message||"").includes("limit reached"))
      return Response.json({error:"This download link has reached its download limit. Please request a new link."},
        {status:429,headers:responseHeaders});
    console.error("Private purchased-book download failed:",error?.name||"Error");
    return Response.json({error:"The book is temporarily unavailable. Please try again."},
      {status:503,headers:responseHeaders});
  }
}
