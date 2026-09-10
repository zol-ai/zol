import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  badgeFor,
  humanize,
  isRoStatus,
  RO_OPEN_STATUSES,
  RO_PIPELINE,
  RO_STATUSES,
} from "./statuses";

describe("statuses", () => {
  it("labels every repair-order status in shop language", () => {
    for (const status of RO_STATUSES) {
      const badge = badgeFor("ro", status);
      assert.notEqual(badge.label, status, `${status} should have a human label`);
      assert.ok(badge.label.length > 0);
    }
    assert.equal(badgeFor("ro", "awaiting_parts").label, "Waiting on parts");
    assert.equal(badgeFor("ro", "awaiting_approval").tone, "person");
    assert.equal(badgeFor("ro", "ready").tone, "zol");
  });

  it("keeps cancelled off the pipeline and out of the open set", () => {
    assert.ok(!RO_PIPELINE.includes("cancelled"));
    assert.ok(!RO_OPEN_STATUSES.includes("cancelled"));
    assert.ok(!RO_OPEN_STATUSES.includes("closed"));
    assert.equal(RO_PIPELINE[0], "open");
    assert.equal(RO_PIPELINE[RO_PIPELINE.length - 1], "closed");
  });

  it("humanises unknown values instead of throwing", () => {
    assert.equal(humanize("some_new_state"), "Some new state");
    assert.deepEqual(badgeFor("ro", "some_new_state"), {
      label: "Some new state",
      tone: "neutral",
    });
    assert.deepEqual(badgeFor("part", null), { label: "—", tone: "neutral" });
  });

  it("guards status strings from forms", () => {
    assert.equal(isRoStatus("in_progress"), true);
    assert.equal(isRoStatus("IN_PROGRESS"), false);
    assert.equal(isRoStatus(""), false);
  });
});
