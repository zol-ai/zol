import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCents, parseCents, parseQuantity } from "./money";
import { formatPhone, toE164 } from "./phone";

describe("phone", () => {
  it("normalises what people type at the counter", () => {
    assert.equal(toE164("(661) 555-0148"), "+16615550148");
    assert.equal(toE164("661.555.0148"), "+16615550148");
    assert.equal(toE164("1 661 555 0148"), "+16615550148");
    assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  });

  it("refuses what cannot be a number", () => {
    assert.equal(toE164("555-0148"), undefined);
    assert.equal(toE164("+0 123 456 789"), undefined);
    assert.equal(toE164(""), undefined);
  });

  it("formats for humans and leaves the rest alone", () => {
    assert.equal(formatPhone("+16615550148"), "(661) 555-0148");
    assert.equal(formatPhone("+442079460958"), "+442079460958");
  });
});

describe("money", () => {
  it("round-trips dollars and cents", () => {
    assert.equal(parseCents("145.00"), 14500);
    assert.equal(parseCents("$1,247.99"), 124799);
    assert.equal(parseCents("-50"), -5000);
    assert.equal(parseCents("12.345"), undefined);
    assert.equal(formatCents(124799), "$1,247.99");
  });

  it("accepts book hours to two decimals", () => {
    assert.equal(parseQuantity("1.8"), 1.8);
    assert.equal(parseQuantity("0.3"), 0.3);
    assert.equal(parseQuantity("0"), undefined);
    assert.equal(parseQuantity("1.234"), undefined);
  });
});
