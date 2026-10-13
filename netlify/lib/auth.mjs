import crypto from "node:crypto";

export function authStatus(request) {
  const expected = process.env.VSH_ADMIN_KEY || "";
  if (!expected || expected.length < 32) return { ok: false, status: 503, error: "Admin access is not configured." };
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
