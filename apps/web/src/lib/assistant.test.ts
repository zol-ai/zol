import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SUGGESTED_QUESTIONS,
  allowedLinks,
  composeFallback,
  routeByKeywords,
  type ToolResult,
} from "./ai/assistant";

// A Thursday, so weekday arithmetic has something to push against.
const ctx = { todayDow: 4 };
const names = (question: string) => routeByKeywords(question, ctx).map((call) => call.name);

describe("routeByKeywords", () => {
  it("routes every suggested question to at least one tool", () => {
    for (const question of SUGGESTED_QUESTIONS) {
      assert.ok(names(question).length > 0, `no tool for "${question}"`);
    }
  });

  it("reads the day the schedule question is about", () => {
    assert.deepEqual(routeByKeywords("what's on the schedule tomorrow?", ctx), [
      { name: "tomorrowsSchedule", args: { dateOffset: 1 } },
    ]);
    assert.deepEqual(routeByKeywords("who's coming in today", ctx)[0], {
      name: "tomorrowsSchedule",
      args: { dateOffset: 0 },
    });
    assert.deepEqual(routeByKeywords("what's booked the day after tomorrow", ctx)[0], {
      name: "tomorrowsSchedule",
      args: { dateOffset: 2 },
    });
    // Thursday → Monday is four days out; a weekday alone is a schedule question.
    assert.deepEqual(routeByKeywords("what about Monday?", ctx)[0], {
      name: "tomorrowsSchedule",
      args: { dateOffset: 4 },
    });
  });

  it("picks the revenue period from the question", () => {
    assert.deepEqual(routeByKeywords("how much money did we make today", ctx), [
      { name: "revenueSummary", args: { period: "today" } },
    ]);
    // "today" here is the period, not a schedule question.
    assert.deepEqual(routeByKeywords("how much did we take today", ctx), [
      { name: "revenueSummary", args: { period: "today" } },
    ]);
    assert.deepEqual(routeByKeywords("revenue this week?", ctx), [
      { name: "revenueSummary", args: { period: "week" } },
    ]);
    assert.deepEqual(routeByKeywords("How much revenue this month?", ctx), [
      { name: "revenueSummary", args: { period: "month" } },
    ]);
  });

  it("does not mistake 'repair orders' for parts on order or 'unpaid' for revenue", () => {
    assert.deepEqual(names("how many repair orders are open?"), []);
    assert.deepEqual(names("which invoices are unpaid"), ["unpaidInvoices"]);
    // "money" alone is the unpaid list, not the revenue figure.
    assert.deepEqual(names("Who still owes us money?"), ["unpaidInvoices"]);
  });

  it("matches the inflected forms a person actually types", () => {
    assert.deepEqual(names("anything declined lately?"), ["declinedOpen"]);
    assert.deepEqual(names("are any parts delayed"), ["partsDelays"]);
    assert.deepEqual(names("what's been collected"), ["readyForPickup"]);
  });

  it("reads a ticket number with or without a hash", () => {
    assert.deepEqual(routeByKeywords("what's the status of #1047", ctx), [
      { name: "ticketLookup", args: { number: 1047 } },
    ]);
    assert.deepEqual(routeByKeywords("ticket 1046?", ctx), [
      { name: "ticketLookup", args: { number: 1046 } },
    ]);
    assert.deepEqual(routeByKeywords("1048", ctx), [{ name: "ticketLookup", args: { number: 1048 } }]);
  });

  it("treats a phone number as a customer, never a ticket", () => {
    assert.deepEqual(routeByKeywords("who is 661-555-0171?", ctx), [
      { name: "customerLookup", args: { term: "6615550171" } },
    ]);
    assert.deepEqual(routeByKeywords("(661) 555 0192", ctx), [
      { name: "customerLookup", args: { term: "6615550192" } },
    ]);
  });

  it("extracts a name from a lookup question", () => {
    assert.deepEqual(routeByKeywords("find customer Jordan Lee", ctx), [
      { name: "customerLookup", args: { term: "Jordan Lee" } },
    ]);
    assert.deepEqual(routeByKeywords("what's Priya Shah's phone number?", ctx), [
      { name: "customerLookup", args: { term: "Priya Shah" } },
    ]);
    // A capitalised name mid-sentence with nothing else to go on.
    assert.deepEqual(routeByKeywords("Anything on Daniel Brooks?", ctx), [
      { name: "customerLookup", args: { term: "Daniel Brooks" } },
    ]);
  });

  it("runs more than one tool when a question asks two things, capped at three", () => {
    const calls = names("what's waiting on approval and are any parts late?");
    assert.deepEqual(calls, ["approvalsWaiting", "partsDelays"]);
    assert.ok(
      names("approvals, parts, techs, revenue and declined work please").length <= 3,
    );
  });

  it("returns nothing for a question it cannot answer", () => {
    assert.deepEqual(names("tell me a joke"), []);
    assert.deepEqual(names(""), []);
  });
});

describe("composeFallback", () => {
  const results: ToolResult[] = [
    {
      name: "readyForPickup",
      args: {},
      text: "1 car is ready to go:\n• #1044 — Sofia Martinez",
      links: [
        { label: "Open ticket #1044", href: "/app/repair-orders/a" },
        { label: "Ready column", href: "/app/repair-orders?status=ready" },
      ],
      data: [],
    },
    {
      name: "unpaidInvoices",
      args: {},
      text: "1 invoice is unpaid.",
      links: [
        { label: "Invoices", href: "/app/invoices" },
        { label: "Open ticket #1044", href: "/app/repair-orders/a" },
      ],
      data: [],
    },
  ];

  it("joins the tool answers and de-duplicates their links", () => {
    const { answer, links } = composeFallback(results);
    assert.equal(answer, "1 car is ready to go:\n• #1044 — Sofia Martinez\n\n1 invoice is unpaid.");
    assert.deepEqual(
      links.map((l) => l.href),
      ["/app/repair-orders/a", "/app/repair-orders?status=ready", "/app/invoices"],
    );
  });

  it("lets the model choose and relabel links but never invent one", () => {
    const links = allowedLinks(
      [
        { label: "Ticket #1044", href: "/app/repair-orders/a" },
        { label: "Made up", href: "/app/customers/00000000-0000-0000-0000-000000000000" },
        { label: "", href: "/app/invoices" },
        { label: "Evil", href: "https://example.com" },
      ],
      results,
    );
    assert.deepEqual(links, [
      { label: "Ticket #1044", href: "/app/repair-orders/a" },
      { label: "Invoices", href: "/app/invoices" },
    ]);
  });
});
