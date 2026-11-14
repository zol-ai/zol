import Link from "next/link";

import { shiftDate } from "@/lib/schedule";

/**
 * Seven days across the top of the schedule, each a link, each carrying how
 * many cars are booked. Scrolls sideways on a phone rather than wrapping so
 * the row always reads as one week.
 *
 * The strip starts at today while today is on it, and at the selected day
 * once the owner has paged further out — jumping back is the "Today" button.
 */
export function DayStrip({
  start,
  date,
  today,
  counts,
}: {
  /** First day shown, "2026-09-10". */
  start: string;
  date: string;
  today: string;
  /** Booked-or-better appointments per day, keyed by "2026-09-10". */
  counts: Record<string, number>;
}) {
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

  return (
    <nav aria-label="Days" className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {days.map((day) => {
        const selected = day === date;
        const isToday = day === today;
        const n = counts[day] ?? 0;
        return (
          <Link
            key={day}
            href={`/app/schedule?date=${day}`}
            aria-current={selected ? "date" : undefined}
            className={`flex min-w-[4.5rem] flex-1 flex-col items-center rounded-[var(--radius)] border px-2 py-2 transition-colors ${
              selected
                ? "border-ink bg-ink text-paper"
                : "border-line bg-paper text-ink hover:bg-paper-2"
            }`}
          >
            <span className={`t-eyebrow flex items-center gap-1 ${selected ? "text-paper/70" : ""}`}>
              {isToday && (
                <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-emerald" />
              )}
              {weekday.format(new Date(`${day}T12:00:00Z`))}
              {isToday && <span className="sr-only">(today)</span>}
            </span>
            <span className="t-num mt-1 text-[1.25rem]">{Number(day.slice(8))}</span>
            <span className={`mt-1 text-[0.6875rem] ${selected ? "text-paper/70" : "text-ink-3"}`}>
              {n === 0 ? "free" : n === 1 ? "1 booked" : `${n} booked`}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
