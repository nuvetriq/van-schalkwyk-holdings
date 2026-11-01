import {test} from "node:test";
import assert from "node:assert/strict";
import {snapshotMixedOrder} from "../netlify/lib/mixed-book-order.mjs";
import {
  persistPendingMixedOrder,bindMixedYocoCheckout,settleVerifiedMixedYocoPayment
} from "../netlify/lib/mixed-book-ledger.mjs";

const granny="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const clever="ac20bc30-83b6-4fa2-b034-e5129232a210";
const checkoutId="checkout_Example456789";
const products=new Map([
 ["grannys:"+granny,{id:granny,business:"grannys",title:"Granny Recipe Book",
  price:129.99,category:"Recipe Books",pdf_path:"grannys/"+granny+".pdf",is_active:true}],
 ["clever-cubs:"+clever,{id:clever,business:"clever-cubs",title:"Grade RR Afrikaans",
  price:85,category:"Preschool",pdf_path:"clever-cubs/"+clever+".pdf",is_active:true}]
]);
const deps={
 async getProduct(b,id){return products.get(b+":"+id)||null},
 async getPrivateFile(){return {metadata:{size:1024}}}
};
async function fresh(){
  const {master}=await snapshotMixedOrder({
    name:"Test Customer",email:"buyer@example.com",
    items:[{business:"grannys",id:granny},{business:"clever-cubs",id:clever}]
  },deps);
  return master;
}
const initial=()=>({orders:{},lines:{},sales:{},events:{},jobs:{}});
function mockPool(){
  let state=initial(),failOnce=null,conn=0,released=0,rollbacks=0;
  function clone(value){return structuredClone(value)}
  const pool={
    async connect(){
      conn++;
      let tx=null;
      return {
        async query(raw,args=[]){
          const sql=String(raw).trim().replace(/\s+/g," ");
          if(sql==="BEGIN"){assert.equal(tx,null);tx=clone(state);return{rows:[]}}
          if(sql==="COMMIT"){state=tx;tx=null;return{rows:[]}}
          if(sql==="ROLLBACK"){tx=null;rollbacks++;return{rows:[]}}
          assert.ok(tx,"All SQL must run in a transaction.");
          if(failOnce && sql.includes(failOnce)){
            failOnce=null;throw Error("Injected database failure");
          }
          if(sql.includes("INSERT INTO vsh_mixed_orders")){
            const [id,name,email,total,mode,snapshot]=args;
            assert.equal(tx.orders[id],undefined);
            tx.orders[id]={id,customer_name:name,customer_email:email,
              amount_cents:total,processing_mode:mode,
              status:"checkout_pending",checkout_id:null,payment_id:null,
              snapshot:JSON.parse(snapshot)};
            return{rows:[]};
          }
          if(sql.includes("INSERT INTO vsh_mixed_order_lines")){
            const [id,brand,pid,title,price,path]=args;
            const key=id+":"+brand+":"+pid;
            assert.equal(tx.lines[key],undefined);
            tx.lines[key]={brand,title,price,path};return{rows:[]};
          }
          if(sql.startsWith("SELECT * FROM vsh_mixed_orders")){
            const order=tx.orders[args[0]];
            return{rows:order?[clone(order)]:[]};
          }
          if(sql.includes("UPDATE vsh_mixed_orders")&&sql.includes("status='awaiting_payment'")){
            const [id,cid]=args;
            const order=tx.orders[id];
            if(!order||order.status!=="checkout_pending"||order.checkout_id)return{rows:[]};
            order.checkout_id=cid;order.status="awaiting_payment";
            return{rows:[{id}]};
          }
          if(sql.includes("INSERT INTO vsh_mixed_payment_events")){
            const [event,id,checkout,payment]=args;
            assert.equal(tx.events[event],undefined,"Unique payment event");
            tx.events[event]={orderId:id,checkout,payment};
            return{rows:[]};
          }
          if(sql.includes("UPDATE vsh_mixed_orders")&&sql.includes("status='paid'")){
            const [id,payment]=args;
            const order=tx.orders[id];
            if(!order||order.status!=="awaiting_payment")return{rows:[]};
            order.status="paid";order.payment_id=payment;
            return{rows:[{id}]};
          }
          if(sql.includes("INSERT INTO vsh_mixed_brand_sales")){
            const [id,b,amount]=args;
            const key=id+":"+b;
            assert.equal(tx.sales[key],undefined);
            tx.sales[key]={amount};return{rows:[]};
          }
          if(sql.includes("INSERT INTO vsh_mixed_email_outbox")){
            const [id,orderId,b,kind,sender,recipient,payload]=args;
            assert.equal(tx.jobs[id],undefined);
            tx.jobs[id]={orderId,b,kind,sender,recipient,...JSON.parse(payload)};
            return{rows:[]};
          }
          throw Error("Unexpected SQL statement: "+sql);
        },
        release(){released++}
      };
    },
    get state(){return clone(state)},
    failNext(fragment){failOnce=fragment},
    get connected(){return conn},
    get released(){return released},
    get rollbacks(){return rollbacks}
  };
  return pool;
}
const confirmation=(order,mode="live",patch={})=>({
  source:"server-verified-yoco-webhook",signatureVerified:true,
  eventType:"payment.succeeded",paymentStatus:"succeeded",
  checkoutId,paymentId:"pay_ExamplePayment",
  eventId:"evt_ExampleEvent",currency:"ZAR",
  amountCents:order.amountCents,processingMode:mode,...patch
});
async function prepared(mode="live"){
  const pool=mockPool(),master=await fresh();
  await persistPendingMixedOrder(pool,master,mode);
  await bindMixedYocoCheckout(pool,{
    orderId:master.id,checkoutId,amountCents:master.amountCents,
    processingMode:mode
  });
  return {pool,master};
}
test("One atomic paid order produces separate brand sales and four email rows",async()=>{
  const {pool,master}=await prepared();
  const result=await settleVerifiedMixedYocoPayment(pool,master.id,confirmation(master));
  const s=pool.state;
  assert.equal(result.duplicate,false);
  assert.equal(result.brandCount,2);
  assert.equal(result.insertedEmailJobs,4);
  assert.equal(s.orders[master.id].status,"paid");
  assert.equal(Object.keys(s.lines).length,2);
  assert.equal(Object.keys(s.sales).length,2);
  assert.equal(Object.keys(s.jobs).length,4);
  assert.equal(Object.keys(s.events).length,1);
  assert.equal(pool.connected,pool.released);
  const gr=Object.values(s.jobs).filter(j=>j.b==="grannys");
  const cc=Object.values(s.jobs).filter(j=>j.b==="clever-cubs");
  assert.equal(gr.length,2);assert.equal(cc.length,2);
  assert.ok(gr.every(x=>JSON.stringify(x).indexOf("Grade RR")<0));
  assert.ok(cc.every(x=>JSON.stringify(x).indexOf("Granny")<0));
});
test("Repeated payment notification is idempotent, without new email tasks",async()=>{
  const {pool,master}=await prepared();
  await settleVerifiedMixedYocoPayment(pool,master.id,confirmation(master));
  const second=await settleVerifiedMixedYocoPayment(pool,master.id,
    confirmation(master,"live",{eventId:"evt_AnotherEvent"}));
  assert.equal(second.duplicate,true);
  assert.equal(second.insertedEmailJobs,0);
  assert.equal(Object.keys(pool.state.jobs).length,4);
  assert.equal(Object.keys(pool.state.events).length,1);
  await assert.rejects(settleVerifiedMixedYocoPayment(pool,master.id,
    confirmation(master,"live",{paymentId:"pay_ConflictingPayment"})));
});
test("If 3rd email insert fails, paid order, sales, event and emails all roll back",async()=>{
  const {pool,master}=await prepared();
  pool.failNext("INSERT INTO vsh_mixed_email_outbox");
  await assert.rejects(settleVerifiedMixedYocoPayment(pool,master.id,confirmation(master)));
  const s=pool.state;
  assert.equal(s.orders[master.id].status,"awaiting_payment");
  assert.equal(Object.keys(s.events).length,0);
  assert.equal(Object.keys(s.sales).length,0);
  assert.equal(Object.keys(s.jobs).length,0);
  assert.ok(pool.rollbacks>0);
  const retry=await settleVerifiedMixedYocoPayment(pool,master.id,confirmation(master));
  assert.equal(retry.insertedEmailJobs,4);
});
test("Test-mode settlement creates no dispatchable outbox entries",async()=>{
  const {pool,master}=await prepared("test");
  const r=await settleVerifiedMixedYocoPayment(pool,master.id,confirmation(master,"test"));
  assert.equal(r.testOnly,true);
  assert.equal(r.insertedEmailJobs,0);
  assert.equal(Object.keys(pool.state.jobs).length,0);
  assert.equal(Object.keys(pool.state.sales).length,2);
});
test("Wrong amount, checkout or processing mode cannot settle the order",async()=>{
  const {pool,master}=await prepared();
  for(const patch of [
    {amountCents:1},{checkoutId:"checkout_WrongCheckout"},
    {processingMode:"test"},{signatureVerified:false},
    {paymentStatus:"failed"}
  ]){
    await assert.rejects(settleVerifiedMixedYocoPayment(pool,master.id,
      confirmation(master,"live",patch)));
  }
  assert.equal(pool.state.orders[master.id].status,"awaiting_payment");
  assert.equal(Object.keys(pool.state.jobs).length,0);
});
test("Duplicate checkout binding is safe; another checkout is refused",async()=>{
  const {pool,master}=await prepared();
  const twice=await bindMixedYocoCheckout(pool,{
    orderId:master.id,checkoutId,amountCents:master.amountCents,
    processingMode:"live"
  });
  assert.equal(twice.duplicate,true);
  await assert.rejects(bindMixedYocoCheckout(pool,{
    orderId:master.id,checkoutId:"checkout_Different1234",
    amountCents:master.amountCents,processingMode:"live"
  }));
});
test("Database rollback on line insert failure leaves no partial master",async()=>{
  const pool=mockPool(),master=await fresh();
  pool.failNext("INSERT INTO vsh_mixed_order_lines");
  await assert.rejects(persistPendingMixedOrder(pool,master,"live"));
  assert.equal(Object.keys(pool.state.orders).length,0);
  assert.equal(Object.keys(pool.state.lines).length,0);
  assert.ok(pool.rollbacks>0);
});
