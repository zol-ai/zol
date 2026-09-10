import type { Queryable } from "../db";
import { shiftDate, zonedDate, zonedToUtc } from "../schedule";

/**
 * Where the receptionist may put a car.
 *
 * A human at the counter can book anything — before opening, on a Sunday, on
 * top of a tech's lunch — because a human typing a time knows something the
 * system doesn't. ZOL is not allowed that latitude. It offers the earliest
 * half-hour start inside opening hours, in the next seven days, where a bay is
 * free and, if the shop has a technician whose specialty matches the job, one
 * of those technicians is free too. The caller's "Thursday afternoon" is a
 * hint that orders the candidates; it never produces a slot the rules would
 * have refused.
 *
 * No `server-only` here on purpose: the search takes whatever `Queryable` the
 * caller is holding — a transaction client in production, a stub in the unit
 * tests — and the decision itself (`pickSlot`) is pure, so it can be tested
 * against a fixed calendar without a database.
 */

export interface OpenSlotRequest {
  shopId: string;
  /** Usually now. Nothing before this plus a short lead time is offered. */
  from: Date;
  durationMin: number;
  /** The caller's words: "tomorrow morning", "Thursday afternoon", "asap". */
  preferredTime?: string | null;
  /** A staff specialty, e.g. "Brakes". Matched against `staff.specialties`. */
  specialty?: string | null;
  /** How far ahead to look. Defaults to a week. */
  days?: number;
}

export interface OpenSlot {
  startsAt: Date;
  endsAt: Date;
  bay: number;
  technicianId: string | null;
  technicianName: string | null;
}

export interface Calendar {
  timezone: string;
  bayCount: number;
  hours: { day_of_week: number; opens_at: string | null; closes_at: string | null; is_closed: boolean }[];
  /** Everything still holding a bay or a tech in the window. */
  busy: { bay: number | null; technician_id: string | null; starts_at: Date; ends_at: Date }[];
  technicians: { id: string; full_name: string; specialties: string[] }[];
}

/**
 * A caller at 7:58 must not be offered 8:00. Half an hour is enough for the
 * advisor to see the booking land before the car does.
 */
const LEAD_MS = 30 * 60_000;
const STEP_MIN = 30;

// -----------------------------------------------------------------------------
// The caller's preference
// -----------------------------------------------------------------------------

export interface Preference {
  /** Days from `from`'s date in the shop's zone. Undefined means no opinion. */
  dayOffset?: number;
  period?: "morning" | "afternoon" | "late";
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Turns "Thursday afternoon" into something the search can order by. Only the
 * shapes people actually say on the phone; anything else is no preference,
 * which yields the earliest slot — the right default for a repair shop.
 */
export function parsePreference(hint: string | null | undefined, from: Date, timeZone: string): Preference {
  if (!hint) return {};
  const text = hint.toLowerCase();
  const pref: Preference = {};

  if (/\b(morning|first thing|early|before noon|\d{1,2}\s?am)\b/.test(text)) pref.period = "morning";
  else if (/\b(afternoon|after lunch|midday|\d{1,2}\s?pm)\b/.test(text)) pref.period = "afternoon";
  else if (/\b(evening|after work|late|end of (the )?day)\b/.test(text)) pref.period = "late";

  const todayDow = new Date(`${zonedDate(from, timeZone)}T12:00:00Z`).getUTCDay();

  if (/\btoday\b/.test(text)) pref.dayOffset = 0;
  else if (/\btomorrow\b/.test(text)) pref.dayOffset = 1;
  else if (/\bnext week\b/.test(text)) pref.dayOffset = ((8 - todayDow) % 7) || 7;
  else {
    const day = WEEKDAYS.findIndex(
      (name) => new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(text),
    );
    if (day >= 0) {
      const offset = (day - todayDow + 7) % 7;
      // "Friday" said on a Friday afternoon means next Friday, not in an hour.
      pref.dayOffset = offset === 0 && /\bnext\b/.test(text) ? 7 : offset;
    }
  }

  return pref;
}

// -----------------------------------------------------------------------------
// The decision
// -----------------------------------------------------------------------------

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function matchesSpecialty(specialties: string[], wanted: string): boolean {
  const w = wanted.toLowerCase();
  return specialties.some((s) => {
    const t = s.toLowerCase();
    return t === w || t.includes(w) || w.includes(t);
  });
}

function hourIn(date: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(date),
  );
}

