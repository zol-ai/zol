import { Reveal } from "./reveal";

/**
 * Shared section opener. The numbers are real structure — the page walks a
 * shop owner from one job, to the record behind it, to the software, to what
 * changes on their existing stack — so the sequence carries information.
 */
export function SectionHead({
  n,
  label,
  title,
  lede,
  className = "",
}: {
  n: string;
  label: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={`max-w-2xl ${className}`}>
      <p className="t-eyebrow">
        <span className="t-data text-ink-2">{n}</span>
        <span className="mx-2 text-line-2">·</span>
        {label}
      </p>
      <h2 className="t-h2 mt-4 text-[1.875rem] sm:text-[2.5rem] lg:text-[2.875rem]">
        {title}
      </h2>
      {lede && <p className="t-lede mt-5">{lede}</p>}
    </Reveal>
  );
}
