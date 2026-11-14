import Link from "next/link";
import {
  Clock,
  FileText,
  HeartHandshake,
  MessageSquare,
  Package,
  type LucideIcon,
} from "lucide-react";

import { EmptyState, Section } from "@/components/app/ui";
import type { AttentionItem, AttentionKind } from "@/lib/dashboard";
import { formatRelative } from "@/lib/format";

/**
 * What is waiting on a person. Oldest first, because the thing that has
 * been sitting longest is the thing costing the most — an estimate nobody
 * answered is a bay that stays full, a text nobody read is a customer
 * deciding to go elsewhere. Every row is amber: it is, by definition, a
 * place where ZOL has done what it can and a human has to pick it up.
 */

const ICON: Record<AttentionKind, LucideIcon> = {
  estimate: FileText,
  part: Package,
  ticket: Clock,
  message: MessageSquare,
  follow_up: HeartHandshake,
};

/** What the timestamp on each row means. */
const WHEN: Record<AttentionKind, string> = {
  estimate: "sent",
  part: "expected",
  ticket: "opened",
  message: "received",
  follow_up: "due",
};

export function AttentionList({
  items,
  timezone,
}: {
  items: AttentionItem[];
  timezone: string;
}) {
  return (
    <Section
      title="Needs attention"
      detail={
        items.length === 0
          ? "Nothing is waiting on a person."
          : `${items.length} thing${items.length === 1 ? "" : "s"} waiting on a person`
      }
      flush
    >
      {items.length === 0 ? (
        <EmptyState
          title="All clear"
          detail="Unanswered estimates, late parts, tickets stuck in diagnosis, unread texts and follow-ups that are due all land here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const Icon = ICON[item.kind];
            return (
              <li key={`${item.kind}-${item.id}`}>
                <Link
                  href={item.href}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-paper-2 sm:px-5"
                >
                  <span
                    aria-hidden="true"
                    className="wash-person mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-[var(--radius)]"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-semibold text-ink">
                      {item.title}
                    </span>
                    {item.detail && (
                      <span className="block truncate text-[0.8125rem] text-ink-2">
                        {item.detail}
                      </span>
                    )}
                  </span>
                  <span className="t-data flex-none text-[0.75rem] text-ink-3">
                    {WHEN[item.kind]} {formatRelative(item.at, timezone)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
