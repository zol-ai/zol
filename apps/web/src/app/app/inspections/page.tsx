import Link from "next/link";

import { PageHead } from "@/components/app/shell";
import { EmptyState, RatingDot, StatusBadge } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { Rating } from "@/lib/statuses";

export const metadata = { title: "Inspections" };

/**
 * Every digital inspection in the shop, newest first.
 *
 * Two groups: sheets still being filled in, and sheets that were signed. The
 * counts on each card are what the owner scans for — three reds on a car
 * that is leaving today is a phone call before it does.
 */

interface InspectionCard {
  id: string;
  overall: Rating;
  completed_at: string | null;
  updated_at: string;
  created_at: string;
  repair_order_id: string;
  ro_number: number;
  ro_status: string;
  customer_name: string | null;
  vehicle: string | null;
  plate: string | null;
  technician_name: string | null;
  green: number;
  yellow: number;
  red: number;
  not_inspected: number;
}

export default async function InspectionsPage() {
  const user = await requireUser();

  const rows = await query<InspectionCard>(
    `SELECT i.id, i.overall, i.completed_at::text, i.updated_at::text, i.created_at::text,
            ro.id AS repair_order_id, ro.number AS ro_number, ro.status AS ro_status,
            c.full_name AS customer_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle, v.plate,
            t.full_name AS technician_name,
            count(it.id) FILTER (WHERE it.rating = 'green')::int AS green,
            count(it.id) FILTER (WHERE it.rating = 'yellow')::int AS yellow,
            count(it.id) FILTER (WHERE it.rating = 'red')::int AS red,
            count(it.id) FILTER (WHERE it.rating = 'not_inspected')::int AS not_inspected
       FROM inspections i
       JOIN repair_orders ro ON ro.id = i.repair_order_id
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = i.vehicle_id
       LEFT JOIN staff t ON t.id = i.technician_id
       LEFT JOIN inspection_items it ON it.inspection_id = i.id
      WHERE i.shop_id = $1
      GROUP BY i.id, ro.id, c.id, v.id, t.id
      ORDER BY i.updated_at DESC
      LIMIT 100`,
    [user.shopId],
  );

  const open = rows.filter((row) => !row.completed_at);
  const done = rows.filter((row) => row.completed_at);

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Inspections"
        description="Every digital inspection, in progress and signed off. Start one from the ticket."
      />

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No inspections yet"
            detail="Open a repair order and start one from its inspection panel. Thirteen systems, rated from the bay, summarised for the customer when you finish."
            action={
              <Link href="/app/repair-orders" className="btn btn-ghost btn-sm">
                Repair orders
              </Link>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <Group title="In progress" items={open} timezone={user.timezone} empty="Nothing being inspected right now." />
          <Group title="Completed" items={done} timezone={user.timezone} empty="Nothing signed off yet." />
        </div>
      )}
    </>
  );
}

function Group({
  title,
  items,
  timezone,
  empty,
}: {
  title: string;
  items: InspectionCard[];
  timezone: string;
  empty: string;
}) {
  return (
    <section>
      <h2 className="t-eyebrow mb-2">
        {title}
        <span className="t-data ml-2 text-ink-3">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="card p-6 text-center text-[0.875rem] text-ink-2">{empty}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/app/repair-orders/${item.repair_order_id}#inspection`}
                className="card block h-full p-4 transition-colors hover:bg-paper-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[0.9375rem] font-semibold text-ink">
                      {item.vehicle ?? "Vehicle not on file"}
                      {item.plate && <span className="t-data ml-2 text-[0.75rem] font-normal text-ink-3">{item.plate}</span>}
                    </p>
                    <p className="mt-0.5 truncate text-[0.8125rem] text-ink-2">
                      <span className="t-data">#{item.ro_number}</span>
                      {" · "}
                      {item.customer_name ?? "Unnamed"}
                    </p>
                  </div>
                  <StatusBadge kind="rating" value={item.overall} />
                </div>

                <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem]">
                  <Count rating="green" label="good" value={item.green} />
                  <Count rating="yellow" label="watch" value={item.yellow} />
                  <Count rating="red" label="urgent" value={item.red} />
                  {item.not_inspected > 0 && (
                    <Count rating="not_inspected" label="not checked" value={item.not_inspected} />
                  )}
                </ul>

                <p className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.75rem] text-ink-3">
                  <span>{item.technician_name ?? "No technician"}</span>
                  <span className="t-data">
                    {item.completed_at
                      ? formatDateTime(item.completed_at, timezone)
                      : `updated ${formatRelative(item.updated_at, timezone)}`}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "5 good", with the rating's dot. The dot is decorative; the words carry it. */
function Count({ rating, label, value }: { rating: Rating; label: string; value: number }) {
  return (
    <li className={`flex items-center gap-1.5 ${value === 0 ? "text-ink-3" : "text-ink"}`}>
      <RatingDot rating={rating} />
      <span className="t-data font-medium">{value}</span> {label}
    </li>
  );
}
