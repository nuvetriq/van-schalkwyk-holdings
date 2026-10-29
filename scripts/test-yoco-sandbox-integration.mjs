// Offline integration coverage: execute actual Netlify Function modules inside a
// Node VM with only Yoco HTTP and Netlify Blobs replaced by in-memory test doubles.
// No external requests, secrets, site deployment, or real payment attempt occurs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://vanschalkwykholdings.com";
const FUNCTION_ROOT = SITE + "/.netlify/functions/";

async function makeHarness() {
  const secretBytes = crypto.randomBytes(32);
  const env = {
    VSH_ADMIN_KEY: "TestOnlyAdminKeyNotForProduction_1234567890",
    VSH_YOCO_SANDBOX_ENABLED: "true",
    VSH_YOCO_SANDBOX_TEST_KEY: "sk_test_TestOnlyForLocalMocks",
    VSH_YOCO_SANDBOX_WEBHOOK_SECRET: "whsec_" + secretBytes.toString("base64")
  };
  const namespaces = new Map();
  let nextEtag = 0;
  let nextCheckout = 0;
  let upstreamRequests = 0;
  const getStore = ({name}) => {
    if (!namespaces.has(name)) namespaces.set(name, new Map());
    const entries = namespaces.get(name);
    return {
      async get(key) {
        const entry = entries.get(key);
        return entry ? structuredClone(entry.value) : null;
      },
      async getWithMetadata(key) {
        const entry = entries.get(key);
        return entry ? {data: structuredClone(entry.value), etag: entry.etag} : null;
      },
      async setJSON(key, value, options = {}) {
        const prior = entries.get(key);
        if (options.onlyIfNew && prior) return { modified: false };
        if (options.onlyIfMatch && (!prior || prior.etag !== options.onlyIfMatch))
          return { modified: false };
        entries.set(key, {value: structuredClone(value), etag: String(++nextEtag)});
        return { modified: true };
      }
    };
  };
  const mockFetch = async (url, options) => {
    assert.equal(url, "https://payments.yoco.com/api/checkouts");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer " + env.VSH_YOCO_SANDBOX_TEST_KEY);
    assert.ok(options.headers["Idempotency-Key"].startsWith("vsh-sandbox-"));
    const body = JSON.parse(options.body);
    assert.equal(body.amount, 1000);
    assert.equal(body.currency, "ZAR");
    assert.ok(["grannys", "clever-cubs"].includes(body.metadata.business));
    upstreamRequests++;
    return Response.json({
      id: "checkout_localTest" + (++nextCheckout),
      redirectUrl: "https://c.yoco.com/checkout/local-test",
      amount: 1000, currency: "ZAR", processingMode: "test"
    });
  };
  const context = vm.createContext({
    URL, Request, Response, AbortSignal, Buffer, console,
    process: {env}, fetch: mockFetch
  });
  const cached = new Map();
  const cryptoModule = new vm.SyntheticModule(["default"], function () {
    this.setExport("default", crypto);
  }, {context, identifier: "node:crypto"});
  const blobsModule = new vm.SyntheticModule(["getStore"], function () {
    this.setExport("getStore", getStore);
  }, {context, identifier: "@netlify/blobs"});
  const load = async filename => {
    if (cached.has(filename)) return cached.get(filename);
    const source = await readFile(filename, "utf8");
    const module = new vm.SourceTextModule(source, {context, identifier: filename});
    cached.set(filename, module);
    return module;
  };
  const entry = new vm.SourceTextModule(
    [
      'import checkout from "./netlify/functions/yoco-production-sandbox-checkout.mjs";',
      'import webhook from "./netlify/functions/yoco-production-sandbox-webhook.mjs";',
      'import status from "./netlify/functions/yoco-production-sandbox-status.mjs";',
      "export {checkout, webhook, status};"
    ].join("\n"),
    {context, identifier: path.join(ROOT, "test-entry.mjs")}
  );
  await entry.link(async (specifier, referencingModule) => {
    if (specifier === "node:crypto") return cryptoModule;
    if (specifier === "@netlify/blobs") return blobsModule;
    if (!specifier.startsWith(".")) throw new Error("Unexpected dependency " + specifier);
    return load(path.resolve(path.dirname(referencingModule.identifier), specifier));
  });
  await entry.evaluate();
  const handlers = entry.namespace;
  const netlify = { deploy: {context: "production"} };
  const checkout = async (business, key = env.VSH_ADMIN_KEY) => {
    const request = new Request(FUNCTION_ROOT + "yoco-production-sandbox-checkout", {
      method: "POST",
      headers: {
        "X-Admin-Key": key,
        "Origin": SITE,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({business})
    });
    const response = await handlers.checkout(request, netlify);
    return {http: response.status, data: await response.json()};
  };
  const status = async (orderId, key = env.VSH_ADMIN_KEY) => {
    const req = new Request(FUNCTION_ROOT +
      "yoco-production-sandbox-status?order=" + encodeURIComponent(orderId), {
      headers: {"X-Admin-Key": key}
    });
    const res = await handlers.status(req, netlify);
    return {http: res.status, data: await res.json()};
  };
  const webhook = async (event, {tamper = false, stale = false, signature = true} = {}) => {
    const id = "evt_" + crypto.randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1000) - (stale ? 600 : 0));
    const raw = JSON.stringify(event);
    const signatureValue = crypto.createHmac("sha256", secretBytes)
      .update(id + "." + timestamp + "." + raw).digest("base64");
    const request = new Request(FUNCTION_ROOT + "yoco-production-sandbox-webhook", {
      method: "POST",
      headers: {
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": "v1," + (signature ? signatureValue : "bad-signature"),
        "Content-Type": "application/json"
      },
      body: tamper ? raw + " " : raw
    });
    const res = await handlers.webhook(request, netlify);
    return {http: res.status, data: await res.json()};
  };
  const event = (checkoutId, orderId, business, overrides = {}) => ({
    id: "evt_" + crypto.randomUUID(),
    type: "payment.succeeded",
    createdDate: new Date().toISOString(),
    payload: {
      amount: 1000,
      currency: "ZAR",
      mode: "test",
      status: "succeeded",
      type: "payment",
      id: "pay_localTest123",
      metadata: {checkoutId, orderId, business, purpose: "vsh-production-sandbox"},
      ...overrides
    }
  });
  const checkoutId = (orderId) => {
    const store = namespaces.get("vsh-production-yoco-sandbox-orders");
    return store?.get("order/" + orderId + ".json")?.value.checkoutId;
  };
  return {checkout, status, webhook, event, checkoutId, env,
    get upstreamRequests() { return upstreamRequests; }};
}

