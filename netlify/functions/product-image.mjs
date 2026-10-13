import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { authStatus, json, BUSINESSES } from "../lib/auth.mjs";

const MAX_SIZE = 3 * 1024 * 1024; // conservative limit under Netlify's buffered request cap
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const keyRE = /^(grannys|clever-cubs)\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const store = () => getStore({ name: "vsh-product-images", consistency: "strong" });
export default async function handler(request) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const key = url.searchParams.get("key") || "";
    const match = key.match(keyRE);
    if (!match) return json({ error: "Invalid image." }, 400);
    try {
      const image = await store().get(key, { type: "arrayBuffer" });
      if (image === null) return json({ error: "Image not found." }, 404);
      return new Response(image, {
        status: 200,
        headers: {
          "Content-Type": MIME[match[2].toLowerCase()],
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (error) {
      console.error("Image read failed:", error);
      return json({ error: "Image unavailable." }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const authorized = authStatus(request);
  if (!authorized.ok) return json({ error: authorized.error }, authorized.status);
  try {
    const form = await request.formData();
    const business = form.get("business");
    const image = form.get("file");
    if (!BUSINESSES.has(business) || !image || typeof image.arrayBuffer !== "function") {
      return json({ error: "Please select a business and a picture." }, 400);
    }
    const mimeToExt = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const extension = mimeToExt[image.type];
    if (!extension || image.size > MAX_SIZE || image.size <= 0) {
      return json({ error: "Upload a JPG, PNG or WebP up to 3 MB." }, 400);
    }
    const data = await image.arrayBuffer();
    // Verify image headers, not just the Content-Type provided by the browser.
    const bytes = new Uint8Array(data);
    const isJPEG = extension === "jpg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPNG = extension === "png" && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
    const isWebP = extension === "webp" && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
    if (!isJPEG && !isPNG && !isWebP) return json({ error: "Invalid image file." }, 400);
    const key = business + "/" + crypto.randomUUID() + "." + extension;
    await store().set(key, data);
    return json({ image_path: key }, 201);
  } catch (error) {
    console.error("Image upload failed:", error);
    return json({ error: "Could not upload the image." }, 500);
  }
}
