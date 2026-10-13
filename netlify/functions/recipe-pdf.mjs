import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { authStatus, json } from "../lib/auth.mjs";

// This storage endpoint is private. There is deliberately NO GET route here.
const pdfStore = () => getStore({ name: "vsh-private-recipe-pdfs", consistency: "strong" });
const MAX_SIZE = 3 * 1024 * 1024;
export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const auth = authStatus(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  try {
    const form = await request.formData();
    const pdf = form.get("file");
    if (!pdf || typeof pdf.arrayBuffer !== "function" || pdf.size < 8 || pdf.size > MAX_SIZE) {
      return json({ error: "Please choose a PDF under 3 MB." }, 400);
    }
    if (pdf.type !== "application/pdf" && !/\.pdf$/i.test(String(pdf.name || ""))) {
      return json({ error: "Only PDF files are permitted." }, 400);
    }
    const data = new Uint8Array(await pdf.arrayBuffer());
    // PDF magic bytes, disallow an image or arbitrary data disguised as a PDF.
    if (Buffer.from(data.subarray(0,5)).toString("ascii") !== "%PDF-") {
      return json({ error: "This is not a valid PDF file." }, 400);
    }
    const key = "grannys/" + crypto.randomUUID() + ".pdf";
    await pdfStore().set(key, data);
    return json({ pdf_path: key }, 201);
  } catch (error) {
    console.error("Private recipe PDF upload failed", error);
    return json({ error: "Could not securely save your PDF." }, 500);
  }
}
