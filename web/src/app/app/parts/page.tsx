import Link from "next/link";

import { PageHead } from "@/components/app/shell";
import { EmptyState, MetricCard, StatusBadge, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { formatCents } from "@/lib/money";
import { PART_STATUS_LABEL, type PartStatus } from "@/lib/statuses";

export const metadata = { title: "Parts" };

/**
 * Every part the shop is waiting on, across every ticket.
 *
 * Grouped by where it is in the chain — needed, requested, ordered — plus
 * what has arrived and is waiting on a tech. Overdue is the vendor's promise
 * having passed with nothing in the door; those rows go red because a late
 * part is a bay that is not earning and a customer who is not being told.
 */

interface PartRow {
  id: string;
  name: string;
  part_number: string | null;
  supplier: string | null;
  quantity: number;
  unit_price_cents: number;
  status: PartStatus;
  expected_at: string | null;
  ordered_at: string | null;
  received_at: string | null;
  overdue: boolean;
  repair_order_id: string;
  ro_number: number;
  ro_status: string;
  customer_name: string | null;
  vehicle: string | null;
  technician_name: string | null;
}

const GROUPS: { status: PartStatus; title: string; detail: string }[] = [
  { status: "needed", title: "Needed", detail: "On a ticket, not yet asked for." },
  { status: "requested", title: "Requested", detail: "Asked for, waiting on a quote or a yes." },
  { status: "ordered", title: "Ordered", detail: "On its way. Overdue when the vendor's date has passed." },
  { status: "received", title: "On the shelf", detail: "Arrived, not yet on the car." },
];

export default async function PartsPage() {
  const user = await requireUser();

  const rows = await query<PartRow>(
    `SELECT p.id, p.name, p.part_number, p.supplier, p.quantity, p.unit_price_cents, p.status,
            p.expected_at::text, p.ordered_at::text, p.received_at::text,
            (p.expected_at IS NOT NULL AND p.expected_at < now()
             AND p.status IN ('needed', 'requested', 'ordered')) AS overdue,
            ro.id AS repair_order_id, ro.number AS ro_number, ro.status AS ro_status,
            c.full_name AS customer_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            t.full_name AS technician_name
       FROM parts p
       JOIN repair_orders ro ON ro.id = p.repair_order_id
       JOIN customers c ON c.id = ro.customer_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN staff t ON t.id = ro.technician_id
      WHERE p.shop_id = $1
        AND p.status IN ('needed', 'requested', 'ordered', 'received')
        AND ro.status NOT IN ('closed', 'cancelled')
      ORDER BY p.expected_at NULLS LAST, p.created_at`,
    [user.shopId],
  );

  const overdue = rows.filter((row) => row.overdue);
  const outstanding = rows.filter((row) => row.status !== "received");
  const ticketsWaiting = new Set(outstanding.map((row) => row.repair_order_id)).size;

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Parts"
        description="Everything on order across the shop, and what has arrived but isn't on a car yet. Parts are added from the ticket."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <MetricCard label="Outstanding" value={outstanding.length} detail={`${ticketsWaiting} ${ticketsWaiting === 1 ? "ticket" : "tickets"} waiting`} />
        <MetricCard
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "red" : "neutral"}
          detail={overdue.length > 0 ? "past the vendor's date" : "nothing late"}
        />
        <MetricCard
          label="On the shelf"
          value={rows.length - outstanding.length}
          detail="received, not installed"
        />
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing on order"
            detail="Parts are added from the ticket they belong to. Once one is ordered it shows up here until it's on the car."
            action={
              <Link href="/app/repair-orders" className="btn btn-ghost btn-sm">
                Repair orders
              </Link>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {GROUPS.map((group) => {
            const items = rows.filter((row) => row.status === group.status);
            if (items.length === 0) return null;
            return (
              <section key={group.status}>
                <h2 className="t-eyebrow mb-0.5">
                  {group.title}
                  <span className="t-data ml-2 text-ink-3">{items.length}</span>
                </h2>
                <p className="mb-2 text-[0.8125rem] text-ink-3">{group.detail}</p>
                <ul className="card divide-y divide-line">
                  {items.map((part) => (
                    <li
                      key={part.id}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${part.overdue ? "bg-red-wash/60" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold text-ink">
                          {part.quantity > 1 && <span className="t-data text-ink-3">{part.quantity} ×</span>}
                          {part.name}
                          {part.overdue && <Tag tone="red">Overdue</Tag>}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.8125rem] text-ink-2">
                          <Link
                            href={`/app/repair-orders/${part.repair_order_id}#parts`}
                            className="font-semibold underline-offset-2 hover:underline"
                          >
                            <span className="t-data">#{part.ro_number}</span> {part.customer_name ?? "Unnamed"}
                          </Link>
                          {part.vehicle && <span>{part.vehicle}</span>}
                          {part.technician_name && <span className="text-ink-3">{part.technician_name}</span>}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.75rem] text-ink-3">
                          {part.supplier && <span>{part.supplier}</span>}
                          {part.part_number && <span className="t-data">{part.part_number}</span>}
                          {part.expected_at && part.status !== "received" && (
                            <span className={part.overdue ? "font-semibold text-red-deep" : ""}>
                              Expected {formatDateTime(part.expected_at, user.timezone)}
                            </span>
                          )}
                          {part.received_at && <span>Received {formatDateTime(part.received_at, user.timezone)}</span>}
                        </p>
                      </div>
                      <StatusBadge kind="ro" value={part.ro_status} />
                      <span className="t-data w-24 text-right text-[0.9375rem] text-ink">
                        {formatCents(part.unit_price_cents * part.quantity)}
                      </span>
                      <span className="sr-only">{PART_STATUS_LABEL[part.status]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
