import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBirthdayOn,
  MAX_ATTEMPTS,
  planAttempt,
  settleAttempt,
  summaryLine,
  type WorkerSummary,
} from "./follow-ups";

describe("settleAttempt", () => {
  it("marks a delivered row sent and clears the last error", () => {
    const settled = settleAttempt(
      { delivered: true, via: "portal", provider: "portal" },
      3,
    );
    assert.deepEqual(settled, { status: "sent", attempts: 4, lastError: null });
  });

  it("leaves a transient failure pending, with the reason on it", () => {
    const settled = settleAttempt(
      { delivered: false, provider: "twilio", reason: "HTTP 503", permanent: false },
      0,
    );
    assert.deepEqual(settled, { status: "pending", attempts: 1, lastError: "HTTP 503" });
  });

  it("gives up straight away on a permanent failure", () => {
    const settled = settleAttempt(
      { delivered: false, provider: "twilio", reason: "21610: opted out", permanent: true },
      0,
    );
    assert.equal(settled.status, "failed");
    assert.equal(settled.attempts, 1);
  });

  it("gives up at the attempt ceiling", () => {
    const transient = {
      delivered: false as const,
      provider: "twilio" as const,
      reason: "timeout",
      permanent: false,
    };
    assert.equal(settleAttempt(transient, MAX_ATTEMPTS - 2).status, "pending");
    assert.equal(settleAttempt(transient, MAX_ATTEMPTS - 1).status, "failed");
  });

  it("writes the same count the claim already did", () => {
    // The claim bumps attempts before the send and the settlement writes
    // attempts afterwards; both are derived from the pre-claim count, so a
    // settled row never disagrees with its own claim.
    const preClaim = 2;
    const claimed = preClaim + 1;
    assert.equal(
      settleAttempt({ delivered: true, via: "sms", provider: "twilio" }, preClaim).attempts,
      claimed,
    );
    assert.equal(
      settleAttempt(
        { delivered: false, provider: "twilio", reason: "HTTP 503", permanent: false },
        preClaim,
      ).attempts,
      claimed,
    );
  });
});

describe("planAttempt", () => {
  const fresh = { sms_opted_out: false, body: "Fifth Street Auto: your car is ready.", attempts: 0 };

  it("claims a fresh row, carrying the body it checked", () => {
    assert.deepEqual(planAttempt(fresh, null), { action: "claim", body: fresh.body });
  });

  it("finishes a row whose earlier attempt already left a message, sending nothing", () => {
    // The point of the two-phase claim: a text that got through before the
    // bookkeeping was lost is finished from the record, never sent again.
    assert.deepEqual(planAttempt({ ...fresh, attempts: 1 }, { channel: "sms" }), {
      action: "finish",
      via: "sms",
    });
    assert.deepEqual(planAttempt({ ...fresh, attempts: 1 }, { channel: "portal" }), {
      action: "finish",
      via: "portal",
    });
  });

  it("lets a recorded message win over a later opt-out or an emptied body", () => {
    // It went before they said STOP, or before somebody blanked the words;
    // the row is sent either way.
    assert.equal(planAttempt({ ...fresh, attempts: 1, sms_opted_out: true }, { channel: "sms" }).action, "finish");
    assert.equal(planAttempt({ ...fresh, attempts: 1, body: null }, { channel: "sms" }).action, "finish");
  });

  it("closes an opted-out row without counting an attempt", () => {
    assert.deepEqual(planAttempt({ ...fresh, sms_opted_out: true }, null), {
      action: "cancel",
      reason: "opted out",
    });
  });

  it("fails a row with nothing to say, quietly", () => {
    for (const body of [null, "", "   "]) {
      assert.deepEqual(planAttempt({ ...fresh, body }, null), {
        action: "fail",
        reason: "no message body",
        notify: false,
      });
    }
  });

  it("gives up, and tells the shop, when every claim so far was cut off", () => {
    // Ordinary failures are counted and capped by settleAttempt; a row only
    // reaches the ceiling here when its attempts were claimed and never
    // settled, which is worth a person hearing about.
    const plan = planAttempt({ ...fresh, attempts: MAX_ATTEMPTS }, null);
    assert.equal(plan.action, "fail");
    assert.equal(plan.action === "fail" && plan.notify, true);
    assert.equal(planAttempt({ ...fresh, attempts: MAX_ATTEMPTS - 1 }, null).action, "claim");
  });
});

describe("isBirthdayOn", () => {
  it("matches month and day and ignores the year", () => {
    assert.equal(isBirthdayOn("1988-04-12", "2026-04-12"), true);
    assert.equal(isBirthdayOn("1988-04-12", "2026-04-13"), false);
    assert.equal(isBirthdayOn("1988-04-12", "2026-05-12"), false);
  });

  it("accepts a timestamp-shaped birthday from Postgres", () => {
    assert.equal(isBirthdayOn("1991-11-02T00:00:00.000Z", "2026-11-02"), true);
  });

  it("moves a 29 February birthday to the 28th in a common year only", () => {
    assert.equal(isBirthdayOn("1996-02-29", "2026-02-28"), true);
    assert.equal(isBirthdayOn("1996-02-29", "2028-02-28"), false);
    assert.equal(isBirthdayOn("1996-02-29", "2028-02-29"), true);
    // Somebody born on the 28th is not also celebrated on the 29th.
    assert.equal(isBirthdayOn("1996-02-28", "2028-02-29"), false);
  });

  it("refuses garbage rather than guessing", () => {
    assert.equal(isBirthdayOn("", "2026-04-12"), false);
    assert.equal(isBirthdayOn("1988-04-12", "not a date"), false);
  });
});

describe("summaryLine", () => {
  const base: WorkerSummary = {
    generated: { declinedRecalls: 1, birthdays: 0 },
    considered: 3,
    sent: 2,
    retried: 0,
    failed: 0,
    cancelled: 1,
    skipped: 0,
    truncated: false,
  };

  it("reads as one line with every count in it", () => {
    const line = summaryLine(base);
    assert.match(line, /^\[follow-ups\] 3 considered, 2 sent/);
    assert.match(line, /1 cancelled/);
    assert.match(line, /queued 1 declined-work recall, 0 birthdays/);
    assert.ok(!line.includes("batch full"));
  });

  it("says when the batch filled up", () => {
    assert.match(summaryLine({ ...base, truncated: true }), /batch full, more waiting/);
  });
});