function inPeriod(start: Date, period: Preference["period"], timeZone: string): boolean {
  if (!period) return true;
  const hour = hourIn(start, timeZone);
  if (period === "morning") return hour < 12;
  if (period === "afternoon") return hour >= 12;
  return hour >= 15;
}

interface Candidate {
  startsAt: Date;
  endsAt: Date;
  dayOffset: number;
}

/** Every half-hour start inside opening hours in the window, in order. */
function candidates(cal: Calendar, from: Date, durationMin: number, days: number): Candidate[] {
  const out: Candidate[] = [];
  const earliest = new Date(from.getTime() + LEAD_MS);
  const firstDay = zonedDate(from, cal.timezone);

  for (let offset = 0; offset < days; offset++) {
    const date = shiftDate(firstDay, offset);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const day = cal.hours.find((h) => h.day_of_week === dow);
    if (!day || day.is_closed || !day.opens_at || !day.closes_at) continue;

    const closes = zonedToUtc(date, day.closes_at.slice(0, 5), cal.timezone);
    if (!closes) continue;

    const [openH, openM] = day.opens_at.slice(0, 5).split(":").map(Number);
    let minutes = openH * 60 + openM;
    for (;;) {
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      const start = zonedToUtc(date, `${hh}:${mm}`, cal.timezone);
      if (!start) break;
      const end = new Date(start.getTime() + durationMin * 60_000);
      if (end > closes) break;
      if (start >= earliest) out.push({ startsAt: start, endsAt: end, dayOffset: offset });
      minutes += STEP_MIN;
    }
  }
  return out;
}

/**
 * The pure core: given the calendar, choose. Exported so it can be tested
 * against a fixed week without a database.
 */
