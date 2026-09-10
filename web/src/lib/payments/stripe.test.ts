import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseStripeSignature,
  readCompletedCheckout,
  signStripePayload,
  verifyStripeSignature,
} from "./stripe";

const secret = "whsec_test_4f1c9c2e";
const payload = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_123",
      payment_intent: "pi_test_456",
      amount_total: 21981,
      payment_status: "paid",
      metadata: { invoice_id: "432d6196-1b16-4270-b249-79bc327f7eb1", portal_token_id: "tok" },
    },
  },
});
const now = new Date("2026-09-10T17:00:00Z");
const ts = Math.floor(now.getTime() / 1000);

describe("verifyStripeSignature", () => {
  it("accepts a header Stripe would have produced", () => {
    const header = signStripePayload(payload, secret, ts);
    assert.equal(verifyStripeSignature({ payload, header, secret, now }), true);
  });

  it("rejects a body that changed after signing", () => {
    const header = signStripePayload(payload, secret, ts);
    const tampered = payload.replace("21981", "1");
    assert.equal(verifyStripeSignature({ payload: tampered, header, secret, now }), false);
  });

  it("rejects the wrong secret", () => {
    const header = signStripePayload(payload, secret, ts);
    assert.equal(verifyStripeSignature({ payload, header, secret: "whsec_other", now }), false);
  });

  it("rejects a signature outside the five-minute window, either direction", () => {
    const stale = signStripePayload(payload, secret, ts - 6 * 60);
    assert.equal(verifyStripeSignature({ payload, header: stale, secret, now }), false);
    const future = signStripePayload(payload, secret, ts + 6 * 60);
    assert.equal(verifyStripeSignature({ payload, header: future, secret, now }), false);
    const edge = signStripePayload(payload, secret, ts - 4 * 60);
    assert.equal(verifyStripeSignature({ payload, header: edge, secret, now }), true);
  });

  it("accepts when any one of several v1 signatures matches (secret rotation)", () => {
    const good = signStripePayload(payload, secret, ts).split(",")[1];
    const bad = signStripePayload(payload, "whsec_old", ts).split(",")[1];
    const header = `t=${ts},${bad},${good}`;
    assert.equal(verifyStripeSignature({ payload, header, secret, now }), true);
  });

  it("refuses missing, malformed and empty-secret cases without throwing", () => {
    const header = signStripePayload(payload, secret, ts);
    assert.equal(verifyStripeSignature({ payload, header: null, secret, now }), false);
    assert.equal(verifyStripeSignature({ payload, header: "garbage", secret, now }), false);
    assert.equal(verifyStripeSignature({ payload, header: `t=abc,v1=00`, secret, now }), false);
    assert.equal(verifyStripeSignature({ payload, header: `t=${ts},v1=zz`, secret, now }), false);
    // A hex string of the wrong length must not reach timingSafeEqual.
    assert.equal(verifyStripeSignature({ payload, header: `t=${ts},v1=abcd`, secret, now }), false);
    assert.equal(verifyStripeSignature({ payload, header, secret: "", now }), false);
  });
});

describe("parseStripeSignature", () => {
  it("reads the timestamp and every v1, ignoring other schemes", () => {
    const parsed = parseStripeSignature("t=1700000000,v1=aa,v0=zz,v1=BB");
    assert.deepEqual(parsed, { timestamp: 1700000000, signatures: ["aa", "bb"] });
  });

  it("is null without a timestamp or without any v1", () => {
    assert.equal(parseStripeSignature("v1=aa"), null);
    assert.equal(parseStripeSignature("t=1700000000"), null);
    assert.equal(parseStripeSignature(null), null);
  });
});

describe("readCompletedCheckout", () => {
  it("pulls what recordPayment needs out of the event", () => {
    assert.deepEqual(readCompletedCheckout(JSON.parse(payload)), {
      sessionId: "cs_test_123",
      paymentIntentId: "pi_test_456",
      amountTotalCents: 21981,
      paymentStatus: "paid",
      invoiceId: "432d6196-1b16-4270-b249-79bc327f7eb1",
      portalTokenId: "tok",
    });
  });

  it("ignores every other event type and any malformed shape", () => {
    assert.equal(readCompletedCheckout({ type: "payment_intent.succeeded", data: { object: {} } }), null);
    assert.equal(readCompletedCheckout({ type: "checkout.session.completed", data: { object: { id: "cs" } } }), null);
    assert.equal(readCompletedCheckout(null), null);
    assert.equal(readCompletedCheckout("nope"), null);
  });
});
