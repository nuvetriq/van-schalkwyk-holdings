/* Read-only operator preview of branded paid-book email outbox.
 * Development only. NO Netlify Function, default export, scheduled trigger,
 * SMTP import, payment request, claim/lease mutation or customer data.
 *
 * This is a future privileged internal inspection primitive, not an API.
 * All access stays disabled until a separately approved release.
 */
import {openMixedBookPool} from "./mixed-book-db-runtime.mjs";

const BRAND=new Set(["grannys","clever-cubs"]);
const KIND=new Set(["customer-delivery","merchant-sale-notice"]);
const STATUS=new Set(["pending","retry","claimed","sent","unknown","failed"]);
const ORDER_STATUS=new Set([
  "checkout_pending","awaiting_payment","paid","failed","refunded"
]);
const unavailable=()=>{throw Error("Email outbox review is not enabled.");};

export function createMixedBookEmailOperatorReview({
  enabled=false,operatorApproved=false,env={},context,
  poolFactory=openMixedBookPool
}={}){
  if(enabled!==true || operatorApproved!==true ||
    context?.deploy?.context!=="production" ||
    env.VSH_MIXED_BOOK_DB_ENABLED!=="true" ||
    env.VSH_MIXED_BOOK_EMAIL_REVIEW_ENABLED!=="true" ||
    typeof poolFactory!=="function")unavailable();
  return Object.freeze({
    async inspect(){
      try{
      const pool=poolFactory({context,enabled:"true"});
      if(!pool || typeof pool.query!=="function")unavailable();
      // Read-only SELECT with no customer identity, order ID, recipient,
      // message body, PDF path, grant, claim token or signing secret.
      const {rows}=await pool.query(
        "SELECT j.business,j.kind,j.status,o.status AS order_status,"+
        " COUNT(*)::integer AS jobs,"+
        " COUNT(*) FILTER (WHERE j.status='claimed'"+
        " AND j.claim_until < now())::integer AS expired_claims"+
        " FROM vsh_mixed_email_outbox j"+
        " INNER JOIN vsh_mixed_orders o ON o.id=j.order_id"+
        " WHERE o.processing_mode='live'"+
        " GROUP BY j.business,j.kind,j.status,o.status"+
        " ORDER BY j.business,j.kind,j.status,o.status"
      );
      if(!Array.isArray(rows) || rows.length>120)unavailable();
      let total=0,eligible=0,manual=0,blocked=0;
      const byBrand={"grannys":0,"clever-cubs":0};
      const groups=[];
      for(const item of rows){
        if(!BRAND.has(item.business) || !KIND.has(item.kind) ||
          !STATUS.has(item.status) || !ORDER_STATUS.has(item.order_status))
          unavailable();
        const n=Number(item.jobs),expired=Number(item.expired_claims);
        if(!Number.isSafeInteger(n) || n<1 ||
          !Number.isSafeInteger(expired) || expired<0 || expired>n)
          unavailable();
        total+=n;
        if(!Number.isSafeInteger(total))unavailable();
        byBrand[item.business]+=n;
        const ready=item.order_status==="paid" &&
          ["pending","retry"].includes(item.status);
        if(ready)eligible+=n;
        if(item.status==="unknown" || expired>0)manual+=
          item.status==="unknown"?n:expired;
        if(item.order_status!=="paid")blocked+=n;
        groups.push(Object.freeze({
          brand:item.business,kind:item.kind,status:item.status,
          orderStatus:item.order_status,count:n,expiredClaims:expired
        }));
      }
      return Object.freeze({
        reviewOnly:true,canSend:false,processingMode:"live",
        total,eligiblePending:eligible,needsManualReview:manual,
        nonPaidOrderJobs:blocked,
        byBrand:Object.freeze(byBrand),groups:Object.freeze(groups)
      });
      }catch{
        // Keep database error details and potentially personal SQL metadata
        // away from any later authorized operator UI.
        throw Error("Email outbox review unavailable.");
      }
    }
  });
}
