/* Not exposed by any Netlify Function. Database integration candidate.
 * Requires a Postgres pool compatible with @netlify/database's db.pool.
 * Every SQL operation is parameterised; all order/payment/outbox mutations are
 * on ONE connection in ONE transaction. No email or Yoco HTTP calls here.
 *
 * IMPORTANT: trustedConfirmation MUST be constructed only after independently
 * verifying the raw signed Yoco webhook and server order lookup. Never accept
 * a browser-provided signatureVerified flag. The database schema is a DRAFT.
 */
import {UUID, BRANDS, partitionBrandSales} from "./mixed-book-order.mjs";
import {planAfterSignedPayment} from "./mixed-book-fulfilment-plan.mjs";

async function atomic(pool,work) {
  if(!pool || typeof pool.connect!=="function")
    throw Error("A transactional Postgres connection pool is required.");
  const client=await pool.connect();
  let begun=false;
  try{
    await client.query("BEGIN");
    begun=true;
    const result=await work(client);
    await client.query("COMMIT");
    return result;
  }catch(error){
    if(begun) {
      try {await client.query("ROLLBACK")}catch { /* preserve original error */ }
    }
    throw error;
  }finally{client.release()}
}
const orderIdValid=id=>typeof id==="string"&&UUID.test(id);
const checkoutID=/^(?:ch_|checkout_)[A-Za-z0-9_-]{5,150}$/;

function assertValidSnapshot(master,processingMode){
  if(!orderIdValid(master?.id) ||
    !["live","test"].includes(processingMode) ||
    !["grannys","clever-cubs"].some(b=>master.items?.some(i=>i.business===b)) ||
    !Array.isArray(master.items) || master.items.length>20 ||
    master.currency!=="ZAR" || master.paymentProvider!=="yoco" ||
    !Number.isSafeInteger(master.amountCents) || master.amountCents<100 ||
    master.amountCents>5_000_000 ||
    typeof master.name!=="string" || master.name.length<2 || master.name.length>120 ||
    typeof master.email!=="string" || master.email.length>254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(master.email))
    throw Error("Invalid trusted master order snapshot.");
  const seen=new Set();
  let total=0;
  for(const line of master.items){
    if(!BRANDS.includes(line.business)||!orderIdValid(line.id) ||
      !Number.isSafeInteger(line.priceCents) || line.priceCents<100 ||
      typeof line.title!=="string" || !line.title.trim() ||
      typeof line.pdfPath!=="string" ||
      !new RegExp("^"+line.business+"/[0-9a-f-]{36}\\.(?:pdf|manifest\\.json)$","i").test(line.pdfPath))
      throw Error("Invalid server-verified book line.");
    const key=line.business+":"+line.id.toLowerCase();
    if(seen.has(key))throw Error("Duplicate book line.");
    seen.add(key);total+=line.priceCents;
  }
  if(total!==master.amountCents ||
    partitionBrandSales(master).reduce((sum,s)=>sum+s.subtotalCents,0)!==total)
    throw Error("Master order and brand totals disagree.");
}