export function pickSlot(
  cal: Calendar,
  req: Omit<OpenSlotRequest, "shopId">,
): OpenSlot | null {
  if (cal.bayCount < 1) return null;
  const days = req.days ?? 7;
  const all = candidates(cal, req.from, req.durationMin, days);
  if (all.length === 0) return null;

  const pref = parsePreference(req.preferredTime, req.from, cal.timezone);
  const specialists = req.specialty
    ? cal.technicians.filter((t) => matchesSpecialty(t.specialties, req.specialty!))
    : [];

  const freeBay = (c: Candidate): number | null => {
    for (let bay = 1; bay <= cal.bayCount; bay++) {
      const taken = cal.busy.some(
        (b) => b.bay === bay && overlaps(c.startsAt, c.endsAt, b.starts_at, b.ends_at),
      );
      if (!taken) return bay;
    }
    return null;
  };

  const freeSpecialist = (c: Candidate) =>
    specialists.find(
      (t) =>
        !cal.busy.some(
          (b) => b.technician_id === t.id && overlaps(c.startsAt, c.endsAt, b.starts_at, b.ends_at),
        ),
    ) ?? null;

  /*
    Three tiers of the caller's preference — the exact day and time of day,
    then that day or later, then anything — each tried first with a matching
    specialist and then without. A shop whose only brake tech is booked solid
    still gets the car in; the advisor reassigns.
  */
  const tiers: ((c: Candidate) => boolean)[] = [
    (c) =>
      (pref.dayOffset === undefined || c.dayOffset === pref.dayOffset) &&
      inPeriod(c.startsAt, pref.period, cal.timezone),
    (c) =>
      (pref.dayOffset === undefined || c.dayOffset >= pref.dayOffset) &&
      inPeriod(c.startsAt, pref.period, cal.timezone),
    () => true,
  ];

  for (const requireSpecialist of specialists.length > 0 ? [true, false] : [false]) {
    for (const tier of tiers) {
      for (const c of all) {
        if (!tier(c)) continue;
        const bay = freeBay(c);
        if (bay === null) continue;
        if (requireSpecialist) {
          const tech = freeSpecialist(c);
          if (!tech) continue;
          return { startsAt: c.startsAt, endsAt: c.endsAt, bay, technicianId: tech.id, technicianName: tech.full_name };
        }
        return { startsAt: c.startsAt, endsAt: c.endsAt, bay, technicianId: null, technicianName: null };
      }
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// The lookup
// -----------------------------------------------------------------------------

export async function loadCalendar(
  client: Queryable,
  shopId: string,
  from: Date,
  days: number,
): Promise<Calendar | null> {
  const shop = await client.query<{ timezone: string; bay_count: number }>(
    "SELECT timezone, bay_count FROM shops WHERE id = $1",
    [shopId],
  );
  if (!shop.rows[0]) return null;

  const until = new Date(from.getTime() + (days + 1) * 86_400_000);

  const [hours, busy, technicians] = await Promise.all([
    client.query<Calendar["hours"][number]>(
      `SELECT day_of_week, opens_at::text, closes_at::text, is_closed
         FROM shop_hours WHERE shop_id = $1`,
      [shopId],
    ),
    client.query<{ bay: number | null; technician_id: string | null; starts_at: Date; ends_at: Date }>(
      `SELECT bay, technician_id, starts_at, ends_at
         FROM appointments
        WHERE shop_id = $1
          AND status IN ('booked', 'confirmed', 'arrived')
          AND ends_at > $2 AND starts_at < $3`,
      [shopId, from, until],
    ),
    client.query<Calendar["technicians"][number]>(
      `SELECT id, full_name, specialties
         FROM staff
        WHERE shop_id = $1 AND role = 'tech' AND disabled_at IS NULL
        ORDER BY full_name`,
      [shopId],
    ),
  ]);

  return {
    timezone: shop.rows[0].timezone,
    bayCount: shop.rows[0].bay_count,
    hours: hours.rows,
    busy: busy.rows.map((b) => ({
      ...b,
      starts_at: new Date(b.starts_at),
      ends_at: new Date(b.ends_at),
    })),
    technicians: technicians.rows,
  };
}

/** The earliest slot ZOL may offer, or null if the week is full. */
export async function findOpenSlot(
  client: Queryable,
  req: OpenSlotRequest,
): Promise<OpenSlot | null> {
  const days = req.days ?? 7;
  const cal = await loadCalendar(client, req.shopId, req.from, days);
  if (!cal) return null;
  return pickSlot(cal, req);
}

// -----------------------------------------------------------------------------
// What kind of job it is
// -----------------------------------------------------------------------------

/**
 * How long to hold a bay for, by the service the receptionist wrote down.
 * Rough on purpose — a diagnostic can take ten minutes or a day — but the
 * bay has to be blocked for something, and these are what shops block.
 */
export function durationForService(serviceType: string | null | undefined): number {
  const s = (serviceType ?? "").toLowerCase();
  if (/brake/.test(s)) return 120;
  if (/suspension|steering/.test(s)) return 120;
  if (/electrical|no.start|won'?t start/.test(s)) return 90;
  if (/cooling|overheat/.test(s)) return 90;
  if (/oil/.test(s)) return 30;
  if (/tire|wheel/.test(s)) return 60;
  if (/alignment/.test(s)) return 60;
  return 60;
}

/**
 * Which specialty on the staff list the job wants, if any. The vocabulary is
 * the owner's free text on the Team page, so this matches loosely and gives up
 * (null → any technician) rather than guessing.
 */
export function specialtyForService(
  serviceType: string | null | undefined,
  complaint?: string | null,
): string | null {
  const s = `${serviceType ?? ""} ${complaint ?? ""}`.toLowerCase();
  if (/brake/.test(s)) return "Brakes";
  if (/suspension|clunk|shock|strut|bump/.test(s)) return "Suspension";
  if (/alignment|pull(s|ing)? to/.test(s)) return "Alignment";
  if (/electrical|battery|won'?t start|no.start|click|alternator|light(s)? (dim|flicker)/.test(s)) return "Electrical";
  if (/check.engine|misfire|stall|hesitat|rough idle|diagnos/.test(s)) return "Diagnostics";
  return null;
}
