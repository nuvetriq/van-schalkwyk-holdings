import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const source=await readFile("assets/shared-book-checkout-core.js","utf8");
const window={};
vm.runInNewContext(source,{window},{filename:"shared-book-checkout-core.js"});
const checkout=window.VSH_BOOK_CHECKOUT_CORE;

const grId="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const ccId="ac20bc30-83b6-4fa2-b034-e5129232a210";
const orderId="e4b97fe9-294d-49d5-9ae5-d1f155c9d459";
const input={
 name:"  Example   Buyer  ",
 email:"  BUYER@Example.com ",
 items:[{business:"grannys",id:grId},
        {business:"clever-cubs",id:ccId}]
};
const response={
 orderId,redirectUrl:"https://c.yoco.com/checkout/LiveCheckout98765",
 amountCents:14500,currency:"ZAR",paymentVerified:false
};
test("Two brands make exactly one minimum-information payload, never browser prices or PDFs",()=>{
 const safe=checkout.prepareBuyerOrder(input);
 assert.deepEqual(JSON.parse(JSON.stringify(safe)),{
  name:"Example Buyer",email:"buyer@example.com",
  items:[{business:"grannys",id:grId},{business:"clever-cubs",id:ccId}]
 });
 assert.ok(!JSON.stringify(safe).includes("price"));
 assert.ok(!JSON.stringify(safe).includes("pdf"));
 assert.equal(checkout.ENDPOINT,"/api/books/live-checkout");
});

test("Invalid customer or basket input stops before a request can be made",async()=>{
 for(const corrupt of [
  {...input,name:""}, {...input,name:"x"}, {...input,name:"x".repeat(121)},
  {...input,email:"bad"}, {...input,email:"fake@example.com\nBcc:other@example.com"},
  {...input,items:[]},
  {...input,items:Array(21).fill(input.items[0])},
  {...input,items:[input.items[0],input.items[0]]},
  {...input,items:[{business:"other",id:grId}]},
  {...input,items:[{business:"grannys",id:"../private.pdf"}]},
  {...input,items:[null]}
 ]){
  let calls=0;
  await assert.rejects(checkout.createYocoCheckout(corrupt,{
   transport:async()=>{calls++;return {status:201,json:async()=>response};}
  }));
  assert.equal(calls,0);
 }
});

test("One explicit checkout uses server-authoritative SKU IDs and no credentials",async()=>{
 const calls=[];
 const final=await checkout.createYocoCheckout(input,{
  transport:async(url,opts)=>{
   calls.push({url,opts});
   return {status:201,json:async()=>response};
  }
 });
 assert.equal(calls.length,1);
 const req=calls[0];
 assert.equal(req.url,"/api/books/live-checkout");
 assert.equal(req.opts.method,"POST");
 assert.equal(req.opts.mode,"same-origin");
 assert.equal(req.opts.cache,"no-store");
 assert.equal(req.opts.redirect,"error");
 assert.equal(req.opts.credentials,"omit");
 assert.equal(req.opts.headers["Content-Type"],"application/json");
 assert.deepEqual(JSON.parse(req.opts.body),JSON.parse(JSON.stringify(
   checkout.prepareBuyerOrder(input))));
 assert.ok(!req.opts.body.includes("priceCents"));
 assert.ok(!req.opts.body.includes("private_pdf_path"));
 assert.equal(final.paymentVerified,false);
 assert.equal(final.redirectUrl,response.redirectUrl);
 assert.equal(JSON.stringify(final).includes("buyer@example.com"),false);
});

test("Only strict c.yoco.com HTTPS checkout redirects may reach browser navigation",()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(
  checkout.validateRedirectReply(response))),response);
 for(const update of [
  {redirectUrl:"https://evil.example/checkout/LiveCheckout98765"},
  {redirectUrl:"http://c.yoco.com/checkout/LiveCheckout98765"},
  {redirectUrl:"https://c.yoco.com.evil.invalid/checkout/LiveCheckout98765"},
  {redirectUrl:"https://evil.invalid@c.yoco.com/checkout/LiveCheckout98765"},
  {redirectUrl:"https://c.yoco.com/checkout/LiveCheckout98765?buyer=x"},
  {redirectUrl:"https://c.yoco.com/checkout/LiveCheckout98765#finish"},
  {redirectUrl:"https://c.yoco.com:8443/checkout/LiveCheckout98765"},
  {redirectUrl:"https://c.yoco.com/checkout/LiveCheckout98765/extra"},
  {redirectUrl:"https://pay.yoco.com/r/LiveCheckout98765"},
  {redirectUrl:"javascript:alert(1)"},
  {orderId:"../other"},
  {amountCents:14501.5}, {amountCents:0},
  {currency:"USD"},{paymentVerified:true}
 ])assert.throws(()=>checkout.validateRedirectReply({...response,...update}));
});

test("An HTTP failure, invalid JSON, or network timeout never automatically retries",async()=>{
 for(const variant of [
  {status:503,json:async()=>response},
  {status:201,json:async()=>({redirectUrl:"https://evil.invalid"})},
  {status:201,json:async()=>{throw Error("corrupted response")}}
 ]){
  let calls=0;
  await assert.rejects(checkout.createYocoCheckout(input,{
   transport:async()=>{calls++;return variant;}
  }));
  assert.equal(calls,1);
 }
 let called=0;
 await assert.rejects(checkout.createYocoCheckout(input,{
  transport:async()=>{called++;throw Error("connection dropped");}
 }));
 assert.equal(called,1);
});

test("Customer UI remains hardcoded OFF and checkout helper is not loaded into either storefront",async()=>{
 const js=await readFile("assets/shared-book-cart.js","utf8");
 const css=await readFile("assets/shared-book-cart.css","utf8");
 assert.match(js,/const LIVE_CHECKOUT_UI_RELEASED=false/);
 assert.match(js,/checkout\.disabled=true/);
 assert.match(js,/if\(LIVE_CHECKOUT_UI_RELEASED && checkoutCore\)/);
 assert.match(js,/buyerName\.value,email:buyerEmail\.value,items:lines/);
 assert.match(js,/window\.location\.assign\(result\.redirectUrl\)/);
 assert.match(js,/payment is not yet confirmed/);
 assert.match(css,/vsh-cart-buyer-form\[hidden\]/);
 for(const path of ["grannys-little-bakery.html","clever-cubs-learning.html"]){
  const html=await readFile(path,"utf8");
  assert.ok(html.includes("assets/shared-book-cart.js"));
  assert.ok(!html.includes("assets/shared-book-checkout-core.js"));
 }
});
