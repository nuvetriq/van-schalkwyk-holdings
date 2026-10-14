/* Granny's recipe-book basket is a PRE-LAUNCH wishlist only.
   It never collects personal information, processes payments or exposes PDFs. */
(() => {
  "use strict";
  const key="grannys-recipe-basket-v1";
  const money=n=>new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR"}).format(Number(n||0));
  const create=(tag,cls,text)=>{
    const x=document.createElement(tag);
    if(cls)x.className=cls;
    if(text!=null)x.textContent=String(text);
    return x;
  };
  let books=[],ids=[];
  try{
    const saved=JSON.parse(sessionStorage.getItem(key)||"[]");
    if(Array.isArray(saved))ids=saved.filter(id=>typeof id==="string").slice(0,4);
  }catch{}
  const fab=create("button","gr-basket-button","♡ Recipe basket (0)");
  fab.type="button";fab.hidden=true;fab.setAttribute("aria-label","Open recipe book basket");
  const cover=create("div","gr-basket-overlay");cover.hidden=true;
  const panel=create("section","gr-basket-panel");
  panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");
  panel.setAttribute("aria-labelledby","gr-basket-title");
  const header=create("div","gr-basket-head");
  const title=create("h2",null,"Your recipe books");title.id="gr-basket-title";
  const close=create("button",null,"×");close.type="button";close.setAttribute("aria-label","Close basket");
  header.append(title,close);
  const list=create("div","gr-basket-items");
  const total=create("div","gr-basket-total");
  const note=create("p","gr-basket-note","Your selected PDF books are saved in this basket for now. Secure Yoco payment and automatic email delivery are being prepared, so you cannot place or pay for an order yet.");
  panel.append(header,list,total,note);cover.append(panel);
  document.body.append(fab,cover);
  const selected=()=>ids.map(id=>books.find(b=>b.id===id)).filter(Boolean);
  function save(){try{sessionStorage.setItem(key,JSON.stringify(ids))}catch{}render()}
  function render(){
    const picks=selected();
    fab.hidden=books.length===0&&!ids.length;
    fab.textContent="♡ Recipe basket ("+ids.length+")";
    list.replaceChildren();
    if(!picks.length)list.append(create("p",null,"Your basket is empty. Add a recipe book when one is available."));
    for(const book of picks){
      const line=create("div","gr-basket-row");
      const info=create("div");
      info.append(create("strong",null,book.title),create("small",null,money(book.price)));
      const remove=create("button",null,"Remove");
      remove.type="button";remove.addEventListener("click",()=>{ids=ids.filter(x=>x!==book.id);save()});
      line.append(info,remove);list.append(line);
    }
    total.replaceChildren(create("span",null,"Total"),create("span",null,money(picks.reduce((sum,b)=>sum+Number(b.price||0),0))));
  }
  function show(){
    cover.hidden=false;fab.hidden=true;
    document.body.classList.add("gr-book-basket-open");
    close.focus();render();
  }
  function hide(){
    cover.hidden=true;
    document.body.classList.remove("gr-book-basket-open");
    render();if(!fab.hidden)fab.focus();
  }
  fab.addEventListener("click",show);close.addEventListener("click",hide);
  cover.addEventListener("click",ev=>{if(ev.target===cover)hide()});
  document.addEventListener("keydown",ev=>{if(ev.key==="Escape"&&!cover.hidden)hide()});
  document.addEventListener("click",ev=>{
    const button=ev.target.closest("[data-recipe-add]");
    if(!button)return;
    const id=button.dataset.recipeAdd;
    if(!books.some(x=>x.id===id))return;
    if(!ids.includes(id)){
      if(ids.length>=4){show();note.textContent="You can add up to four books at a time. Remove one to add another.";return;}
      ids.push(id);save();
    }
    show();
  });
  (async()=>{
    try{
      books=(await window.VSH_PUBLIC_PRODUCTS.list("grannys")).filter(p=>/^recipe books?$/i.test(String(p.category).trim())&&p.has_pdf);
      ids=ids.filter(id=>books.some(p=>p.id===id));save();
    }catch(err){console.warn("Could not load Granny's public recipe book list.",err);}
  })();
})();
