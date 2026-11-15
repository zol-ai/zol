import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  eachDayOfInterval,
  eachMonthOfInterval,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  isSameMonth,
  parse,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import type { ScheduleColor, ScheduleEvent } from "@/types";

/*
  Pure date arithmetic for the schedule. Shared by the browser views, the
  dashboard card, and the Firestore helper, so it must stay free of React and
  of anything server-only.

  Everything works on "date keys" (YYYY-MM-DD strings). They sort as strings,
  they compare as strings, and parseISO reads a bare date as *local* midnight,
  so a key survives a round trip without a time-zone shift.
*/

export const scheduleViews = ["day", "week", "month", "quarter", "year"] as const;
export type ScheduleView = (typeof scheduleViews)[number];

export function isScheduleView(value: unknown): value is ScheduleView {
  return typeof value === "string" && (scheduleViews as readonly string[]).includes(value);
}

export type DateRange = { start: string; end: string };
export type ScheduleSpan = Pick<ScheduleEvent, "date" | "endDate">;

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Weeks start on Monday, the same convention as the dashboard's weekly count. */
const weekOptions = { weekStartsOn: 1 } as const;

export function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function fromDateKey(key: string) {
  return parseISO(key);
}

export function todayKey() {
  return toDateKey(new Date());
}

export function rangeFor(view: ScheduleView, anchor: string): DateRange {
  const date = fromDateKey(anchor);
  switch (view) {
    case "day":
      return { start: anchor, end: anchor };
    case "week":
      return {
        start: toDateKey(startOfWeek(date, weekOptions)),
        end: toDateKey(endOfWeek(date, weekOptions)),
      };
    case "month":
      return { start: toDateKey(startOfMonth(date)), end: toDateKey(endOfMonth(date)) };
    case "quarter":
      return { start: toDateKey(startOfQuarter(date)), end: toDateKey(endOfQuarter(date)) };
    case "year":
      return { start: toDateKey(startOfYear(date)), end: toDateKey(endOfYear(date)) };
  }
}

/** The month padded out to whole Monday-to-Sunday rows, for calendar grids. */
export function monthGridRange(anchor: string): DateRange {
  const date = fromDateKey(anchor);
  return {
    start: toDateKey(startOfWeek(startOfMonth(date), weekOptions)),
    end: toDateKey(endOfWeek(endOfMonth(date), weekOptions)),
  };
}

export function shiftAnchor(view: ScheduleView, anchor: string, direction: -1 | 1) {
  const date = fromDateKey(anchor);
  switch (view) {
    case "day":
      return toDateKey(addDays(date, direction));
    case "week":
      return toDateKey(addWeeks(date, direction));
    case "month":
      return toDateKey(addMonths(date, direction));
    case "quarter":
      return toDateKey(addQuarters(date, direction));
    case "year":
      return toDateKey(addYears(date, direction));
  }
}

export function rangeLabel(view: ScheduleView, anchor: string) {
  const date = fromDateKey(anchor);
  switch (view) {
    case "day":
      return format(date, "EEEE, MMMM d, yyyy");
    case "week": {
      const { start, end } = rangeFor("week", anchor);
      const first = fromDateKey(start);
      const last = fromDateKey(end);
      return isSameMonth(first, last)
        ? `${format(first, "MMM d")} – ${format(last, "d, yyyy")}`
        : `${format(first, "MMM d")} – ${format(last, "MMM d, yyyy")}`;
    }
    case "month":
      return format(date, "MMMM yyyy");
    case "quarter":
      return format(date, "QQQ yyyy");
    case "year":
      return format(date, "yyyy");
  }
}

export function daysInRange(range: DateRange) {
  return eachDayOfInterval({ start: fromDateKey(range.start), end: fromDateKey(range.end) }).map(
    toDateKey,
  );
}

/** The first day of every month the range touches. */
export function monthsInRange(range: DateRange) {
  return eachMonthOfInterval({
    start: fromDateKey(range.start),
    end: fromDateKey(range.end),
  }).map(toDateKey);
}

export function eventLastDay(event: ScheduleSpan) {
  return event.endDate ?? event.date;
}

export function occursOn(event: ScheduleSpan, dateKey: string) {
  return event.date <= dateKey && eventLastDay(event) >= dateKey;
}

export function overlapsRange(event: ScheduleSpan, range: DateRange) {
  return event.date <= range.end && eventLastDay(event) >= range.start;
}

export function isMultiDay(event: ScheduleSpan) {
  return Boolean(event.endDate && event.endDate !== event.date);
}

/** All-day entries first, then by start time, then by title. */
export function compareEvents(a: ScheduleEvent, b: ScheduleEvent) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const byTime = (a.startTime ?? "").localeCompare(b.startTime ?? "");
  if (byTime) return byTime;
  return a.title.localeCompare(b.title);
}

export function eventsOn(events: ScheduleEvent[], dateKey: string) {
  return events.filter((event) => occursOn(event, dateKey)).sort(compareEvents);
}

/** How many events touch each day of the range. Multi-day events count on every day they cover. */
export function countByDay(events: ScheduleSpan[], range: DateRange) {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!overlapsRange(event, range)) continue;
    const start = event.date > range.start ? event.date : range.start;
    const last = eventLastDay(event);
    const end = last < range.end ? last : range.end;
    for (const day of daysInRange({ start, end })) {
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }
  return counts;
}

export function formatClock(time: string) {
  return format(parse(time, "HH:mm", new Date(0)), "h:mm a");
}

export function formatEventTime(event: Pick<ScheduleEvent, "allDay" | "startTime" | "endTime">) {
  if (event.allDay || !event.startTime) return "All day";
  return event.endTime
    ? `${formatClock(event.startTime)} – ${formatClock(event.endTime)}`
    : formatClock(event.startTime);
}

export const scheduleColors: ScheduleColor[] = ["blue", "green", "amber", "rose", "violet", "slate"];

export const scheduleColorStyles: Record<
  ScheduleColor,
  { label: string; chip: string; swatch: string }
> = {
  blue: {
    label: "Blue",
    chip: "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100",
    swatch: "bg-blue-500",
  },
  green: {
    label: "Green",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    swatch: "bg-emerald-500",
  },
  amber: {
    label: "Amber",
    chip: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100",
    swatch: "bg-amber-500",
  },
  rose: {
    label: "Rose",
    chip: "border-rose-200 bg-rose-50 text-rose-900 hover:bg-rose-100",
    swatch: "bg-rose-500",
  },
  violet: {
    label: "Violet",
    chip: "border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100",
    swatch: "bg-violet-500",
  },
  slate: {
    label: "Slate",
    chip: "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200",
    swatch: "bg-slate-500",
  },
};
