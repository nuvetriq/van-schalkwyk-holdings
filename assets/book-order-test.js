(() => {
  "use strict";
  const output = document.getElementById("payment-test-result");
  const button = document.getElementById("check-payment-status");
  const params = new URLSearchParams(location.search);
  const order = params.get("order") || "";
  const business = params.get("business") || "";
  const adminKey = () => sessionStorage.getItem("vsh_master_admin_key") || "";
  const say = (message, isError = false) => {
    output.textContent = message;
    output.className = "message" + (isError ? " error" : "");
  };
  async function check() {
    if (!adminKey()) return say("Please sign in through the Admin Portal in this browser tab first.", true);
    if (!/^[0-9a-f-]{36}$/i.test(order) || !["grannys", "clever-cubs"].includes(business))
      return say("Missing a valid sandbox order reference.", true);
    button.disabled = true;
    say("Checking the server's signed Yoco payment verification…");
    try {
      const url = "/.netlify/functions/book-order-test-status?business=" +
        encodeURIComponent(business) + "&order=" + encodeURIComponent(order);
      const response = await fetch(url, { cache: "no-store",
        headers: { "X-Admin-Key": adminKey() } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || "Could not retrieve the test order.");
      if (data.testOnly !== true || data.deliveryEnabled !== false)
        throw Error("Unexpected test order response.");
      if (data.paymentVerified === true && data.status === "test_payment_verified")
        say("SUCCESS: Yoco's signed test payment was verified against your order and amount. Emails and downloads remain disabled.");
      else if (data.status === "awaiting_payment")
        say("Not verified yet. Yoco may still be sending the webhook. Check the webhook URL and signing secret, then click again.");
      else
        say("Current sandbox order status: " + String(data.status || "unknown") + ". No customer delivery occurred.");
    } catch (error) {
      say(error.message || "Status lookup failed.", true);
    } finally { button.disabled = false; }
  }
  button.addEventListener("click", check);
})();
