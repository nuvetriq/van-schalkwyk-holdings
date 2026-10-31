/* Shared pre-launch cart used on BOTH Granny's and CleverCubs Learning pages.
   Reads public published catalogues for DISPLAY ONLY. Server must independently
   validate products/prices/PDF ownership before a future Yoco checkout. */
(() => {
  "use strict";
  if (!window.VSH_BOOK_CART_CORE || !window.VSH_PUBLIC_PRODUCTS) return;
  const core=window.VSH_BOOK_CART_CORE;
  const storage=window.localStorage;
  const money=cents => new Intl.NumberFormat("en-ZA",{
    style:"currency",currency:"ZAR"
  }).format(cents/100);
  const tag=(name,className,text)=>{
    const el=document.createElement(name);
    if(className)el.className=className;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  const brands={
    grannys:{name:"Granny's",url:"grannys-little-bakery.html"},
    "clever-cubs":{name:"CleverCubs Learning",url:"clever-cubs-learning.html"}
  };
  const products=new Map();
  const loaded=new Set();
  const offline=new Set();
  const key=(business,id)=>business+":"+id.toLowerCase();
  const note=tag("p","vsh-cart-note","Secure Yoco checkout is being prepared. Your basket is saved, but no payment or book delivery can happen yet.");

  const trigger=tag("button","vsh-cart-launcher","🛒 Book basket (0)");
  trigger.type="button";trigger.setAttribute("aria-haspopup","dialog");
  trigger.setAttribute("aria-expanded","false");
  const backdrop=tag("div","vsh-cart-backdrop");backdrop.hidden=true;
  const dialog=tag("section","vsh-cart-dialog");
  dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");
  dialog.setAttribute("aria-labelledby","vsh-cart-heading");
  const head=tag("div","vsh-cart-head");
  const heading=tag("h2",null,"Your digital book basket");heading.id="vsh-cart-heading";
  const close=tag("button","vsh-cart-close","×");close.type="button";
  close.setAttribute("aria-label","Close basket");
  head.append(heading,close);
  const list=tag("div","vsh-cart-lines");
  const total=tag("div","vsh-cart-total");
  const actions=tag("div","vsh-cart-actions");
  const browseGranny=tag("a",null,"Browse Granny's books");
  browseGranny.href=brands.grannys.url;
  const browseCubs=tag("a",null,"Browse CleverCubs books");
  browseCubs.href=brands["clever-cubs"].url;
  const checkout=tag("button","vsh-cart-checkout","Yoco checkout coming soon");
  checkout.type="button";checkout.disabled=true;
  actions.append(browseGranny,browseCubs,checkout);
  dialog.append(head,list,total,note,actions);
  backdrop.append(dialog);
  document.body.append(trigger,backdrop);

  let open=false,previousFocus=null;
  let cart;
  function itemRow(line,product) {
    const row=tag("div","vsh-cart-row");
    const details=tag("div");
    const title=tag("strong",null,product?.title||"Book unavailable — please remove");
    const label=tag("small",null,product ?
      money(Math.round(Number(product.price)*100)) :
      (offline.has(line.business) ? "Checking availability…" : "Not currently published"));
    const remove=tag("button","vsh-cart-remove","Remove");
    remove.type="button";
    remove.setAttribute("aria-label","Remove book from "+brands[line.business].name);
    remove.addEventListener("click",()=>cart.remove(line.business,line.id));
    details.append(title,label);
    row.append(details,remove);
    return row;
  }
  function render() {
    const lines=cart.items();
    trigger.textContent="🛒 Book basket ("+lines.length+")";
    list.replaceChildren();
    if(!lines.length)list.append(tag("p","vsh-cart-empty","Your basket is empty. Browse either shop to add a digital book."));
    let grand=0;
    for(const business of core.BUSINESSES) {
      const own=lines.filter(line=>line.business===business);
      if(!own.length)continue;
      const section=tag("section","vsh-cart-brand");
      section.append(tag("h3",null,brands[business].name));
      let subtotal=0;
      for(const line of own) {
        const product=products.get(key(line.business,line.id));
        section.append(itemRow(line,product));
        if(product)subtotal+=Math.round(Number(product.price)*100);
      }
      section.append(tag("p","vsh-cart-subtotal","Subtotal: "+money(subtotal)));
      grand+=subtotal;
      list.append(section);
    }
    total.replaceChildren(tag("span",null,"Current catalogue total"),tag("strong",null,money(grand)));
    if(lines.some(line=>!products.has(key(line.business,line.id))))
      note.textContent="Some books aren't available in the current catalogue. Remove unavailable items before checkout can launch. No payments are enabled.";
    else
      note.textContent="Secure Yoco checkout is being prepared. One future payment will cover books from both businesses. No payment or delivery is enabled yet.";
  }
  cart=core.create(storage,render);
  function show() {
    previousFocus=document.activeElement;
    open=true;backdrop.hidden=false;
    trigger.setAttribute("aria-expanded","true");
    document.body.classList.add("vsh-cart-open");
    render();close.focus();
  }
  function hide() {
    open=false;backdrop.hidden=true;
    trigger.setAttribute("aria-expanded","false");
    document.body.classList.remove("vsh-cart-open");
    if(previousFocus && typeof previousFocus.focus==="function")previousFocus.focus();
  }
  trigger.addEventListener("click",show);
  close.addEventListener("click",hide);
  backdrop.addEventListener("click",event=>{if(event.target===backdrop)hide()});
  document.addEventListener("keydown",event=>{
    if(!open)return;
    if(event.key==="Escape"){event.preventDefault();hide()}
    if(event.key==="Tab"){
      const nodes=[...dialog.querySelectorAll("button:not([disabled]), a[href]")];
      if(!nodes.length)return;
      const first=nodes[0],last=nodes[nodes.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus()}
    }
  });
  window.addEventListener("storage",event=>{
    if(event.key===core.KEY || event.key===null)cart.refresh();
  });

  function add(business,id) {
    // Product buttons are rendered from the published catalogue, but the
    // shared cart's second catalogue fetch may still be finishing. Save the
    // validated SKU now and independently refresh its current availability.
    const result=cart.add(business,id);
    if(result && !products.has(key(business,String(id))))refreshCatalogue(business);
    if(!result && cart.items().length>=core.MAX)
      note.textContent="Your basket can hold up to "+core.MAX+" books. Remove an item before adding another.";
    show();
    return result;
  }
  window.VSH_BOOK_CART=Object.freeze({
    add,
    open:show,
    items:()=>cart.items(),
    remove:(business,id)=>cart.remove(business,id)
  });

  // The Granny's product renderer produces [data-recipe-add] buttons.
  document.addEventListener("click",event=>{
    const el=event.target.closest("[data-recipe-add]");
    if(el)add("grannys",el.dataset.recipeAdd);
  });

  async function refreshCatalogue(business) {
    try {
      const list=await window.VSH_PUBLIC_PRODUCTS.list(business);
      if(!Array.isArray(list))throw Error("Invalid catalogue");
      for(const [sku] of products)
        if(sku.startsWith(business+":"))products.delete(sku);
      for(const product of list) {
        if(product.has_pdf!==true || product.is_active!==true)continue;
        if(business==="grannys" && !/^recipe books?$/i.test(String(product.category||"").trim()))continue;
        if(!core.normalize([{business,id:product.id}]).length)continue;
        if(!Number.isFinite(Number(product.price)) || Number(product.price)<1)continue;
        products.set(key(business,product.id),product);
      }
      loaded.add(business);
      offline.delete(business);
    }catch(error){
      offline.add(business);
      console.warn("Shared book cart: catalogue unavailable for",business);
    }
    render();
  }
  render();
  for(const business of core.BUSINESSES)refreshCatalogue(business);
})();
