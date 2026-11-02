/* Preview ONLY schema verification for approved isolated PR.
 * Never use as runtime authorization. GitHub Actions must be running from
 * this exact non-production branch. Fails CI after any merge to main.
 */
import assert from "node:assert/strict";
import {existsSync,readdirSync,readFileSync} from "node:fs";
const BRANCH="release/preview-mixed-book-schema-20261102";
const ROOT="netlify/database/migrations";
const FILE="20261102000000_mixed_book_schema_preview.sql";
export const previewMigrationPath=ROOT+"/"+FILE;
export function expectedPreviewSql(){
 const draft=readFileSync("docs/database/mixed-book-orders-DRAFT.sql","utf8");
 return draft
  .replace(/^-- DRAFT ONLY\..*\n/m,"")
  .replace(/^-- Do NOT place.*\n/m,"")
  .replace(/^[ \t]*BEGIN;\s*\n/m,"")
  .replace(/^[ \t]*COMMIT;\s*$/m,"")
  .trim()+"\n";
}
export function requireApprovedPreviewMigration(){
 const head=process.env.GITHUB_HEAD_REF||process.env.GITHUB_REF_NAME;
 assert.equal(head,BRANCH,
   "Migration is permitted in CI only for the explicitly approved preview branch");
 assert.notEqual(process.env.GITHUB_BASE_REF,BRANCH,
   "Never use the preview migration branch as a production base");
 assert.ok(existsSync(ROOT),"Isolated PR must include its reviewed migration");
 assert.deepEqual(readdirSync(ROOT).sort(),[FILE],
   "Exactly one reviewable migration, no auto-added migrations");
 const actual=readFileSync(previewMigrationPath,"utf8");
 assert.equal(actual,expectedPreviewSql(),
   "Preview schema must exactly match the reviewed additive six-table draft");
 assert.doesNotMatch(actual,/^\s*(?:BEGIN|COMMIT)\s*;/mi,
   "Netlify migration runner owns transaction boundaries");
 assert.doesNotMatch(actual,/\b(?:DROP TABLE|ALTER TABLE|TRUNCATE TABLE|DELETE FROM|UPDATE vsh_mixed_)\b/i);
 assert.equal((actual.match(/\bCREATE TABLE vsh_mixed_[a-z_]+/g)||[]).length,6);
 return true;
}
