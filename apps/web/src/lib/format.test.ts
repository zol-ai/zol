import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDate,
  formatDateTime,
  formatMiles,
  formatRelative,
  formatTime,
  formatWhen,
  initials,
  vehicleLabel,
} from "./format";

const TZ = "America/Los_Angeles";
// 2026-09-15 15:00 UTC = 8:00 AM PDT.
const instant = new Date("2026-09-15T15:00:00Z");

describe("format", () => {
  it("renders in the shop's zone, not the server's", () => {
    assert.equal(formatTime(instant, TZ), "8:00 AM");
    assert.equal(formatDate(instant, TZ), "Sep 15, 2026");
    assert.equal(formatDateTime(instant, TZ), "Sep 15, 8:00 AM");
    assert.equal(formatWhen(instant, TZ), "Tuesday, Sep 15 at 8:00 AM");
    // The same instant reads as 11:00 in New York.
    assert.equal(formatTime(instant, "America/New_York"), "11:00 AM");
  });

  it("accepts ISO strings as well as Dates", () => {
    assert.equal(formatTime("2026-09-15T15:00:00Z", TZ), "8:00 AM");
  });

  it("describes recent times relatively and old ones absolutely", () => {
    const now = new Date("2026-09-15T16:00:00Z");
    assert.equal(formatRelative(new Date("2026-09-15T15:59:40Z"), TZ, now), "just now");
    assert.equal(formatRelative(new Date("2026-09-15T15:45:00Z"), TZ, now), "15 min ago");
    assert.equal(formatRelative(new Date("2026-09-15T13:00:00Z"), TZ, now), "3 h ago");
    assert.equal(formatRelative(new Date("2026-09-13T16:00:00Z"), TZ, now), "2 d ago");
    assert.equal(formatRelative(new Date("2026-08-01T16:00:00Z"), TZ, now), "Aug 1, 2026");
  });

  it("builds vehicle labels from whatever is on file", () => {
    assert.equal(vehicleLabel({ year: 2015, make: "Chevrolet", model: "Sonic", trim: "LT" }), "2015 Chevrolet Sonic LT");
    assert.equal(vehicleLabel({ make: "Ford", model: "F-150" }), "Ford F-150");
    assert.equal(vehicleLabel({}), null);
  });

  it("formats miles and initials", () => {
    assert.equal(formatMiles(102430), "102,430 mi");
    assert.equal(formatMiles(null), "—");
    assert.equal(initials("Jordan Lee"), "JL");
    assert.equal(initials("Cher"), "C");
    assert.equal(initials(null), "?");
  });
});
