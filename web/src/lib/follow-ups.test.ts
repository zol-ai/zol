import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QueryResultRow } from "pg";

import type { Queryable } from "./db";
import { journeyMessage, queueFollowUp } from "./follow-ups";
import { FOLLOW_UP_KINDS } from "./statuses";

const ctx = {
  shopName: "Fifth Street Auto",
  shopPhone: "+16615550100",
  firstName: "Jordan",
  vehicle: "2015 Chevrolet Sonic",
  roNumber: 1048,
  portalUrl: "https://tryzol.com/portal/abc",
  when: "Tuesday, Sep 15 at 8:00 AM",
  technician: "Manny Ruiz",
  serviceType: "Check-engine diagnostic",
  totalCents: 45723,
  work: "rear brake pads",
};

describe("journeyMessage", () => {
  it("has words for every kind of follow-up", () => {
    for (const kind of FOLLOW_UP_KINDS) {
      const message = journeyMessage(kind, ctx);
      assert.ok(message.title.length > 0, `${kind} needs a title`);
      // A custom message is whatever the person typed, verbatim; every
      // templated one opens with the shop's name so the customer knows who
      // is texting before they read a word.
      if (kind !== "custom") {
        assert.ok(message.body.startsWith("Fifth Street Auto"), `${kind} should open with the shop name`);
      }
      assert.ok(message.body.length < 320, `${kind} is too long for a text: ${message.body.length}`);
    }
  });

  it("puts the portal link and total where the customer needs them", () => {
    const ready = journeyMessage("ready_for_pickup", ctx);
    assert.match(ready.body, /\$457\.23/);
    assert.match(ready.body, /https:\/\/tryzol\.com\/portal\/abc/);

    const estimate = journeyMessage("estimate_ready", ctx);
    assert.match(estimate.body, /\$457\.23/);
    assert.match(estimate.body, /portal\/abc/);
  });

  it("degrades gracefully with a thin context", () => {
    const message = journeyMessage("checked_in", { shopName: "Shop" });
    assert.equal(message.title, "Checked in");
    assert.match(message.body, /your vehicle/);
    assert.ok(!message.body.includes("undefined"));
    assert.ok(!message.body.includes("null"));

    const confirmed = journeyMessage("appointment_confirmed", { shopName: "Shop" });
    assert.ok(!confirmed.body.includes("undefined"));
    assert.match(confirmed.body, /your appointment/);
  });

  it("renders the shop phone for humans", () => {
    const recall = journeyMessage("declined_work_recall", ctx);
    assert.match(recall.body, /\(661\) 555-0100/);
    assert.match(recall.body, /rear brake pads/);
  });
});

describe("queueFollowUp", () => {
  /** A client that remembers what it was asked and says the row was written. */
  function recorder() {
    const calls: { text: string; values: unknown[] }[] = [];
    const client: Queryable = {
      async query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
        calls.push({ text, values });
        return { rows: [{ id: "follow-up-1" } as unknown as T], rowCount: 1 };
      },
    };
    return { client, calls };
  }

  /**
   * The column list and the parameter list of the insert are written by
   * hand in two places. This pins them together for the one column the
   * appointment cancel path depends on: a confirmation stored under the
   * wrong column would never be swept when its visit is cancelled.
   */
  function appointmentIdArgument(call: { text: string; values: unknown[] }): unknown {
    const columns =
      /INSERT INTO follow_ups\s*\(([^)]+)\)/.exec(call.text)?.[1]
        .split(",")
        .map((column) => column.trim()) ?? [];
    const position = columns.indexOf("appointment_id");
    assert.ok(position >= 0, "appointment_id is a column of the insert");
    return call.values[position];
  }

  it("links the row to the appointment that produced it", async () => {
    const { client, calls } = recorder();
    const id = await queueFollowUp(client, {
      shopId: "shop-1",
      customerId: "customer-1",
      appointmentId: "appointment-1",
      kind: "appointment_confirmed",
      body: "Fifth Street Auto: you're booked.",
    });
    assert.equal(id, "follow-up-1");
    assert.equal(calls.length, 1);
    assert.equal(appointmentIdArgument(calls[0]), "appointment-1");
  });

  it("stores null, not undefined, when there is no appointment", async () => {
    const { client, calls } = recorder();
    await queueFollowUp(client, {
      shopId: "shop-1",
      customerId: "customer-1",
      kind: "post_repair",
      body: "Fifth Street Auto: how is the car running?",
    });
    assert.equal(appointmentIdArgument(calls[0]), null);
  });
});
