/* CleverCubs Learning product source.
   Real books can be added here after review, or this can be replaced by the secure backend later. */
window.CLEVER_CUBS_PRODUCTS = [];

/* Once the backend is configured, the public catalogue reads ONLY published
   CleverCubs Learning products. Do not create fictitious products when no books are published. */
window.CLEVER_CUBS_PRODUCTS_READY = (async function () {
  try {
    const items = await window.VSH_PUBLIC_PRODUCTS.list("clever-cubs");
    if (items === null) return;
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[c]);
    const categorySlug = label => {
      const s = String(label || "").toLowerCase();
      if (s.includes("preschool")) return "preschool";
      if (s.includes("primary")) return "primary";
      if (s.includes("skill")) return "skills";
      return "other";
    };
    window.CLEVER_CUBS_PRODUCTS = items.filter(item => item.has_pdf === true && item.is_active === true).map(item => ({
      id: item.id,
      title: escapeHtml(item.title),
      category: categorySlug(item.category),
      categoryLabel: escapeHtml(item.category),
      grade: escapeHtml(item.grade),
      description: escapeHtml(item.description),
      price: Number(item.price),
      currency: "ZAR",
      badge: "DIGITAL RESOURCE",
      image_url: item.image_path ? window.VSH_PUBLIC_PRODUCTS.photo(item.image_path) : "",
      demo: false,
      active: item.is_active
    }));
  } catch (error) {
    console.warn("CleverCubs Learning live catalogue unavailable:", error);
    window.CLEVER_CUBS_PRODUCTS = [];
  }
})();
