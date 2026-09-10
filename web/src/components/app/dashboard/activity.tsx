import Link from "next/link";

import { EmptyState, Section } from "@/components/app/ui";
import type { ActivityItem } from "@/lib/dashboard";
import { formatRelative } from "@/lib/format";
import { humanize } from "@/lib/statuses";

/**
 * The last ten things that happened to any ticket, newest first, each one
 * attributed. The dot is the page's one colour system: emerald where ZOL
 * did it unattended, amber where a person pressed the button.
 */
export function RecentActivity({
  items,
  timezone,
}: {
  items: ActivityItem[];
  timezone: string;
}) {
  return (
    <Section title="Recent activity" detail="Across every ticket" flush>
      {items.length === 0 ? (
        <EmptyState
          title="Quiet so far"
          detail="Status changes, estimates, parts and payments show up here as they happen."
        />
      ) : (
        <ol className="divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
              <span
                aria-hidden="true"
                className={`mt-2 h-2 w-2 flex-none rounded-full ${
                  item.actor === "person" ? "bg-amber" : "bg-emerald"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.875rem] text-ink">
                  <Link
                    href={`/app/repair-orders/${item.repair_order_id}`}
                    className="t-data mr-1.5 text-[0.8125rem] text-ink-2 underline-offset-2 hover:underline"
                  >
                    #{item.ro_number}
                  </Link>
                  {item.detail ?? humanize(item.kind)}
                </span>
                <span className="block text-[0.75rem] text-ink-3">
                  {item.actor === "person" ? (item.staff_name ?? "Someone at the shop") : "ZOL"}
                  {" · "}
                  {formatRelative(item.created_at, timezone)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
