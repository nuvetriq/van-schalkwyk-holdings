/* Server-only adapter for EXISTING uploaded PDFs in the Holdings project.
 *
 * Small PDF: vsh-private-recipe-pdfs/<brand>/<upload-id>.pdf
 * Chunked:   vsh-private-recipe-pdfs/<brand>/<upload-id>.manifest.json
 *            vsh-private-book-parts/<brand>/<upload-id>/part/<five digits>
 *
 * All names/keys are derived from a verified paid order and private manifest.
 * This module NEVER grants or authorizes downloads: use only after
 * readAuthorizedPaidBookPart validates the signed/hashed paid book grant.
 * Site-wide Blob stores are private; do not expose them in public responses.
 */
import {openVSHStore} from "./catalogue-store.mjs";
import {PDF_PART_BYTES} from "./mixed-book-private-pdf-parts.mjs";

const KEY=/^(grannys|clever-cubs)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(pdf|manifest\.json)$/i;
const PART=/^(grannys|clever-cubs)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/part\/([0-9]{5})$/i;
const SMALL="vsh-private-recipe-pdfs";
const LARGE="vsh-private-book-parts";

function requireBook(business,path,extension) {
  if(typeof path!=="string")throw Error("Invalid private PDF identity.");
  const match=KEY.exec(path);
  if(!match || match[1]!==business || match[3]!==extension)
    throw Error("Invalid private PDF identity.");
  return match[2].toLowerCase();
}
function bytesFrom(blob){
  if(!blob || !(blob.data instanceof ArrayBuffer))
    throw Error("Private PDF bytes are missing.");
  return new Uint8Array(blob.data);
}
export function createMixedBookPrivatePdfStore({openStore=openVSHStore}={}){
  if(typeof openStore!=="function")
    throw Error("Private PDF storage is unavailable.");
  const small=openStore(SMALL);
  const large=openStore(LARGE);
  const cache=new Map();
  async function smallFile(business,path){
    requireBook(business,path,"pdf");
    if(cache.has(path))return cache.get(path);
    const blob=await small.getWithMetadata(path,{type:"arrayBuffer"});
    if(!blob)return null;
    const bytes=bytesFrom(blob);
    if(bytes.byteLength<8 || bytes.byteLength>PDF_PART_BYTES)
      throw Error("Small book exceeds the safe per-part limit.");
    const copy={bytes,metadata:blob.metadata||{}};
    cache.set(path,copy);
    return copy;
  }
  return Object.freeze({
    async getManifest(business,path){
      const uploadId=requireBook(business,path,"manifest.json");
      const manifest=await small.get(path,{type:"json"});
      // The detailed size/count/content checks are performed by the paid
      // reader's validateSealedBookManifest. Enforce ownership here too.
      if(manifest && (manifest.business!==business ||
        typeof manifest.id!=="string" ||
        manifest.id.toLowerCase()!==uploadId))
        throw Error("Private manifest ownership mismatch.");
      return manifest;
    },
    async getSmallPdfSize(business,path){
      const file=await smallFile(business,path);
      return file?.bytes.byteLength??null;
    },
    async getPart(storeName,key){
      if(storeName===SMALL){
        const match=KEY.exec(key||"");
        if(!match || match[3]!=="pdf")throw Error("Invalid small PDF key.");
        const file=await smallFile(match[1],key);
        return file ? {bytes:file.bytes,metadata:file.metadata}:null;
      }
      if(storeName!==LARGE || typeof key!=="string" || !PART.test(key))
        throw Error("Invalid private PDF part key.");
      const blob=await large.getWithMetadata(key,{type:"arrayBuffer"});
      if(!blob)return null;
      const bytes=bytesFrom(blob);
      if(bytes.byteLength<1 || bytes.byteLength>PDF_PART_BYTES)
        throw Error("Private PDF part is too large.");
      return {bytes,metadata:blob.metadata||{}};
    }
  });
}
