import {test} from "node:test";
import assert from "node:assert/strict";
import {
  CheckoutDiagnosticError,checkoutDiagnostic,safeCheckoutDiagnostic
} from "../netlify/lib/mixed-book-checkout-diagnostics.mjs";
import {
  postYocoTestCheckout,createMixedBookTestCheckout
} from "../netlify/lib/mixed-book-yoco-test-operation.mjs";
import {validateYocoTestCheckoutResponse} from "../netlify/lib/mixed-book-yoco-test-checkout.mjs";
import {makeMixedBookTestCheckoutHandler} from "../netlify/functions/mixed-book-yoco-test-checkout.mjs";

const id="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const book="ac20bc30-83b6-4fa2-b034-e5129232a210";
const master={
  id,paymentProvider:"yoco",currency:"ZAR",amountCents:14500,
  items:[{business:"grannys",id:book,title:"Test book",priceCents:14500,
    pdfPath:"grannys/"+book+".pdf"}]
};
const good={
  id:"checkout_abcdeABCDE123",status:"created",amount:14500,
  currency:"ZAR",processingMode:"test",externalId:id,
  redirectUrl:"https://c.yoco.com/checkout/abcdeABCDE123"
};
const key="sk_test_"+("z".repeat(30));
const validRequest={
  url:"https://payments.yoco.com/api/checkouts",
  headers:{Authorization:"Bearer "+key,
    "Content-Type":"application/json","Idempotency-Key":"test-only"},
  body:JSON.stringify({amount:14500,currency:"ZAR"})
};

test("Only fixed allowlisted diagnostic codes and sanitized HTTP statuses survive",()=>{
  const keyFragment="sk_test_very_private_testing_key";
  const rawError=new Error("Password "+keyFragment+" private book paths and customer email");
  assert.deepEqual(safeCheckoutDiagnostic(rawError),{code:"internal_unclassified"});
  assert.equal(JSON.stringify(safeCheckoutDiagnostic(rawError)).includes(keyFragment),false);
  assert.deepEqual(safeCheckoutDiagnostic(checkoutDiagnostic("yoco_http_rejected",422)),
    {code:"yoco_http_rejected",httpStatus:422});
  assert.deepEqual(safeCheckoutDiagnostic(checkoutDiagnostic("secret: "+keyFragment,200)),
    {code:"internal_unclassified"});
  assert.deepEqual(safeCheckoutDiagnostic(checkoutDiagnostic("yoco_http_rejected",999)),
    {code:"yoco_http_rejected"});
});

test("Provider rejection emits only an HTTP code; response body is never read",async()=>{
  let read=false;
  await assert.rejects(postYocoTestCheckout(validRequest,{
    transport:async()=>({ok:false,status:422,async text(){read=true;return '{"secret":"private"}'}})
  }),error=>{
    assert.ok(error instanceof CheckoutDiagnosticError);
    assert.deepEqual(safeCheckoutDiagnostic(error),{code:"yoco_http_rejected",httpStatus:422});
    return true;
  });
  assert.equal(read,false);
});

test("Provider connection and response parsing fail with fixed codes",async()=>{
  await assert.rejects(postYocoTestCheckout(validRequest,{
    transport:async()=>{throw Error("sk_test_PRIVATE_NODE_REQUEST");}
  }),error=>error.code==="yoco_network_failed");
  await assert.rejects(postYocoTestCheckout(validRequest,{
    transport:async()=>({ok:true,headers:new Headers(),async text(){return "<private>bad json";}})
  }),error=>error.code==="yoco_response_json_invalid");
  await assert.rejects(postYocoTestCheckout(validRequest,{
    transport:async()=>({ok:true,headers:new Headers({"content-length":"45000"}),
      async text(){throw Error("must not read");}})
  }),error=>error.code==="yoco_response_too_large");
});

test("Yoco response shape mismatches get distinct field-group codes",()=>{
  const cases=[
    [{...good,id:"invalid"},"yoco_response_id_invalid"],
    [{...good,status:"unknown"},"yoco_response_status_invalid"],
    [{...good,amount:14499},"yoco_response_amount_invalid"],
    [{...good,processingMode:undefined},"yoco_response_mode_invalid"],
    [{...good,externalId:"other"},"yoco_response_reference_invalid"],
    [{...good,redirectUrl:"https://not-yoco.example/payment"},"yoco_response_redirect_invalid"]
  ];
  for(const [response,code] of cases)
    assert.throws(()=>validateYocoTestCheckoutResponse(master,response),
      e=>e.code===code);
  assert.equal(validateYocoTestCheckoutResponse(master,good).checkoutId,good.id);
});

test("Checkout stages distinguish catalogue and pending-order failures without original errors",async()=>{
  const catalogue={
    async getProduct(business,bookId){
      return {business,id:bookId,title:"Book",price:145,is_active:true,
        category:"Recipe Books",pdf_path:business+"/"+bookId+".pdf"};
    },
    async getPrivateFile(){return {metadata:{size:100}};}
  };
  const cart={name:"Test Buyer",email:"test-buyer@example.com",
    items:[{business:"grannys",id:book}]};
  const ledger={
    async createPendingOrder(){throw Error("private SQL failure");},
    async bindYocoCheckout(){}
  };
  await assert.rejects(createMixedBookTestCheckout({items:[]},{
    catalogue,ledger,secretKey:key,postCheckout:async()=>({ok:true,data:good})
  }),e=>e.code==="catalogue_snapshot_failed");
  await assert.rejects(createMixedBookTestCheckout(cart,{
    catalogue,ledger,secretKey:key,postCheckout:async()=>({ok:true,data:good})
  }),e=>e.code==="pending_order_write_failed");
});

test("Admin endpoint logs only a fixed code and safe HTTP status; response remains generic",async()=>{
  const confidential="sk_test_NOT_FOR_LOGS_12345 customer@private.com";
  const captured=[],original=console.error;
  const f=makeMixedBookTestCheckoutHandler({
    env:{
      VSH_MIXED_BOOK_DB_ENABLED:"true",
      VSH_MIXED_YOCO_TEST_ENABLED:"true",
      VSH_ENABLE_PAYMENTS:"false",
      VSH_MIXED_YOCO_TEST_KEY:key,
      VSH_MIXED_YOCO_TEST_WEBHOOK_SECRET:"whsec_"+("a".repeat(24))
    },
    authorize:()=>({ok:true}),
    catalogueFactory:()=>({}),
    databaseFactory:()=>({}),
    operate:async()=>{throw Object.assign(checkoutDiagnostic("yoco_http_rejected",422),{message:confidential});}
  });
  const req=new Request(
    "https://vanschalkwykholdings.com/.netlify/functions/mixed-book-yoco-test-checkout",{
    method:"POST",
    headers:{"Origin":"https://vanschalkwykholdings.com",
      "Content-Type":"application/json","X-Admin-Key":"fake-admin-only"},
    body:JSON.stringify({})
  });
  let response;
  try{
    console.error=(...args)=>captured.push(args.join(" "));
    response=await f(req,{deploy:{context:"production"}});
  } finally {console.error=original;}
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,"The test checkout could not be prepared.");
  assert.deepEqual(captured,["Mixed Yoco TEST checkout diagnostic yoco_http_rejected http_status 422"]);
  assert.ok(!captured.join(" ").includes(confidential));
});
