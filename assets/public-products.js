/* Public products are served by our Netlify Function. No admin key appears here. */
window.VSH_PUBLIC_PRODUCTS = {
  async list(business) {
    if (!["grannys", "clever-cubs"].includes(business)) throw new Error("Invalid business");
    const response = await fetch("/.netlify/functions/admin-products?business=" + encodeURIComponent(business));
    if (!response.ok) throw new Error("Catalogue temporarily unavailable");
    const data = await response.json();
    return Array.isArray(data.products) ? data.products : [];
  },
  photo(path) {
    if (!path || typeof path !== "string") return "";
    return "/.netlify/functions/product-image?key=" + encodeURIComponent(path);
  }
};
