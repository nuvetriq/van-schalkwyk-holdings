import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { sandboxEnabled, SITE, AMOUNT, CURRENCY } from "../netlify/lib/production-sandbox.mjs";
import { verifyBookYocoWebhook } from "../netlify/lib/yoco-books-verification.mjs";

// Local tests only. Do not call Yoco, Netlify Functions, or any actual payment endpoint.
test("R10 sandbox activates only under explicit safe production-domain conditions", () => {
  const names = [
    "CONTEXT",
    "VSH_YOCO_SANDBOX_ENABLED",
    "VSH_YOCO_SANDBOX_TEST_KEY",
    "VSH_YOCO_SANDBOX_WEBHOOK_SECRET"
  ];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const req = new Request(SITE + "/.netlify/functions/yoco-production-sandbox-checkout");
  const prod = { deploy: { context: "production" } };
  try {
    delete process.env.CONTEXT; // Runtime CONTEXT is not guaranteed by Netlify.
    process.env.VSH_YOCO_SANDBOX_ENABLED = "true";
    process.env.VSH_YOCO_SANDBOX_TEST_KEY = "sk_test_ExampleOnly123";
    process.env.VSH_YOCO_SANDBOX_WEBHOOK_SECRET = "whsec_ExampleOnly123";
    assert.equal(AMOUNT, 1000);
    assert.equal(CURRENCY, "ZAR");
    assert.equal(sandboxEnabled(req, prod), true);
    assert.equal(sandboxEnabled(req, { deploy: { context: "deploy-preview" } }), false);
    assert.equal(sandboxEnabled(new Request("https://example.com/test"), prod), false);
    process.env.VSH_YOCO_SANDBOX_ENABLED = "false";
    assert.equal(sandboxEnabled(req, prod), false);
    process.env.VSH_YOCO_SANDBOX_ENABLED = "true";
    process.env.VSH_YOCO_SANDBOX_TEST_KEY = "sk_live_ExampleOnly123";
    assert.equal(sandboxEnabled(req, prod), false);
    process.env.VSH_YOCO_SANDBOX_TEST_KEY = "sk_test_ExampleOnly123";
    delete process.env.VSH_YOCO_SANDBOX_WEBHOOK_SECRET;
    assert.equal(sandboxEnabled(req, prod), false);
    process.env.VSH_YOCO_SANDBOX_WEBHOOK_SECRET = "whsec_ExampleOnly123";
    assert.equal(sandboxEnabled(req, { deploy: { context: "branch-deploy" } }), false);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("Signed webhook HMAC verifies exact raw body and rejects tampering/replay", () => {
  const key = randomBytes(32);
  const secret = "whsec_" + key.toString("base64");
  const eventId = "evt_YocoSandboxTest";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ type: "payment.succeeded", payload: { amount: 1000 } });
  const sig = createHmac("sha256", key).update(eventId + "." + timestamp + "." + body).digest("base64");
  const request = (overrides = {}) => new Request(SITE + "/.netlify/functions/yoco-production-sandbox-webhook", {
    method: "POST",
    headers: {
      "webhook-id": eventId,
      "webhook-timestamp": timestamp,
      "webhook-signature": "v1," + sig,
      ...overrides
    }
  });
  assert.equal(verifyBookYocoWebhook(request(), body, secret), true);
  assert.equal(verifyBookYocoWebhook(request(), body + " ", secret), false);
  assert.equal(verifyBookYocoWebhook(request({ "webhook-signature": "v1," + randomBytes(32).toString("base64") }), body, secret), false);
  assert.equal(verifyBookYocoWebhook(request({ "webhook-timestamp": String(Number(timestamp) - 3600) }), body, secret), false);
  assert.equal(verifyBookYocoWebhook(request({ "webhook-id": "wrong_event_id" }), body, secret), false);
  assert.equal(verifyBookYocoWebhook(request(), body, "bad_secret"), false);
  assert.equal(verifyBookYocoWebhook(request(), body, "whsec_" + randomBytes(32).toString("base64")), false);
});
