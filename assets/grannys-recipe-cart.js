/* Recipe books checkout only. Client prices are indicative; the server
   validates the products and recalculates the total from stored prices. */
(() => {
  "use strict";
  const format = n => new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR"}).format(n);
  const key = "grannys-recipe-basket-v1";
  const saved = () => {
    try { const a=JSON.parse(sessionStorage.getItem(key)||"[]");return Array.isArray(a)?a.filter(x=>typeof x==="string").slice(0,4):[]; }
    catch { return []; }
  };
  let ids=saved();
  let products=[];
  function persist(){sessionStorage.setItem(key,JSON.stringify(ids));refresh();}
  const el=(tag,cls,text)=>{
    const e=document.createElement(tag);if(cls)e.className=cls;
    if(text!==undefined)e.textContent=text;
    return e;
  };
  const basket=el("button","gr-cart-floating","🛒 Recipe basket (0)");
  basket.type="button";basket.hidden=true;
  const overlay=el("div","gr-cart-overlay");
  overlay.hidden=true;
  overlay.setAttribute("role","presentation");
  const panel=el("section","gr-cart-panel");
  panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-labelledby","gr-cart-title");
  const head=el("div","gr-cart-head");
  const heading=el("h2",null,"Your recipe books");heading.id="gr-cart-title";
  const close=el("button","gr-cart-close","×");close.type="button";close.setAttribute("aria-label","Close recipe basket");
  head.append(heading,close);
  const intro=el("p","gr-cart-subtitle","PDF recipe books delivered automatically by email after payment is verified.");
  const lines=el("div","gr-cart-lines");
  const total=el("div","gr-cart-total");
  const nameLabel=el("label",null,"Your full name");nameLabel.htmlFor="gr-cart-name";
  const name=el("input");name.id="gr-cart-name";name.required=true;name.autocomplete="name";name.maxLength=120;
  const emailLabel=el("label",null,"Email for your recipe books");emailLabel.htmlFor="gr-cart-email";
  const email=el("input");email.id="gr-cart-email";email.type="email";email.required=true;email.autocomplete="email";email.maxLength=254;
  const notice=el("p","gr-cart-note","Your email address is only used to process this order and deliver your purchased PDFs. Please double-check the spelling before paying.");
  const pay=el("button","gr-cart-pay","Pay securely with Yoco");pay.type="button";
  const error=el("p","gr-cart-error");error.setAttribute("role","status");
  panel.append(head,intro,lines,total,nameLabel,name,emailLabel,email,notice,pay,error);
  overlay.append(panel);
  document.body.append(basket,overlay);
  function available() {return ids.map(id=>products.find(p=>p.id===id)).filter(p=>p&&p.has_pdf);}
  function refresh(){
    const valid=available();
    basket.hidden=products.length===0 && ids.length===0;
    basket.textContent="🛒 Recipe basket ("+ids.length+")";
    lines.replaceChildren();
    if(!valid.length) lines.append(el("p","gr-cart-note","Your basket is empty. Add a recipe book to get started."));
    for (const book of valid) {
      const row=el("div","gr-cart-line");
      const text=el("div");
      text.append(el("strong",null,book.title),el("small",null,format(book.price)));
      const remove=el("button",null,"Remove");
      remove.type="button";remove.addEventListener("click",()=>{ids=ids.filter(id=>id!==book.id);persist();});
      row.append(text,remove);lines.append(row);
    }
    const amount=valid.reduce((n,p)=>n+Number(p.price),0);
    total.replaceChildren(el("strong",null,"Total"),el("strong",null,format(amount)));
    pay.disabled=valid.length===0;
  }
  function open(){
    overlay.hidden=false;
    basket.hidden=true;
    error.textContent="";
    document.body.style.overflow="hidden";
    close.focus();
    refresh();
  }
  function hide(){
    overlay.hidden=true;
    document.body.style.overflow="";
    refresh();
    if(!basket.hidden) basket.focus();
  }
  basket.addEventListener("click",open);
  close.addEventListener("click",hide);
  overlay.addEventListener("click",e=>{if(e.target===overlay)hide();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!overlay.hidden)hide();});
  document.addEventListener("click",e=>{
    const button=e.target.closest("[data-recipe-add]");
    if(!button)return;
    const id=button.dataset.recipeAdd;
    if(!products.some(p=>p.id===id&&p.has_pdf))return;
    if(!ids.includes(id)){
      if(ids.length>=4){open();error.textContent="You can buy up to four recipe books in one order.";return;}
      ids.push(id);persist();
    }
    open();
  });
  pay.addEventListener("click",async()=>{
    const selected=available();
    if(!selected.length) return;
    if(name.value.trim().length<2){error.textContent="Please enter your full name.";name.focus();return;}
    if(!email.validity.valid || !email.value.trim()){error.textContent="Please enter a valid email address.";email.focus();return;}
    pay.disabled=true;
    pay.textContent="Connecting to Yoco…";
    error.textContent="";
    try{
      const response=await fetch("/.netlify/functions/recipe-checkout",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:name.value.trim(),email:email.value.trim(),ids:selected.map(p=>p.id)})
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"Could not start payment.");
      if(!data.redirectUrl)throw Error("Missing payment link.");
      location.assign(data.redirectUrl);
    }catch(err){
      error.textContent=err.message||"Unable to contact payment provider.";
      pay.disabled=false;pay.textContent="Pay securely with Yoco";
    }
  });
  async function init(){
    try{
      const data=await window.VSH_PUBLIC_PRODUCTS.list("grannys");
      products=(data||[]).filter(p=>/recipe books?/i.test(String(p.category).trim())&&p.has_pdf);
      ids=ids.filter(id=>products.some(p=>p.id===id));persist();
    }catch(err){console.warn("Recipe basket unavailable:",err);}
  }
  init();
})();
