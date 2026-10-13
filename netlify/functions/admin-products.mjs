import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { authStatus, json, BUSINESSES } from "../lib/auth.mjs";

const store = () => getStore({ name: "vsh-products", consistency: "strong" });
const uuidRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function keyFor(business, id) { return business + "/" + id + ".json"; }
function clean(value, maxLength) { return String(value ?? "").trim().slice(0, maxLength); }
function validImage(path, business) {
  return path === null || path === "" || (
    typeof path === "string" &&
    new RegExp("^" + business + "/[0-9a-f-]{36}\\.(jpg|png|webp)$", "i").test(path)
  );
}
function validate(input) {
  if (!input || typeof input !== "object" || !BUSINESSES.has(input.business)) throw Error("Invalid business.");
  const business = input.business;
  const title = clean(input.title, 121), category = clean(input.category, 81);
  const description = clean(input.description, 1001), grade = clean(input.grade, 81);
  const price = Number(input.price);
  if (!title || title.length > 120) throw Error("Enter a product name (max 120 characters).");
  if (!category || category.length > 80) throw Error("Enter a category (max 80 characters).");
  if (description.length > 1000 || grade.length > 80) throw Error("Description or size is too long.");
  if (typeof input.price === "boolean" || !Number.isFinite(price) || price < 0 || price > 999999.99) throw Error("Invalid price.");
  if (!validImage(input.image_path, business)) throw Error("Invalid image path.");
  const pdf = input.pdf_path == null || input.pdf_path === "" ? null : String(input.pdf_path);
  if (pdf && (business !== "grannys" || !/^grannys\/[0-9a-f-]{36}\.pdf$/i.test(pdf))) {
    throw Error("Invalid private PDF path.");
  }
  // Only the recipe-book category supports downloadable PDFs.
  if (pdf && !/^recipe books?$/i.test(category)) throw Error("Only recipe books may have a PDF.");
  if (business==="grannys" && /^recipe books?$/i.test(category) && input.is_active===true && !pdf)
    throw Error("Please upload the private recipe PDF before publishing this book.");

  return {
    business, title, category, description, grade,
    price: Math.round(price * 100) / 100,
    image_path: input.image_path || null,
    pdf_path: pdf,
    is_active: input.is_active === true
  };
}
export default async function handler(request) {
  const url = new URL(request.url);
  const business = url.searchParams.get("business");
  const admin = url.searchParams.get("admin") === "1";
  const verify = url.searchParams.get("verify") === "1";
  if (request.method === "OPTIONS") return new Response(null, { status: 405 });
  const authorized = authStatus(request);
  if (verify) {
    return authorized.ok ? json({ ok: true }) : json({ error: authorized.error }, authorized.status);
  }
  if (request.method === "GET") {
    if (!BUSINESSES.has(business)) return json({ error: "Unknown business." }, 400);
    if (admin && !authorized.ok) return json({ error: authorized.error }, authorized.status);
    try {
      const db = store();
      const { blobs } = await db.list({ prefix: business + "/" });
      const records = await Promise.all(blobs.map(item => db.get(item.key, { type: "json" })));
      const output = records.filter(row => row && row.business === business)
        .filter(row => admin || row.is_active === true)
        .sort((a,b) => b.updated_at.localeCompare(a.updated_at));
      // Public clients only receive the approved display fields.
      if (!admin) return json({ products: output.map(({ id, business, title, category, grade, description, price, image_path, is_active, updated_at, pdf_path }) => ({
        id, business, title, category, grade, description, price, image_path, is_active, updated_at, has_pdf: Boolean(pdf_path)\n      })) });
      return json({ products: output });
    } catch (error) {
      console.error("Product read failed:", error);
      return json({ error: "Could not load products." }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!authorized.ok) return json({ error: authorized.error }, authorized.status);
  const raw = await request.text();
  if (raw.length > 16000) return json({ error: "Product details are too large." }, 413);
  let payload;
  try { payload = validate(JSON.parse(raw)); }
  catch (error) { return json({ error: error.message || "Invalid product." }, 400); }
  const id = url.searchParams.get("id") || crypto.randomUUID();
  if (!uuidRE.test(id)) return json({ error: "Invalid product identifier." }, 400);
  const key = keyFor(payload.business, id);
  try {
    const db = store();
    const existing = await db.get(key, { type: "json" });
    if (url.searchParams.has("id") && !existing) return json({ error: "Product not found." }, 404);
    if (!url.searchParams.has("id") && existing) return json({ error: "Product already exists." }, 409);
    const now = new Date().toISOString();
    const product = { ...payload, id, created_at: existing?.created_at || now, updated_at: now };
    await db.setJSON(key, product);
    return json({ product }, existing ? 200 : 201);
  } catch (error) {
    console.error("Product save failed:", error);
    return json({ error: "Could not save product." }, 500);
  }
}
