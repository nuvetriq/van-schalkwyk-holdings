import crypto from "node:crypto";
import { openVSHStore } from "./catalogue-store.mjs";

// Server-only order snapshots. Both businesses share the structure while
// retaining separate product namespaces and PDF ownership.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const BUSINESSES = new Set(["grannys", "clever-cubs"]);
const MAX_CART = 8;
const MAX_ORDER_CENTS = 5000000;
const PART_SIZE = 3*1024*1024;
const products = () => openVSHStore("vsh-products");
const privatePDFs = () => openVSHStore("vsh-private-recipe-pdfs");
const orders = () => openVSHStore("vsh-book-orders");
const checkouts = () => openVSHStore("vsh-book-checkouts");
export const orderKey = (business,id) => "orders/"+business+"/"+id+".json";
export const checkoutKey = id => "checkout/"+id+".json";

export function priceToCents(value) {
  if(typeof value==="boolean" || value===null || value==="" ||
     !Number.isFinite(Number(value)) || Number(value)<1) return null;
  const cents=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(cents) || cents>MAX_ORDER_CENTS ||
    Math.abs(Number(value)*100-cents)>0.000001) return null;
  return cents;
}

export function validPDFPath(business,path) {
  if(!BUSINESSES.has(business) || typeof path!=="string") return false;
  return new RegExp("^"+business+"/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:pdf|manifest\\.json)$","i").test(path);
}

export function validBook(product,business) {
  if(!product || product.business!==business || product.is_active!==true ||
    !UUID.test(product.id||"") || !String(product.title||"").trim() ||
    !validPDFPath(business,product.pdf_path) || priceToCents(product.price)===null)
    return false;
  if(business==="grannys" && !/^recipe books?$/i.test(String(product.category||"").trim()))
    return false;
  return true;
}

export function validateCartInput(input) {
  if(!input || !BUSINESSES.has(input.business))throw Error("Invalid bookshop.");
  const ids=input.ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>MAX_CART||
    ids.some(id=>typeof id!=="string" || !UUID.test(id))||
    new Set(ids).size!==ids.length)throw Error("Choose up to eight different PDF books.");
  const name=String(input.name||"").trim().slice(0,120);
  const email=String(input.email||"").trim().toLowerCase().slice(0,254);
  if(name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
     /[\r\n]/.test(name))throw Error("Enter your name and a valid email address.");
  return {business:input.business,ids,name,email};
}

export async function snapshotCart(input) {
  const {business,ids,name,email}=validateCartInput(input);
  const productRecords=await Promise.all(ids.map(id=>products().get(business+"/"+id+".json",{type:"json"})));
  if(productRecords.some((p,i)=>!validBook(p,business)||p.id!==ids[i]))
    throw Error("One or more books are unavailable. Please refresh the catalogue.");

  const pdfStore=privatePDFs();
  // This check is intentionally independent of the public product data:
  // a book must have a real private PDF/manifest before checkout is offered.
  const files=await Promise.all(productRecords.map(async p=>{
    const metadata=await pdfStore.getMetadata(p.pdf_path);
    if(!metadata)return false;
    if(p.pdf_path.endsWith(".manifest.json")){
      const m=await pdfStore.get(p.pdf_path,{type:"json"});
      return m?.kind==="chunked-pdf" && m.version===1 && m.business===business &&
        Number.isSafeInteger(m.size_bytes) && m.size_bytes>=8 &&
        Number.isSafeInteger(m.part_count) && m.part_count>0 &&
        m.part_bytes===PART_SIZE &&
        m.part_count===Math.ceil(m.size_bytes/PART_SIZE);
    }
    return true;
  }));
  if(files.some(ok=>!ok))throw Error("One or more books are not ready for download yet.");

  const items=productRecords.map(p=>({
    id:p.id,title:String(p.title).slice(0,120),priceCents:priceToCents(p.price),
    pdfPath:p.pdf_path
  }));
  const amount=items.reduce((sum,i)=>sum+i.priceCents,0);
  if(!Number.isSafeInteger(amount)||amount<100||amount>MAX_ORDER_CENTS)
    throw Error("Invalid basket total.");
  return {business,name,email,items,amount,currency:"ZAR"};
}

export async function createPendingOrder(snapshot) {
  const id=crypto.randomUUID();
  const date=new Date().toISOString();
  const order={
    ...snapshot,id,status:"checkout_pending",
    paymentVerified:false,paymentProvider:"yoco",
    checkoutId:null,processingMode:"test",
    email_status:"not_sent",created_at:date,updated_at:date
  };
  const result=await orders().setJSON(orderKey(order.business,id),order,{onlyIfNew:true});
  if(!result.modified)throw Error("Could not create a unique order reference.");
  return order;
}

export async function bindTestCheckout(order,{id,amount,currency,processingMode}) {
  if(typeof id!=="string"||id.length>160||
     !/^(?:ch_|checkout_)[A-Za-z0-9_-]{5,}$/.test(id) ||
     amount!==order.amount || currency!=="ZAR" || processingMode!=="test")
    throw Error("Yoco checkout confirmation did not match the server order.");
  const saved=await checkouts().setJSON(checkoutKey(id),{
    checkoutId:id,orderId:order.id,business:order.business,
    amount:order.amount,currency:"ZAR",mode:"test",
    created_at:new Date().toISOString()
  },{onlyIfNew:true});
  if(!saved.modified)throw Error("The Yoco checkout reference was already used.");
  const store=orders(),key=orderKey(order.business,order.id);
  for(let tries=0;tries<5;tries++) {
    const rec=await store.getWithMetadata(key,{type:"json"});
    if(!rec || rec.data.status!=="checkout_pending" ||
       rec.data.checkoutId || rec.data.paymentVerified!==false)
      throw Error("Order state changed unexpectedly.");
    const next={...rec.data,checkoutId:id,status:"awaiting_payment",
      updated_at:new Date().toISOString()};
    const result=await store.setJSON(key,next,{onlyIfMatch:rec.etag});
    if(result.modified)return next;
  }
  throw Error("Order is busy. Please retry.");
}