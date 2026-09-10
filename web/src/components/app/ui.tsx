import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatDateTime } from "@/lib/format";
import { initials } from "@/lib/format";
import { badgeFor, type BadgeKind, type Tone } from "@/lib/statuses";

/**
 * The pieces every screen behind sign-in is built from.
 *
 * Deliberately few. A badge, a metric, a card with a heading, an empty state,
 * a timeline, an avatar chip and a notice — and every one of them speaks the
 * app's one colour system: emerald is ZOL acting or a state that's good news,
 * amber is a person needed, everything else is just a different column.
 */

const TONE_TAG: Record<Tone, string> = {
  zol: "tag-zol",
  person: "tag-person",
  neutral: "tag-neutral",
  blue: "tag-blue",
  violet: "tag-violet",
  red: "tag-red",
};

const TONE_WASH: Record<Tone, string> = {
  zol: "wash-zol",
  person: "wash-person",
  neutral: "wash-neutral",
  blue: "wash-blue",
  violet: "wash-violet",
  red: "wash-red",
};

/** A small uppercase mono pill. */
export function Tag({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={`tag ${TONE_TAG[tone]} ${className}`}>{children}</span>;
}

/** The pill for any status the database stores, labelled in shop language. */
export function StatusBadge({
  kind,
  value,
  className = "",
}: {
  kind: BadgeKind;
  value: string | null | undefined;
  className?: string;
}) {
  const badge = badgeFor(kind, value);
  return (
    <Tag tone={badge.tone} className={className}>
      {badge.label}
    </Tag>
  );
}

/** A number the owner glances at. Links through when there's a screen behind it. */
export function MetricCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail?: ReactNode;
  href?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        {Icon ? (
          <span
            aria-hidden="true"
            className={`grid h-9 w-9 flex-none place-items-center rounded-[var(--radius)] ${TONE_WASH[tone]}`}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        ) : (
          <span />
        )}
        {detail && <span className="text-[0.75rem] text-ink-3">{detail}</span>}
      </div>
      <p className="t-num mt-4 text-[1.75rem] text-ink">{value}</p>
      <p className="t-eyebrow mt-1.5">{label}</p>
    </>
  );

  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:bg-paper-2">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

/**
 * A card with a heading row. `flush` drops the body padding for lists and
 * tables that want to run edge to edge.
 */
export function Section({
  title,
  detail,
  action,
  children,
  className = "",
  flush = false,
  id,
}: {
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="t-h3 text-[1rem] text-ink">{title}</h2>
          {detail && <p className="mt-0.5 text-[0.8125rem] text-ink-2">{detail}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  className = "",
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-6 py-10 text-center ${className}`}>
      <p className="text-[0.9375rem] font-semibold text-ink">{title}</p>
      {detail && (
        <p className="mx-auto mt-1 max-w-md text-[0.875rem] leading-relaxed text-ink-2">
          {detail}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A banner: saved, denied, over cap. `role=status` so screen readers hear it. */
export function Notice({
  tone = "neutral",
  children,
  className = "",
  action,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const styles: Record<Tone, string> = {
    zol: "border-emerald-line bg-emerald-wash text-emerald-deep",
    person: "border-amber-line bg-amber-wash text-amber-deep",
    neutral: "border-line bg-paper-3 text-ink-2",
    blue: "border-blue-line bg-blue-wash text-blue-deep",
    violet: "border-violet-line bg-violet-wash text-violet-deep",
    red: "border-red-line bg-red-wash text-red-deep",
  };
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border px-3.5 py-2.5 text-[0.875rem] ${styles[tone]} ${className}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/** Initials in a chip, for people. */
export function Avatar({
  name,
  size = "md",
  tone = "neutral",
}: {
  name: string | null | undefined;
  size?: "sm" | "md" | "lg";
  tone?: Tone;
}) {
  const dims = size === "sm" ? "h-7 w-7 text-[0.6875rem]" : size === "lg" ? "h-12 w-12 text-[1rem]" : "h-9 w-9 text-[0.8125rem]";
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-full font-semibold ${TONE_WASH[tone]} ${dims}`}
    >
      {initials(name)}
    </span>
  );
}

/** The coloured dot an inspection rating is read by at a glance. */
export function RatingDot({
  rating,
  className = "",
}: {
  rating: "green" | "yellow" | "red" | "not_inspected" | string;
  className?: string;
}) {
  const color =
    rating === "green"
      ? "bg-emerald"
      : rating === "yellow"
        ? "bg-amber"
        : rating === "red"
          ? "bg-red-deep"
          : "bg-line-2";
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 flex-none rounded-full ${color} ${className}`}
    />
  );
}

export interface TimelineItem {
  id: string;
  title: ReactNode;
  detail?: ReactNode;
  /** ISO string or Date. */
  at: string | Date;
  actor?: "zol" | "person";
  by?: string | null;
}

/**
 * Events in order, newest first, each attributed. The rail is emerald where
 * ZOL acted and amber where a person did — the page's one system.
 */
export function Timeline({
  items,
  timezone,
  empty = "Nothing has happened yet.",
}: {
  items: TimelineItem[];
  timezone: string;
  empty?: string;
}) {
  if (items.length === 0) {
    return <p className="text-[0.875rem] text-ink-3">{empty}</p>;
  }

  return (
    <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[1.4375rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper ${
              item.actor === "person" ? "bg-amber" : "bg-emerald"
            }`}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-[0.9375rem] font-semibold text-ink">{item.title}</p>
            <p className="t-data text-[0.75rem] text-ink-3">{formatDateTime(item.at, timezone)}</p>
          </div>
          {item.detail && (
            <p className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-2">{item.detail}</p>
          )}
          <p className="mt-1 text-[0.75rem] text-ink-3">
            {item.actor === "person" ? (item.by ?? "Someone at the shop") : "ZOL"}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Label + value pairs, for the details column on a record. */
export function Facts({
  items,
  className = "",
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.875rem] ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-ink-3">{item.label}</dt>
          <dd className="min-w-0 text-right text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