export async function persistPendingMixedOrder(pool,master,processingMode){
  assertValidSnapshot(master,processingMode);
  return atomic(pool,async tx=>{
    await tx.query(
      `INSERT INTO vsh_mixed_orders
       (id,customer_name,customer_email,amount_cents,currency,
        processing_mode,status,snapshot)
       VALUES ($1,$2,$3,$4,'ZAR',$5,'checkout_pending',$6::jsonb)`,
      [master.id,master.name,master.email,master.amountCents,
        processingMode,JSON.stringify(master)]
    );
    for(const line of master.items)await tx.query(
      `INSERT INTO vsh_mixed_order_lines
       (order_id,business,product_id,title,price_cents,private_pdf_path)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [master.id,line.business,line.id,line.title,line.priceCents,line.pdfPath]
    );
    return {orderId:master.id,status:"checkout_pending",mode:processingMode};
  });
}

export async function bindMixedYocoCheckout(pool,{
  orderId,checkoutId,amountCents,processingMode
}){
  if(!orderIdValid(orderId)||!checkoutID.test(checkoutId||"") ||
    !Number.isSafeInteger(amountCents)||!["live","test"].includes(processingMode))
    throw Error("Invalid checkout details.");
  return atomic(pool,async tx=>{
    const {rows}=await tx.query(
      "SELECT * FROM vsh_mixed_orders WHERE id=$1 FOR UPDATE",[orderId]
    );
    const order=rows[0];
    if(!order || Number(order.amount_cents)!==amountCents ||
      order.processing_mode!==processingMode)
      throw Error("Yoco checkout does not match stored order.");
    if(order.status==="awaiting_payment" && order.checkout_id===checkoutId)
      return {orderId,checkoutId,duplicate:true};
    if(order.status!=="checkout_pending" || order.checkout_id)
      throw Error("Checkout is already bound or order status changed.");
    const changed=await tx.query(
      `UPDATE vsh_mixed_orders
       SET checkout_id=$2,status='awaiting_payment',updated_at=now()
       WHERE id=$1 AND status='checkout_pending' AND checkout_id IS NULL
       RETURNING id`,[orderId,checkoutId]
    );
    if(changed.rows.length!==1)throw Error("Checkout could not be committed.");
    return {orderId,checkoutId,duplicate:false};
  });
}

export async function settleVerifiedMixedYocoPayment(pool,orderId,trustedConfirmation){
  if(!orderIdValid(orderId))throw Error("Invalid order identifier.");
  return atomic(pool,async tx=>{
    const {rows}=await tx.query(
      "SELECT * FROM vsh_mixed_orders WHERE id=$1 FOR UPDATE",[orderId]
    );
    const order=rows[0];
    if(!order)throw Error("Order does not exist.");
    if(!order.snapshot || order.snapshot.id!==orderId ||
      order.snapshot.amountCents!==Number(order.amount_cents) ||
      order.snapshot.email!==order.customer_email)
      throw Error("Stored order snapshot does not reconcile.");
    const master={...order.snapshot,id:orderId,checkoutId:order.checkout_id,
      processingMode:order.processing_mode};
    const plan=planAfterSignedPayment(master,trustedConfirmation);
    if(order.status==="paid"){
      if(order.payment_id!==plan.paymentId)
        throw Error("Conflicting payment for settled order.");
      return {orderId,duplicate:true,testOnly:plan.testOnly,
        insertedEmailJobs:0,brandCount:plan.sales.length};
    }
    if(order.status!=="awaiting_payment")
      throw Error("Order is not ready for payment confirmation.");

    // Payment event, order status, business sales, and outbox entries all
    // commit atomically, or all roll back. Unique constraints protect repeats.
    await tx.query(
      `INSERT INTO vsh_mixed_payment_events
       (event_id,order_id,checkout_id,payment_id) VALUES ($1,$2,$3,$4)`,
      [plan.eventId,orderId,plan.checkoutId,plan.paymentId]
    );
    const updated=await tx.query(
      `UPDATE vsh_mixed_orders SET status='paid',payment_id=$2,
       paid_at=now(),updated_at=now()
       WHERE id=$1 AND status='awaiting_payment'
       RETURNING id`,[orderId,plan.paymentId]
    );
    if(updated.rows.length!==1)throw Error("Concurrent order transition.");
    for(const sale of plan.sales){
      await tx.query(
        `INSERT INTO vsh_mixed_brand_sales
         (order_id,business,subtotal_cents,currency) VALUES ($1,$2,$3,'ZAR')`,
        [orderId,sale.business,sale.subtotalCents]
      );
    }
    // Test-mode orders may be marked test-paid internally, but never enqueue
    // dispatchable email tasks or grant downloads.
    for(const job of plan.jobs){
      await tx.query(
        `INSERT INTO vsh_mixed_email_outbox
         (id,order_id,business,kind,sender,recipient,payload,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'pending')`,
        [job.id,orderId,job.business,job.type,job.sender,job.recipient,
          JSON.stringify(job)]
      );
    }
    return {orderId,duplicate:false,testOnly:plan.testOnly,
      insertedEmailJobs:plan.jobs.length,brandCount:plan.sales.length};
  });
}
