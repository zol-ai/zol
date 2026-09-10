import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QueryResultRow } from "pg";

import type { Queryable } from "../db";
import {
  durationForService,
  findOpenSlot,
  parsePreference,
  pickSlot,
  specialtyForService,
  type Calendar,
} from "./scheduling";

const TZ = "America/Los_Angeles";

/** Tuesday 2026-09-15, 07:00 PDT. */
const tuesdayDawn = new Date("2026-09-15T14:00:00Z");

/** "2026-09-15", "09:00" PDT → instant. September is daylight time, UTC-7. */
function pdt(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-07:00`);
}

const ELENA = { id: "elena", full_name: "Elena Torres", specialties: ["Brakes", "Suspension"] };
const MANNY = { id: "manny", full_name: "Manny Ruiz", specialties: ["Diagnostics", "Electrical"] };

function calendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    timezone: TZ,
    bayCount: 2,
    hours: [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
      day_of_week,
      opens_at: day_of_week === 0 ? null : day_of_week === 6 ? "09:00:00" : "08:00:00",
      closes_at: day_of_week === 0 ? null : day_of_week === 6 ? "13:00:00" : "17:00:00",
      is_closed: day_of_week === 0,
    })),
    busy: [],
    technicians: [ELENA, MANNY],
    ...overrides,
  };
}

describe("pickSlot", () => {
  it("offers the first half hour after opening, with a lead time, in bay 1", () => {
    const slot = pickSlot(calendar(), { from: tuesdayDawn, durationMin: 60 });
    assert.ok(slot);
    assert.equal(slot.startsAt.toISOString(), pdt("2026-09-15", "08:00").toISOString());
    assert.equal(slot.endsAt.toISOString(), pdt("2026-09-15", "09:00").toISOString());
    assert.equal(slot.bay, 1);
    assert.equal(slot.technicianId, null);
  });

  it("will not offer a slot inside the lead time", () => {
    // 07:45: 08:00 is only fifteen minutes away.
    const slot = pickSlot(calendar(), { from: new Date("2026-09-15T14:45:00Z"), durationMin: 60 });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-15", "08:30").toISOString());
  });

  it("skips to the next free bay, and the next free time when every bay is taken", () => {
    const cal = calendar({
      busy: [
        { bay: 1, technician_id: null, starts_at: pdt("2026-09-15", "08:00"), ends_at: pdt("2026-09-15", "09:00") },
        { bay: 2, technician_id: null, starts_at: pdt("2026-09-15", "08:00"), ends_at: pdt("2026-09-15", "10:00") },
      ],
    });
    const slot = pickSlot(cal, { from: tuesdayDawn, durationMin: 60 });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-15", "09:00").toISOString());
    assert.equal(slot?.bay, 1);
  });

  it("does not let a job run past closing", () => {
    // Tuesday 16:20: the next half hour with 60 minutes before 17:00 doesn't exist.
    const slot = pickSlot(calendar(), { from: new Date("2026-09-15T23:20:00Z"), durationMin: 60 });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-16", "08:00").toISOString());
  });

  it("skips closed days and honours a shorter Saturday", () => {
    // Saturday 12:00: nothing fits before 13:00; Sunday is closed; Monday 08:00.
    const slot = pickSlot(calendar(), { from: new Date("2026-09-19T19:00:00Z"), durationMin: 60 });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-21", "08:00").toISOString());
  });

  it("holds out for a free specialist when one exists", () => {
    const cal = calendar({
      busy: [{ bay: 1, technician_id: "elena", starts_at: pdt("2026-09-15", "08:00"), ends_at: pdt("2026-09-15", "11:00") }],
    });
    const slot = pickSlot(cal, { from: tuesdayDawn, durationMin: 120, specialty: "Brakes" });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-15", "11:00").toISOString());
    assert.equal(slot?.technicianId, "elena");
    assert.equal(slot?.technicianName, "Elena Torres");
  });

  it("books without a technician when nobody on the team has the specialty", () => {
    const slot = pickSlot(calendar(), { from: tuesdayDawn, durationMin: 60, specialty: "Transmission" });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-15", "08:00").toISOString());
    assert.equal(slot?.technicianId, null);
  });

  it("falls back to any technician-free slot when the specialist is booked all week", () => {
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 8, 15 + i, 12)).toISOString().slice(0, 10);
      return { bay: null, technician_id: "elena", starts_at: pdt(day, "00:00"), ends_at: pdt(day, "23:59") };
    });
    const slot = pickSlot(calendar({ busy: week }), { from: tuesdayDawn, durationMin: 60, specialty: "Brakes" });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-15", "08:00").toISOString());
    assert.equal(slot?.technicianId, null);
  });

  it("orders by the caller's preference: tomorrow afternoon", () => {
    const slot = pickSlot(calendar(), { from: tuesdayDawn, durationMin: 60, preferredTime: "tomorrow afternoon" });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-16", "12:00").toISOString());
  });

  it("orders by the caller's preference: a weekday", () => {
    const slot = pickSlot(calendar(), { from: tuesdayDawn, durationMin: 120, preferredTime: "Thursday afternoon", specialty: "Brakes" });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-17", "12:00").toISOString());
    assert.equal(slot?.technicianId, "elena");
  });

  it("relaxes the preferred day when it is full", () => {
    const wednesday = { bay: 1, technician_id: null, starts_at: pdt("2026-09-16", "00:00"), ends_at: pdt("2026-09-16", "23:59") };
    const slot = pickSlot(calendar({ bayCount: 1, busy: [wednesday] }), {
      from: tuesdayDawn,
      durationMin: 60,
      preferredTime: "tomorrow morning",
    });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-17", "08:00").toISOString());
  });

  it("returns null when the week is full", () => {
    const slot = pickSlot(
      calendar({
        bayCount: 1,
        busy: [{ bay: 1, technician_id: null, starts_at: pdt("2026-09-01", "00:00"), ends_at: pdt("2026-10-01", "00:00") }],
      }),
      { from: tuesdayDawn, durationMin: 60 },
    );
    assert.equal(slot, null);
  });
});

describe("parsePreference", () => {
  it("reads the shapes people say on the phone", () => {
    assert.deepEqual(parsePreference("tomorrow morning", tuesdayDawn, TZ), { dayOffset: 1, period: "morning" });
    assert.deepEqual(parsePreference("Thursday afternoon", tuesdayDawn, TZ), { dayOffset: 2, period: "afternoon" });
    assert.deepEqual(parsePreference("today", tuesdayDawn, TZ), { dayOffset: 0 });
    assert.deepEqual(parsePreference("first thing", tuesdayDawn, TZ), { period: "morning" });
    assert.deepEqual(parsePreference("next week", tuesdayDawn, TZ), { dayOffset: 6 });
    assert.deepEqual(parsePreference("whenever", tuesdayDawn, TZ), {});
    assert.deepEqual(parsePreference(null, tuesdayDawn, TZ), {});
  });

  it("treats today's weekday as next week when 'next' is said", () => {
    assert.deepEqual(parsePreference("next Tuesday", tuesdayDawn, TZ), { dayOffset: 7 });
    assert.deepEqual(parsePreference("Tuesday", tuesdayDawn, TZ), { dayOffset: 0 });
  });
});

/** A `Queryable` that answers each statement from a fixed table. */
function stub(answer: (text: string) => unknown[]): Queryable {
  return {
    query: async <T extends QueryResultRow>(text: string) => ({
      rows: answer(text) as T[],
      rowCount: null,
    }),
  };
}

describe("findOpenSlot", () => {
  it("reads the calendar through whatever client it is handed", async () => {
    const seen: string[] = [];
    const client = stub((text) => {
      seen.push(text);
      if (/FROM shops/.test(text)) return [{ timezone: TZ, bay_count: 1 }];
      if (/FROM shop_hours/.test(text)) return calendar().hours;
      if (/FROM appointments/.test(text)) {
        return [{ bay: 1, technician_id: null, starts_at: pdt("2026-09-15", "08:00"), ends_at: pdt("2026-09-15", "09:30") }];
      }
      if (/FROM staff/.test(text)) return [ELENA];
      throw new Error(`unexpected query: ${text}`);
    });

    const slot = await findOpenSlot(client, { shopId: "shop", from: tuesdayDawn, durationMin: 60 });
    assert.equal(slot?.startsAt.toISOString(), pdt("2026-09-15", "09:30").toISOString());
    assert.equal(slot?.bay, 1);
    assert.equal(seen.length, 4);
    // Only live bookings count as busy; the query says so.
    assert.match(seen.find((q) => /FROM appointments/.test(q))!, /status IN \('booked', 'confirmed', 'arrived'\)/);
  });

  it("returns null for a shop that doesn't exist", async () => {
    const client = stub(() => []);
    assert.equal(await findOpenSlot(client, { shopId: "nope", from: tuesdayDawn, durationMin: 60 }), null);
  });
});

describe("job shape", () => {
  it("maps services to durations and specialties", () => {
    assert.equal(durationForService("Brake service"), 120);
    assert.equal(durationForService("Oil service"), 30);
    assert.equal(durationForService("Check-engine diagnostic"), 60);
    assert.equal(durationForService(null), 60);
    assert.equal(specialtyForService("Brake service"), "Brakes");
    assert.equal(specialtyForService("Electrical diagnostic", "won't start, just clicks"), "Electrical");
    assert.equal(specialtyForService("Check-engine diagnostic"), "Diagnostics");
    assert.equal(specialtyForService("Oil service"), null);
  });
});
