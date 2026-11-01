/* Internal-only, unguessable digital-book download grants.
 * This module neither exposes private PDF bytes nor connects to the database.
 * A trusted backend must persist the token_hash and ownership tuple, verify
 * that the order is PAID and live at redemption, then stream ONLY that PDF.
 * Never log/email the token_hash; only email the private URL containing token.
 */
import crypto from "node:crypto";
import {BRANDS, UUID} from "./mixed-book-order.mjs";

const TOKEN_FORMAT=/^[A-Za-z0-9_-]{43}$/;
const digest=token=>crypto.createHash("sha256").update(token,"utf8").digest("hex");

export function issueBookDownloadGrant({
  orderId,business,productId,paymentStatus,processingMode,
  issuedAt=new Date(),hours=48
}={}) {
  if(!UUID.test(orderId||"") || !UUID.test(productId||"") ||
    !BRANDS.includes(business))throw Error("Invalid purchased book identity.");
  if(paymentStatus!=="paid" || processingMode!=="live")
    throw Error("Only a verified live paid order can receive a download grant.");
  const start=new Date(issuedAt).getTime();
  if(!Number.isFinite(start) || !Number.isInteger(hours) || hours<1 || hours>168)
    throw Error("Invalid download expiry.");
  const token=crypto.randomBytes(32).toString("base64url");
  const tokenHash=digest(token);
  const expiresAt=new Date(start+hours*3600000).toISOString();
  // Caller MUST save row in a transaction; the URL must not be emailed until
  // it is committed. Do not store token plaintext in the database.
  return {
    token,
    grant:{
      tokenHash,orderId,business,productId,expiresAt
    }
  };
}

export function isValidBookGrant(token,grant,order,{
  now=new Date()
}={}) {
  // No caller supplied trust flag. The paid master order is independently
  // loaded from authoritative server storage in the future download endpoint.
  if(typeof token!=="string" || !TOKEN_FORMAT.test(token) ||
    !grant || !order || !UUID.test(order.id||"") ||
    !UUID.test(grant.orderId||"") || !UUID.test(grant.productId||"") ||
    !BRANDS.includes(grant.business) || order.id!==grant.orderId ||
    order.status!=="paid" || order.processingMode!=="live" ||
    grant.revokedAt) return false;
  const nowMs=new Date(now).getTime();
  const expiryMs=new Date(grant.expiresAt).getTime();
  if(!Number.isFinite(nowMs) || !Number.isFinite(expiryMs) || nowMs>=expiryMs)
    return false;
  const known=String(grant.tokenHash||"");
  if(!/^[a-f0-9]{64}$/.test(known))return false;
  const actual=Buffer.from(digest(token),"hex");
  const expected=Buffer.from(known,"hex");
  if(actual.length!==expected.length || !crypto.timingSafeEqual(actual,expected))
    return false;
  // Re-check ownership against immutable paid snapshot, rather than trusting
  // token metadata alone, and restrict future streaming to this exact line.
  const lines=order.items;
  return Array.isArray(lines) && lines.some(item=>
    item.business===grant.business && item.id===grant.productId &&
    typeof item.pdfPath==="string" &&
    item.pdfPath.startsWith(grant.business+"/")
  );
}

export function bookDownloadUrl(token,origin="https://vanschalkwykholdings.com") {
  if(typeof token!=="string" || !TOKEN_FORMAT.test(token))
    throw Error("Invalid download token.");
  const url=new URL(origin);
  if(url.origin!=="https://vanschalkwykholdings.com" || url.username || url.password)
    throw Error("Invalid public download origin.");
  // Endpoint doesn't exist yet. Building a URL is NOT delivering the file.
  return url.origin+"/.netlify/functions/paid-book-download?token="+encodeURIComponent(token);
}