for (const business of ["grannys", "clever-cubs"]) {
  test("End-to-end signed checkout and webhook — " + business, async () => {
    const h = await makeHarness();
    const refused = await h.checkout(business, "incorrect");
    assert.equal(refused.http, 401);
    assert.equal(h.upstreamRequests, 0);

    const created = await h.checkout(business);
    assert.equal(created.http, 201);
    assert.equal(created.data.testOnly, true);
    assert.equal(created.data.amount, 1000);
    assert.equal(created.data.currency, "ZAR");
    assert.equal(created.data.emailSent, false);
    assert.equal(created.data.pdfDelivered, false);
    assert.equal(h.upstreamRequests, 1);

    const orderId = created.data.orderId;
    const id = h.checkoutId(orderId);
    assert.match(id, /^checkout_/);
    assert.equal((await h.status(orderId)).data.testPaymentVerified, false);
    const payment = h.event(id, orderId, business);
    const missingSignature = await h.webhook(payment, {signature: false});
    assert.equal(missingSignature.http, 401);
    const stale = await h.webhook(payment, {stale: true});
    assert.equal(stale.http, 401);
    const tampered = await h.webhook(payment, {tamper: true});
    assert.equal(tampered.http, 401);
    assert.equal((await h.status(orderId)).data.testPaymentVerified, false);

    const wrongAmount = await h.webhook(h.event(id, orderId, business, {amount: 999}));
    assert.equal(wrongAmount.http, 400);
    const wrongMode = await h.webhook(h.event(id, orderId, business, {mode: "live"}));
    assert.equal(wrongMode.http, 200);
    assert.equal(wrongMode.data.ignored, true);
    const wrongStatus = await h.webhook(h.event(id, orderId, business, {status: "failed"}));
    assert.equal(wrongStatus.http, 400);
    const wrongBusiness = await h.webhook(h.event(id, orderId, business,
      {metadata: {checkoutId: id, orderId, business: "another", purpose: "vsh-production-sandbox"}}));
    assert.equal(wrongBusiness.http, 400);
    const wrongCheckout = await h.webhook(h.event("ch_unknownLocal12345", orderId, business));
    assert.equal(wrongCheckout.http, 503);
    assert.equal((await h.status(orderId)).data.testPaymentVerified, false);

    const verified = await h.webhook(payment);
    assert.equal(verified.http, 200);
    assert.equal(verified.data.testVerified, true);
    const result = await h.status(orderId);
    assert.equal(result.http, 200);
    assert.equal(result.data.testPaymentVerified, true);
    assert.equal(result.data.realPaymentVerified, false);
    assert.equal(result.data.emailSent, false);
    assert.equal(result.data.pdfDelivered, false);

    const repeated = await h.webhook(payment);
    assert.equal(repeated.http, 200);
    assert.equal(repeated.data.duplicate, true);
    const otherPayment = await h.webhook(h.event(id, orderId, business, {id: "pay_DIFFERENT"}));
    assert.equal(otherPayment.http, 409);
    assert.equal((await h.status(orderId)).data.testPaymentVerified, true);
  });
}
