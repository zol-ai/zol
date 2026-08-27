import Link from "next/link";

import { setAppointmentStatus } from "@/app/actions/appointments";
import { PageHead } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import {
  clockLabel,
  longDate,
  shiftDate,
  zonedDate,
  zonedTime,
} from "@/lib/schedule";

export const metadata = { title: "Schedule" };

const STATUS_LABEL: Record<string, string> = {
  booked: "Booked",
  confirmed: "Confirmed",
  arrived: "Arrived",
  no_show: "No-show",
  cancelled: "Cancelled",
};

interface Slot {
  id: string;
  bay: number | null;
  starts_at: string;
  ends_at: string;
  status: string;
  booked_by_agent: boolean;
  customer_id: string;
  customer_name: string | null;
  phone: string;
  vehicle: string | null;
  repair_order_id: string | null;
  ro_number: number | null;
}

export default async function SchedulePage(props: PageProps<"/app/schedule">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const today = zonedDate(new Date(), user.timezone);
  const date =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : today;

  const shops = await query<{ bay_count: number }>(
    "SELECT bay_count FROM shops WHERE id = $1",
    [user.shopId],
  );
  const bayCount = shops[0].bay_count;

  /*
    The day is bounded in the shop's zone, in SQL, rather than by computing two
    instants here. `AT TIME ZONE` on a timestamptz gives the wall clock in that
    zone, so this is "everything whose local date is this date" — which is what
    a day means to a shop, including the day a clock change makes 23 or 25
    hours long.
  */
  const slots = await query<Slot>(
    `SELECT a.id, a.bay, a.starts_at::text, a.ends_at::text, a.status,
            a.booked_by_agent, a.customer_id,
            c.full_name AS customer_name, c.phone,
            concat_ws(' ', v.year::text, v.make, v.model) AS vehicle,
            a.repair_order_id, ro.number AS ro_number
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN vehicles v ON v.id = a.vehicle_id
       LEFT JOIN repair_orders ro ON ro.id = a.repair_order_id
      WHERE a.shop_id = $1
        AND (a.starts_at AT TIME ZONE $3)::date = $2::date
      ORDER BY a.starts_at, a.bay NULLS LAST`,
    [user.shopId, date, user.timezone],
  );

  const hours = await query<{
    is_closed: boolean;
    opens_at: string | null;
    closes_at: string | null;
  }>(
    `SELECT is_closed, opens_at::text, closes_at::text
       FROM shop_hours
      WHERE shop_id = $1
        AND day_of_week = extract(dow FROM $2::date)`,
    [user.shopId, date],
  );

  const day = hours[0];
  const bays = Array.from({ length: bayCount }, (_, index) => index + 1);
  const unassigned = slots.filter((slot) => slot.bay === null);

  return (
    <>
      <PageHead eyebrow={user.shopName} title={longDate(date, user.timezone)}>
        <Link href={`/app/schedule?date=${shiftDate(date, -1)}`} className="btn btn-ghost btn-sm">
          ←
        </Link>
        <Link href="/app/schedule" className="btn btn-ghost btn-sm">
          Today
        </Link>
        <Link href={`/app/schedule?date=${shiftDate(date, 1)}`} className="btn btn-ghost btn-sm">
          →
        </Link>
      </PageHead>

      <p className="mb-5 text-[0.875rem] text-ink-2">
        {day?.is_closed || !day?.opens_at
          ? "Closed today."
          : `Open ${clockLabel(day.opens_at.slice(0, 5))} to ${clockLabel(
              day.closes_at!.slice(0, 5),
            )}.`}{" "}
        {slots.length === 0
          ? "Nothing booked."
          : `${slots.length} in the book.`}
      </p>

      {params.note === "closed" && (
        <p
          role="status"
          className="mb-6 rounded-[var(--radius)] border border-amber-line bg-amber-wash px-3 py-2.5 text-[0.875rem] text-amber-deep"
        >
          Booked — though the shop is marked closed that day. Left as you typed
          it.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {bays.map((bay) => (
          <BayRow
            key={bay}
            label={`Bay ${bay}`}
            date={date}
            timezone={user.timezone}
            slots={slots.filter((slot) => slot.bay === bay)}
          />
        ))}

        {/* A car that's in but not on a lift yet. The exclusion constraint
            ignores these on purpose — nothing is being double-booked. */}
        <BayRow
          label="No bay yet"
          date={date}
          timezone={user.timezone}
          slots={unassigned}
        />
      </div>
    </>
  );
}

function BayRow({
  label,
  date,
  timezone,
  slots,
}: {
  label: string;
  date: string;
  timezone: string;
  slots: Slot[];
}) {
  return (
    <section className="card p-4">
      <h2 className="t-eyebrow mb-3">{label}</h2>

      {slots.length === 0 ? (
        <p className="text-[0.875rem] text-ink-3">Free all day.</p>
      ) : (
        <ul className="divide-y divide-line">
          {slots.map((slot) => (
            <li key={slot.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
              {/* On a phone the time takes its own line: squeezed next to the
                  name it left about twenty characters for the customer. */}
              <span className="t-data w-full flex-none text-[0.875rem] text-ink sm:w-36">
                {clockLabel(zonedTime(new Date(slot.starts_at), timezone))}
                <span className="text-ink-3">
                  {" – "}
                  {clockLabel(zonedTime(new Date(slot.ends_at), timezone))}
                </span>
              </span>

              <span className="min-w-0 flex-1">
                <Link
                  href={`/app/customers/${slot.customer_id}`}
                  className="text-[0.9375rem] font-semibold text-ink underline-offset-4 hover:underline"
                >
                  {slot.customer_name ?? "Unnamed"}
                </Link>
                <span className="block text-[0.8125rem] text-ink-2">
                  {slot.vehicle ?? "No vehicle on file"} ·{" "}
                  <span className="t-data">{formatPhone(slot.phone)}</span>
                  {slot.ro_number && (
                    <>
                      {" · "}
                      <Link
                        href={`/app/repair-orders/${slot.repair_order_id}`}
                        className="t-data underline-offset-2 hover:underline"
                      >
                        #{slot.ro_number}
                      </Link>
                    </>
                  )}
                </span>
              </span>

              {slot.booked_by_agent ? (
                <span className="tag tag-zol">ZOL booked</span>
              ) : (
                <span className="tag tag-person">Counter</span>
              )}

              <span
                className={`tag ${
                  slot.status === "cancelled" || slot.status === "no_show"
                    ? "tag-person"
                    : "tag-neutral"
                }`}
              >
                {STATUS_LABEL[slot.status]}
              </span>

              {/* Two buttons, not a dropdown: on a Tuesday morning the only
                  two things anybody presses are "they're here" and "they
                  didn't show". */}
              {slot.status !== "arrived" && slot.status !== "cancelled" && (
                <form action={setAppointmentStatus} className="flex gap-2">
                  <input type="hidden" name="id" value={slot.id} />
                  <input type="hidden" name="date" value={date} />
                  <button
                    type="submit"
                    name="status"
                    value="arrived"
                    className="btn btn-ghost btn-sm"
                  >
                    Arrived
                  </button>
                  <button
                    type="submit"
                    name="status"
                    value="no_show"
                    className="btn btn-ghost btn-sm"
                  >
                    No-show
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
