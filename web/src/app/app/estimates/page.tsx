import Link from "next/link";
import { FileText, Hourglass, PhoneCall } from "lucide-react";

import { PageHead } from "@/components/app/shell";
import { EmptyState, MetricCard, StatusBadge } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { EstimateStatus } from "@/lib/statuses";

export const metadata = { title: "Estimates" };

/**
 * Every estimate the shop has sent, with the ones that need a person on top.
 *
 * The number that matters here is not "how many estimates" but "how much
 * work is sitting on a customer's phone unanswered". An estimate that was
 * opened and not answered is the amber row: the customer has seen the price
 * and gone quiet, and a call from the advisor closes most of those.
 */

type Filter = "attention" | "open" | "draft" | "answered" | "expired" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "attention", label: "Needs a call" },
  { key: "open", label: "Out with customers" },
  { key: "draft", label: "Drafts" },
  { key: "answered", label: "Answered" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
];

interface Row {
  id: string;
  number: number;
  status: EstimateStatus;
  total_cents: number;
  approved_cents: number;
  line_count: number;
  approved_count: number;
  declined_count: number;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  expires_at: string | null;
  created_at: string;
  repair_order_id: string;
  ro_number: number;
  customer_id: string;
  customer_name: string | null;
  vehicle: string | null;
  expired: boolean;
}

