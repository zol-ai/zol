import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DiagnosticResultSchema,
  fallbackAnalysis,
  isObdCode,
  parseCodes,
  VERIFICATION_WARNING,
  type DiagnosticInput,
} from "./diagnostics";

const input = (over: Partial<DiagnosticInput>): DiagnosticInput => ({
  codes: [],
  symptoms: null,
  observations: null,
  vehicle: "2015 Chevrolet Sonic LT",
  mileage: 102_430,
  complaint: null,
  ...over,
});

describe("parseCodes", () => {
  it("uppercases, splits on space or comma and drops what isn't a code", () => {
    assert.deepEqual(parseCodes("p0301, P0171 p0420"), ["P0301", "P0171", "P0420"]);
    assert.deepEqual(parseCodes("P0301 PO301 hello"), ["P0301"]);
    assert.deepEqual(parseCodes(""), []);
  });

  it("de-duplicates", () => {
    assert.deepEqual(parseCodes("P0301 p0301 P0301"), ["P0301"]);
  });

  it("accepts B, C and U families", () => {
    assert.ok(isObdCode("C0035"));
    assert.ok(isObdCode("B1234"));
    assert.ok(isObdCode("U0100"));
    assert.ok(!isObdCode("X0100"));
    assert.ok(!isObdCode("P030"));
  });
});

describe("fallbackAnalysis", () => {
  it("always produces the schema shape and ends with the verification warning", () => {
    for (const codes of [[], ["P0301"], ["P0171", "P0174"], ["P0420"], ["P0456"], ["P0128"], ["C0035"], ["B1000"], ["U0100"], ["P9999"]]) {
      const result = fallbackAnalysis(input({ codes }));
      const parsed = DiagnosticResultSchema.safeParse(result);
      assert.ok(parsed.success, `schema should accept the result for ${codes.join(",") || "no codes"}`);
      assert.equal(result.warnings.at(-1), VERIFICATION_WARNING);
      assert.ok(result.causes.length >= 1 && result.causes.length <= 5);
    }
  });

  it("ranks a cylinder misfire as coil, plug, injector", () => {
    const result = fallbackAnalysis(input({ codes: ["P0301"] }));
    const titles = result.causes.map((cause) => cause.title.toLowerCase());
    assert.match(titles[0], /coil, cylinder 1/);
    assert.ok(titles.some((title) => title.includes("spark plug")));
    assert.ok(titles.some((title) => title.includes("injector")));
    assert.ok(result.testPlan[0].toLowerCase().includes("swap coil 1"));
    assert.ok(result.warnings.some((w) => w.includes("flashing")));
  });

  it("reads lean codes as vacuum leak, MAF, fuel pressure", () => {
    const result = fallbackAnalysis(input({ codes: ["P0171"] }));
    const titles = result.causes.map((cause) => cause.title.toLowerCase());
    assert.match(titles[0], /vacuum leak/);
    assert.ok(titles.some((title) => title.includes("maf")));
    assert.ok(titles.some((title) => title.includes("fuel pressure")));
  });

  it("knows the common families", () => {
    assert.match(fallbackAnalysis(input({ codes: ["P0420"] })).causes[0].title, /Catalytic converter/);
    assert.match(fallbackAnalysis(input({ codes: ["P0456"] })).causes[0].title, /fuel cap/);
    assert.match(fallbackAnalysis(input({ codes: ["P0128"] })).causes[0].title, /Thermostat/);
    assert.match(fallbackAnalysis(input({ codes: ["P0300"] })).causes[0].title, /Vacuum leak/);
  });

  it("gives generic guidance for chassis, body and network codes", () => {
    assert.match(fallbackAnalysis(input({ codes: ["C0035"] })).causes[0].title, /Wheel speed sensor/);
    assert.match(fallbackAnalysis(input({ codes: ["B1234"] })).causes[0].title, /Open circuit/);
    assert.match(fallbackAnalysis(input({ codes: ["U0100"] })).causes[0].title, /Lost communication/);
  });

  it("uses symptom words to corroborate a code rather than duplicate it", () => {
    const bare = fallbackAnalysis(input({ codes: ["P0301"] }));
    const withWords = fallbackAnalysis(
      input({ codes: ["P0301"], symptoms: "Rough idle, shakes at a stop, misfire counter climbing" }),
    );
    const coilBare = bare.causes.find((c) => c.title.includes("coil"))!;
    const coilWords = withWords.causes.find((c) => c.title.includes("coil"))!;
    assert.ok(coilWords.confidence > coilBare.confidence, "agreeing symptoms should raise confidence");
    assert.ok(coilWords.supporting.includes("Misfire or rough idle"));
    // No second "engine misfire" row when a code already names the cylinder.
    assert.ok(!withWords.causes.some((c) => c.title.startsWith("Engine misfire")));
  });

  it("ranks from symptoms alone when there are no codes", () => {
    const result = fallbackAnalysis(
      input({ codes: [], symptoms: "Squeal under light braking and the pedal pulsates" }),
    );
    assert.match(result.causes[0].title, /Brake pads/);
    assert.ok(result.warnings.some((w) => w.toLowerCase().includes("safety")));
    assert.equal(result.warnings.at(-1), VERIFICATION_WARNING);
  });

  it("asks for a hands-on look when given nothing at all", () => {
    const result = fallbackAnalysis(input({}));
    assert.equal(result.causes.length, 1);
    assert.match(result.causes[0].title, /hands-on/);
    assert.deepEqual(result.warnings, [VERIFICATION_WARNING]);
  });

  it("notices two misfire codes point at a shared cause", () => {
    const result = fallbackAnalysis(input({ codes: ["P0301", "P0303"] }));
    assert.ok(result.causes.some((c) => c.title.startsWith("Shared cause")));
  });

  it("never returns more than five causes, sorted by confidence", () => {
    const result = fallbackAnalysis(
      input({
        codes: ["P0301", "P0171", "P0420", "P0456", "C0035"],
        symptoms: "overheating, clunk over bumps, no start some mornings",
      }),
    );
    assert.equal(result.causes.length, 5);
    for (let i = 1; i < result.causes.length; i += 1) {
      assert.ok(result.causes[i - 1].confidence >= result.causes[i].confidence);
    }
    assert.ok(result.testPlan.length <= 10);
    assert.ok(result.warnings.length <= 6);
  });

  it("orders the test plan by how the causes ranked, not by how the codes were typed", () => {
    // P0420 typed first, but the misfire's coil ranks higher (82 vs 55) once
    // the symptoms agree — so the coil swap must lead the plan.
    const result = fallbackAnalysis(
      input({ codes: ["P0420", "P0301"], symptoms: "Shakes at idle, light flashing on hills" }),
    );
    assert.match(result.causes[0].title, /coil, cylinder 1/);
    assert.match(result.testPlan[0], /Swap coil 1/);
    const coilIndex = result.testPlan.findIndex((t) => t.includes("Swap coil 1"));
    const catIndex = result.testPlan.findIndex((t) => t.includes("O2 sensor waveforms"));
    assert.ok(coilIndex < catIndex, "coil tests before catalyst tests");
  });

  it("caps confidence at 95 even with many agreeing facts", () => {
    const result = fallbackAnalysis(
      input({
        codes: ["P0301"],
        symptoms: "misfire rough idle shaking flashing light",
        observations: "misfire on coil, rough idle",
        complaint: "shakes and misfires",
      }),
    );
    for (const cause of result.causes) assert.ok(cause.confidence <= 95);
  });
});
