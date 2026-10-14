(() => {
"use strict";
const $=id=>document.getElementById(id);
const key=()=>sessionStorage.getItem("vsh_master_admin_key")||"";
const fmt=number=>new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR"}).format(number);
const state={books:[]};
const status=(message,type="")=>{$("test-status").textContent=message;$("test-status").className="message "+type};
const picked=()=>[...$("test-books").querySelectorAll("input[type=checkbox]:checked")].map(el=>el.value);
function total(){
  const ids=new Set(picked());
  $("test-total").textContent="Selected total: "+fmt(state.books.filter(b=>ids.has(b.id)).reduce((sum,b)=>sum+Number(b.price||0),0));
}
async function refresh(){
  const brand=$("test-business").value;
  $("test-books").replaceChildren(document.createTextNode("Loading preview catalogue…"));
  state.books=[];
  total();status("");
  const r=await fetch("/.netlify/functions/admin-products?business="+encodeURIComponent(brand),{cache:"no-store"});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||"Could not read the preview catalogue.");
  state.books=(data.products||[]).filter(p=>p.is_active&&p.has_pdf&&
    (brand==="clever-cubs"||/^recipe books?$/i.test(String(p.category||""))));
  $("test-books").replaceChildren();
  if(!state.books.length){
    $("test-books").textContent="No published books in this Deploy Preview. Upload and publish a small test book in the preview admin first.";
  }
  for(const product of state.books){
    const label=document.createElement("label");
    label.style.display="flex";label.style.gap="12px";label.style.padding="13px 8px";
    const checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.value=product.id;
    checkbox.addEventListener("change",total);
    const caption=document.createElement("span");
    caption.textContent=product.title+" · "+fmt(product.price);
    label.append(checkbox,caption);$("test-books").append(label);
  }
}
$("test-business").addEventListener("change",()=>refresh().catch(err=>status(err.message,"error")));
$("test-cart").addEventListener("submit",async event=>{
  event.preventDefault();
  if(!key())return status("Please sign in through Admin Portal first, in this same browser tab.","error");
  const ids=picked();
  if(!ids.length)return status("Select at least one published PDF book.","error");
  const button=$("test-start");button.disabled=true;
  status("Creating your sandbox checkout…");
  try{
    const response=await fetch("/.netlify/functions/book-checkout-test",{
      method:"POST",cache:"no-store",
      headers:{"Content-Type":"application/json","X-Admin-Key":key()},
      body:JSON.stringify({
        business:$("test-business").value,ids,
        name:$("test-customer").value.trim(),email:$("test-email").value.trim()
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||"Sandbox checkout unavailable.");
    if(data.testOnly!==true||typeof data.redirectUrl!=="string")
      throw Error("Unexpected sandbox checkout response.");
    status("Redirecting to the Yoco TEST payment page. No PDF delivery is enabled.");
    location.assign(data.redirectUrl);
  }catch(err){status(err.message,"error");button.disabled=false}
});
refresh().catch(err=>status(err.message,"error"));
})();