import Link from "next/link";
import { CalendarDays, CreditCard, Sun } from "lucide-react";

import { PaymentItem, ProviderTag } from "@/components/app/ro/invoice-panel";
import { PageHead } from "@/components/app/shell";
import { EmptyState, MetricCard, Notice, StatusBadge, Tag } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import type { PaymentRow } from "@/lib/invoices";
import { formatCents } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/statuses";

export const metadata = { title: "Payments" };

/**
 * Money in, newest first.
 *
 * Every row says how it arrived — cash at the counter, Stripe, or the
 * labelled demo — because "how much did we take today" and "how much of
 * that is real" are different questions until a processor is connected, and
 * the notice at the top says which mode the shop is in.
 */

interface Row extends PaymentRow {
  invoice_id: string;
  invoice_number: number;
  repair_order_id: string;
  ro_number: number;
  customer_id: string;
  customer_name: string | null;
  vehicle: string | null;
}

export default async function PaymentsPage() {
  const user = await requireUser();

  const [rows, totals] = await Promise.all([
    query<Row>(
      `SELECT p.id, p.amount_cents, p.method, p.provider, p.provider_ref, p.status, p.note,
              s.full_name AS recorded_by_name, p.processed_at::text, p.created_at::text,
              i.id AS invoice_id, i.number AS invoice_number,
              i.repair_order_id, ro.number AS ro_number,
              i.customer_id, c.full_name AS customer_name,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         JOIN repair_orders ro ON ro.id = i.repair_order_id
         JOIN customers c ON c.id = i.customer_id
         LEFT JOIN vehicles v ON v.id = i.vehicle_id
         LEFT JOIN staff s ON s.id = p.recorded_by
        WHERE p.shop_id = $1
        ORDER BY coalesce(p.processed_at, p.created_at) DESC
        LIMIT 300`,
      [user.shopId],
    ),
    // Today and this month by the shop's clock. Demo rows are counted
    // separately so the headline number is money that actually moved.
    query<{
      today_cents: number;
      today_count: number;
      month_cents: number;
      month_count: number;
      month_demo_cents: number;
    }>(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE provider <> 'demo' AND is_today), 0)::int AS today_cents,
              count(*) FILTER (WHERE provider <> 'demo' AND is_today)::int AS today_count,
              coalesce(sum(amount_cents) FILTER (WHERE provider <> 'demo'), 0)::int AS month_cents,
              count(*) FILTER (WHERE provider <> 'demo')::int AS month_count,
              coalesce(sum(amount_cents) FILTER (WHERE provider = 'demo'), 0)::int AS month_demo_cents
         FROM (
           SELECT amount_cents, provider,
                  (coalesce(processed_at, created_at) AT TIME ZONE $2)::date
                    = (now() AT TIME ZONE $2)::date AS is_today
             FROM payments
            WHERE shop_id = $1 AND status = 'succeeded'
              AND date_trunc('month', coalesce(processed_at, created_at) AT TIME ZONE $2)
                = date_trunc('month', now() AT TIME ZONE $2)
         ) p`,
      [user.shopId, user.timezone],
    ),
  ]);

  const t = totals[0];

  // Group the list by day so a busy Saturday reads as one block.
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: user.timezone,
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(row.processed_at ?? row.created_at));
    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Payments"
        description="Every payment recorded, however it arrived."
      />

      <Notice tone={env.stripe.configured ? "zol" : "person"} className="mb-6">
        {env.stripe.configured ? (
          <>
            <strong>Card payments are live.</strong> Customers pay from their repair page through Stripe; the
            webhook records the charge and closes the ticket.
          </>
        ) : (
          <>
            <strong>No card processor is connected.</strong> The customer&apos;s Pay button records a clearly
            labelled demo payment and nothing is charged. Cash, cheque and terminal payments are recorded
            from the ticket as usual. Add a Stripe key to switch the portal to real card payments.
          </>
        )}
      </Notice>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard
          label="Taken today"
          value={formatCents(t?.today_cents ?? 0)}
          detail={`${t?.today_count ?? 0} payment${(t?.today_count ?? 0) === 1 ? "" : "s"}`}
          icon={Sun}
          tone="zol"
        />
        <MetricCard
          label="This month"
          value={formatCents(t?.month_cents ?? 0)}
          detail={`${t?.month_count ?? 0} payment${(t?.month_count ?? 0) === 1 ? "" : "s"}`}
          icon={CalendarDays}
          tone="neutral"
        />
        <MetricCard
          label="Demo this month"
          value={formatCents(t?.month_demo_cents ?? 0)}
          detail="not real money"
          icon={CreditCard}
          tone="person"
        />
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No payments yet"
            detail="Payments appear here when an invoice is paid — from the customer's repair page, or recorded at the counter from the ticket."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...byDay.entries()].map(([day, items]) => {
            const dayReal = items
              .filter((row) => row.provider !== "demo" && row.status === "succeeded")
              .reduce((sum, row) => sum + row.amount_cents, 0);
            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                  <h2 className="t-eyebrow">{day}</h2>
                  <span className="t-data text-[0.8125rem] text-ink-2">{formatCents(dayReal)}</span>
                </div>

                <ul className="card divide-y divide-line md:hidden">
                  {items.map((row) => (
                    <li key={row.id} className="p-4">
                      <Link href={`/app/repair-orders/${row.repair_order_id}#invoice`} className="block">
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-[0.9375rem] font-semibold text-ink">{row.customer_name ?? "Unnamed"}</span>
                          <span className="t-data text-[0.9375rem] font-semibold text-ink">{formatCents(row.amount_cents)}</span>
                        </span>
                        <span className="mt-0.5 block text-[0.8125rem] text-ink-2">
                          {row.vehicle ?? "No vehicle"} · invoice #{row.invoice_number}
                        </span>
                      </Link>
                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Tag tone="neutral">{PAYMENT_METHOD_LABEL[row.method]}</Tag>
                        <ProviderTag provider={row.provider} />
                        <StatusBadge kind="payment" value={row.status} />
                        <span className="ml-auto text-[0.75rem] text-ink-3">
                          {formatDateTime(row.processed_at ?? row.created_at, user.timezone)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="card hidden divide-y divide-line px-4 md:block">
                  {items.map((row) => (
                    <div key={row.id} className="flex items-center gap-4">
                      <Link
                        href={`/app/repair-orders/${row.repair_order_id}#invoice`}
                        className="w-56 flex-none py-2.5 text-[0.875rem] hover:underline"
                      >
                        <span className="block truncate font-semibold text-ink">{row.customer_name ?? "Unnamed"}</span>
                        <span className="block truncate text-[0.8125rem] text-ink-3">
                          {row.vehicle ?? "No vehicle"} · #{row.invoice_number}
                        </span>
                      </Link>
                      <div className="min-w-0 flex-1">
                        <ul>
                          <PaymentItem payment={row} timezone={user.timezone} />
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
