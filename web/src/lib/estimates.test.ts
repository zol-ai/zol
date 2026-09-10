import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decisionsFromForm,
  describeDecisions,
  estimateStatusFromLines,
  isEstimateExpired,
} from "./estimates";

describe("estimateStatusFromLines", () => {
  it("is approved, declined or partial once every line is answered", () => {
    assert.equal(estimateStatusFromLines([{ approval: "approved" }, { approval: "approved" }]), "approved");
    assert.equal(estimateStatusFromLines([{ approval: "declined" }, { approval: "declined" }]), "declined");
    assert.equal(estimateStatusFromLines([{ approval: "approved" }, { approval: "declined" }]), "partial");
  });

  it("reads as partial while some lines are still pending after an answer", () => {
    assert.equal(estimateStatusFromLines([{ approval: "approved" }, { approval: "pending" }]), "partial");
    assert.equal(estimateStatusFromLines([{ approval: "declined" }, { approval: "pending" }]), "partial");
  });

  it("leaves the status alone when nothing has been answered", () => {
    assert.equal(estimateStatusFromLines([{ approval: "pending" }, { approval: "pending" }]), null);
    assert.equal(estimateStatusFromLines([]), null);
  });
});

describe("decisionsFromForm", () => {
  it("keeps only known line ids with a real answer", () => {
    const form = new FormData();
    form.set("line:a", "approved");
    form.set("line:b", "declined");
    form.set("line:c", "maybe");
    form.set("line:stranger", "approved");
    assert.deepEqual(decisionsFromForm(form, ["a", "b", "c"]), { a: "approved", b: "declined" });
  });

  it("is empty for an empty form", () => {
    assert.deepEqual(decisionsFromForm(new FormData(), ["a"]), {});
  });
});

describe("describeDecisions", () => {
  it("names the work on each side of the answer", () => {
    assert.equal(
      describeDecisions(2041, [
        { description: "MAP sensor", approval: "approved" },
        { description: "Throttle body clean", approval: "approved" },
        { description: "Shop supplies", approval: "declined" },
      ]),
      "Estimate #2041 — approved: MAP sensor, Throttle body clean; declined: Shop supplies.",
    );
  });

  it("copes with one-sided and empty answers", () => {
    assert.equal(
      describeDecisions(7, [{ description: "Brakes", approval: "declined" }]),
      "Estimate #7 — declined: Brakes.",
    );
    assert.equal(describeDecisions(7, []), "Estimate #7 — no answer recorded.");
  });
});

describe("isEstimateExpired", () => {
  const now = new Date("2026-09-10T12:00:00Z");

  it("expires a sent or viewed estimate once expires_at has passed", () => {
    assert.equal(isEstimateExpired({ status: "sent", expires_at: "2026-09-09T12:00:00Z" }, now), true);
    assert.equal(isEstimateExpired({ status: "viewed", expires_at: "2026-09-11T12:00:00Z" }, now), false);
  });

  it("never expires a draft or an answered estimate, or one with no window", () => {
    assert.equal(isEstimateExpired({ status: "draft", expires_at: "2020-01-01T00:00:00Z" }, now), false);
    assert.equal(isEstimateExpired({ status: "approved", expires_at: "2020-01-01T00:00:00Z" }, now), false);
    assert.equal(isEstimateExpired({ status: "sent", expires_at: null }, now), false);
  });
});
