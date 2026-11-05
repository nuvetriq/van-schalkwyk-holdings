/* Validate the already-approved production schema at PR #6 without modifying it.
 * Code-only release candidate: exactly one pre-existing migration is allowed.
 * This is a static repository check; it does not query any live database.
 */
import assert from "node:assert/strict";
import {existsSync,readdirSync,readFileSync} from "node:fs";
const ROOT="netlify/database/migrations";
const FILE="20261102000000_mixed_book_schema_preview.sql";
export const approvedMigrationPath=ROOT+"/"+FILE;
export function expectedApprovedSql(){
 const draft=readFileSync("docs/database/mixed-book-orders-DRAFT.sql","utf8");
 return draft
  .replace(/^-- DRAFT ONLY\..*\n/m,"")
  .replace(/^-- Do NOT place.*\n/m,"")
  .replace(/^[ \t]*BEGIN;\s*\n/m,"")
  .replace(/^[ \t]*COMMIT;\s*$/m,"")
  .trim()+"\n";
}
export function requireApprovedProductionSchemaBaseline(){
 assert.ok(existsSync(ROOT),"Previously approved migration must remain present");
 assert.deepEqual(readdirSync(ROOT).sort(),[FILE],
   "Exactly one previously approved migration; no additional migrations permitted");
 const actual=readFileSync(approvedMigrationPath,"utf8");
 assert.equal(actual,expectedApprovedSql(),
   "Existing production schema file must exactly match the approved six-table draft");
 assert.doesNotMatch(actual,/^\s*(?:BEGIN|COMMIT)\s*;/mi,
   "Netlify migration runner owns transaction boundaries");
 assert.doesNotMatch(actual,/\b(?:DROP TABLE|ALTER TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE vsh_mixed_)\b/i);
 assert.equal((actual.match(/\bCREATE TABLE vsh_mixed_[a-z_]+/g)||[]).length,6);
 return true;
}
