/* Server-only mixed digital-book database service (NOT a Netlify Function).
 *
 * Access is OFF unless the Netlify deployment explicitly enables
 * VSH_MIXED_BOOK_DB_ENABLED=true. This adapter does not activate payments,
 * send mail, create download URLs or apply database migrations.
 *
 * Never call settleAfterVerifiedWebhook with an unverified browser payload:
 * the future webhook route must independently HMAC-verify the raw body AND
 * resolve the matching order and merchant payment from server records.
 */
import {openMixedBookPool} from "./mixed-book-db-runtime.mjs";
import {
  persistPendingMixedOrder,bindMixedYocoCheckout,settleVerifiedMixedYocoPayment
} from "./mixed-book-ledger.mjs";
import {createMixedBookDbReads} from "./mixed-book-db-reads.mjs";

export function createMixedBookServices(options={}){
  const pool=openMixedBookPool(options);
  const reads=createMixedBookDbReads(pool);
  return Object.freeze({
    async createPendingOrder(serverSnapshot,processingMode){
      return persistPendingMixedOrder(pool,serverSnapshot,processingMode);
    },
    async bindYocoCheckout(input){
      return bindMixedYocoCheckout(pool,input);
    },
    async settleAfterVerifiedWebhook(orderId,verifiedConfirmation){
      return settleVerifiedMixedYocoPayment(pool,orderId,verifiedConfirmation);
    },
    // Merchant/customer access checks are required in the caller. The SQL
    // itself filters both brand and paid/live state as defence in depth.
    async loadPaidBrandSale(orderId,business){
      return reads.loadPaidBrandSale(orderId,business);
    },
    grantStore:reads.grantStore,
    orderStore:reads.orderStore
  });
}
