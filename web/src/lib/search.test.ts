import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appointmentHref,
  countResults,
  escapeLike,
  estimateHref,
  invoiceHref,
  parseSearch,
} from "./search";

describe("parseSearch", () => {
  it("ignores an empty or one-character box", () => {
    assert.equal(parseSearch(""), null);
    assert.equal(parseSearch("   "), null);
    assert.equal(parseSearch("j"), null);
    assert.equal(parseSearch(undefined), null);
    assert.equal(parseSearch(null), null);
  });

  it("splits words into escaped patterns so word order does not matter", () => {
    const terms = parseSearch("  civic   Honda ");
    assert.ok(terms);
    assert.equal(terms.text, "civic Honda");
    assert.deepEqual(terms.patterns, ["%civic%", "%Honda%"]);
    assert.equal(terms.number, "");
  });

  it("reads a bare number, with or without a hash, as a ticket number", () => {
    assert.equal(parseSearch("1047")?.number, "1047");
    assert.equal(parseSearch("#1047")?.number, "1047");
    assert.equal(parseSearch("RO 1047")?.number, "1047");
    assert.equal(parseSearch("inv #3052")?.number, "3052");
    // Letters mixed in are not a number: a plate, or a code.
    assert.equal(parseSearch("P0301")?.number, "");
    assert.equal(parseSearch("8ABC123")?.number, "");
  });

  it("keeps digits for the phone match only once there are enough to mean something", () => {
    assert.equal(parseSearch("555-0171")?.digits, "5550171");
    assert.equal(parseSearch("(661) 555 0171")?.digits, "6615550171");
    // Two digits match half the shop's numbers; not worth asking.
    assert.equal(parseSearch("15")?.digits, "");
    assert.equal(parseSearch("jordan")?.digits, "");
  });

  it("normalises plates and VINs to what is stored", () => {
    assert.equal(parseSearch("8abc-123")?.plate, "8ABC123");
    assert.equal(parseSearch("1G1JC5SH0F4100001")?.plate, "1G1JC5SH0F4100001");
    // A name is also "plate-shaped" — that is fine, the LIKE simply misses.
    assert.equal(parseSearch("Jordan Lee")?.plate, "JORDANLEE");
  });

  it("caps runaway input", () => {
    const long = "a".repeat(500);
    const terms = parseSearch(long);
    assert.ok(terms);
    assert.equal(terms.text.length, 80);
    assert.equal(parseSearch("one two three four five six seven eight")?.patterns.length, 6);
  });
});

describe("escapeLike", () => {
  it("escapes the LIKE wildcards and the escape character itself", () => {
    assert.equal(escapeLike("100%"), "100\\%");
    assert.equal(escapeLike("a_b"), "a\\_b");
    assert.equal(escapeLike("back\\slash"), "back\\\\slash");
    assert.equal(escapeLike("plain"), "plain");
  });
});

describe("hrefs", () => {
  it("sends an appointment to its own day on the shop's calendar", () => {
    // 2026-09-15 04:30 UTC is still Sep 14 in Los Angeles.
    assert.equal(
      appointmentHref({ starts_at: "2026-09-15T04:30:00Z" }, "America/Los_Angeles"),
      "/app/schedule?date=2026-09-14",
    );
    assert.equal(
      appointmentHref({ starts_at: "2026-09-15T04:30:00Z" }, "America/New_York"),
      "/app/schedule?date=2026-09-15",
    );
  });

  it("filters the estimate and invoice lists by number", () => {
    assert.equal(estimateHref({ number: 2041 }), "/app/estimates?q=2041");
    assert.equal(invoiceHref({ number: 3052 }), "/app/invoices?q=3052");
  });
});

describe("countResults", () => {
  it("adds every group", () => {
    assert.equal(
      countResults({
        customers: [{ id: "a", full_name: null, phone: "+16615550171", email: null, vehicle: null }],
        vehicles: [],
        repairOrders: [],
        appointments: [],
        estimates: [],
        invoices: [],
      }),
      1,
    );
  });
});
