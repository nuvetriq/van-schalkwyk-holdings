import crypto from "node:crypto";
import { openVSHStore } from "../lib/catalogue-store.mjs";
import { authStatus, json, BUSINESSES } from "../lib/auth.mjs";

// Shared PRIVATE PDF storage for Granny's recipe books and Clever Cubs books.
// There is intentionally no GET/download route; paid fulfillment is separate.
// The existing store name is retained to keep legacy Granny's draft orders compatible.
const pdfStore = () => openVSHStore({ name: "vsh-private-recipe-pdfs", consistency: "strong" });
const MAX_SIZE = 3 * 1024 * 1024;
export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const auth = authStatus(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    // Limit request body size before parsing multipart content where available.
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_SIZE + 100 * 1024) {
      return json({ error: "PDF upload exceeds the 3 MB limit." }, 413);
    }
    const form = await request.formData();
    const business = form.get("business");
    const pdf = form.get("file");
    if (!BUSINESSES.has(business)) return json({ error: "Choose Granny's or Clever Cubs." }, 400);
    if (!pdf || typeof pdf.arrayBuffer !== "function" || pdf.size < 8 || pdf.size > MAX_SIZE) {
      return json({ error: "Choose a PDF between 8 bytes and 3 MB." }, 400);
    }
    if (pdf.type !== "application/pdf" && !/\.pdf$/i.test(String(pdf.name || ""))) {
      return json({ error: "Only PDF book files are permitted." }, 400);
    }
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    // Check the PDF header AND EOF marker instead of trusting the extension/MIME alone.
    if (Buffer.from(bytes.subarray(0,5)).toString("ascii") !== "%PDF-" ||
        !Buffer.from(bytes.subarray(Math.max(0,bytes.length-2048))).toString("latin1").includes("%%EOF")) {
      return json({ error: "The file does not look like a complete PDF. Please check it and try again." }, 400);
    }
    const key = business + "/" + crypto.randomUUID() + ".pdf";
    await pdfStore().set(key, bytes.buffer);
    return json({ pdf_path: key, size_bytes: pdf.size }, 201);
  } catch (error) {
    console.error("Private book PDF upload failed", error);
    return json({ error: "Could not securely save the PDF. Please try again." }, 500);
  }
}
