/* Granny's public catalogue. Only published products come from the Netlify API.
   Recipe books have their own section and do not also appear in the treats grid. */
(async function () {
  "use strict";
  const treatsSection = document.getElementById("grannys-live-products");
  const treatsGrid = document.getElementById("grannys-live-grid");
  const recipesGrid = document.getElementById("grannys-recipe-grid");
  const recipesEmpty = document.getElementById("grannys-recipe-empty");
  if (!treatsSection || !treatsGrid || !recipesGrid || !recipesEmpty) return;

  const money = value =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value || 0));

  const bookCategory = product => {
    const category = String(product.category || "").trim().toLocaleLowerCase("en-ZA");
    return category === "recipe books" || category === "recipe book";
  };

  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };

  function whatsappLink(product, isBook) {
    const message = isBook
      ? "Hi Chantel! I'm interested in Granny's recipe book: " + product.title + ". Could you please tell me how to order it?"
      : "Hi! I'd like to ask about " + product.title + " from Granny's.";
    const link = create("a", isBook ? "gr-recipe-card-action" : "", isBook ? "Ask about this book ↗" : "Enquire on WhatsApp →");
    link.href = "https://wa.me/27753908063?text=" + encodeURIComponent(message);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Enquire on WhatsApp about " + product.title);
    return link;
  }

  function productPhoto(product, isBook) {
    const photo = create("div", isBook ? "gr-recipe-card-image" : "g-live-photo");
    if (product.image_path) {
      const img = create("img");
      img.src = window.VSH_PUBLIC_PRODUCTS.photo(product.image_path);
      img.alt = isBook ? "Cover of " + product.title : product.title;
      img.loading = "lazy";
      photo.append(img);
    } else if (isBook) {
      photo.append(create("span", "gr-recipe-cover-fallback", product.title));
    } else {
      photo.append(create("span", null, "♥"));
    }
    return photo;
  }

  function treatCard(product) {
    const article = create("article", "g-live-card");
    const body = create("div", "g-live-body");
    body.append(
      create("small", null, product.category),
      create("h3", null, product.title),
      create("p", null, product.description || "")
    );
    const footer = create("div", "g-live-footer");
    footer.append(create("b", null, money(product.price)), whatsappLink(product, false));
    body.append(footer);
    article.append(productPhoto(product, false), body);
    return article;
  }

  function recipeCard(product) {
    const article = create("article", "gr-recipe-card");
    const body = create("div", "gr-recipe-card-body");
    const format = String(product.grade || "").trim();
    body.append(
      create("p", "gr-recipe-card-meta", format ? "RECIPE BOOK · " + format : "RECIPE BOOK"),
      create("h4", null, product.title),
      create("p", "gr-recipe-card-description", product.description || "")
    );
    const footer = create("div", "gr-recipe-card-footer");
    footer.append(create("b", "gr-recipe-card-price", money(product.price)), whatsappLink(product, true));
    body.append(footer);
    article.append(productPhoto(product, true), body);
    return article;
  }

  try {
    const products = await window.VSH_PUBLIC_PRODUCTS.list("grannys");
    if (!Array.isArray(products)) return;
    const recipes = products.filter(bookCategory);
    const treats = products.filter(product => !bookCategory(product));
    treatsGrid.replaceChildren(...treats.map(treatCard));
    recipesGrid.replaceChildren(...recipes.map(recipeCard));
    treatsSection.hidden = treats.length === 0;
    recipesEmpty.hidden = recipes.length > 0;
  } catch (error) {
    // Never break the static bakery page when the product API is unavailable.
    console.warn("Granny's catalogue unavailable:", error);
  }
})();
