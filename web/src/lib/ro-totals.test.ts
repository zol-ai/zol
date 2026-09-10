import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { taxCentsFor, totalsFor } from "./ro-totals";

describe("totalsFor", () => {
  const lines = [
    { kind: "labor", total_cents: 29000, approval: "approved" },
    { kind: "part", total_cents: 8900, approval: "approved" },
    { kind: "part", total_cents: 1250, approval: "pending" },
    { kind: "fee", total_cents: 1500, approval: "approved" },
    { kind: "discount", total_cents: -2000, approval: "approved" },
  ];

  it("taxes parts and fees, not labour", () => {
    const totals = totalsFor(lines, "8.25");
    assert.equal(totals.subtotalCents, 29000 + 8900 + 1250 + 1500 - 2000);
    assert.equal(totals.taxableCents, 8900 + 1250 + 1500);
    assert.equal(totals.taxCents, 961); // 961.125, and what Postgres says
    assert.equal(totals.totalCents, totals.subtotalCents + totals.taxCents);
  });

  it("leaves declined lines out of every sum", () => {
    const withDeclined = [
      ...lines,
      { kind: "part", total_cents: 99900, approval: "declined" },
      { kind: "labor", total_cents: 50000, approval: "declined" },
    ];
    assert.deepEqual(totalsFor(withDeclined, "8.25"), totalsFor(lines, "8.25"));
  });

  it("counts lines with no approval column as live", () => {
    const totals = totalsFor([{ kind: "labor", total_cents: 100 }], 0);
    assert.equal(totals.totalCents, 100);
  });

  it("is zero for an empty ticket", () => {
    assert.deepEqual(totalsFor([], "8.25"), {
      subtotalCents: 0,
      taxableCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });
});

/*
  Every case here was checked against `round(taxable * rate::numeric(5,2) / 100)`
  in Postgres. The half-cent ones are the point: the product in a double falls a
  hair under .5 and Math.round would have gone the other way, leaving the invoice
  a cent short of the ticket.
*/
describe("taxCentsFor", () => {
  it("rounds a half cent up, like numeric round in RECALCULATE", () => {
    assert.equal(taxCentsFor(41000, "6.35"), 2604); // Connecticut: 2603.5, doubles say 2603.4999…
    assert.equal(taxCentsFor(3000, "9.45"), 284); // 283.5, doubles say 283.4999…
    assert.equal(taxCentsFor(1000, "0.05"), 1); // 0.5
  });

  it("agrees with the ordinary cases and takes the rate as a string or a number", () => {
    assert.equal(taxCentsFor(11650, "8.25"), 961);
    assert.equal(taxCentsFor(11650, 8.25), 961);
    assert.equal(taxCentsFor(22890, "7.25"), 1660); // 1659.525
    assert.equal(taxCentsFor(0, "8.25"), 0);
    assert.equal(taxCentsFor(11650, 0), 0);
  });

  it("rounds half away from zero on a credit, as Postgres does", () => {
    assert.equal(taxCentsFor(-1000, "0.05"), -1);
    assert.equal(taxCentsFor(-2000, "8.25"), -165);
  });

  it("is what totalsFor uses", () => {
    const totals = totalsFor([{ kind: "part", total_cents: 41000 }], "6.35");
    assert.equal(totals.taxCents, 2604);
    assert.equal(totals.totalCents, 43604);
  });
});
