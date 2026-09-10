import Link from "next/link";

import { EmptyState, Section, StatusBadge, Tag } from "@/components/app/ui";
import type { TodayAppointment } from "@/lib/dashboard";
import { formatTime } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/statuses";

/**
 * Today's book, as a list rather than the bay grid: on a phone the grid is
 * four columns of nothing, and what the owner wants at 7:45 is "who is
 * coming and when". Each row says where the booking came from — emerald for
 * ZOL, amber for the counter — and what has happened to it so far.
 */
export function TodayList({
  appointments,
  date,
  timezone,
}: {
  appointments: TodayAppointment[];
  /** Today as the shop's calendar reads it, "2026-09-10". */
  date: string;
  timezone: string;
}) {
  return (
    <Section
      title="Today"
      detail={
        appointments.length === 0
          ? "Nothing in the book."
          : `${appointments.length} in the book`
      }
      action={
        <Link href={`/app/schedule?date=${date}`} className="btn btn-ghost btn-sm">
          Open the schedule
        </Link>
      }
      flush
    >
      {appointments.length === 0 ? (
        <EmptyState
          title="No appointments today"
          detail="Anything ZOL books from a call or the web chat lands here, along with what the counter takes."
          action={
            <Link href="/app/schedule/new" className="btn btn-emerald btn-sm">
              Book a bay
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {appointments.map((appt) => {
            const done = appt.status === "no_show";
            return (
              <li
                key={appt.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5 ${
                  done ? "opacity-60" : ""
                }`}
              >
                <span className="t-data w-20 flex-none text-[0.875rem] text-ink">
                  {formatTime(appt.starts_at, timezone)}
                </span>

                <span className="min-w-0 flex-1 basis-40">
                  <Link
                    href={`/app/customers/${appt.customer_id}`}
                    className="text-[0.9375rem] font-semibold text-ink underline-offset-4 hover:underline"
                  >
                    {appt.customer_name ?? "Unnamed"}
                  </Link>
                  <span className="block truncate text-[0.8125rem] text-ink-2">
                    {appt.vehicle ?? "No vehicle on file"}
                    {appt.service_type && ` · ${appt.service_type}`}
                    {appt.technician && (
                      <>
                        {" · "}
                        <span className="text-ink-3">with {appt.technician}</span>
                      </>
                    )}
                  </span>
                </span>

                <span className="flex flex-wrap items-center gap-1.5">
                  <Tag tone={appt.booked_by_agent ? "zol" : "person"}>
                    {SOURCE_LABEL[appt.source] ?? appt.source}
                  </Tag>
                  <StatusBadge kind="appointment" value={appt.status} />
                </span>

                {appt.repair_order_id ? (
                  <Link
                    href={`/app/repair-orders/${appt.repair_order_id}`}
                    className="btn btn-ghost btn-sm"
                  >
                    <span className="t-data">#{appt.ro_number}</span>
                  </Link>
                ) : (
                  !done && (
                    // The check-in itself lives on the schedule (mileage, fuel,
                    // damage, notes); this only carries the advisor to the right
                    // day with the right booking in hand.
                    <Link
                      href={`/app/schedule?date=${date}&checkin=${appt.id}`}
                      className="btn btn-ghost btn-sm"
                    >
                      Check in
                    </Link>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
