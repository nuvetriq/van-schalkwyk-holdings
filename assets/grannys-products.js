(async function () {
  "use strict";
  const section = document.getElementById("grannys-live-products");
  const grid = document.getElementById("grannys-live-grid");
  if (!section || !grid) return;
  try {
    const products = await window.VSH_PUBLIC_PRODUCTS.list("grannys");
    if (!products || !products.length) return; // Keep the existing showcase when no live products exist.
    for (const product of products) {
      const article = document.createElement("article");
      article.className = "g-live-card";
      const figure = document.createElement("div");
      figure.className = "g-live-photo";
      if (product.image_path) {
        const img = document.createElement("img");
        img.src = window.VSH_PUBLIC_PRODUCTS.photo(product.image_path);
        img.alt = product.title;
        img.loading = "lazy";
        figure.append(img);
      } else {
        const placeholder = document.createElement("span");
        placeholder.textContent = "♥";
        figure.append(placeholder);
      }
      const body = document.createElement("div");
      body.className = "g-live-body";
      const category = document.createElement("small");
      category.textContent = product.category;
      const title = document.createElement("h3");
      title.textContent = product.title;
      const description = document.createElement("p");
      description.textContent = product.description || "";
      const footer = document.createElement("div");
      footer.className = "g-live-footer";
      const price = document.createElement("b");
      price.textContent = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(product.price);
      const order = document.createElement("a");
      order.href = "https://wa.me/27753908063?text=" + encodeURIComponent("Hi! I'd like to ask about " + product.title + " from Granny's.");
      order.target = "_blank";
      order.rel = "noopener noreferrer";
      order.textContent = "Enquire on WhatsApp →";
      footer.append(price, order);
      body.append(category, title, description, footer);
      article.append(figure, body);
      grid.append(article);
    }
    section.hidden = false;
  } catch (error) {
    // The public showcase remains readable if the catalogue service is temporarily unavailable.
    console.warn("Granny's catalogue unavailable:", error);
  }
})();
