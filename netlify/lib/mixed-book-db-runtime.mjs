/* Netlify Database adapter for the mixed-brand bookshop.
 *
 * Server-only, OFF by default, NOT imported by any live Netlify Function.
 * Netlify supplies the correct branch connection using getDatabase().
 * Never copy NETLIFY_DB_URL or personal access tokens into GitHub.
 *
 * Gate is deliberately separate from payment flags: database experiments
 * must not make checkout, emails or private PDF downloads customer-accessible.
 * Draft SQL has NOT been placed in Netlify's automatic migration directory.
 */
import {getDatabase} from "@netlify/database";

const contexts=new Set(["production","deploy-preview"]);
export function openMixedBookPool({
  context,
  enabled=process.env.VSH_MIXED_BOOK_DB_ENABLED,
  databaseFactory=getDatabase
}={}) {
  if(enabled!=="true")throw Error("Mixed-book database access is disabled.");
  const deployContext=context?.deploy?.context;
  if(!contexts.has(deployContext))
    throw Error("Mixed-book database requires an authorised Netlify deploy context.");
  if(typeof databaseFactory!=="function")
    throw Error("Invalid database connector.");
  // This call uses Netlify's automatically supplied branch-specific URL.
  // No hardcoded connection strings, fallbacks or URL logging.
  const database=databaseFactory();
  const pool=database?.pool;
  if(!pool || typeof pool.connect!=="function" || typeof pool.query!=="function")
    throw Error("Netlify Database did not provide a transactional pool.");
  return pool;
}
