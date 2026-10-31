/* CleverCubs Learning storefront catalogue and filters.
   Shared cart lives in shared-book-cart.js for BOTH businesses. */
(async()=>{
  "use strict";
  await (window.CLEVER_CUBS_PRODUCTS_READY || Promise.resolve());
  const products=(window.CLEVER_CUBS_PRODUCTS||[]).filter(p=>p.active!==false);
  const grid=document.getElementById("ccl-book-grid");
  if(!grid)return;
  const money=n=>new Intl.NumberFormat("en-ZA",{style:"currency",currency:"ZAR"}).format(Number(n||0));
  const categoryFromText=value=>{
    const t=String(value||"").toLowerCase();
    if(t.includes("preschool"))return "preschool";
    if(t.includes("primary"))return "primary";
    if(t.includes("skill"))return "skills";
    if(t.includes("high"))return "high";
    return "all";
  };
  function renderProducts(filter="all"){
    const list=products.filter(p=>filter==="all"||p.category===filter);
    if(!list.length){
      grid.innerHTML='<div class="ccl-empty"><strong>No books in this category yet.</strong><p>Published PDF books will appear here once added through the admin.</p></div>';
      return;
    }
    // Product text is HTML-escaped by clever-cubs-products.js, directly after
    // loading the published catalogue. Dynamic buttons only contain product IDs.
    grid.innerHTML=list.map(p=>'<article class="ccl-book-card"><div class="ccl-cover"><span class="ccl-preview-pill">'+(p.badge||"DIGITAL PDF")+'</span><div class="ccl-cover-book"><img src="'+(p.image_url||"assets/clever-new.png")+'" alt=""><div><small>CleverCubs Learning</small><b>'+p.title+'</b></div><small>'+p.categoryLabel+'</small></div></div><div class="ccl-card-body"><div class="ccl-card-meta"><span>'+p.categoryLabel+'</span><span>'+p.grade+'</span></div><h3>'+p.title+'</h3><p>'+p.description+'</p><div class="ccl-card-bottom"><span class="ccl-price">'+money(p.price)+'</span><button class="ccl-add" type="button" data-add="'+p.id+'">Add to shared basket</button></div></div></article>').join("");
    grid.querySelectorAll("[data-add]").forEach(button=>button.addEventListener("click",()=>{
      if(window.VSH_BOOK_CART)window.VSH_BOOK_CART.add("clever-cubs",button.dataset.add);
    }));
  }
  const filters=[...document.querySelectorAll('[aria-label="Filter books"] button')];
  filters.forEach((button,i)=>{
    const filter=categoryFromText(button.textContent);
    if(i===0)button.classList.add("ccl-filter-active");
    button.addEventListener("click",()=>{
      filters.forEach(x=>x.classList.remove("ccl-filter-active","offline-selected"));
      button.classList.add("ccl-filter-active");
      renderProducts(filter);
    });
  });
  const categoryCards=[...document.querySelectorAll("#categories>.grid>button")];
  categoryCards.forEach(card=>card.addEventListener("click",()=>{
    const filter=categoryFromText(card.querySelector("h3")?.textContent||"");
    categoryCards.forEach(x=>x.classList.remove("is-active","offline-selected"));
    card.classList.add("is-active");
    filters.forEach(x=>{
      x.classList.remove("ccl-filter-active","offline-selected");
      if(categoryFromText(x.textContent)===filter)x.classList.add("ccl-filter-active");
    });
    renderProducts(filter);
    document.getElementById("shop")?.scrollIntoView({behavior:"smooth"});
  }));
  renderProducts();
})();
