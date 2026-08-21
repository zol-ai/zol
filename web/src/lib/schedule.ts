/**
 * Wall-clock time in the shop's time zone.
 *
 * Everything is stored as timestamptz — an instant, not a wall clock — and the
 * booking screen is entirely wall clock: "Tuesday at 9" means nine in the
 * morning where the shop is, whether the advisor booking it is standing in the
 * bay or at home in another state. So this converts in both directions, and
 * every conversion names the zone explicitly. There is no "server local time"
 * anywhere: a Vercel function runs in UTC and Cloud Run in whatever it feels
 * like, and neither is where the shop is.
 *
 * `Intl` does this without a date library. The trick in `zonedToUtc` is to
 * guess an instant, ask what wall clock that instant shows in the shop's zone,
 * and correct by the difference — twice, because the correction can itself
 * cross a daylight-saving boundary.
 */

/** The parts of an instant, as they read on a clock in `timeZone`. */
function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds. */
function offsetAt(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** "2026-08-21", "09:30" in the shop's zone → the instant that is. */
export function zonedToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date | undefined {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) {
    return undefined;
  }

  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // First pass gets within an hour; the second settles a DST transition, where
  // the offset at the guess differs from the offset at the answer.
  let guess = new Date(naive - offsetAt(new Date(naive), timeZone));
  guess = new Date(naive - offsetAt(guess, timeZone));
  return guess;
}

/** The instant → "2026-08-21" as the shop's calendar reads it. */
export function zonedDate(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The instant → "09:30" on the shop's clock. */
export function zonedTime(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** 0 = Sunday, matching EXTRACT(DOW) and the shop_hours primary key. */
export function zonedDayOfWeek(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** "2026-08-21" → "Friday, August 21" for a heading. */
export function longDate(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "09:30" → "9:30 AM". */
export function clockLabel(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** Shift a "2026-08-21" by whole days without touching a time zone. */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
