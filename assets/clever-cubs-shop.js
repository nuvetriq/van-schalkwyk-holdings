(()=>{"use strict";
const products=(window.CLEVER_CUBS_PRODUCTS||[]).filter(p=>p.active!==false);
const storageKey="ccl-cart-v1";
let cart=[];
try{cart=JSON.parse(localStorage.getItem(storageKey)||"[]")}catch{cart=[]}
cart=cart.filter(id=>products.some(p=>p.id===id));
const rand=()=>Math.random().toString(36).slice(2,7).toUpperCase();
const money=n=>new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR"}).format(n);
const categoryFromText=t=>{t=t.toLowerCase();if(t.includes("preschool"))return"preschool";if(t.includes("primary"))return"primary";if(t.includes("skill"))return"skills";return"all"};
const grid=document.getElementById("ccl-book-grid");
if(!grid)return;

const overlay=document.createElement("div");overlay.className="ccl-overlay";overlay.id="ccl-overlay";
const drawer=document.createElement("aside");drawer.className="ccl-cart-drawer";drawer.setAttribute("aria-label","Shopping cart");
drawer.innerHTML='<div class="ccl-cart-head"><div><small>YOUR BASKET</small><h2>Digital books</h2></div><button class="ccl-icon-button" type="button" data-cart-close aria-label="Close cart">×</button></div><div class="ccl-cart-items" id="ccl-cart-items"></div><div class="ccl-cart-foot"><div class="ccl-cart-total"><span>Total</span><span id="ccl-cart-total">R0.00</span></div><button class="ccl-checkout-button" type="button" id="ccl-start-checkout">Continue to checkout</button><p class="ccl-test-note">Setup mode — no payment can be taken yet.</p></div>';
const fab=document.createElement("button");fab.type="button";fab.className="ccl-cart-fab";fab.innerHTML='🛒 Basket <span class="ccl-cart-count" id="ccl-cart-count">0</span>';
const modalWrap=document.createElement("div");modalWrap.className="ccl-modal-wrap";modalWrap.id="ccl-checkout-wrap";
modalWrap.innerHTML='<section class="ccl-checkout-modal" role="dialog" aria-modal="true" aria-labelledby="ccl-checkout-title"><div class="ccl-modal-head"><div><small>CHECKOUT PREVIEW</small><h2 id="ccl-checkout-title">Customer details</h2><p>This lets us test the full customer journey before Yoco is connected.</p></div><button class="ccl-icon-button" type="button" data-checkout-close aria-label="Close checkout">×</button></div><div class="ccl-checkout-body"><div class="ccl-checkout-grid"><label class="ccl-field full">Full name<input id="ccl-name" autocomplete="name" placeholder="Customer name"></label><label class="ccl-field">Email address<input id="ccl-email" type="email" autocomplete="email" placeholder="name@example.com"></label><label class="ccl-field">Phone number <span style="font-weight:400;color:#667">optional</span><input id="ccl-phone" type="tel" autocomplete="tel" placeholder="e.g. 071 234 5678"></label></div><div class="ccl-order-summary"><h3>Order summary</h3><div id="ccl-checkout-lines"></div><div class="ccl-summary-total"><span>Total</span><span id="ccl-checkout-total"></span></div></div><div class="ccl-license-note"><strong>When the live shop launches:</strong> payment will be confirmed securely before delivery. The customer will receive a private download link and a personalised PDF copy carrying their name and order number.</div><div class="ccl-preview-order" id="ccl-preview-order"></div><div class="ccl-checkout-actions"><button class="ccl-secondary" type="button" data-checkout-close>Back to basket</button><button class="ccl-primary" type="button" id="ccl-create-test-order">Create test order — no payment</button></div></div></section>';
const toast=document.createElement("div");toast.className="ccl-toast";toast.id="ccl-toast";
document.body.append(overlay,drawer,fab,modalWrap,toast);

const save=()=>localStorage.setItem(storageKey,JSON.stringify(cart));
const cartProducts=()=>cart.map(id=>products.find(p=>p.id===id)).filter(Boolean);
const total=()=>cartProducts().reduce((s,p)=>s+p.price,0);
function showToast(msg){toast.textContent=msg;toast.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove("show"),1800)}
function openCart(){drawer.classList.add("open");overlay.classList.add("open");document.body.classList.add("ccl-cart-open")}
function closeCart(){drawer.classList.remove("open");overlay.classList.remove("open");document.body.classList.remove("ccl-cart-open")}
function openCheckout(){if(!cart.length)return;closeCart();renderCheckout();modalWrap.classList.add("open");document.body.classList.add("ccl-checkout-open")}
function closeCheckout(){modalWrap.classList.remove("open");document.body.classList.remove("ccl-checkout-open")}
function add(id){if(!cart.includes(id)){cart.push(id);save();renderCart();showToast("Added to basket")}else{showToast("Already in your basket")}}
function remove(id){cart=cart.filter(x=>x!==id);save();renderCart()}
function renderProducts(filter="all"){
  const list=products.filter(p=>filter==="all"||p.category===filter);
  if(!list.length){grid.innerHTML='<div class="ccl-empty"><strong>No books in this category yet.</strong><br>The catalogue is ready for the approved books when they are signed off.</div>';return}
  grid.innerHTML=list.map(p=>'<article class="ccl-book-card"><div class="ccl-cover"><span class="ccl-preview-pill">'+(p.badge||"DIGITAL PDF")+'</span><div class="ccl-cover-book"><img src="assets/clever-new.png" alt=""><div><small>Clever Cubs Learning</small><b>'+p.title+'</b></div><small>'+p.categoryLabel+'</small></div></div><div class="ccl-card-body"><div class="ccl-card-meta"><span>'+p.categoryLabel+'</span><span>'+p.grade+'</span></div><h3>'+p.title+'</h3><p>'+p.description+'</p><div class="ccl-card-bottom"><span class="ccl-price">'+money(p.price)+'</span><button class="ccl-add" type="button" data-add="'+p.id+'">'+(p.demo?"Add demo to basket":"Add to basket")+'</button></div></div></article>').join("");
  grid.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>add(b.dataset.add)));
}
function renderCart(){
  const list=cartProducts();
  document.getElementById("ccl-cart-count").textContent=String(list.length);
  document.getElementById("ccl-cart-total").textContent=money(total());
  document.getElementById("ccl-start-checkout").disabled=!list.length;
  const box=document.getElementById("ccl-cart-items");
  if(!list.length){box.innerHTML='<div class="ccl-cart-empty"><strong>Your basket is empty.</strong><p>Add a demo book to test the cart.</p></div>';return}
  box.innerHTML=list.map(p=>'<div class="ccl-cart-item"><div><strong>'+p.title+'</strong><small>'+p.categoryLabel+' · Digital PDF</small><button type="button" class="ccl-remove" data-remove="'+p.id+'">Remove</button></div><strong>'+money(p.price)+'</strong></div>').join("");
  box.querySelectorAll("[data-remove]").forEach(b=>b.addEventListener("click",()=>remove(b.dataset.remove)));
}
function renderCheckout(){
  const list=cartProducts();
  document.getElementById("ccl-checkout-lines").innerHTML=list.map(p=>'<div class="ccl-summary-line"><span>'+p.title+'</span><strong>'+money(p.price)+'</strong></div>').join("");
  document.getElementById("ccl-checkout-total").textContent=money(total());
  const status=document.getElementById("ccl-preview-order");status.classList.remove("show");status.innerHTML="";
}
function createPreviewOrder(){
  const name=document.getElementById("ccl-name").value.trim();
  const email=document.getElementById("ccl-email").value.trim();
  if(!name){showToast("Please enter the customer name");document.getElementById("ccl-name").focus();return}
  if(!/^\S+@\S+\.\S+$/.test(email)){showToast("Please enter a valid email address");document.getElementById("ccl-email").focus();return}
  const order="CCL-PREVIEW-"+rand();
  const box=document.getElementById("ccl-preview-order");
  box.innerHTML='<strong>Test order created: '+order+'</strong><br>No payment was taken and no PDF was sent. This confirms the catalogue → basket → customer details flow is working.';
  box.classList.add("show");
}
fab.addEventListener("click",openCart);overlay.addEventListener("click",closeCart);
drawer.querySelector("[data-cart-close]").addEventListener("click",closeCart);
document.getElementById("ccl-start-checkout").addEventListener("click",openCheckout);
modalWrap.querySelectorAll("[data-checkout-close]").forEach(b=>b.addEventListener("click",closeCheckout));
document.getElementById("ccl-create-test-order").addEventListener("click",createPreviewOrder);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeCart();closeCheckout()}});

const filters=[...document.querySelectorAll('[aria-label="Filter books"] button')];
filters.forEach((b,i)=>{
  const filter=categoryFromText(b.textContent);
  if(i===0)b.classList.add("ccl-filter-active");
  b.addEventListener("click",()=>{
    filters.forEach(x=>x.classList.remove("ccl-filter-active","offline-selected"));
    b.classList.add("ccl-filter-active");
    renderProducts(filter);
  });
});
const categoryCards=[...document.querySelectorAll("#categories>.grid>button")];
categoryCards.forEach(card=>card.addEventListener("click",()=>{
  const filter=categoryFromText(card.querySelector("h3")?.textContent||"");
  categoryCards.forEach(x=>x.classList.remove("is-active","offline-selected"));
  card.classList.add("is-active");
  filters.forEach(x=>{x.classList.remove("ccl-filter-active","offline-selected");if(categoryFromText(x.textContent)===filter)x.classList.add("ccl-filter-active")});
  renderProducts(filter);
  document.getElementById("shop")?.scrollIntoView({behavior:"smooth"});
}));
renderProducts();renderCart();
})();