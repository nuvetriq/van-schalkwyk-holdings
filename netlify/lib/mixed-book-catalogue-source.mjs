/* Server-authoritative product/PDF lookups for mixed-brand digital checkout.
 * Read-only; does not make private Blob stores public or modify uploads.
 * Must only be called from a guarded Netlify server Function.
 */
import {openVSHStore} from "./catalogue-store.mjs";
import {BRANDS,UUID} from "./mixed-book-order.mjs";

const namespaces=Object.freeze({
  products:"vsh-products",
  pdfs:"vsh-private-recipe-pdfs"
});
export function createMixedBookCatalogueSource({openStore=openVSHStore}={}){
  if(typeof openStore!=="function")throw Error("Private Blob store adapter is unavailable.");
  const products=openStore(namespaces.products);
  const files=openStore(namespaces.pdfs);
  const validBusiness=business=>BRANDS.includes(business);
  const belongs=(business,id)=>validBusiness(business)&&
    typeof id==="string"&&UUID.test(id);
  const pdfKey=business=>new RegExp("^"+business+
    "/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:pdf|manifest\\.json)$","i");
  return Object.freeze({
    async getProduct(business,id){
      if(!belongs(business,id))return null;
      const product=await products.get(business+"/"+id.toLowerCase()+".json",{type:"json"});
      if(!product || product.business!==business || product.id!==id.toLowerCase() ||
        product.is_active!==true || !product.pdf_path ||
        !pdfKey(business).test(product.pdf_path))return null;
      // Return the entire trusted stored record to snapshotMixedOrder.
      // NEVER send it to a browser: it contains a private PDF key.
      return product;
    },
    async getPrivateFile(business,path){
      if(!validBusiness(business)||typeof path!=="string"||
         !pdfKey(business).test(path))return null;
      const metadata=await files.getMetadata(path);
      if(!metadata)return null;
      const manifest=path.endsWith(".manifest.json") ?
        await files.get(path,{type:"json"}):null;
      if(manifest && (manifest.business!==business ||
        manifest.id!==path.slice(business.length+1,-".manifest.json".length)))
        return null;
      return {metadata,manifest};
    }
  });
}
