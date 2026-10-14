import crypto from "node:crypto";
import { openVSHStore } from "../lib/catalogue-store.mjs";
import { authStatus, json, BUSINESSES } from "../lib/auth.mjs";

const store = () => openVSHStore({ name: "vsh-products", consistency: "strong" });
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
  const isBook = business === "clever-cubs" ||
    (business === "grannys" && /^recipe books?$/i.test(category));
  // Book files must be kept in the matching business folder, not attached to treats
  // or another business's listing. They are NEVER included in public responses.
  if (pdf && (!isBook || !new RegExp("^"+business+"/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:pdf|manifest\\.json)$","i").test(pdf))) {
    throw Error("Invalid private PDF path for this business.");
  }
  if (isBook && input.is_active === true && !pdf)
    throw Error("Upload the private PDF before publishing a digital book.");
  if (isBook && input.is_active === true && price < 1)
    throw Error("A published digital book needs a price of at least R1.00.");
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
        id, business, title, category, grade, description, price, image_path, is_active, updated_at, has_pdf: Boolean(pdf_path)
      })) });
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
    // A digital book cannot be published with a fake, deleted or missing PDF key.
    // Also verify referenced private PDFs even when saving a draft to prevent
    // assigning invented paths to a product.
    if (payload.pdf_path) {
      const pdfStore = openVSHStore({ name: "vsh-private-recipe-pdfs", consistency: "strong" });
      const metadata = await pdfStore.getMetadata(payload.pdf_path);
      if (!metadata) return json({ error: "The private PDF cannot be found. Please upload it again." }, 400);
      // Chunked PDFs are *manifests*, not inline PDF files. Confirm their
      // recorded business and complete status before accepting a reference.
      if (payload.pdf_path.endsWith(".manifest.json")) {
        const manifest=await pdfStore.get(payload.pdf_path,{type:"json"});
        if(manifest?.kind!=="chunked-pdf" || manifest.version!==1 ||
          manifest.business!==payload.business || manifest.part_count<1 ||
          !Number.isSafeInteger(manifest.size_bytes) ||
          manifest.part_bytes!==3*1024*1024) {
          return json({error:"Private PDF upload isn't complete. Please upload it again."},400);
        }
      }
    }
    // Image paths must point to an existing upload in the appropriate business.
    if (payload.image_path) {
      const imgStore = openVSHStore({ name: "vsh-product-images", consistency: "strong" });
      if (!await imgStore.getMetadata(payload.image_path))
        return json({ error: "The product photo cannot be found. Please upload it again." }, 400);
    }
    const now = new Date().toISOString();
    const product = { ...payload, id, created_at: existing?.created_at || now, updated_at: now };
    await db.setJSON(key, product);
    return json({ product }, existing ? 200 : 201);
  } catch (error) {
    console.error("Product save failed:", error);
    return json({ error: "Could not save product." }, 500);
  }
}
