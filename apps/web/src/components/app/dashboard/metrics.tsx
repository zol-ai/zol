import {
  Banknote,
  CalendarDays,
  Car,
  FileText,
  KeyRound,
  Package,
  Receipt,
} from "lucide-react";

import { MetricCard } from "@/components/app/ui";
import type { DashboardMetrics } from "@/lib/dashboard";
import { formatCents } from "@/lib/money";

/**
 * The row of numbers the owner reads before coffee. Each one links to the
 * screen where it can be acted on; the tone follows the app's one system —
 * amber where a person is needed, emerald where something is finished.
 */
export function DashboardMetrics({
  metrics,
  month,
}: {
  metrics: DashboardMetrics;
  /** "September" — the month the revenue figure covers. */
  month: string;
}) {
  const average =
    metrics.paidInvoicesMonth > 0
      ? Math.round(metrics.revenueMonthCents / metrics.paidInvoicesMonth)
      : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <MetricCard
        label="Booked today"
        value={metrics.appointmentsToday}
        icon={CalendarDays}
        href="/app/schedule"
      />
      <MetricCard
        label="In the shop"
        value={metrics.openRepairOrders}
        icon={Car}
        tone="blue"
        href="/app/repair-orders"
      />
      <MetricCard
        label="Needs approval"
        value={metrics.needsApproval}
        icon={FileText}
        tone={metrics.needsApproval > 0 ? "person" : "neutral"}
        href="/app/repair-orders?status=awaiting_approval"
      />
      <MetricCard
        label="Waiting on parts"
        value={metrics.awaitingParts}
        icon={Package}
        tone="violet"
        href="/app/parts"
      />
      <MetricCard
        label="Ready for pickup"
        value={metrics.ready}
        icon={KeyRound}
        tone={metrics.ready > 0 ? "zol" : "neutral"}
        href="/app/repair-orders?status=ready"
      />
      <MetricCard
        label="Unpaid invoices"
        value={metrics.unpaidCount}
        detail={metrics.unpaidCount > 0 ? formatCents(metrics.unpaidCents) : undefined}
        icon={Receipt}
        tone={metrics.unpaidCount > 0 ? "person" : "neutral"}
        href="/app/invoices"
      />
      {/* The one figure that can run long — a good month is six digits and
          two decimals — gets the full width of a phone screen. */}
      <div className="col-span-2 md:col-span-1">
        <MetricCard
          label={`Revenue in ${month}`}
          value={formatCents(metrics.revenueMonthCents)}
          detail={average !== null ? `avg ticket ${formatCents(average)}` : "no payments yet"}
          icon={Banknote}
          tone="zol"
          href="/app/payments"
        />
      </div>
    </div>
  );
}
