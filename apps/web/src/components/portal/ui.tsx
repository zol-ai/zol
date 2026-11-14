import type { ReactNode } from "react";

/**
 * The few pieces a repair page is built from. Same tokens as the app, larger
 * type and more air: this is read on a phone by somebody who has never seen
 * the product and never will again.
 */

export function PortalCard({
  title,
  eyebrow,
  children,
  id,
  className = "",
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`card p-4 sm:p-5 ${className}`}>
      {(eyebrow || title) && (
        <header className="mb-3">
          {eyebrow && <p className="t-eyebrow">{eyebrow}</p>}
          {title && <h2 className="t-h3 mt-0.5 text-[1.125rem] text-ink">{title}</h2>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A label/amount line in a totals block. */
export function MoneyRow({
  label,
  value,
  strong = false,
  tone,
}: {
  label: ReactNode;
  value: string;
  strong?: boolean;
  tone?: "person" | "zol";
}) {
  const color = tone === "person" ? "text-amber-deep" : tone === "zol" ? "text-emerald-deep" : "text-ink";
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        strong ? "border-t border-line pt-2 text-[1rem] font-semibold" : "text-[0.9375rem] text-ink-2"
      }`}
    >
      <dt className={strong ? "text-ink" : ""}>{label}</dt>
      <dd className={`t-data ${strong ? color : "text-ink"}`}>{value}</dd>
    </div>
  );
}

/** A banner on the customer's page: answered, paid, message sent. */
export function PortalNotice({
  tone = "zol",
  children,
}: {
  tone?: "zol" | "person" | "neutral" | "red";
  children: ReactNode;
}) {
  const styles = {
    zol: "border-emerald-line bg-emerald-wash text-emerald-deep",
    person: "border-amber-line bg-amber-wash text-amber-deep",
    neutral: "border-line bg-paper-3 text-ink-2",
    red: "border-red-line bg-red-wash text-red-deep",
  }[tone];
  return (
    <div role="status" className={`rounded-[var(--radius)] border px-4 py-3 text-[0.9375rem] leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}
