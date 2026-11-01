/* SQL read adapters for server-only paid-book delivery.
 *
 * Do not call directly from a public endpoint without authorising the
 * customer's token or the admin's access for THAT business.
 * This module does not create orders, send emails or expose private PDFs.
 */
import {BRANDS,UUID} from "./mixed-book-order.mjs";

const checkPool=pool=>{
  if(!pool || typeof pool.query!=="function")
    throw Error("A PostgreSQL query pool is required.");
};
const moneyInt=value=>{
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<100||parsed>5_000_000)
    throw Error("Invalid stored book amount.");
  return parsed;
};
export function createMixedBookDbReads(pool){
  checkPool(pool);
  return Object.freeze({
    async loadPaidBrandSale(orderId,business){
      if(typeof orderId!=="string" || !UUID.test(orderId) ||
         !BRANDS.includes(business))
        throw Error("Invalid business sale identifier.");
      // A brand query CANNOT select the mixed master snapshot, nor any other
      // business's order lines. An approved caller handles authentication.
      const saleResult=await pool.query(
        `SELECT s.order_id,s.business,s.subtotal_cents,s.currency,
                o.customer_name,o.customer_email
         FROM vsh_mixed_brand_sales s
         JOIN vsh_mixed_orders o ON o.id=s.order_id
         WHERE s.order_id=$1 AND s.business=$2
           AND o.status='paid' AND o.processing_mode='live'
           AND o.payment_id IS NOT NULL`,
        [orderId,business]
      );
      const saved=saleResult.rows?.[0];
      if(!saved)return null;
      if(saved.business!==business || saved.currency!=="ZAR" ||
         saved.order_id!==orderId)throw Error("Business sale data mismatch.");
      const lineResult=await pool.query(
        `SELECT product_id,title,price_cents,private_pdf_path
         FROM vsh_mixed_order_lines
         WHERE order_id=$1 AND business=$2
         ORDER BY product_id`,
        [orderId,business]
      );
      const items=(lineResult.rows||[]).map(item=>{
        if(typeof item.private_pdf_path!=="string" ||
          !item.private_pdf_path.startsWith(business+"/") ||
          !UUID.test(item.product_id||""))
          throw Error("Invalid brand-owned PDF path.");
        return {
          id:item.product_id,title:String(item.title||"").slice(0,120),
          priceCents:moneyInt(item.price_cents),
          pdfPath:item.private_pdf_path
        };
      });
      const subtotalCents=moneyInt(saved.subtotal_cents);
      if(!items.length || items.reduce((sum,item)=>sum+item.priceCents,0)!==subtotalCents)
        throw Error("Business sale does not reconcile.");
      return {
        business,brandOrderRef:orderId+":"+business,
        masterOrderId:orderId,subtotalCents,currency:"ZAR",
        customer:{
          name:String(saved.customer_name||"").slice(0,120),
          email:String(saved.customer_email||"").slice(0,254)
        },items
      };
    },
    grantStore:Object.freeze({
      async findByHash(hash){
        if(typeof hash!=="string" || !/^[a-f0-9]{64}$/.test(hash))return null;
        const result=await pool.query(
          `SELECT token_hash,order_id,business,product_id,expires_at,revoked_at
           FROM vsh_mixed_download_grants WHERE token_hash=$1`,[hash]
        );
        const row=result.rows?.[0];
        if(!row)return null;
        return {
          tokenHash:row.token_hash,orderId:row.order_id,business:row.business,
          productId:row.product_id,expiresAt:row.expires_at,
          revokedAt:row.revoked_at
        };
      }
    }),
    orderStore:Object.freeze({
      async findById(orderId){
        if(typeof orderId!=="string" || !UUID.test(orderId))return null;
        const result=await pool.query(
          `SELECT id,status,processing_mode,snapshot
           FROM vsh_mixed_orders WHERE id=$1`,[orderId]
        );
        const row=result.rows?.[0];
        if(!row || !row.snapshot || row.snapshot.id!==row.id)return null;
        // Snapshot is always server-authored at checkout, never browser price.
        return {
          ...row.snapshot,id:row.id,status:row.status,
          processingMode:row.processing_mode
        };
      }
    })
  });
}
