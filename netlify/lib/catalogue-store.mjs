import { getStore } from "@netlify/blobs";

// Production-only admin helper. Persist products, cover images and private PDF
// files site-wide across deployments. Draft branch storage remains isolated.
export function openVSHStore(nameOrOptions) {
  const options = typeof nameOrOptions === "string"
    ? { name: nameOrOptions, consistency: "strong" }
    : { ...nameOrOptions, consistency: "strong" };
  if (!options.name || typeof options.name !== "string")
    throw new Error("A valid storage namespace is required.");
  return getStore(options);
}
