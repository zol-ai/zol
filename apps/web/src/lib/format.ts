/**
 * Dates and times for humans, always in the shop's zone.
 *
 * Nothing here reads the server clock's zone: a Vercel function runs in UTC
 * and Cloud Run wherever it likes, and neither is where the shop is. Every
 * helper takes the zone explicitly so a forgotten argument is a type error,
 * not a booking shown three hours off.
 */

type DateInput = string | Date;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "Sep 15, 2026" */
export function formatDate(value: DateInput, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(toDate(value));
}

/** "8:00 AM" */
export function formatTime(value: DateInput, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "Sep 15, 8:00 AM" — the everyday timestamp on lists and timelines. */
export function formatDateTime(value: DateInput, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "Tuesday, Sep 15 at 8:00 AM" — what goes in a text to a customer. */
export function formatWhen(value: DateInput, timeZone: string): string {
  const date = toDate(value);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
  return `${day} at ${formatTime(date, timeZone)}`;
}

/** "3 min ago", "2 h ago", "4 d ago", or the date once it's old. */
export function formatRelative(value: DateInput, timeZone: string, now = new Date()): string {
  const date = toDate(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const suffix = seconds >= 0 ? "ago" : "from now";
  if (abs < 60) return "just now";
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 86_400) return `${Math.round(abs / 3600)} h ${suffix}`;
  if (abs < 7 * 86_400) return `${Math.round(abs / 86_400)} d ${suffix}`;
  return formatDate(date, timeZone);
}

/** "102,430 mi" */
export function formatMiles(miles: number | null | undefined): string {
  return miles == null ? "—" : `${miles.toLocaleString("en-US")} mi`;
}

/** "2015 Chevrolet Sonic LT", from whatever parts are on file. */
export function vehicleLabel(vehicle: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}): string | null {
  const label = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");
  return label.length > 0 ? label : null;
}

/** "JL" for the avatar chip. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
