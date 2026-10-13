let createClient; // Loaded only after the public Supabase project details are configured.

const config = window.VSH_ADMIN_CONFIG || {};
const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const BUSINESSES = {
  grannys: { label: "GRANNY’S", categories: ["Gourmet Popcorn", "Party Snacks", "Baked Goods", "Jars", "Other"] },
  "clever-cubs": { label: "CLEVER CUBS", categories: ["Preschool", "Primary School", "High School", "Life Skills", "Other"] }
};
const configured = Boolean(config.supabaseUrl && config.publishableKey && /^https:\/\//.test(config.supabaseUrl));
let db;
let currentUser = null;
let business = new URLSearchParams(location.search).get("business") || sessionStorage.getItem("vsh-admin-business") || "grannys";
let products = [];
let editingImagePath = "";
let previewObjectUrl = null;
if (!BUSINESSES[business]) business = "grannys";

function show(id) {
  ["setup-panel", "login-panel", "dashboard"].forEach(name => $(name).hidden = name !== id);
}
function message(id, text, type = "") {
  const el = $(id);
  el.textContent = text || "";
  el.className = "message" + (type ? " " + type : "");
}
function setBusy(busy) {
  $("save-product").disabled = busy;
  $("save-product").textContent = busy ? "Saving…" : "Save product";
}
function fmtPrice(value) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value || 0));
}
function imageUrl(path) {
  if (!path) return "";
  return db.storage.from("product-images").getPublicUrl(path).data.publicUrl;
}
function resetEditor() {
  $("product-form").reset();
  $("product-id").value = "";
  editingImagePath = "";
  $("editor-heading").textContent = "Add a product";
  $("image-preview").hidden = true;
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  $("preview-img").removeAttribute("src");
  message("form-message", "");
}
function updateCategorySuggestions() {
  const list = $("category-suggestions");
  list.replaceChildren();
  for (const category of BUSINESSES[business].categories) {
    const option = document.createElement("option");
    option.value = category;
    list.append(option);
  }
}
function chooseBusiness(key) {
  if (!BUSINESSES[key]) return;
  business = key;
  sessionStorage.setItem("vsh-admin-business", business);
  $("current-business-label").textContent = BUSINESSES[business].label;
  all("[data-business]").forEach(button => {
    const selected = button.dataset.business === business;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("search-products").value = "";
  updateCategorySuggestions();
  resetEditor();
  loadProducts();
}
function drawProducts() {
  const term = $("search-products").value.toLocaleLowerCase().trim();
  const visible = products.filter(p =>
    (p.title + " " + (p.category || "")).toLocaleLowerCase().includes(term)
  );
  const list = $("product-list");
  list.replaceChildren();
  $("total-count").textContent = products.length;
  $("active-count").textContent = products.filter(p => p.is_active).length;
  $("hidden-count").textContent = products.filter(p => !p.is_active).length;
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = term ? "No matching products." : "No products yet. Select New product to add the first one.";
    list.append(empty);
    return;
  }
  for (const product of visible) {
    const row = document.createElement("article");
    row.className = "product-row";
    const image = product.image_path ? document.createElement("img") : document.createElement("span");
    image.className = product.image_path ? "product-thumb" : "product-thumb product-placeholder";
    if (product.image_path) {
      image.src = imageUrl(product.image_path);
      image.alt = "";
      image.loading = "lazy";
    } else {
      image.textContent = (product.title || "?").charAt(0).toUpperCase();
    }
    const info = document.createElement("div");
    info.className = "product-info";
    const name = document.createElement("b");
    name.textContent = product.title;
    const details = document.createElement("small");
    details.textContent = [product.category, product.grade].filter(Boolean).join(" · ") || "Uncategorised";
    info.append(name, details);
    const right = document.createElement("div");
    right.className = "product-side";
    const price = document.createElement("strong");
    price.textContent = fmtPrice(product.price);
    const status = document.createElement("span");
    status.className = "status-badge" + (product.is_active ? "" : " draft");
    status.textContent = product.is_active ? "Published" : "Draft";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", "Edit " + product.title);
    edit.addEventListener("click", () => editProduct(product.id));
    right.append(price, status, edit);
    row.append(image, info, right);
    list.append(row);
  }
}
async function loadProducts() {
  $("product-list").textContent = "Loading products…";
  message("list-message", "");
  const { data, error } = await db.from("products")
    .select("id,business,title,category,grade,description,price,image_path,is_active,updated_at")
    .eq("business", business).order("updated_at", { ascending: false });
  if (error) {
    products = [];
    drawProducts();
    message("list-message", error.message, "error");
    return;
  }
  products = data || [];
  drawProducts();
}
function editProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  resetEditor();
  $("product-id").value = product.id;
  $("product-title").value = product.title;
  $("product-category").value = product.category;
  $("product-description").value = product.description || "";
  $("product-price").value = product.price;
  $("product-grade").value = product.grade || "";
  $("product-active").checked = product.is_active;
  editingImagePath = product.image_path || "";
  $("editor-heading").textContent = "Edit product";
  if (editingImagePath) {
    $("preview-img").src = imageUrl(editingImagePath);
    $("image-preview").hidden = false;
  }
  $("product-title").focus({ preventScroll: true });
  if (window.innerWidth < 850) $("product-form").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function saveProduct(event) {
  event.preventDefault();
  message("form-message", "");
  const price = Number($("product-price").value);
  if (!Number.isFinite(price) || price < 0 || price > 999999.99) {
    message("form-message", "Please enter a valid price.", "error");
    return;
  }
  const file = $("product-image").files[0];
  if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
    message("form-message", "Choose a JPG, PNG or WebP image no larger than 5 MB.", "error");
    return;
  }
  setBusy(true);
  try {
    let path = editingImagePath;
    if (file) {
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
      const key = business + "/" + crypto.randomUUID() + "." + extension;
      const { error: uploadError } = await db.storage.from("product-images")
        .upload(key, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      path = key;
    }
    const payload = {
      business,
      title: $("product-title").value.trim(),
      category: $("product-category").value.trim(),
      description: $("product-description").value.trim(),
      grade: $("product-grade").value.trim(),
      price: Math.round(price * 100) / 100,
      image_path: path || null,
      is_active: $("product-active").checked
    };
    if (!payload.title || !payload.category) throw new Error("A product name and category are required.");
    const id = $("product-id").value;
    const query = id ? db.from("products").update(payload).eq("id", id).eq("business", business)
                     : db.from("products").insert(payload);
    const { error } = await query.select("id");
    if (error) throw error;
    resetEditor();
    await loadProducts();
    message("list-message", "Product saved successfully.", "success");
  } catch (error) {
    message("form-message", error.message || "Could not save the product.", "error");
  } finally {
    setBusy(false);
  }
}
async function authorize(user) {
  const { data, error } = await db.from("admin_users").select("role").eq("id", user.id).maybeSingle();
  if (error || data?.role !== "master") {
    await db.auth.signOut();
    show("login-panel");
    message("login-message", "This account is not approved as the master admin.", "error");
    return;
  }
  currentUser = user;
  $("user-email").textContent = currentUser.email || "Master admin";
  show("dashboard");
  chooseBusiness(business);
}
async function init() {
  if (!configured) {
    show("setup-panel");
    return;
  }
  try {
    db = createClient(config.supabaseUrl.replace(/\/$/, ""), config.publishableKey);
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await authorize(data.session.user);
    else show("login-panel");
    db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        show("login-panel");
      }
    });
  } catch (error) {
    show("setup-panel");
    const setup = $("setup-panel");
    const extra = document.createElement("p");
    extra.textContent = "Connection error: " + (error.message || "Could not reach authentication.");
    setup.append(extra);
  }
}
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  message("login-message", "");
  $("sign-in-button").disabled = true;
  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error) throw error;
    await authorize(data.user);
    $("password").value = "";
  } catch (error) {
    message("login-message", error.message || "Sign-in failed.", "error");
  } finally {
    $("sign-in-button").disabled = false;
  }
});
$("sign-out-button").addEventListener("click", async () => {
  if (db) await db.auth.signOut();
  currentUser = null;
  products = [];
  show("login-panel");
});
all("[data-business]").forEach(button => button.addEventListener("click", () => chooseBusiness(button.dataset.business)));
$("new-product").addEventListener("click", () => { resetEditor(); $("product-title").focus(); });
$("reset-product").addEventListener("click", resetEditor);
$("search-products").addEventListener("input", drawProducts);
$("product-form").addEventListener("submit", saveProduct);
$("product-image").addEventListener("change", event => {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  const file = event.target.files[0];
  if (file) {
    previewObjectUrl = URL.createObjectURL(file);
    $("preview-img").src = previewObjectUrl;
    $("image-preview").hidden = false;
  } else if (editingImagePath) {
    $("preview-img").src = imageUrl(editingImagePath);
    $("image-preview").hidden = false;
  } else {
    $("image-preview").hidden = true;
  }
});
init();
