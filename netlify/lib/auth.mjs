import crypto from "node:crypto";

export function authStatus(request) {
  const expected = process.env.VSH_ADMIN_KEY || "";
  // This distinction makes Netlify preview setup issues diagnosable without
  // ever returning the key, its length, or any part of its value.
  if (!expected) {
    console.error("Admin login setup: VSH_ADMIN_KEY is missing from this deployed Netlify Function.");
    return { ok: false, status: 503, error: "The admin key is not available to Netlify Functions in this deployment. Rebuild the Deploy Preview after configuring VSH_ADMIN_KEY." };
  }
  if (expected.length < 32) {
    console.error("Admin login setup: VSH_ADMIN_KEY does not meet the 32-character minimum.");
    return { ok: false, status: 503, error: "The admin key configured in Netlify is shorter than 32 characters. Replace it with a long random key, then rebuild the Deploy Preview." };
  }
  const actual = request.headers.get("X-Admin-Key") || "";
  const digest = value => crypto.createHash("sha256").update(value).digest();
  if (!crypto.timingSafeEqual(digest(actual), digest(expected))) {
    return { ok: false, status: 401, error: "Invalid admin key." };
  }
  return { ok: true };
}
export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
export const BUSINESSES = new Set(["grannys", "clever-cubs"]);
