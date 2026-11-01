/* Server-only PRIVATE PDF download planning, not a public Netlify Function.
 *
 * The existing large-book upload stores parts in vsh-private-book-parts with
 * key business/<uploadUUID>/part/<5-digit index>, and a sealed manifest in
 * vsh-private-recipe-pdfs. Never expose either store/key in a customer URL.
 *
 * Netlify Functions cap streamed responses at 20 MiB. Every planned request
 * returns exactly ONE verified part (at most 3 MiB); a separate authorised
 * client will need to assemble/write parts incrementally for large files.
 * Never buffer a 2 GiB PDF in a Function or in browser memory.
 */
import crypto from "node:crypto";

export const PDF_PART_BYTES=3*1024*1024;
export const PDF_MAX_BYTES=2*1024*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRANDS=new Set(["grannys","clever-cubs"]);
const HASH=/^[a-f0-9]{64}$/i;
const storage={
  small:"vsh-private-recipe-pdfs",
  large:"vsh-private-book-parts"
};
function bad(message){throw Error(message)}
function bookIdentity(business,pdfPath) {
  if(!BRANDS.has(business) || typeof pdfPath!=="string" ||
    !pdfPath.startsWith(business+"/"))bad("Invalid private book ownership.");
  const suffix=pdfPath.slice(business.length+1);
  const match=/^([0-9a-f-]{36})\.(pdf|manifest\.json)$/i.exec(suffix);
  if(!match || !UUID.test(match[1]))bad("Invalid private PDF storage path.");
  return {uploadId:match[1].toLowerCase(),chunked:match[2].toLowerCase()!=="pdf"};
}
export function validateSealedBookManifest(business,pdfPath,manifest){
  const identity=bookIdentity(business,pdfPath);
  if(!identity.chunked)bad("PDF is not a chunked private book.");
  if(!manifest || manifest.version!==1 ||
    manifest.kind!=="chunked-pdf" ||
    manifest.business!==business ||
    String(manifest.id).toLowerCase()!==identity.uploadId ||
    !Number.isSafeInteger(manifest.size_bytes) ||
    manifest.size_bytes<8 || manifest.size_bytes>PDF_MAX_BYTES ||
    manifest.part_bytes!==PDF_PART_BYTES ||
    !Number.isSafeInteger(manifest.part_count) ||
    manifest.part_count!==Math.ceil(manifest.size_bytes/PDF_PART_BYTES) ||
    manifest.part_count<1 ||
    typeof manifest.filename!=="string" ||
    !/\.pdf$/i.test(manifest.filename) ||
    /[\/\\\r\n\0]/.test(manifest.filename))
    bad("Incomplete or mismatched sealed private PDF manifest.");
  return {uploadId:identity.uploadId,sizeBytes:manifest.size_bytes,
    partCount:manifest.part_count,fileName:manifest.filename};
}
export function privatePdfPartPlan({business,pdfPath,manifest=null,smallPdfBytes=null,index}={}){
  const identity=bookIdentity(business,pdfPath);
  if(!Number.isSafeInteger(index)||index<0)bad("Invalid requested book part.");
  if(!identity.chunked){
    if(index!==0 || !Number.isSafeInteger(smallPdfBytes) ||
      smallPdfBytes<8 || smallPdfBytes>PDF_PART_BYTES)
      bad("Invalid small-book length or part.");
    return {business,partIndex:0,partCount:1,sizeBytes:smallPdfBytes,
      expectedPartBytes:smallPdfBytes,offset:0,
      storeName:storage.small,storeKey:pdfPath};
  }
  const record=validateSealedBookManifest(business,pdfPath,manifest);
  if(index>=record.partCount)bad("Requested book part is outside the PDF.");
  const offset=index*PDF_PART_BYTES;
  const expectedPartBytes=Math.min(PDF_PART_BYTES,record.sizeBytes-offset);
  return {business,partIndex:index,partCount:record.partCount,
    sizeBytes:record.sizeBytes,expectedPartBytes,offset,
    storeName:storage.large,
    storeKey:business+"/"+record.uploadId+"/part/"+String(index).padStart(5,"0")};
}
export function validatePrivatePdfPartBytes(plan,bytes,blobMetadata=null) {
  if(!plan || !BRANDS.has(plan.business) ||
    !Number.isSafeInteger(plan.expectedPartBytes) ||
    plan.expectedPartBytes<1 || plan.expectedPartBytes>PDF_PART_BYTES)
    bad("Invalid private PDF part plan.");
  if(!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes))
    bad("Private PDF part must be binary.");
  if(bytes.byteLength!==plan.expectedPartBytes)
    bad("Private PDF part has an unexpected length.");
  const meta=blobMetadata?.metadata || blobMetadata;
  if(plan.partCount>1) {
    if(!meta || !HASH.test(meta.sha256||"") ||
      meta.bytes!==plan.expectedPartBytes ||
      crypto.createHash("sha256").update(bytes).digest("hex")!==meta.sha256.toLowerCase())
      bad("Private PDF part checksum does not match upload.");
  }
  if(plan.partIndex===0 &&
    Buffer.from(bytes.subarray(0,5)).toString("ascii")!=="%PDF-")
    bad("Private PDF header is invalid.");
  if(plan.partIndex===plan.partCount-1 &&
    !Buffer.from(bytes.subarray(Math.max(0,bytes.length-2048)))
      .toString("latin1").includes("%%EOF"))
    bad("Private PDF final part is incomplete.");
  return {length:bytes.byteLength,
    // The Content-Range value is informative even though each authenticated
    // API call returns one explicit part, not an arbitrary byte-range GET.
    contentRange:"bytes "+plan.offset+"-"+(plan.offset+bytes.byteLength-1)+"/"+plan.sizeBytes};
}
export function safePrivatePdfFileName(value){
  const name=String(value||"Purchased-book.pdf");
  const cleaned=name.replace(/[\/\\\0-\x1f\x7f"<>:|?*]/g,"_").trim().slice(0,120);
  return /\.pdf$/i.test(cleaned)?cleaned:"Purchased-book.pdf";
}
