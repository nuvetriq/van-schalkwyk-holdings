/* Server-only paid PDF part reader. No public route or database provisioning.
 *
 * A future Function may call this after acquiring trusted DB + Blob adapters.
 * The token selects a SHA-256 grant, and the paid LIVE master order is checked
 * afresh for EVERY requested part. This means expired/revoked grants cannot
 * keep downloading after access is revoked. Stores never become public.
 */
import crypto from "node:crypto";
import {isValidBookGrant} from "./mixed-book-download-grants.mjs";
import {
  privatePdfPartPlan,validatePrivatePdfPartBytes,
  validateSealedBookManifest,PDF_PART_BYTES
} from "./mixed-book-private-pdf-parts.mjs";

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const fail=()=>{throw Error("This private book download is unavailable.");};

export async function readAuthorizedPaidBookPart({
  token,index,grantStore,orderStore,pdfStore,now=new Date()
}={}) {
  if(typeof token!=="string" || !TOKEN.test(token) ||
    !Number.isSafeInteger(index) || index<0)fail();
  if(!grantStore || typeof grantStore.findByHash!=="function" ||
    !orderStore || typeof orderStore.findById!=="function" ||
    !pdfStore || typeof pdfStore.getManifest!=="function" ||
    typeof pdfStore.getSmallPdfSize!=="function" ||
    typeof pdfStore.getPart!=="function")fail();
  const tokenHash=crypto.createHash("sha256").update(token).digest("hex");
  const grant=await grantStore.findByHash(tokenHash);
  if(!grant)fail();
  const order=await orderStore.findById(grant.orderId);
  if(!isValidBookGrant(token,grant,order,{now}))fail();
  const book=order.items.find(line=>
    line.id===grant.productId && line.business===grant.business);
  if(!book)fail();
  const isChunked=book.pdfPath.endsWith(".manifest.json");
  const manifest=isChunked ?
    await pdfStore.getManifest(grant.business,book.pdfPath) : null;
  let smallPdfBytes=null;
  if(isChunked)validateSealedBookManifest(grant.business,book.pdfPath,manifest);
  else smallPdfBytes=await pdfStore.getSmallPdfSize(grant.business,book.pdfPath);
  const plan=privatePdfPartPlan({
    business:grant.business,pdfPath:book.pdfPath,manifest,smallPdfBytes,index
  });
  // A strict adapter reads ONLY the exact server-derived Blob store/key.
  const data=await pdfStore.getPart(plan.storeName,plan.storeKey);
  if(!data || !(data.bytes instanceof Uint8Array) ||
    data.bytes.byteLength>PDF_PART_BYTES)fail();
  const checked=validatePrivatePdfPartBytes(plan,data.bytes,data.metadata);
  return {
    bytes:data.bytes,
    partIndex:plan.partIndex,partCount:plan.partCount,
    sizeBytes:plan.sizeBytes,partBytes:checked.length,
    contentRange:checked.contentRange,
    contentType:"application/octet-stream",
    cacheControl:"private, no-store",
    // Downloading a book is always a protected, per-part action.
    brand:grant.business,productId:grant.productId
  };
}
