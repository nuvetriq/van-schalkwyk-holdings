/* REVIEW-ONLY, server-side LIVE paid-book email batch orchestration.
 *
 * This module has no default export, no Netlify Function or schedule, no
 * payment API calls, and no side effects at import. It cannot enable sending
 * by itself: the existing worker additionally validates ALL payment/email/
 * download flags, both verified brand Gmail identities and private link key.
 *
 * A future separately approved, privileged scheduler may invoke ONE bounded
 * batch. An ambiguous SMTP result is quarantined by the existing outbox;
 * this runner MUST NOT automatically repeat that job.
 */
import {createControlledMixedBookEmailWorker}
  from "./mixed-book-email-worker-draft.mjs";

const BRANDS=Object.freeze(["grannys","clever-cubs"]);
const STATUSES=new Set(["empty","sent","retry","failed","unknown"]);
const KINDS=new Set(["customer-delivery","merchant-sale-notice"]);

const refuse=()=>{throw Error("Live branded book delivery is not enabled.");};

export function createControlledMixedBookEmailBatch({
  enabled=false,operatorApproved=false,
  context,env=process.env,
  maxJobs=4,
  workerFactory=createControlledMixedBookEmailWorker,
  ...workerDependencies
}={}){
  // Limit work even if a future privileged scheduler is accidentally
  // triggered many times. Never allow a user-defined unbounded sweep.
  if(enabled!==true || operatorApproved!==true ||
     context?.deploy?.context!=="production" ||
     !Number.isSafeInteger(maxJobs) || maxJobs<1 || maxJobs>4 ||
     typeof workerFactory!=="function")refuse();

  // The worker performs a second fail-closed readiness check, including the
  // paid LIVE PostgreSQL outbox and both brand-specific Gmail identities.
  const worker=workerFactory({
    ...workerDependencies,
    enabled:true,operatorApproved:true,context,env
  });
  if(!worker || typeof worker.runOne!=="function")refuse();

  return Object.freeze({
    async runBatch(){
      const summary={
        jobsAttempted:0,sent:0,retry:0,failed:0,unknown:0,empty:false,
        byBrand:{
          "grannys":{sent:0,retry:0,failed:0,unknown:0},
          "clever-cubs":{sent:0,retry:0,failed:0,unknown:0}
        }
      };
      for(let i=0;i<maxJobs;i++){
        const item=await worker.runOne();
        if(!item || !STATUSES.has(item.status))refuse();
        if(item.status==="empty"){
          summary.empty=true;
          break;
        }
        if(!BRANDS.includes(item.business) || !KINDS.has(item.kind))refuse();
        summary.jobsAttempted++;
        summary[item.status]++;
        summary.byBrand[item.business][item.status]++;
        // NEVER auto-retry 'unknown' mail. The underlying SQL claim
        // quarantines it for operator reconciliation.
      }
      const frozenBrands=Object.fromEntries(
        BRANDS.map(business=>[business,Object.freeze(summary.byBrand[business])])
      );
      return Object.freeze({
        jobsAttempted:summary.jobsAttempted,sent:summary.sent,
        retry:summary.retry,failed:summary.failed,
        unknown:summary.unknown,queueExhausted:summary.empty,
        byBrand:Object.freeze(frozenBrands),
        emailsMayHaveBeenAccepted:summary.sent+summary.unknown
      });
    }
  });
}
