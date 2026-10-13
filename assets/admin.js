/* Netlify master admin: no third-party client and no secret committed to GitHub. */
const $ = id => document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const BUSINESSES = {
  grannys: { label: "GRANNY’S", categories: ["Gourmet Popcorn", "Party Snacks", "Baked Goods", "Jars", "Recipe Books", "Other"] },
  "clever-cubs": { label: "CLEVER CUBS", categories: ["Preschool", "Primary School", "High School", "Life Skills", "Other"] }
};
const productsEndpoint = "/.netlify/functions/admin-products";
const imagesEndpoint = "/.netlify/functions/product-image";
const keyStoreName = "vsh_master_admin_key";
const getKey = () => sessionStorage.getItem(keyStoreName) || "";
async function requestJSON(url, options = {}, key = getKey()) {
  const headers = new Headers(options.headers || {});
  if (key) headers.set("X-Admin-Key", key);
  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}
let business = new URLSearchParams(location.search).get("business") || sessionStorage.getItem("vsh-admin-business") || "grannys";
let products = [];
let editingImagePath = "";
let editingPdfPath = "";
let previewObjectUrl = null;
if (!BUSINESSES[business]) business = "grannys";

function show(id) {
  ["login-panel", "dashboard"].forEach(name => $(name).hidden = name !== id);
}
function message(id, text, type = "") {
  const el = $(id);
  el.textContent = text || "";
  el.className = "message" + (type ? " " + type : "");
}
function setBusy(busy) {
  for (const control of [$("save-product"), $("reset-product"), $("new-product"),
    $("new-recipe-book"), $("new-clever-book"), ...all("[data-business]")])
      control.disabled = busy;
  $("save-product").textContent = busy ? "Saving…" : "Save product";
}
function fmtPrice(value) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value || 0));
}
function imageUrl(path) {
  if (!path) return "";
  return imagesEndpoint + "?key=" + encodeURIComponent(path);
}
function isDigitalBook() {
  return business === "clever-cubs" ||
    (business === "grannys" && /^recipe books?$/i.test($("product-category").value.trim()));
}
function refreshPdfControls() {
  const book = isDigitalBook();
  $("book-pdf-controls").hidden = !book;
  $("pdf-label").textContent = business === "clever-cubs"
    ? "Clever Cubs learning book PDF (private, max 3 MB)"
    : "Granny's recipe book PDF (private, max 3 MB)";
  $("remove-pdf-wrapper").hidden = !book || !editingPdfPath;
  if (book && editingPdfPath) $("pdf-status").textContent =
    "Private PDF attached to this listing. Choose another PDF to replace it.";
  else if (book) $("pdf-status").textContent =
    "No private PDF attached yet. Upload a PDF before publishing this book.";
}
function resetEditor() {
  $("product-form").reset();
  $("product-id").value = "";
  editingImagePath = "";
  editingPdfPath = "";
  $("pdf-status").textContent = "Upload the private PDF that will be emailed after a verified payment.";
  $("editor-heading").textContent = "Add a product";
  $("product-grade").placeholder = "e.g. Printed, Digital, Grade 4 or 250g";
  $("image-preview").hidden = true;
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  $("preview-img").removeAttribute("src");
  message("form-message", "");
  refreshPdfControls();
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
  $("new-recipe-book").hidden = business !== "grannys";
  $("new-clever-book").hidden = business !== "clever-cubs";
  $("new-product").hidden = business === "clever-cubs";
  $("category-helper").textContent = business === "grannys"
    ? "Choose Recipe Books to list a book in Granny’s dedicated recipe-books section."
    : "Choose a category so shoppers can find your learning resources.";
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
    details.textContent = [product.category, product.grade,
      product.pdf_path ? "Private PDF attached" :
      (product.business === "clever-cubs" || /^recipe books?$/i.test(product.category)) ? "PDF not attached" : ""
    ].filter(Boolean).join(" · ") || "Uncategorised";
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
  const selected = business;
  $("product-list").textContent = "Loading products…";
  message("list-message", "");
  try {
    const output = await requestJSON(productsEndpoint + "?admin=1&business=" + encodeURIComponent(selected));
    if (business !== selected) return;
    products = output.products || [];
    drawProducts();
  } catch (error) {
    if (business !== selected) return;
    products = [];
    drawProducts();
    message("list-message", error.message, "error");
    if (error.status === 401) {
      sessionStorage.removeItem(keyStoreName);
      show("login-panel");
      message("login-message", "Your admin key was not accepted. Please sign in again.", "error");
    }
  }
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
  editingPdfPath = product.pdf_path || "";
  refreshPdfControls();
  $("editor-heading").textContent = business === "clever-cubs" ? "Edit learning book" :
    /^recipe books?$/i.test(String(product.category || "").trim()) ? "Edit recipe book" : "Edit product";
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
  if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024)) {
    message("form-message", "Choose a JPG, PNG or WebP image no larger than 3 MB.", "error");
    return;
  }
  const selectedBusiness = business;
  const isBook = isDigitalBook();
  const pdfFile = isBook ? $("product-pdf").files[0] : null;
  const detach = isBook && $("remove-pdf").checked;
  if (pdfFile && detach) {
    message("form-message", "Choose either a replacement PDF or detach the old one, not both.", "error");
    return;
  }
  if (pdfFile && (!["application/pdf", ""].includes(pdfFile.type) ||
      !/\.pdf$/i.test(pdfFile.name) || pdfFile.size < 8 || pdfFile.size > 3 * 1024 * 1024)) {
    message("form-message", "Choose a PDF file no larger than 3 MB.", "error");
    return;
  }
  if (isBook && $("product-active").checked && !pdfFile && (!editingPdfPath || detach)) {
    message("form-message", "Please attach a PDF before publishing this digital book.", "error");
    return;
  }
  if (isBook && $("product-active").checked && price < 1) {
    message("form-message", "Published digital books need a price of at least R1.00.", "error");
    return;
  }
  setBusy(true);
  try {
    let path = editingImagePath;
    if (file) {
      const data = new FormData();
      data.set("business", selectedBusiness);
      data.set("file", file);
      const uploaded = await requestJSON(imagesEndpoint, { method: "POST", body: data });
      path = uploaded.image_path;
    }
    let pdfPath = isBook && !detach ? editingPdfPath : "";
    if (pdfFile) {
      const form = new FormData();
      form.set("business", selectedBusiness);
      form.set("file", pdfFile);
      const response = await requestJSON("/.netlify/functions/book-pdf",
        { method: "POST", body: form });
      pdfPath = response.pdf_path;
    }
    const payload = {
      business: selectedBusiness,
      title: $("product-title").value.trim(),
      category: $("product-category").value.trim(),
      description: $("product-description").value.trim(),
      grade: $("product-grade").value.trim(),
      price: Math.round(price * 100) / 100,
      image_path: path || null,
      pdf_path: pdfPath || null,
      is_active: $("product-active").checked
    };
    if (!payload.title || !payload.category) throw new Error("A product name and category are required.");
    const id = $("product-id").value;
    await requestJSON(productsEndpoint + (id ? "?id=" + encodeURIComponent(id) : ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    resetEditor();
    await loadProducts();
    message("list-message", "Product saved successfully.", "success");
  } catch (error) {
    message("form-message", error.message || "Could not save the product.", "error");
  } finally {
    setBusy(false);
  }
}
function loginFailure(error) {
  if (error.status === 503) {
    return error.message || "The admin service is not configured in this Deploy Preview. Rebuild the preview after updating VSH_ADMIN_KEY.";
  }
  if (error.status === 401) {
    return "That admin key wasn't recognised. Check that it matches your Netlify secret exactly, including capital letters.";
  }
  if (error.status === 404) {
    return "The admin login service isn't available on this deployment. Please rebuild the Deploy Preview.";
  }
  return error.message || "Couldn't connect to the admin login. Please try again.";
}
async function unlock(key) {
  if (key.length < 32) {
    const error = new Error("Your admin key must contain at least 32 characters. Update VSH_ADMIN_KEY in Netlify and rebuild this Deploy Preview.");
    error.status = 400;
    throw error;
  }
  await requestJSON(productsEndpoint + "?verify=1", {}, key);
  sessionStorage.setItem(keyStoreName, key);
  $("user-email").textContent = "Master administrator";
  show("dashboard");
  chooseBusiness(business);
}
async function init() {
  show("login-panel");
  try {
    const saved = getKey();
    if (saved) {
      await unlock(saved);
      return;
    }
    await requestJSON(productsEndpoint + "?verify=1");
  } catch (error) {
    // 401 is expected when probing an authenticated endpoint without a key.
    // Keep the login page visible instead of showing a second setup panel.
    if (error.status !== 401) message("login-message", loginFailure(error), "error");
  }
}
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  message("login-message", "");
  $("sign-in-button").disabled = true;
  try {
    await unlock($("admin-key").value.trim());
    $("admin-key").value = "";
  } catch (error) {
    message("login-message", loginFailure(error), "error");
  } finally {
    $("sign-in-button").disabled = false;
  }
});
$("sign-out-button").addEventListener("click", () => {
  sessionStorage.removeItem(keyStoreName);
  products = [];
  resetEditor();
  show("login-panel");
});

