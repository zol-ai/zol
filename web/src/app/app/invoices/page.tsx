import Link from "next/link";
import { CircleDollarSign, Receipt } from "lucide-react";

import { PageHead } from "@/components/app/shell";
import { EmptyState, MetricCard, StatusBadge } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { invoiceBalanceCents } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import type { InvoiceStatus } from "@/lib/statuses";

export const metadata = { title: "Invoices" };

/**
 * Every invoice, with the money still owed on top.
 *
 * Age is days since the invoice was written, not since it was due: an owner
 * scanning this list wants "how long has that car been paid for or not", and
 * a seven-day due date is a convention, not a deadline anyone enforces.
 */

type Filter = "unpaid" | "paid" | "all";

interface Row {
  id: string;
  number: number;
  status: InvoiceStatus;
  total_cents: number;
  paid_cents: number;
  created_at: string;
  paid_at: string | null;
  age_days: number;
  repair_order_id: string;
  ro_number: number;
  customer_id: string;
  customer_name: string | null;
  vehicle: string | null;
}

export default async function InvoicesPage(props: PageProps<"/app/invoices">) {
  const user = await requireUser();
  const params = await props.searchParams;
  // A number or a name from search. With one, "all" is the default — the
  // person is looking for a particular invoice, paid or not.
  const q = typeof params.q === "string" ? params.q.trim().replace(/^#/, "").slice(0, 60) : "";
  const filter: Filter =
    params.filter === "paid" || params.filter === "all" ? params.filter : q ? "all" : "unpaid";

  const [rows, month] = await Promise.all([
    query<Row>(
      `SELECT i.id, i.number, i.status, i.total_cents, i.paid_cents,
              i.created_at::text, i.paid_at::text,
              floor(extract(epoch FROM (now() - i.created_at)) / 86400)::int AS age_days,
              i.repair_order_id, ro.number AS ro_number,
              i.customer_id, c.full_name AS customer_name,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
         FROM invoices i
         JOIN repair_orders ro ON ro.id = i.repair_order_id
         JOIN customers c ON c.id = i.customer_id
         LEFT JOIN vehicles v ON v.id = i.vehicle_id
        WHERE i.shop_id = $1
          AND CASE $2
                WHEN 'unpaid' THEN i.status IN ('open', 'partial')
                WHEN 'paid' THEN i.status = 'paid'
                ELSE true
              END
          AND ($3 = ''
               OR i.number::text LIKE $3 || '%'
               OR ro.number::text = $3
               OR c.full_name ILIKE '%' || $3 || '%')
        ORDER BY CASE WHEN i.status IN ('open', 'partial') THEN 0 ELSE 1 END, i.created_at DESC
        LIMIT 300`,
      [user.shopId, filter, q],
    ),
    // This month in the shop's zone, not the server's.
    query<{ paid_cents: number; count: number }>(
      `SELECT coalesce(sum(i.paid_cents), 0)::int AS paid_cents, count(*)::int AS count
         FROM invoices i
        WHERE i.shop_id = $1 AND i.status = 'paid'
          AND date_trunc('month', i.paid_at AT TIME ZONE $2)
            = date_trunc('month', now() AT TIME ZONE $2)`,
      [user.shopId, user.timezone],
    ),
  ]);

  const outstanding = await query<{ balance_cents: number; count: number }>(
    `SELECT coalesce(sum(total_cents - paid_cents), 0)::int AS balance_cents, count(*)::int AS count
       FROM invoices WHERE shop_id = $1 AND status IN ('open', 'partial')`,
    [user.shopId],
  );

  const totalCents = rows.reduce((sum, row) => sum + row.total_cents, 0);
  const balanceCents = rows.reduce((sum, row) => sum + invoiceBalanceCents(row), 0);

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Invoices"
        description="What's been billed, what's been paid, and what's still owed."
      />

      <div className="mb-6 grid grid-cols-2 gap-3">
        <MetricCard
          label="Outstanding"
          value={formatCents(outstanding[0]?.balance_cents ?? 0)}
          detail={`${outstanding[0]?.count ?? 0} unpaid`}
          icon={Receipt}
          tone={(outstanding[0]?.count ?? 0) > 0 ? "person" : "neutral"}
          href="/app/invoices"
        />
        <MetricCard
          label="Collected this month"
          value={formatCents(month[0]?.paid_cents ?? 0)}
          detail={`${month[0]?.count ?? 0} paid`}
          icon={CircleDollarSign}
          tone="zol"
          href="/app/invoices?filter=paid"
        />
      </div>

      <nav aria-label="Filter" className="mb-4 flex gap-1.5">
        {(
          [
            ["unpaid", "Unpaid"],
            ["paid", "Paid"],
            ["all", "All"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "unpaid" ? "/app/invoices" : `/app/invoices?filter=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {q && (
        <p className="mb-3 text-[0.875rem] text-ink-2">
          Showing invoices matching <span className="font-semibold text-ink">“{q}”</span>.{" "}
          <Link href="/app/invoices" className="font-semibold text-emerald-deep underline-offset-2 hover:underline">
            Clear
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title={q ? `Nothing matches “${q}”` : filter === "unpaid" ? "Nothing owed" : "No invoices"}
            detail={
              filter === "unpaid"
                ? "Every invoice is settled. New ones are created from a ticket once the work is approved."
                : "Invoices are created from a ticket's approved lines."
            }
          />
        </div>
      ) : (
        <>
          {/* Stacked on a phone; a table where there is room for seven columns. */}
          <ul className="card divide-y divide-line md:hidden">
            {rows.map((row) => {
              const balance = invoiceBalanceCents(row);
              return (
                <li key={row.id}>
                  <Link href={`/app/repair-orders/${row.repair_order_id}#invoice`} className="flex flex-col gap-1 p-4">
                    <span className="flex items-center justify-between gap-3">
                      <span className="t-data text-[0.8125rem] text-ink-3">#{row.number} · ticket #{row.ro_number}</span>
                      <StatusBadge kind="invoice" value={row.status} />
                    </span>
                    <span className="text-[0.9375rem] font-semibold text-ink">{row.customer_name ?? "Unnamed"}</span>
                    <span className="text-[0.8125rem] text-ink-2">{row.vehicle ?? "No vehicle"}</span>
                    <span className="flex items-baseline justify-between text-[0.875rem]">
                      <span className="text-ink-3">{ageLabel(row.age_days)}</span>
                      <span className="t-data text-ink">
                        {formatCents(row.total_cents)}
                        {balance > 0 && balance !== row.total_cents && (
                          <span className="text-amber-deep"> · {formatCents(balance)} due</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Balance</th>
                  <th className="text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const balance = invoiceBalanceCents(row);
                  return (
                    <tr key={row.id}>
                      <td className="t-data text-ink-3">
                        <Link href={`/app/repair-orders/${row.repair_order_id}#invoice`} className="text-ink underline-offset-2 hover:underline">
                          #{row.number}
                        </Link>
                      </td>
                      <td>
                        <Link href={`/app/customers/${row.customer_id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                          {row.customer_name ?? "Unnamed"}
                        </Link>
                      </td>
                      <td className="text-ink-2">{row.vehicle ?? "—"}</td>
                      <td className="t-data text-ink-2">
                        <Link href={`/app/repair-orders/${row.repair_order_id}`} className="underline-offset-2 hover:underline">
                          #{row.ro_number}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge kind="invoice" value={row.status} />
                      </td>
                      <td className="t-data text-right text-ink">{formatCents(row.total_cents)}</td>
                      <td className={`t-data text-right ${balance > 0 ? "text-amber-deep" : "text-ink-3"}`}>
                        {balance > 0 ? formatCents(balance) : "—"}
                      </td>
                      <td className="text-right text-ink-3" title={formatDate(row.created_at, user.timezone)}>
                        {ageLabel(row.age_days)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-paper-2 font-semibold">
                  <td colSpan={5} className="text-ink">
                    {rows.length} invoice{rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="t-data text-right text-ink">{formatCents(totalCents)}</td>
                  <td className={`t-data text-right ${balanceCents > 0 ? "text-amber-deep" : "text-ink-3"}`}>
                    {balanceCents > 0 ? formatCents(balanceCents) : "—"}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function ageLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
