/* Paid LIVE book download grant preparation.
 * DEVELOPMENT ONLY — no deployed Function, emails or schema migration.
 *
 * DB stores a random UUID nonce and SHA256 of an HMAC-derived token. The
 * server can recreate the same customer link after a worker crash with its
 * separate VSH_MIXED_BOOK_LINK_KEY (Netlify Functions secret). Neither raw
 * tokens nor the secret is persisted in PostgreSQL.
 *
 * A single transaction validates the paid LIVE master + brand sale, locks
 * the order, and inserts/reconciles ALL brand-only grants. No caller receives
 * private links until COMMIT succeeds. NO email sending in this module.
 */
import crypto from "node:crypto";
import {BRANDS,UUID} from "./mixed-book-order.mjs";
import {bookDownloadUrl} from "./mixed-book-download-grants.mjs";

const LINK_KEY=/^vshlk_[A-Za-z0-9+/]{43}=$/;
const HASH=/^[a-f0-9]{64}$/;
const HOURS=48;
function requireKey(linkKey){
  if(typeof linkKey!=="string" || !LINK_KEY.test(linkKey))
    throw Error("Private book delivery key is not configured.");
  const bytes=Buffer.from(linkKey.slice(6),"base64");
  if(bytes.length!==32 || bytes.toString("base64")!==linkKey.slice(6))
    throw Error("Invalid private book delivery key.");
  return bytes;
}
export function derivePaidBookToken({
  linkKey,orderId,business,productId,nonce
}={}){
  const key=requireKey(linkKey);
  if(!UUID.test(orderId||"") || !BRANDS.includes(business) ||
    !UUID.test(productId||"") || !UUID.test(nonce||""))
    throw Error("Invalid private book grant identity.");
  // Domain-separated and versioned; full HMAC SHA-256 is 43 base64url chars.
  return crypto.createHmac("sha256",key)
    .update("vsh-mixed-paid-book-token-v1\0"+orderId.toLowerCase()+
      "\0"+business+"\0"+productId.toLowerCase()+
      "\0"+nonce.toLowerCase()).digest("base64url");
}
const digest=token=>crypto.createHash("sha256").update(token).digest("hex");
const validExpiry=(date,at)=>{
  const expires=new Date(date).getTime();
  return Number.isFinite(expires) && expires>at;
};

export async function ensureCommittedPaidBookLinks(pool,{
  orderId,business,linkKey,now=new Date(),nonceFactory=crypto.randomUUID
}={}){
  requireKey(linkKey); // Check secrets before opening database.
  if(!UUID.test(orderId||"") || !BRANDS.includes(business) ||
    !pool || typeof pool.connect!=="function" ||
    typeof nonceFactory!=="function")
    throw Error("Private book grant transaction is unavailable.");
  const nowMs=new Date(now).getTime();
  if(!Number.isFinite(nowMs))throw Error("Invalid book grant timestamp.");
  const tx=await pool.connect();
  let began=false;
  try{
    await tx.query("BEGIN");
    began=true;
    const payment=await tx.query(
      "SELECT o.id,o.status,o.processing_mode,o.payment_id,o.checkout_id,"+
      " s.business,s.subtotal_cents FROM vsh_mixed_orders o"+
      " JOIN vsh_mixed_brand_sales s ON s.order_id=o.id"+
      " WHERE o.id=$1 AND s.business=$2 FOR UPDATE OF o",
      [orderId.toLowerCase(),business]
    );
    const row=payment.rows?.[0];
    if(!row || row.id!==orderId.toLowerCase() ||
      row.business!==business || row.status!=="paid" ||
      row.processing_mode!=="live" ||
      typeof row.payment_id!=="string" || !row.payment_id ||
      typeof row.checkout_id!=="string" || !row.checkout_id)
      throw Error("Verified live brand payment is required.");
    const list=await tx.query(
      "SELECT product_id,title,price_cents,private_pdf_path"+
      " FROM vsh_mixed_order_lines"+
      " WHERE order_id=$1 AND business=$2 ORDER BY product_id",
      [orderId.toLowerCase(),business]
    );
    const lines=list.rows||[];
    if(lines.length<1 || lines.length>20)
      throw Error("Invalid purchased book list.");
    let subtotal=0;
    for(const line of lines){
      if(!UUID.test(line.product_id||"") ||
        !Number.isSafeInteger(Number(line.price_cents)) ||
        Number(line.price_cents)<100 ||
        typeof line.private_pdf_path!=="string" ||
        !line.private_pdf_path.startsWith(business+"/"))
        throw Error("Invalid purchased book ownership.");
      subtotal+=Number(line.price_cents);
    }
    if(subtotal!==Number(row.subtotal_cents))
      throw Error("Brand sale amount does not reconcile.");

    const existing=await tx.query(
      "SELECT token_hash,product_id,token_nonce,expires_at,revoked_at"+
      " FROM vsh_mixed_download_grants WHERE order_id=$1 AND business=$2 FOR UPDATE",
      [orderId.toLowerCase(),business]
    );
    const byProduct=new Map();
    for(const grant of existing.rows||[]){
      if(byProduct.has(grant.product_id))
        throw Error("Duplicate persisted book grant.");
      byProduct.set(grant.product_id,grant);
    }
    if([...byProduct.keys()].some(id=>!lines.some(x=>x.product_id===id)))
      throw Error("Unexpected brand book grant.");
    const links=[];
    for(const line of lines){
      let nonce,hash,expiresAt;
      const prior=byProduct.get(line.product_id);
      if(prior){
        if(prior.revoked_at || !UUID.test(prior.token_nonce||"") ||
          !validExpiry(prior.expires_at,nowMs) ||
          typeof prior.token_hash!=="string" || !HASH.test(prior.token_hash))
          throw Error("Existing book link needs manual renewal.");
        nonce=prior.token_nonce;
        hash=prior.token_hash;
        expiresAt=new Date(prior.expires_at).toISOString();
      }else{
        nonce=nonceFactory();
        if(!UUID.test(nonce||""))throw Error("Invalid grant nonce.");
        expiresAt=new Date(nowMs+HOURS*3600000).toISOString();
      }
      const token=derivePaidBookToken({
        linkKey,orderId,business,productId:line.product_id,nonce
      });
      const tokenHash=digest(token);
      const match=Buffer.from(hash||tokenHash,"hex");
      if(!crypto.timingSafeEqual(Buffer.from(tokenHash,"hex"),match))
        throw Error("Saved book link does not match the private delivery key.");
      if(!prior){
        const inserted=await tx.query(
          "INSERT INTO vsh_mixed_download_grants"+
          " (token_hash,order_id,business,product_id,token_nonce,expires_at)"+
          " VALUES ($1,$2,$3,$4,$5::uuid,$6::timestamptz)"+
          " ON CONFLICT (order_id,business,product_id) DO NOTHING RETURNING token_hash",
          [tokenHash,orderId.toLowerCase(),business,line.product_id,nonce,expiresAt]
        );
        if(inserted.rows?.[0]?.token_hash!==tokenHash)
          throw Error("Concurrent private book grant conflict.");
      }
      links.push({id:line.product_id,url:bookDownloadUrl(token),expiresAt});
    }
    await tx.query("COMMIT");
    began=false;
    return links; // Only committed grants result in usable links.
  }catch(error){
    if(began)try{await tx.query("ROLLBACK")}catch{/* preserve original error */}
    throw error;
  }finally{tx.release()}
}
