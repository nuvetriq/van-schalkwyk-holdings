/* Release evidence is a dated human-readable screenshot summary, NOT a
 * Netlify DB API audit, successful restore verification or user authorization.
 * This test prevents green CI from being interpreted as release approval.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";

const path="docs/database/OWNER-NETLIFY-RELEASE-EVIDENCE.json";
const evidence=JSON.parse(await readFile(path,"utf8"));
test("Dated scheduled backup does not permit migration without restore-readiness and owner approval",()=>{
  assert.equal(evidence.status,"DRAFT_ONLY_NO_GO");
  assert.equal(evidence.release_gate,"NO_GO");
  assert.equal(evidence.project,"vanschalkwykholdings.com");
  assert.equal(evidence.as_of,"2026-11-02");
  assert.match(evidence.source,/screenshots/);
  assert.equal(evidence.production_database.public_schema_table_count_observed,0);
  assert.equal(evidence.production_database.custom_schemas_checked,false);
  assert.equal(evidence.backup.configured_scheduled_retention_days,7);
  assert.equal(evidence.backup.configured_on_publish_retained_deploys,3);
  assert.equal(evidence.backup.dated_existing_backup_verified,true);
  assert.equal(evidence.backup.pre_migration_candidate_listed,true);
  assert.equal(evidence.backup.backup_type_observed,"Scheduled");
  assert.equal(evidence.backup.backup_date_time_displayed,"2026-11-02 05:00 AM");
  assert.equal(evidence.backup.backup_display_timezone,"not shown in screenshot");
  assert.equal(evidence.backup.restore_button_observed,true);
  assert.equal(evidence.backup.restoration_success_verified,false);
  assert.equal(evidence.backup.pre_migration_restore_point_verified,false);
  assert.equal(evidence.backup.dated_backup_id,null);
  assert.equal(evidence.backup.recovery_test_performed,false);
  assert.ok(evidence.blockers.some(item=>item.includes("backup")));
});
test("Credit balance and public-schema screenshot cannot authorize deployment",()=>{
  assert.equal(evidence.billing_snapshot.listed_monthly_credits,1000);
  assert.equal(evidence.billing_snapshot.listed_available_credits,1878.4);
  assert.equal(evidence.billing_snapshot.used_credits_current_period,6.2);
  assert.equal(evidence.billing_snapshot.future_usage_or_cost_verified,false);
  assert.deepEqual(Object.values(evidence.approvals),Array(6).fill(false));
  assert.equal(existsSync("netlify/database/migrations"),false,
    "A draft migration must never automatically run during deployment.");
  assert.equal(existsSync("docs/database/mixed-book-orders-DRAFT.sql"),true);
});
test("Backup policy and dated restore-point evidence stay clearly distinct in runbook",async()=>{
  const runbook=await readFile(
    "docs/database/MIXED-BOOK-DATABASE-BACKUP-MIGRATION-ROLLBACK-RUNBOOK.md","utf8"
  );
  assert.match(runbook,/(?:7|seven) days/i);
  assert.match(runbook,/three most recent deploys/i);
  assert.match(runbook,/Scheduled.*5:00 AM/i);
  assert.match(runbook,/NO-GO/);
  assert.match(runbook,/not.*database connection or proof of restoration capability/i);
  assert.match(runbook,/restoration were NOT checked/i);
  assert.match(runbook,/DO NOT click Restore/i);
});
