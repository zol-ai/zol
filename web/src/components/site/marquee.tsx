import { pilotShops } from "@/lib/shop-demo";

/**
 * The pilot-shop strip. Two identical halves in one track; the CSS loop
 * travels exactly one half, so the seam never shows. The second half is
 * aria-hidden — a screen reader gets the list once.
 */
function Half({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul
      className="flex items-center gap-10 pr-10 sm:gap-14 sm:pr-14"
      aria-hidden={hidden || undefined}
    >
      {pilotShops.map((s) => (
        <li
          key={s.name}
          className="flex flex-none items-baseline gap-2.5 whitespace-nowrap"
        >
          <span className="t-h3 text-[0.9375rem] text-ink-2">{s.name}</span>
          <span className="t-data text-[0.625rem] uppercase tracking-[0.08em] text-ink-3">
            {s.city}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ShopMarquee() {
  return (
    <div className="marquee py-1">
      <div className="marquee-track">
        <Half />
        <Half hidden />
      </div>
    </div>
  );
}
