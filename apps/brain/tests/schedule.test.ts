import { describe, expect, it } from "vitest";
import {
  compareEvents,
  countByDay,
  eventsOn,
  monthGridRange,
  rangeFor,
  rangeLabel,
  shiftAnchor,
} from "../lib/schedule";
import {
  scheduleEventCreateSchema,
  scheduleEventUpdateSchema,
  scheduleQuerySchema,
} from "../lib/validation/schemas";
import type { ScheduleEvent } from "../types";

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "event",
    title: "Event",
    date: "2026-09-07",
    allDay: false,
    startTime: "09:00",
    color: "blue",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("schedule event validation", () => {
  it("accepts a timed event and supplies defaults", () => {
    const result = scheduleEventCreateSchema.parse({
      title: "Standup",
      date: "2026-09-07",
      startTime: "09:00",
      endTime: "09:15",
    });
    expect(result).toMatchObject({ title: "Standup", allDay: false, color: "blue" });
  });

  it("drops clock times from an all-day event", () => {
    const result = scheduleEventCreateSchema.parse({
      title: "Offsite",
      date: "2026-09-07",
      allDay: true,
      startTime: "09:00",
      endTime: "10:00",
    });
    expect(result.startTime).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  it("requires a start time unless the event is all day", () => {
    expect(() => scheduleEventCreateSchema.parse({ title: "Call", date: "2026-09-07" })).toThrow();
  });

  it("rejects an end time before the start on a single day", () => {
    expect(() =>
      scheduleEventCreateSchema.parse({
        title: "Call",
        date: "2026-09-07",
        startTime: "10:00",
        endTime: "09:00",
      }),
    ).toThrow();
  });

  it("lets the end time wrap when the event spans days", () => {
    const result = scheduleEventCreateSchema.parse({
      title: "Overnight",
      date: "2026-09-07",
      endDate: "2026-09-08",
      startTime: "17:00",
      endTime: "09:00",
    });
    expect(result.endDate).toBe("2026-09-08");
  });

  it("rejects an end date before the start and impossible dates", () => {
    expect(() =>
      scheduleEventCreateSchema.parse({
        title: "Trip",
        date: "2026-09-07",
        endDate: "2026-09-06",
        allDay: true,
      }),
    ).toThrow();
    expect(() =>
      scheduleEventCreateSchema.parse({ title: "Trip", date: "2026-02-30", allDay: true }),
    ).toThrow();
  });

  it("requires at least one field on update and reads blanks as clears", () => {
    expect(() => scheduleEventUpdateSchema.parse({})).toThrow();
    expect(scheduleEventUpdateSchema.parse({ endDate: "" }).endDate).toBeUndefined();
  });

  it("rejects a query window that ends before it starts", () => {
    expect(() => scheduleQuerySchema.parse({ from: "2026-09-08", to: "2026-09-07" })).toThrow();
    expect(scheduleQuerySchema.parse({ from: "2026-09-07", to: "2026-09-07" })).toMatchObject({
      from: "2026-09-07",
      to: "2026-09-07",
    });
  });
});

describe("schedule ranges", () => {
  it("builds Monday-first weeks", () => {
    expect(rangeFor("week", "2026-09-09")).toEqual({ start: "2026-09-07", end: "2026-09-13" });
  });

  it("builds day, month, quarter, and year windows", () => {
    expect(rangeFor("day", "2026-09-09")).toEqual({ start: "2026-09-09", end: "2026-09-09" });
    expect(rangeFor("month", "2026-09-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(rangeFor("quarter", "2026-09-09")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(rangeFor("year", "2026-09-09")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("pads the month grid out to whole weeks", () => {
    expect(monthGridRange("2026-09-15")).toEqual({ start: "2026-08-31", end: "2026-10-04" });
  });

  it("steps the anchor by one unit of the view", () => {
    expect(shiftAnchor("day", "2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftAnchor("week", "2026-09-09", -1)).toBe("2026-09-02");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftAnchor("quarter", "2026-09-09", 1)).toBe("2026-12-09");
    expect(shiftAnchor("year", "2026-09-09", 1)).toBe("2027-09-09");
  });

  it("labels each view", () => {
    expect(rangeLabel("day", "2026-09-09")).toBe("Wednesday, September 9, 2026");
    expect(rangeLabel("week", "2026-09-09")).toBe("Sep 7 – 13, 2026");
    expect(rangeLabel("week", "2026-09-30")).toBe("Sep 28 – Oct 4, 2026");
    expect(rangeLabel("month", "2026-09-09")).toBe("September 2026");
    expect(rangeLabel("quarter", "2026-09-09")).toBe("Q3 2026");
    expect(rangeLabel("year", "2026-09-09")).toBe("2026");
  });
});

describe("schedule events by day", () => {
  it("includes multi-day events on every day they cover", () => {
    const offsite = event({ id: "offsite", date: "2026-09-07", endDate: "2026-09-09", allDay: true });
    expect(eventsOn([offsite], "2026-09-08")).toHaveLength(1);
    expect(eventsOn([offsite], "2026-09-10")).toHaveLength(0);
  });

  it("lists all-day events first, then by start time", () => {
    const order = [
      event({ id: "afternoon", startTime: "13:00" }),
      event({ id: "all-day", allDay: true, startTime: undefined }),
      event({ id: "morning", startTime: "08:30" }),
    ]
      .sort(compareEvents)
      .map((item) => item.id);
    expect(order).toEqual(["all-day", "morning", "afternoon"]);
  });

  it("counts events per day within the window only", () => {
    const counts = countByDay(
      [
        event({ id: "spanning", date: "2026-09-06", endDate: "2026-09-08" }),
        event({ id: "single", date: "2026-09-08" }),
      ],
      { start: "2026-09-07", end: "2026-09-30" },
    );
    expect(counts.get("2026-09-06")).toBeUndefined();
    expect(counts.get("2026-09-07")).toBe(1);
    expect(counts.get("2026-09-08")).toBe(2);
    expect(counts.get("2026-09-09")).toBeUndefined();
  });
});
