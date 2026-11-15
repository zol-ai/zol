/**
 * Editorial figure caption, in the style of a service manual: every mockup and
 * chart on the page is numbered and labelled, and the label is also where the
 * "this is illustrative data" honesty lives. One component so the numbering
 * reads as one system across sections.
 */
export function Fig({
  n,
  children,
  className = "",
}: {
  n: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`t-data mt-6 text-[0.5625rem] uppercase tracking-[0.14em] text-ink-3 ${className}`}
    >
      <span className="font-semibold text-ink-2">Fig. {n}</span>
      <span className="mx-1.5">·</span>
      {children}
    </p>
  );
}
