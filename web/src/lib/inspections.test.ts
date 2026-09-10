import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countRatings,
  describeItem,
  INSPECTION_ITEMS,
  isRating,
  joinForSentence,
  overallRating,
  phraseItem,
  ratedOnly,
} from "./inspections";
import { INSPECTION_CATEGORIES } from "./statuses";

describe("inspection checklist", () => {
  it("has one item per category, in the category order", () => {
    assert.equal(INSPECTION_ITEMS.length, INSPECTION_CATEGORIES.length);
    assert.deepEqual(
      INSPECTION_ITEMS.map((item) => item.category),
      [...INSPECTION_CATEGORIES],
    );
  });

  it("names what each item checks", () => {
    for (const item of INSPECTION_ITEMS) {
      assert.ok(item.name.length > 10, `${item.category} should say what is checked`);
      assert.notEqual(item.name, item.category);
    }
  });
});

describe("overallRating", () => {
  it("is the worst rating present", () => {
    assert.equal(overallRating(["green", "green", "yellow", "green"]), "yellow");
    assert.equal(overallRating(["green", "red", "yellow"]), "red");
    assert.equal(overallRating(["green", "green"]), "green");
  });

  it("is not_inspected when nothing was rated, never green", () => {
    assert.equal(overallRating([]), "not_inspected");
    assert.equal(overallRating(["not_inspected", "not_inspected"]), "not_inspected");
  });

  it("ignores not_inspected once anything is rated", () => {
    assert.equal(overallRating(["not_inspected", "green"]), "green");
    assert.equal(overallRating(["not_inspected", "yellow", "not_inspected"]), "yellow");
  });
});

describe("counts and filters", () => {
  it("counts each rating", () => {
    assert.deepEqual(countRatings(["green", "green", "yellow", "red", "not_inspected"]), {
      green: 2,
      yellow: 1,
      red: 1,
      not_inspected: 1,
    });
  });

  it("keeps only rated items", () => {
    const items = [
      { rating: "green" as const, category: "Engine" },
      { rating: "not_inspected" as const, category: "Transmission" },
      { rating: "red" as const, category: "Brakes" },
    ];
    assert.deepEqual(
      ratedOnly(items).map((item) => item.category),
      ["Engine", "Brakes"],
    );
  });

  it("guards rating strings from forms", () => {
    assert.ok(isRating("green"));
    assert.ok(isRating("not_inspected"));
    assert.ok(!isRating("GREEN"));
    assert.ok(!isRating(""));
  });
});

describe("describeItem", () => {
  it("leads with the notes and adds the measurement when it isn't already there", () => {
    assert.equal(
      describeItem({ category: "Brakes", notes: "Front pads worn", measurement: "4 mm" }),
      "Brakes — Front pads worn (4 mm)",
    );
    assert.equal(
      describeItem({ category: "Brakes", notes: "Front pads at 4 mm", measurement: "4 mm" }),
      "Brakes — Front pads at 4 mm",
    );
  });

  it("falls back to the measurement, then the bare category", () => {
    assert.equal(describeItem({ category: "Battery", measurement: "12.3 V" }), "Battery — (12.3 V)");
    assert.equal(describeItem({ category: "Lights" }), "Lights");
  });

  it("does not repeat a measurement the notes already give in different spacing", () => {
    assert.equal(
      describeItem({ category: "Brakes", notes: "Front pads at 4mm", measurement: "4 mm" }),
      "Brakes — Front pads at 4mm",
    );
  });
});

describe("phraseItem and joinForSentence", () => {
  it("shapes a finding for a text message", () => {
    assert.equal(
      phraseItem({ category: "Brakes", notes: "Front pads at 4mm", measurement: "4 mm" }),
      "brakes (front pads at 4mm)",
    );
    assert.equal(phraseItem({ category: "Battery", measurement: "12.3 V" }), "battery (12.3 V)");
    assert.equal(phraseItem({ category: "Suspension" }), "suspension");
  });

  it("joins a list the way a sentence does", () => {
    assert.equal(joinForSentence([]), "");
    assert.equal(joinForSentence(["a"]), "a");
    assert.equal(joinForSentence(["a", "b"]), "a and b");
    assert.equal(joinForSentence(["a", "b", "c"]), "a, b and c");
  });
});
