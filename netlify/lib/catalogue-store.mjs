import { getStore, getDeployStore } from "@netlify/blobs";

// Some callers use a name string; others use the Netlify options-object form.
// Support both while always enabling strong consistency.
// Production data persists between releases. Draft/previews are isolated.
// Fail closed to deploy-scoped storage if CONTEXT is missing or unknown.
export function openVSHStore(nameOrOptions) {
  const options = typeof nameOrOptions === "string"
    ? { name: nameOrOptions, consistency: "strong" }
    : { ...nameOrOptions, consistency: "strong" };
  if (!options.name || typeof options.name !== "string") {
    throw new Error("A valid storage namespace is required.");
  }
  return process.env.CONTEXT === "production"
    ? getStore(options)
    : getDeployStore(options);
}
