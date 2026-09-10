import Link from "next/link";

import { DayStrip } from "@/components/app/schedule/day-strip";
import { SlotCard, type Slot } from "@/components/app/schedule/slot-card";
import type { TechnicianOption } from "@/components/app/check-in-form";
import { PageHead } from "@/components/app/shell";
import { Notice } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { clockLabel, longDate, shiftDate, zonedDate } from "@/lib/schedule";

export const metadata = { title: "Schedule" };

export default async function SchedulePage(props: PageProps<"/app/schedule">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const today = zonedDate(new Date(), user.timezone);
  const date =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : today;
  // The dashboard's Check in button: land with that booking's form open.
  const checkin = typeof params.checkin === "string" ? params.checkin : null;

  // The strip starts at today while today is on it, otherwise at the day
  // being looked at — so paging a week out shows that week, not a gap.
  const stripStart = date >= today && date <= shiftDate(today, 6) ? today : date;
  const stripEnd = shiftDate(stripStart, 6);

  const [shops, slots, hours, counts, techs] = await Promise.all([
    query<{ bay_count: number }>("SELECT bay_count FROM shops WHERE id = $1", [user.shopId]),
    /*
      The day is bounded in the shop's zone, in SQL, rather than by computing
      two instants here. `AT TIME ZONE` on a timestamptz gives the wall clock
      in that zone, so this is "everything whose local date is this date" —
      which is what a day means to a shop, including the day a clock change
      makes 23 or 25 hours long.
    */
    query<Slot>(
      `SELECT a.id, a.bay, a.starts_at::text, a.ends_at::text, a.status,
              a.booked_by_agent, a.source, a.customer_id,
              c.full_name AS customer_name, c.phone,
              a.vehicle_id,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
              v.mileage AS vehicle_mileage,
              a.repair_order_id, ro.number AS ro_number,
              a.technician_id, t.full_name AS technician_name,
              a.service_type, a.complaint, a.notes, a.call_id
         FROM appointments a
         JOIN customers c ON c.id = a.customer_id
         LEFT JOIN vehicles v ON v.id = a.vehicle_id
         LEFT JOIN repair_orders ro ON ro.id = a.repair_order_id
         LEFT JOIN staff t ON t.id = a.technician_id
        WHERE a.shop_id = $1
          AND (a.starts_at AT TIME ZONE $3)::date = $2::date
        ORDER BY a.starts_at, a.bay NULLS LAST`,
      [user.shopId, date, user.timezone],
    ),
    query<{ is_closed: boolean; opens_at: string | null; closes_at: string | null }>(
      `SELECT is_closed, opens_at::text, closes_at::text
         FROM shop_hours
        WHERE shop_id = $1 AND day_of_week = extract(dow FROM $2::date)`,
      [user.shopId, date],
    ),
    query<{ day: string; n: string }>(
      `SELECT (a.starts_at AT TIME ZONE $2)::date::text AS day, count(*) AS n
         FROM appointments a
        WHERE a.shop_id = $1
          AND a.status IN ('booked', 'confirmed', 'arrived')
          AND (a.starts_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
        GROUP BY 1`,
      [user.shopId, user.timezone, stripStart, stripEnd],
    ),
    query<{ id: string; full_name: string; specialties: string[] }>(
      `SELECT id, full_name, specialties FROM staff
        WHERE shop_id = $1 AND role = 'tech' AND disabled_at IS NULL
        ORDER BY full_name`,
      [user.shopId],
    ),
  ]);

  const bayCount = shops[0].bay_count;
  const day = hours[0];
  const bays = Array.from({ length: bayCount }, (_, index) => index + 1);
  const unassigned = slots.filter((slot) => slot.bay === null);
  const technicians: TechnicianOption[] = techs.map((tech) => ({
    id: tech.id,
    label: tech.specialties.length > 0 ? `${tech.full_name} — ${tech.specialties.join(", ")}` : tech.full_name,
  }));

  const live = slots.filter((slot) => slot.status !== "cancelled" && slot.status !== "no_show");
  const arrived = slots.filter((slot) => slot.status === "arrived").length;
  const zolBooked = live.filter((slot) => slot.source === "agent").length;

  return (
    <>
      <PageHead eyebrow={user.shopName} title={longDate(date, user.timezone)}>
        <Link href={`/app/schedule?date=${shiftDate(date, -1)}`} className="btn btn-ghost btn-sm" aria-label="Previous day">
          ←
        </Link>
        <Link href="/app/schedule" className="btn btn-ghost btn-sm">
          Today
        </Link>
        <Link href={`/app/schedule?date=${shiftDate(date, 1)}`} className="btn btn-ghost btn-sm" aria-label="Next day">
          →
        </Link>
        {/* An appointment is somebody's: booking starts from the customer. */}
        <Link href="/app/customers" className="btn btn-emerald btn-sm">
          Book a bay
        </Link>
      </PageHead>

      <DayStrip
        start={stripStart}
        date={date}
        today={today}
        counts={Object.fromEntries(counts.map((row) => [row.day, Number(row.n)]))}
      />

      <p className="mb-5 text-[0.875rem] text-ink-2">
        {day?.is_closed || !day?.opens_at
          ? "Closed today."
          : `Open ${clockLabel(day.opens_at.slice(0, 5))} to ${clockLabel(day.closes_at!.slice(0, 5))}.`}{" "}
        {live.length === 0
          ? "Nothing booked."
          : `${live.length} in the book${arrived > 0 ? `, ${arrived} here` : ""}${
              zolBooked > 0 ? `, ${zolBooked} booked by ZOL` : ""
            }.`}
      </p>

      {params.note === "closed" && (
        <Notice tone="person" className="mb-6">
          Booked — though the shop is marked closed that day. Left as you typed it.
        </Notice>
      )}
      {params.note === "booked" && (
        <Notice tone="zol" className="mb-6">
          Booked. The confirmation is queued for the customer.
        </Notice>
      )}

      <div className="flex flex-col gap-4">
        {bays.map((bay) => (
          <BayRow
            key={bay}
            label={`Bay ${bay}`}
            date={date}
            timezone={user.timezone}
            technicians={technicians}
            slots={slots.filter((slot) => slot.bay === bay)}
            checkin={checkin}
          />
        ))}

        {/* A car that's in but not on a lift yet. The exclusion constraint
            ignores these on purpose — nothing is being double-booked. */}
        <BayRow
          label="No bay yet"
          date={date}
          timezone={user.timezone}
          technicians={technicians}
          slots={unassigned}
          checkin={checkin}
        />
      </div>
    </>
  );
}

function BayRow({
  label,
  date,
  timezone,
  technicians,
  slots,
  checkin,
}: {
  label: string;
  date: string;
  timezone: string;
  technicians: TechnicianOption[];
  slots: Slot[];
  checkin: string | null;
}) {
  return (
    <section className="card p-4">
      <h2 className="t-eyebrow mb-3">{label}</h2>

      {slots.length === 0 ? (
        <p className="text-[0.875rem] text-ink-3">Free all day.</p>
      ) : (
        <ul className="divide-y divide-line">
          {slots.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              date={date}
              timezone={timezone}
              technicians={technicians}
              openCheckIn={slot.id === checkin}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
