/* Draft PostgreSQL outbox leasing — NOT connected to a deployed function.
 *
 * Intent: after one server-verified Yoco payment, each brand's independently
 * scoped email task is persisted with a unique id. Workers can claim only
 * pending / explicitly safe-to-retry tasks for already PAID LIVE orders.
 *
 * Safety rule: failure AFTER starting an SMTP/provider send is AMBIGUOUS.
 * Move to "unknown", NEVER auto-retry: manual reconciliation is required to
 * avoid sending duplicate PDFs or receipts. Expired claims also become unknown.
 *
 * Database schema: docs/database/mixed-book-orders-DRAFT.sql (UNAPPLIED).
 * This module does not send messages and does not enable customer payments.
 */
import crypto from "node:crypto";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRAND = new Set(["grannys","clever-cubs"]);
const TASK = new Set(["customer-delivery","merchant-sale-notice"]);
const CLAIM = ID;
const requirePool = pool => {
  if(!pool || typeof pool.query !== "function")
    throw Error("Postgres connection pool with query() is required.");
};
const requireTask = job => {
  if(!job || !ID.test(job.order_id||"") ||
    !BRAND.has(job.business) || !TASK.has(job.kind) ||
    job.id !== job.order_id + ":" + job.business + ":" + job.kind)
    throw Error("Invalid email task identity.");
};

export async function claimMixedBookEmail(pool,{leaseSeconds=120}={}) {
  requirePool(pool);
  if(!Number.isSafeInteger(leaseSeconds) || leaseSeconds<30 || leaseSeconds>300)
    throw Error("Invalid outbox lease duration.");
  const claimToken=crypto.randomUUID();
  // Atomic claim (one SQL statement) with row locking and skip-locked. The
  // paid/live join is essential: a test payment must NEVER dispatch emails.
  const {rows}=await pool.query(`
    WITH candidate AS (
      SELECT j.id
      FROM vsh_mixed_email_outbox j
      JOIN vsh_mixed_orders o ON o.id=j.order_id
      WHERE j.status IN ('pending','retry')
        AND j.next_attempt_at <= now()
        AND j.attempt_count < 4
        AND o.status='paid' AND o.processing_mode='live'
      ORDER BY j.next_attempt_at, j.created_at, j.id
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    )
    UPDATE vsh_mixed_email_outbox j
    SET status='claimed', claim_token=$1::uuid,
        claim_until=now() + ($2::integer * interval '1 second'),
        attempt_count=j.attempt_count+1
    FROM candidate WHERE j.id=candidate.id
    RETURNING j.*
  `,[claimToken,leaseSeconds]);
  if(!rows?.length)return null;
  const job=rows[0];
  requireTask(job);
  if(job.status!=="claimed" || job.claim_token!==claimToken)
    throw Error("Unexpected outbox claim state.");
  return {job,claimToken};
}

function requireClaim(jobId,claimToken) {
  if(typeof jobId!=="string" || !ID.test(claimToken||"") ||
    !/^[0-9a-f-]{36}:(?:grannys|clever-cubs):(?:customer-delivery|merchant-sale-notice)$/i.test(jobId))
    throw Error("Invalid claimed email task.");
}
async function transition(pool,jobId,claimToken,fragment,params=[]) {
  requirePool(pool);requireClaim(jobId,claimToken);
  const {rows}=await pool.query(`
    UPDATE vsh_mixed_email_outbox
    SET ${fragment}
    WHERE id=$1 AND claim_token=$2::uuid AND status='claimed'
    RETURNING id,status
  `,[jobId,claimToken,...params]);
  return rows?.[0] ?? null;
}

// Call ONLY after a provider returns a trusted, unambiguous acceptance
// acknowledgement. It does not guarantee delivery to a human mailbox.
export async function markMixedEmailAccepted(pool,jobId,claimToken,providerMessageId) {
  if(typeof providerMessageId!=="string" || providerMessageId.length<3 ||
    providerMessageId.length>250 || /[\r\n]/.test(providerMessageId))
    throw Error("Provider acknowledgement reference required.");
  return transition(pool,jobId,claimToken,
    "status='sent',provider_message_id=$3,claim_token=NULL,claim_until=NULL,sent_at=now()",
    [providerMessageId]);
}

// Pre-send failures can be retried. The caller must guarantee that no network
// send was begun; provider timeouts or SMTP disconnects are NOT pre-send errors.
export async function retryMixedEmailBeforeSend(pool,jobId,claimToken,minutes=5) {
  if(!Number.isSafeInteger(minutes) || minutes<1 || minutes>60)
    throw Error("Invalid retry delay.");
  return transition(pool,jobId,claimToken,
    "status=CASE WHEN attempt_count>=4 THEN 'failed' ELSE 'retry' END," +
    "next_attempt_at=now() + ($3::int * interval '1 minute')," +
    "claim_token=NULL,claim_until=NULL",
    [minutes]);
}

// After any ambiguous provider/SMTP result, HOLD the record for review.
// Never blindly retry after timeout, worker crash, or lost acknowledgement.
export async function holdMixedEmailUnknown(pool,jobId,claimToken) {
  return transition(pool,jobId,claimToken,
    "status='unknown',claim_token=NULL,claim_until=NULL");
}

export async function quarantineExpiredMixedEmailClaims(pool) {
  requirePool(pool);
  const {rows}=await pool.query(`
    UPDATE vsh_mixed_email_outbox
    SET status='unknown',claim_token=NULL,claim_until=NULL
    WHERE status='claimed' AND claim_until < now()
    RETURNING id
  `);
  return rows?.map(row=>row.id) ?? [];
}
