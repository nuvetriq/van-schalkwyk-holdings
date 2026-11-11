/* Admin-only Yoco TEST lab. Never make payment requests on page load.
 * The existing admin session key is kept in sessionStorage and passed only as
 * X-Admin-Key to SAME-ORIGIN Netlify Functions. Nothing is logged to console.
 */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const adminKey = sessionStorage.getItem("vsh_master_admin_key") || "";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const money = cents => new Intl.NumberFormat("en-ZA", {
    style: "currency", currency: "ZAR"
  }).format(cents / 100);
  const books = {"grannys": new Map(), "clever-cubs": new Map()};
  const selects = {"grannys": $("test-grannys"), "clever-cubs": $("test-clever")};
  const create = $("test-create");
  const check = $("test-check-status");
  const yoco = $("test-yoco-link");
  let ready = false;
  let creating = false;
  let created = false;
  let orderId = "";

  const message = (id, value, isError = false) => {
    const el = $(id);
    el.textContent = value;
    el.className = "message" + (isError ? " error" : "");
  };
  const showLogin = () => {
    $("test-workspace").hidden = true;
    $("no-admin").hidden = false;
  };
  const selected = business => books[business].get(selects[business].value);
  const priceCents = product => Math.round(Number(product.price) * 100);

  async function request(path, options = {}) {
    // Paths are fixed local Netlify Functions; no keys or customer details in URLs.
    const headers = new Headers(options.headers || {});
    headers.set("X-Admin-Key", adminKey);
    const response = await fetch(path, {
      ...options, headers, cache: "no-store", credentials: "same-origin",
      redirect: "error"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "TEST service unavailable.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function updateEstimate() {
    const chosen = [selected("grannys"), selected("clever-cubs")];
    const amount = chosen.every(Boolean)
      ? chosen.reduce((sum, product) => sum + priceCents(product), 0)
      : null;
    $("test-estimate").textContent = amount === null ? "Select both books" : money(amount);
    create.disabled = !ready || creating || created || amount === null ||
      !$("test-confirm").checked;
  }

  function fill(business, products) {
    books[business].clear();
    const select = selects[business];
    select.replaceChildren(new Option("Choose a published digital book", ""));
    for (const product of products) {
      if (!product || product.business !== business || !uuid.test(product.id || "") ||
          product.is_active !== true || !product.pdf_path ||
          !Number.isFinite(Number(product.price)) || Number(product.price) < 1 ||
          (business === "grannys" &&
            !/^recipe books?$/i.test(String(product.category || "").trim()))) continue;
      const cents = priceCents(product);
      if (!Number.isSafeInteger(cents) || cents < 100 || cents > 5000000) continue;
      books[business].set(product.id, product);
      select.add(new Option(String(product.title).slice(0, 120) + " — " + money(cents), product.id));
    }
    if (!books[business].size) {
      select.replaceChildren(new Option("No eligible published books found", ""));
      select.disabled = true;
    } else {
      select.disabled = false;
    }
  }

  async function loadCatalogue() {
    try {
      const [grannys, clever] = await Promise.all([
        request("/.netlify/functions/admin-products?admin=1&business=grannys"),
        request("/.netlify/functions/admin-products?admin=1&business=clever-cubs")
      ]);
      fill("grannys", grannys.products || []);
      fill("clever-cubs", clever.products || []);
      ready = books.grannys.size > 0 && books["clever-cubs"].size > 0;
      if (!ready) message("test-create-message",
        "Add a published book with a private PDF in both brand catalogues before testing.", true);
      updateEstimate();
    } catch (error) {
      if (error.status === 401) {
        sessionStorage.removeItem("vsh_master_admin_key");
        showLogin();
        return;
      }
      message("test-create-message",
        "Unable to load both admin catalogues. Return to the admin dashboard and check access.", true);
      ready = false;
      updateEstimate();
    }
  }

  function safeYocoUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "c.yoco.com" ||
          !url.pathname.startsWith("/checkout/") || url.username || url.password)
        return null;
      return url.href;
    } catch { return null; }
  }

  $("test-checkout-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = $("test-checkout-form");
    if (!ready || creating || created || !form.reportValidity() ||
        !$("test-confirm").checked) return;
    const a = selected("grannys"), b = selected("clever-cubs");
    if (!a || !b) return;
    const estimated = priceCents(a) + priceCents(b);
    const confirmed = window.confirm(
      "Create ONE Yoco TEST checkout for approximately " + money(estimated) +
      "? This writes a TEST order and calls Yoco with your TEST key. " +
      "No LIVE payments, customer emails or PDF delivery will be enabled.");
    if (!confirmed) return;

    creating = true;
    updateEstimate();
    message("test-create-message", "Preparing ONE TEST checkout…");
    try {
      const data = await request("/.netlify/functions/mixed-book-yoco-test-checkout", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          name: $("test-name").value.trim(),
          email: $("test-email").value.trim(),
          items: [{business: "grannys", id: a.id},
                  {business: "clever-cubs", id: b.id}]
        })
      });
      // Never offer a redirect unless it is a verified, HTTPS official Yoco checkout.
      const target = safeYocoUrl(data.redirectUrl);
      if (data.processingMode !== "test" || data.paymentVerified !== false ||
          data.currency !== "ZAR" || !uuid.test(data.orderId || "") ||
          !Number.isSafeInteger(data.amountCents) || data.amountCents < 100 ||
          !target) throw Error("The TEST checkout response could not be verified.");
      orderId = data.orderId;
      sessionStorage.setItem("vsh_mixed_test_order_id", orderId);
      created = true; // One checkout per page load. Never silently submit twice.
      $("test-order-ref").textContent = "TEST order reference: " + orderId;
      $("test-checkout-amount").textContent =
        "Yoco TEST amount (server verified): " + money(data.amountCents) +
        (data.amountCents !== estimated ? " — NOTE: the catalogue amount changed." : "");
      check.disabled = false;
      if (data.amountCents !== estimated) {
        // Product pricing changed after the catalogue loaded. Never redirect
        // without a fresh, separately reviewed TEST amount confirmation.
        message("test-create-message",
          "STOP: The TEST amount differs from the catalogue estimate. Do not open Yoco or retry without review.", true);
      } else {
        yoco.href = target;
        yoco.hidden = false;
        message("test-create-message",
          "TEST checkout created. Confirm the amount before opening Yoco. Use TEST payment details only.");
      }
    } catch (error) {
      const disabled = error.status === 503 &&
        error.message === "Test-only checkout is disabled.";
      message("test-create-message", disabled
        ? "TEST checkout is still disabled on the server. No checkout was started."
        : "No verified checkout link was returned. A pending TEST record may exist; do not retry until reviewed.", true);
      // No retry loop. A partially completed order must be investigated first.
      created = true;
    } finally {
      creating = false;
      updateEstimate();
    }
  });

  check.addEventListener("click", async () => {
    if (!uuid.test(orderId)) return;
    check.disabled = true;
    message("test-status-message", "Checking the stored TEST order…");
    try {
      const data = await request("/.netlify/functions/mixed-book-yoco-test-order-status?orderId=" +
        encodeURIComponent(orderId));
      if (data.mode !== "test" || data.orderId !== orderId ||
          data.customerDeliveryEnabled !== false)
        throw Error("Unexpected TEST status response.");
      message("test-status-message", data.testPaymentVerified === true && data.status === "paid"
        ? "Verified TEST payment recorded. No customer email or PDF delivery was enabled."
        : "TEST order status: " + String(data.status).slice(0, 50) +
          ". A redirect or customer page alone does not prove payment.");
    } catch {
      message("test-status-message",
        "Could not verify the TEST payment status. Do not assume it was paid.", true);
    } finally { check.disabled = false; }
  });

  for (const business of Object.keys(selects)) selects[business].addEventListener("change", updateEstimate);
  $("test-confirm").addEventListener("change", updateEstimate);
  if (!adminKey) {
    showLogin();
    return;
  }
  $("test-workspace").hidden = false;
  // The page loads only catalogue data; NEVER POST a checkout automatically.
  loadCatalogue();
})();