all("[data-business]").forEach(button => button.addEventListener("click", () => chooseBusiness(button.dataset.business)));
$("new-product").addEventListener("click", () => { resetEditor(); $("product-title").focus(); });
$("new-recipe-book").addEventListener("click", () => {
  if (business !== "grannys") return;
  resetEditor();
  $("product-category").value = "Recipe Books";
  refreshPdfControls();
  $("editor-heading").textContent = "Add a recipe book";
  $("product-grade").placeholder = "e.g. Printed book, Digital edition, 48 pages";
  $("product-title").focus();
  if (window.innerWidth < 850) $("product-form").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("new-clever-book").addEventListener("click", () => {
  if (business !== "clever-cubs") return;
  resetEditor();
  $("product-category").value = "Primary School";
  refreshPdfControls();
  $("editor-heading").textContent = "Add a learning book";
  $("product-grade").placeholder = "e.g. Grade 3 or Foundation Phase";
  $("product-title").focus();
  if (window.innerWidth < 850) $("product-form").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("reset-product").addEventListener("click", resetEditor);
$("search-products").addEventListener("input", drawProducts);
$("product-category").addEventListener("input", refreshPdfControls);
$("product-pdf").addEventListener("change", event => {
  if (event.target.files[0]) $("pdf-status").textContent =
    "Selected file: " + event.target.files[0].name + " (private; not published for download).";
  else refreshPdfControls();
});
$("remove-pdf").addEventListener("change", event => {
  if (event.target.checked) {
    $("product-pdf").value = "";
    $("pdf-status").textContent = "The PDF will be detached when you save as a draft. Previously sold PDFs remain stored privately.";
  } else refreshPdfControls();
});
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