export default async function EstimatesPage(props: PageProps<"/app/estimates">) {
  const user = await requireUser();
  const params = await props.searchParams;
  // A number or a name from search. With one, "all" is the sensible default —
  // somebody looking for #2041 doesn't care which tab it would be under.
  const q = typeof params.q === "string" ? params.q.trim().replace(/^#/, "").slice(0, 60) : "";
  const filter: Filter = FILTERS.some((f) => f.key === params.status)
    ? (params.status as Filter)
    : q
      ? "all"
      : "attention";

  const rows = await query<Row>(
    `SELECT e.id, e.number, e.status, e.total_cents,
            coalesce((SELECT sum(l.total_cents) FROM estimate_lines l
                       WHERE l.estimate_id = e.id AND l.approval = 'approved'), 0)::int AS approved_cents,
            (SELECT count(*) FROM estimate_lines l WHERE l.estimate_id = e.id)::int AS line_count,
            (SELECT count(*) FROM estimate_lines l WHERE l.estimate_id = e.id AND l.approval = 'approved')::int AS approved_count,
            (SELECT count(*) FROM estimate_lines l WHERE l.estimate_id = e.id AND l.approval = 'declined')::int AS declined_count,
            e.sent_at::text, e.viewed_at::text, e.responded_at::text, e.expires_at::text, e.created_at::text,
            e.repair_order_id, ro.number AS ro_number,
            e.customer_id, c.full_name AS customer_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            (e.status IN ('sent', 'viewed') AND e.expires_at < now()) AS expired
       FROM estimates e
       JOIN repair_orders ro ON ro.id = e.repair_order_id
       JOIN customers c ON c.id = e.customer_id
       LEFT JOIN vehicles v ON v.id = e.vehicle_id
      WHERE e.shop_id = $1
        AND ($2 = ''
             OR e.number::text LIKE $2 || '%'
             OR ro.number::text = $2
             OR c.full_name ILIKE '%' || $2 || '%')
      ORDER BY e.created_at DESC
      LIMIT 300`,
    [user.shopId, q],
  );

  const isOpen = (row: Row) => (row.status === "sent" || row.status === "viewed") && !row.expired;
  const needsCall = (row: Row) => isOpen(row) && Boolean(row.viewed_at);
  const answered = (row: Row) => ["approved", "partial", "declined"].includes(row.status);

  const shown = rows.filter((row) => {
    switch (filter) {
      case "attention":
        return needsCall(row);
      case "open":
        return isOpen(row);
      case "draft":
        return row.status === "draft";
      case "answered":
        return answered(row);
      case "expired":
        return row.status === "expired" || row.expired;
      default:
        return true;
    }
  });

  const open = rows.filter(isOpen);
  const openCents = open.reduce((sum, row) => sum + row.total_cents, 0);
  const calls = rows.filter(needsCall);
  const answeredRows = rows.filter(answered);
  const approvedCents = answeredRows.reduce((sum, row) => sum + row.approved_cents, 0);
  const quotedCents = answeredRows.reduce((sum, row) => sum + row.total_cents, 0);

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Estimates"
        description="What's been quoted, who has opened it, and who has gone quiet."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard
          label="Out with customers"
          value={open.length}
          detail={formatCents(openCents)}
          icon={Hourglass}
          tone="blue"
          href="/app/estimates?status=open"
        />
        <MetricCard
          label="Opened, no answer"
          value={calls.length}
          detail="worth a call"
          icon={PhoneCall}
          tone={calls.length > 0 ? "person" : "neutral"}
          href="/app/estimates?status=attention"
        />
        <MetricCard
          label="Approval rate"
          value={quotedCents > 0 ? `${Math.round((approvedCents / quotedCents) * 100)}%` : "—"}
          detail={quotedCents > 0 ? `${formatCents(approvedCents)} of ${formatCents(quotedCents)} quoted` : "no answers yet"}
          icon={FileText}
          tone="zol"
        />
      </div>

      <nav aria-label="Filter" className="swipe-x mb-4 flex gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "attention" ? "/app/estimates" : `/app/estimates?status=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={`btn btn-sm flex-none ${filter === f.key ? "btn-primary" : "btn-ghost"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {q && (
        <p className="mb-3 text-[0.875rem] text-ink-2">
          Showing estimates matching <span className="font-semibold text-ink">“{q}”</span>.{" "}
          <Link href="/app/estimates" className="font-semibold text-emerald-deep underline-offset-2 hover:underline">
            Clear
          </Link>
        </p>
      )}

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState
            title={q ? `Nothing matches “${q}”` : filter === "attention" ? "Nobody has gone quiet" : "Nothing here"}
            detail={
              filter === "attention"
                ? "Every estimate that's been opened has been answered. Check back after the next one goes out."
                : rows.length === 0
                  ? "Estimates are created from a ticket — put the work on as lines, then Create estimate."
                  : "Try another filter."
            }
          />
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {shown.map((row) => {
            const call = needsCall(row);
            const expired = row.status === "expired" || row.expired;
            return (
              <li key={row.id} className={call ? "bg-amber-wash/60" : ""}>
                <Link
                  href={`/app/repair-orders/${row.repair_order_id}#estimates`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-4 transition-colors hover:bg-paper-2"
                >
                  <span className="t-data w-16 text-[0.8125rem] text-ink-3">#{row.number}</span>
                  <span className="min-w-0 flex-1 basis-40">
                    <span className="block truncate text-[0.9375rem] font-semibold text-ink">
                      {row.customer_name ?? "Unnamed"}
                    </span>
                    <span className="block truncate text-[0.8125rem] text-ink-2">
                      {row.vehicle ?? "No vehicle"} · ticket #{row.ro_number}
                    </span>
                  </span>
                  <StatusBadge kind="estimate" value={expired ? "expired" : row.status} />
                  <span className="hidden w-52 text-[0.8125rem] text-ink-3 md:block">
                    {row.status === "draft"
                      ? `Drafted ${formatRelative(row.created_at, user.timezone)}`
                      : row.responded_at
                        ? `Answered ${formatRelative(row.responded_at, user.timezone)}${row.declined_count > 0 ? ` · ${row.approved_count} of ${row.line_count} lines` : ""}`
                        : row.viewed_at
                          ? `Opened ${formatRelative(row.viewed_at, user.timezone)}, no answer`
                          : row.sent_at
                            ? `Sent ${formatDateTime(row.sent_at, user.timezone)}, not opened`
                            : ""}
                  </span>
                  <span className="t-data w-24 text-right text-[0.9375rem] text-ink">
                    {answered(row) && row.approved_cents !== row.total_cents
                      ? formatCents(row.approved_cents)
                      : formatCents(row.total_cents)}
                  </span>
                  {call && (
                    <span className="w-full text-[0.8125rem] text-amber-deep md:hidden">
                      Opened {formatRelative(row.viewed_at!, user.timezone)} and not answered — worth a call.
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
