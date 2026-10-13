import { getStore, getDeployStore } from "@netlify/blobs";

// Production catalogues persist across normal site updates.
// Every preview, branch deploy and local test gets its own isolated store.
// Fail closed to deploy-scoped storage if CONTEXT is missing or unrecognised.
export function openVSHStore(name) {
  if (process.env.CONTEXT === "production") {
    return getStore({ name, consistency: "strong" });
  }
  return getDeployStore({ name, consistency: "strong" });
}
