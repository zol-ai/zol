import { board, shop } from "@/lib/shop-demo";
import { Tag } from "./tag";

const states = ["In bay", "Waiting on customer", "Waiting on parts", "Ready"] as const;

const stateTone: Record<string, string> = {
  "In bay": "text-ink",
  "Waiting on customer": "text-amber-deep",
  "Waiting on parts": "text-amber-deep",
  Ready: "text-emerald-deep",
};

/**
 * The shop board: every open repair order, the bay it's in, who it's waiting
 * on, and — the point of the page — which of those moves ZOL made on its own.
 *
 * Renders as a table on wide screens and as stacked records on narrow ones,
 * rather than a table that has to be scrolled sideways on a phone.
 */
export function Board() {
  return (
    <div className="screen">
      {/* Window bar */}
      <div className="flex items-center gap-3 border-b border-line bg-paper-2 px-4 py-3">
        <div>
          <div className="text-[0.875rem] font-semibold leading-tight text-ink">
            {shop.name}
          </div>
          <div className="t-data text-[0.625rem] uppercase tracking-wider text-ink-3">
            {shop.location} · {shop.bays} bays
          </div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-line bg-emerald-wash px-2 py-1">
          <span className="dot dot-live" aria-hidden="true" />
          <span className="t-data text-[0.5625rem] font-semibold uppercase tracking-wider text-emerald-deep">
            Live
          </span>
        </span>
      </div>

      {/* Counts */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
        <span className="t-data text-[0.6875rem] uppercase tracking-wider text-ink">
          All <span className="font-semibold">{board.length}</span>
        </span>
        {states.map((s) => {
          const n = board.filter((r) => r.state === s).length;
          return (
            <span
              key={s}
              className="t-data text-[0.6875rem] uppercase tracking-wider text-ink-3"
            >
              {s} <span className="font-semibold text-ink-2">{n}</span>
            </span>
          );
        })}
      </div>

      {/* Wide: table */}
      <table className="hidden w-full border-collapse sm:table">
        <thead>
          <tr className="t-data text-[0.5625rem] uppercase tracking-[0.14em] text-ink-3">
            <th className="border-b border-line px-4 py-2 text-left font-medium">RO</th>
            <th className="border-b border-line px-4 py-2 text-left font-medium">Vehicle</th>
            <th className="border-b border-line px-4 py-2 text-left font-medium">Job</th>
            <th className="border-b border-line px-4 py-2 text-left font-medium">
              Last move
            </th>
          </tr>
        </thead>
        <tbody>
          {board.map((r) => (
            <tr key={r.ro} className="border-b border-line last:border-0">
              <td className="px-4 py-3 align-top">
                <span className="t-data text-[0.75rem] font-semibold text-ink">
                  {r.ro}
                </span>
                <span
                  className={`t-data mt-0.5 block text-[0.625rem] ${stateTone[r.state]}`}
                >
                  {r.state}
                </span>
              </td>
              <td className="px-4 py-3 align-top">
                <span className="block text-[0.8125rem] font-medium text-ink">
                  {r.vehicle}
                </span>
                <span className="t-data block text-[0.625rem] text-ink-3">
                  {r.plate}
                </span>
              </td>
              <td className="px-4 py-3 align-top text-[0.8125rem] text-ink-2">
                {r.job}
              </td>
              <td className="px-4 py-3 align-top">
                <span className="block text-[0.8125rem] text-ink-2">{r.event}</span>
                <Tag by={r.by} className="mt-1.5" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Narrow: stacked records */}
      <ul className="sm:hidden">
        {board.map((r) => (
          <li key={r.ro} className="border-b border-line px-4 py-3 last:border-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="t-data text-[0.75rem] font-semibold text-ink">
                {r.ro}
              </span>
              <span className={`t-data text-[0.625rem] ${stateTone[r.state]}`}>
                {r.state}
              </span>
            </div>
            <div className="mt-1 text-[0.8125rem] font-medium text-ink">
              {r.vehicle}
            </div>
            <div className="text-[0.8125rem] text-ink-2">{r.job}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Tag by={r.by} />
              <span className="text-[0.75rem] text-ink-3">{r.event}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
