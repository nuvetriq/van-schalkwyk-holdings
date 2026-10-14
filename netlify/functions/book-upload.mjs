import crypto from "node:crypto";
import { openVSHStore } from "../lib/catalogue-store.mjs";
import { authStatus, json, BUSINESSES } from "../lib/auth.mjs";

// ADMIN-ONLY resumable upload. Each 3 MiB part is a private Blob, never
// published as a URL or assembled in Lambda memory.
// Payments and customer downloads are separate, disabled features.
const PART_BYTES = 3 * 1024 * 1024;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{64}$/i;
const sessions = () => openVSHStore("vsh-book-upload-sessions");
const pieces = () => openVSHStore("vsh-private-book-parts");
const books = () => openVSHStore("vsh-private-recipe-pdfs");
const sessionKey = (business, id) => business + "/" + id + ".json";
const partKey = (business, id, number) => business + "/" + id + "/part/" + String(number).padStart(5, "0");
const bookKey = (business, id) => business + "/" + id + ".manifest.json";
const active = session => session && session.version === 1 &&
  session.status === "uploading" && Date.parse(session.expires_at) > Date.now();
const safeError = (msg, status=400) => json({error:msg},status);

async function sessionFor(business, id) {
  if (!BUSINESSES.has(business) || !UUID_RE.test(id)) return null;
  return sessions().getWithMetadata(sessionKey(business, id), {type:"json"});
}
async function presentParts(business, id, count) {
  const {blobs} = await pieces().list({prefix:business+"/"+id+"/part/"});
  return [...new Set(blobs.map(item=>Number(item.key.split("/").pop()))
    .filter(number=>Number.isSafeInteger(number) && number>=0 && number<count))]
    .sort((a,b)=>a-b);
}
async function bodyJSON(request) {
  const size=Number(request.headers.get("content-length"));
  if(Number.isFinite(size) && size>4096)throw new Error("Upload details are too long.");
  const raw=await request.text();
  if(raw.length>4096)throw new Error("Upload details are too long.");
  return JSON.parse(raw);
}
export default async function handler(request) {
  if(!["GET","POST"].includes(request.method))return safeError("Method not allowed.",405);
  const auth=authStatus(request);
  if(!auth.ok)return json({error:auth.error},auth.status);
  const url=new URL(request.url);
  const action=url.searchParams.get("action");
  const business=String(url.searchParams.get("business") || "");
  const id=String(url.searchParams.get("id") || "");
  try {
    if(request.method==="POST" && action==="start") {
      const data=await bodyJSON(request);
      if(!BUSINESSES.has(data.business))return safeError("Invalid business.");
      const filename=String(data.filename || "").trim().slice(0,150);
      const size=Number(data.size_bytes);
      const fingerprint=String(data.fingerprint || "");
      if(!/\.pdf$/i.test(filename) || /[\/\\\x00-\x1f]/.test(filename))
        return safeError("Choose a valid PDF filename.");
      if(!Number.isSafeInteger(size) || size<8 || size>MAX_BYTES)
        return safeError("PDF size must be between 8 bytes and 2 GB.");
      if(!HEX_RE.test(fingerprint))return safeError("Invalid file fingerprint.");
      const id=crypto.randomUUID();
      const count=Math.ceil(size/PART_BYTES);
      const session={
        version:1,id,business:data.business,filename,size_bytes:size,
        fingerprint:fingerprint.toLowerCase(),part_bytes:PART_BYTES,part_count:count,
        created_at:new Date().toISOString(),
        expires_at:new Date(Date.now()+SESSION_TTL).toISOString(),
        status:"uploading"
      };
      const created=await sessions().setJSON(sessionKey(session.business,id),session,{onlyIfNew:true});
      if(!created.modified)return safeError("Could not start upload. Retry.",409);
      return json({id,business:session.business,size_bytes:size,part_bytes:PART_BYTES,
        part_count:count,expires_at:session.expires_at},201);
    }
    if(!BUSINESSES.has(business) || !UUID_RE.test(id))return safeError("Invalid upload identifier.");
    const saved=await sessionFor(business,id);
    if(!saved)return safeError("Upload session not found. Please start again.",404);
    const s=saved.data;
    if(s.business!==business || s.id!==id)return safeError("Upload session mismatch.",403);
    if(request.method==="GET" && action==="status") {
      if(s.status==="complete")return json({status:"complete",pdf_path:s.pdf_path,
        part_count:s.part_count,size_bytes:s.size_bytes});
      if(!active(s))return safeError("This upload expired. Please start again.",410);
      return json({status:s.status,id,part_bytes:PART_BYTES,part_count:s.part_count,
        size_bytes:s.size_bytes,fingerprint:s.fingerprint,
        uploaded:await presentParts(business,id,s.part_count)});
    }
    if(request.method==="POST" && action==="part") {
      if(!active(s))return safeError("Upload is closed or expired.",410);
      const idx=Number(url.searchParams.get("index"));
      if(!Number.isSafeInteger(idx) || idx<0 || idx>=s.part_count)return safeError("Invalid part number.");
      const expectedSize=Math.min(PART_BYTES,s.size_bytes-idx*PART_BYTES);
      const statedLength=Number(request.headers.get("content-length"));
      if(Number.isFinite(statedLength)&&statedLength>PART_BYTES)return safeError("Upload part too large.",413);
      const expectedHash=String(request.headers.get("x-part-sha256")||"").toLowerCase();
      if(!HEX_RE.test(expectedHash))return safeError("Missing or invalid part checksum.");
      if(!/^application\/octet-stream(?:;|$)/i.test(request.headers.get("content-type")||""))
        return safeError("Expected a binary upload part.");
      const raw=await request.arrayBuffer();
      if(raw.byteLength!==expectedSize)return safeError("Part size does not match.",400);
      const buf=Buffer.from(raw);
      const hash=crypto.createHash("sha256").update(buf).digest("hex");
      if(hash!==expectedHash)return safeError("Part checksum mismatch.",422);
      if(idx===0 && buf.subarray(0,5).toString("ascii")!=="%PDF-")
        return safeError("The selected file is not a PDF.");
      if(idx===s.part_count-1 && !buf.subarray(Math.max(0,buf.length-2048)).toString("latin1").includes("%%EOF"))
        return safeError("The PDF appears incomplete or damaged.");
      const key=partKey(business,id,idx);
      const store=pieces();
      const existing=await store.getMetadata(key);
      if(existing) {
        if(existing.metadata?.sha256===hash && existing.metadata?.bytes===expectedSize)
          return json({index:idx,stored:true,already_uploaded:true});
        return safeError("This part has different content. Restart the upload.",409);
      }
      const result=await store.set(key,raw,{
        metadata:{sha256:hash,bytes:expectedSize},
        onlyIfNew:true
      });
      if(!result.modified) {
        const persisted=await store.getMetadata(key);
        if(persisted?.metadata?.sha256!==hash)return safeError("Part upload conflict.",409);
      }
      return json({index:idx,stored:true});
    }
    if(request.method==="POST" && action==="finalize") {
      if(s.status==="complete")return json({pdf_path:s.pdf_path,size_bytes:s.size_bytes,complete:true});
      if(!active(s))return safeError("Upload expired or already closed.",410);
      const present=await presentParts(business,id,s.part_count);
      if(present.length!==s.part_count || present.some((n,i)=>n!==i))
        return safeError("Some PDF parts are missing. Continue uploading before saving.",409);
      // Only the server can produce a complete, immutable private-book manifest.
      // This is *not* a normal PDF; the customer-download layer must stream parts
      // after verifying payment, and must never blindly read this as PDF bytes.
      const pdf_path=bookKey(business,id);
      const manifest={version:1,kind:"chunked-pdf",business,id,
        filename:s.filename,size_bytes:s.size_bytes,part_bytes:PART_BYTES,
        part_count:s.part_count,created_at:s.created_at,completed_at:new Date().toISOString()};
      const result=await books().setJSON(pdf_path,manifest,{onlyIfNew:true});
      if(!result.modified) {
        const previous=await books().get(pdf_path,{type:"json"});
        if(previous?.id!==id || previous?.business!==business)
          return safeError("Upload manifest conflict.",409);
      }
      const updated={...s,status:"complete",pdf_path};
      const ack=await sessions().setJSON(sessionKey(business,id),updated,{onlyIfMatch:saved.etag});
      if(!ack.modified) {
        // Another concurrent finalizer can also have completed. Retain the
        // already published immutable manifest and return the same path.
        const fresh=await sessionFor(business,id);
        if(fresh?.data?.status!=="complete")return safeError("Upload state changed. Please check status.",409);
      }
      return json({complete:true,pdf_path,size_bytes:s.size_bytes,part_count:s.part_count});
    }
    return safeError("Unsupported upload operation.",405);
  } catch(error) {
    if(error instanceof SyntaxError)return safeError("Invalid upload details.");
    console.error("Private resumable book upload error:",error);
    return json({error:"The private upload could not be completed. Please retry."},500);
  }
}
