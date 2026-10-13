/* Browser-readable storefront product feed.
   This uses ONLY the public/publishable key and RLS-filtered published products. */
window.VSH_PUBLIC_PRODUCTS = {
  async list(business) {
    const config = window.VSH_ADMIN_CONFIG || {};
    if (!config.supabaseUrl || !config.publishableKey) return null;
    if (!["grannys", "clever-cubs"].includes(business)) throw new Error("Invalid business");
    const base = config.supabaseUrl.replace(/\/$/, "");
    const query = new URLSearchParams({
      select: "id,business,title,category,grade,description,price,image_path,is_active,updated_at",
      business: "eq." + business,
      is_active: "eq.true",
      order: "updated_at.desc"
    });
    const response = await fetch(base + "/rest/v1/products?" + query.toString(), {
      headers: { apikey: config.publishableKey, Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Catalogue temporarily unavailable (" + response.status + ")");
    return await response.json();
  },
  photo(path) {
    if (!path) return "";
    const config = window.VSH_ADMIN_CONFIG || {};
    const base = config.supabaseUrl.replace(/\/$/, "");
    return base + "/storage/v1/object/public/product-images/" +
      path.split("/").map(encodeURIComponent).join("/");
  }
};
