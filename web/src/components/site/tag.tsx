import type { Actor } from "@/lib/shop-demo";

/**
 * The attribution chip. Emerald means ZOL did it unattended; amber means a
 * person took over. This pair carries meaning everywhere it appears on the
 * page, so it must never be used for decoration.
 */
export function Tag({ by, className = "" }: { by: Actor; className?: string }) {
  return (
    <span
      className={`tag ${by === "zol" ? "tag-zol" : "tag-person"} ${className}`}
    >
      <span
        className={`dot ${by === "zol" ? "bg-emerald" : "bg-amber"}`}
        aria-hidden="true"
      />
      {by === "zol" ? "ZOL" : "Person"}
    </span>
  );
}

/** Explains the colour system once, near the top of the page. */
export function AttributionLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${className}`}>
      <span className="inline-flex items-center gap-2 text-[0.8125rem] text-ink-2">
        <span className="dot bg-emerald" aria-hidden="true" />
        <strong className="font-semibold text-ink">Emerald</strong> — ZOL did it
        unattended
      </span>
      <span className="inline-flex items-center gap-2 text-[0.8125rem] text-ink-2">
        <span className="dot bg-amber" aria-hidden="true" />
        <strong className="font-semibold text-ink">Amber</strong> — a person took
        over
      </span>
    </div>
  );
}
