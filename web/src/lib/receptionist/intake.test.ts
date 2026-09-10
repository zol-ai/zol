import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyUrgency,
  parseBareName,
  parseIntakeFallback,
  parseName,
  parsePhone,
  parsePreferredTime,
  parseVehicle,
  scrubNegations,
  symptomsIn,
} from "./intake";
import { TEST_CALL_SCRIPTS, testCallScript } from "./scripts";

describe("parseIntakeFallback", () => {
  it("reads the returning-customer test call", () => {
    const intake = parseIntakeFallback(testCallScript("returning-brakes")!.transcript);
    assert.equal(intake.customerName, "Jordan Lee");
    assert.equal(intake.phone, "+16615550171");
    assert.deepEqual(intake.vehicle, { year: 2012, make: "Honda", model: "Civic" });
    assert.equal(intake.serviceType, "Brake service");
    assert.equal(intake.urgency, "urgent");
    assert.equal(intake.preferredTime, "Thursday afternoon");
    assert.match(intake.complaint!, /squealing when I brake/);
    assert.ok(intake.symptoms.includes("Squealing"));
    assert.ok(intake.symptoms.includes("Soft brake pedal"));
    // "No grinding" is not grinding.
    assert.ok(!intake.symptoms.includes("Grinding"));
    assert.match(intake.summary, /Jordan Lee: 2012 Honda Civic/);
    assert.ok(intake.safetyAdvice);
  });

  it("reads the new-caller test call", () => {
    const intake = parseIntakeFallback(testCallScript("new-no-start")!.transcript);
    assert.equal(intake.customerName, "Marcus Bell");
    assert.equal(intake.phone, "+16615550177");
    assert.deepEqual(intake.vehicle, { year: 2017, make: "Ford", model: "Escape" });
    assert.equal(intake.serviceType, "Electrical diagnostic");
    assert.equal(intake.urgency, "urgent");
    assert.equal(intake.preferredTime, "Earliest tomorrow morning");
    assert.match(intake.complaint!, /won't start/);
    assert.ok(intake.symptoms.includes("Won't start"));
    assert.ok(intake.symptoms.includes("Lights dimming"));
  });

  it("ignores what the assistant said", () => {
    const intake = parseIntakeFallback([
      { role: "assistant", content: "I have your 2015 Chevrolet Sonic on file — is it that one?" },
      { role: "customer", content: "No, it's the 2012 Honda Civic this time." },
    ]);
    assert.deepEqual(intake.vehicle, { year: 2012, make: "Honda", model: "Civic" });
  });

  it("lets facts established by questions win over the transcript", () => {
    const intake = parseIntakeFallback(
      [{ role: "customer", content: "Hi, it's Dana. My Chevy has the check engine light on." }],
      { customerName: "Dana Kowalski", phone: "+16615550102", vehicle: { year: 2015, make: "Chevrolet", model: "Sonic" } },
    );
    assert.equal(intake.customerName, "Dana Kowalski");
    assert.equal(intake.phone, "+16615550102");
    assert.deepEqual(intake.vehicle, { year: 2015, make: "Chevrolet", model: "Sonic" });
    assert.equal(intake.urgency, "soon");
    assert.equal(intake.serviceType, "Check-engine diagnostic");
  });

  it("calls brake failure what it is", () => {
    const intake = parseIntakeFallback([
      { role: "customer", content: "My brakes failed on the freeway, the pedal went to the floor. 2019 Toyota Camry." },
    ]);
    assert.equal(intake.urgency, "stop_driving");
    assert.match(intake.safetyAdvice!, /towed/);
    assert.equal(intake.serviceType, "Brake service");
  });

  it("every scripted call parses to something bookable", () => {
    for (const script of TEST_CALL_SCRIPTS) {
      const intake = parseIntakeFallback(script.transcript);
      assert.ok(intake.customerName, `${script.key} needs a name`);
      assert.ok(intake.phone, `${script.key} needs a phone`);
      assert.ok(intake.vehicle.make, `${script.key} needs a make`);
      assert.ok(intake.complaint, `${script.key} needs a complaint`);
    }
  });
});

describe("the pieces", () => {
  it("normalises phones however they were said", () => {
    assert.equal(parsePhone("call me on 661.555.0171 please"), "+16615550171");
    assert.equal(parsePhone("6615550171"), "+16615550171");
    assert.equal(parsePhone("+1 661 555 0171"), "+16615550171");
    assert.equal(parsePhone("(661) 555-0171"), "+16615550171");
    assert.equal(parsePhone("my 2015 Sonic"), null);
  });

  it("reads vehicles and writes the model the way the badge does", () => {
    assert.deepEqual(parseVehicle("2020 honda cr-v"), { year: 2020, make: "Honda", model: "CR-V" });
    assert.deepEqual(parseVehicle("my ford f-150 from 2018"), { year: 2018, make: "Ford", model: "F-150" });
    assert.deepEqual(parseVehicle("a chevy silverado 1500, 2016"), { year: 2016, make: "Chevrolet", model: "Silverado 1500" });
    assert.deepEqual(parseVehicle("the VW golf"), { year: null, make: "Volkswagen", model: "Golf" });
    assert.deepEqual(parseVehicle("2014 Jeep Compass that stalls"), { year: 2014, make: "Jeep", model: "Compass" });
    assert.deepEqual(parseVehicle("it's a Subaru"), { year: null, make: "Subaru", model: null });
    assert.deepEqual(parseVehicle("no idea, it's blue"), { year: null, make: null, model: null });
  });

  it("finds names in introductions and bare answers", () => {
    assert.equal(parseName("Hi, this is Jordan Lee calling about my car"), "Jordan Lee");
    assert.equal(parseName("my name is marcus bell and my number is"), "Marcus Bell");
    assert.equal(parseName("it's Dana"), "Dana");
    assert.equal(parseBareName("Priya Shah"), "Priya Shah");
    assert.equal(parseBareName("It's Priya."), "Priya");
    assert.equal(parseBareName("661-555-0171"), null);
    assert.equal(parseBareName("2015 Chevy Sonic"), null);
  });

  it("ranks urgency and drops negated symptoms", () => {
    assert.equal(classifyUrgency("the light is flashing and it shakes"), "stop_driving");
    assert.equal(classifyUrgency("smoke from under the hood"), "stop_driving");
    assert.equal(classifyUrgency("it overheats in traffic"), "urgent");
    assert.equal(classifyUrgency("squeals when I brake"), "soon");
    assert.equal(classifyUrgency("due for an oil change"), "routine");
    assert.equal(classifyUrgency("no smoke, no grinding, just a squeak"), "soon");
    assert.equal(scrubNegations("no grinding at all").trim(), "at all");
    assert.deepEqual(symptomsIn("it's not leaking but the check engine light is on"), ["Check-engine light"]);
  });

  it("pulls the time phrase out of a sentence", () => {
    assert.equal(parsePreferredTime("Thursday afternoon would be best"), "Thursday afternoon");
    assert.equal(parsePreferredTime("could I do tomorrow morning?"), "Tomorrow morning");
    assert.equal(parsePreferredTime("as soon as possible please"), "As soon as possible");
    assert.equal(parsePreferredTime("early next week"), "Early next week");
    assert.equal(parsePreferredTime("the light came on and it shakes"), null);
  });
});
