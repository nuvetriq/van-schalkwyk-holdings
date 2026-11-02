import {readFile} from "node:fs/promises";
import {test} from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const uuidA="f3ff94aa-79f3-4de1-b9e2-0f112fe2df56";
const uuidB="ac20bc30-83b6-4fa2-b034-e5129232a210";
const coreSource=await readFile("assets/shared-book-cart-core.js","utf8");
const window={};
vm.runInNewContext(coreSource,{window},{filename:"shared-book-cart-core.js"});
const {create,normalize,KEY,MAX}=window.VSH_BOOK_CART_CORE;
const makeStorage=()=>{
  const map=new Map();
  return {
    getItem:key=>map.get(key)??null,
    setItem:(key,value)=>map.set(key,value),
    removeItem:key=>map.delete(key),
    map
  };
};
test("Granny's + CleverCubs are saved as separate lines in ONE storage cart",()=>{
  const storage=makeStorage();
  const events=[];
  const first=create(storage,items=>events.push(items));
  assert.equal(first.add("grannys",uuidA),true);
  assert.equal(first.add("clever-cubs",uuidB),true);
  assert.equal(first.items().length,2);
  assert.equal(JSON.parse(storage.getItem(KEY)).length,2);
  const second=create(storage);
  assert.deepEqual(JSON.parse(JSON.stringify(second.items())),[
    {business:"grannys",id:uuidA},{business:"clever-cubs",id:uuidB}
  ]);
  assert.equal(events.length,2);
});
test("Deduplicates identical brand/book but preserves same ID across brands",()=>{
  const storage=makeStorage();
  const state=create(storage);
  assert.equal(state.add("grannys",uuidA),true);
  assert.equal(state.add("grannys",uuidA),false);
  assert.equal(state.add("clever-cubs",uuidA),true);
  assert.equal(state.items().length,2);
  assert.equal(state.remove("grannys",uuidA),true);
  assert.equal(state.items()[0].business,"clever-cubs");
});
test("Rejects malformed business and product IDs, sanitizes saved cart",()=>{
  const storage=makeStorage();
  storage.setItem(KEY,JSON.stringify([
    {business:"grannys",id:uuidA},
    {business:"grannys",id:uuidA},
    {business:"evil",id:uuidB},
    {business:"clever-cubs",id:"../secret.pdf"},
    {business:"clever-cubs",id:uuidB},
    null
  ]));
  const state=create(storage);
  assert.equal(state.items().length,2);
  assert.equal(state.add("evil",uuidA),false);
  assert.equal(state.add("grannys","../../pdf"),false);
  assert.equal(normalize("not an array").length,0);
  assert.equal(MAX,20);
});
test("Cross-tab refresh reads externally stored selections",()=>{
  const storage=makeStorage();
  const first=create(storage);
  const second=create(storage);
  first.add("grannys",uuidA);
  second.refresh();
  assert.equal(second.items().length,1);
  first.add("clever-cubs",uuidB);
  second.refresh();
  assert.equal(second.items().length,2);
  second.remove("grannys",uuidA);
  first.refresh();
  assert.equal(first.items().length,1);
  assert.equal(first.items()[0].business,"clever-cubs");
});
test("Corrupted or inaccessible browser storage doesn't crash",()=>{
  const bad={getItem(){throw Error("Access denied")},setItem(){throw Error("Access denied")}};
  const state=create(bad);
  assert.equal(state.items().length,0);
  assert.equal(state.add("grannys",uuidA),true);
  assert.equal(state.items().length,1);
});
test("Both shop pages use one cart; no legacy cart scripts or active checkout",async()=>{
  const granny=await readFile("grannys-little-bakery.html","utf8");
  const cubs=await readFile("clever-cubs-learning.html","utf8");
  for(const page of [granny,cubs]){
    assert.ok(page.includes('assets/shared-book-cart-core.js'));
    assert.ok(page.includes('assets/shared-book-cart.js'));
    assert.ok(page.includes('assets/shared-book-cart.css'));
    assert.ok(page.indexOf("shared-book-cart-core.js")<page.indexOf("shared-book-cart.js"));
  }
  assert.ok(!granny.includes('src="assets/grannys-basket.js"'));
  const ui=await readFile("assets/shared-book-cart.js","utf8");
  assert.ok(ui.includes("checkout.disabled=true"));
  assert.ok(!ui.includes("api/checkouts"));
  assert.ok(!ui.includes("VSH_ENABLE_PAYMENTS"));
  const clever=await readFile("assets/clever-cubs-shop.js","utf8");
  assert.ok(clever.includes('VSH_BOOK_CART.add("clever-cubs"'));
  assert.ok(!clever.includes("ccl-cart-v1"));
});
