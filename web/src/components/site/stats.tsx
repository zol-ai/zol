import { shop, stats } from "@/lib/shop-demo";
import { CountUp } from "./count-up";
import { Fig } from "./fig";
import { Reveal } from "./reveal";

/*
 * The morning in numbers, set like instrument readouts: a ruled grid of four
 * cells, each with a counted numeral and a small figure that draws itself in
 * when the band reveals. Emerald appears only where it means "ZOL did this
 * unattended" — the bay blocks and the waiting estimates stay in ink, because
 * they are shop state, not attribution.
 */

/** Six bays, four filled — the blocks land one at a time. */
function BaysFig() {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: shop.bays }, (_, i) => (
        <span
          key={i}
          className={`h-6 flex-1 rounded-[3px] border ${
            i < 4 ? "fig-fill border-ink bg-ink" : "border-line-2"
          }`}
          style={{ "--d": `${200 + i * 110}ms` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** A day rail with three answered calls landing on it. */
function CallsFig() {
  const marks = [
    { left: "12%", label: "9:41p" },
    { left: "46%", label: "6:48p" },
    { left: "78%", label: "7:02a" },
  ];
  return (
    <div aria-hidden="true">
      <div className="relative h-6">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 rounded bg-line-2" />
        {marks.map((m, i) => (
          <span
            key={m.label}
            className="fig-pop absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald ring-4 ring-emerald-wash"
            style={{ left: m.left, "--d": `${260 + i * 140}ms` } as React.CSSProperties}
          />
        ))}
      </div>
      <div className="t-data flex justify-between text-[0.5625rem] text-ink-3">
        <span>close</span>
        <span>open</span>
      </div>
    </div>
  );
}

/** Two estimates sitting with the customer. */
function ApprovalsFig() {
  const waiting = ["$742.18", "$389.40"];
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      {waiting.map((amount, i) => (
        <span
          key={amount}
          className="fig-pop t-data inline-flex items-center gap-1.5 rounded border border-line-2 bg-paper px-2 py-1 text-[0.6875rem] text-ink-2"
          style={{ "--d": `${260 + i * 140}ms` } as React.CSSProperties}
        >
          <span className="dot bg-ink-3" />
          {amount}
        </span>
      ))}
    </div>
  );
}

/** ZOL's reply time against the front desk's, as two bars. */
function ReplyFig() {
  const rows = [
    { label: "ZOL", width: "9%", bar: "bg-emerald", value: "8s" },
    { label: "Front desk", width: "86%", bar: "bg-line-2", value: "when it slows down" },
  ];
  return (
    <div className="grid gap-1.5" aria-hidden="true">
      {rows.map((r, i) => (
        <div key={r.label} className="grid grid-cols-[3.5rem_1fr] items-center gap-2">
          <span className="t-data text-[0.5625rem] uppercase tracking-[0.08em] text-ink-3">
            {r.label}
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`fig-grow h-2 rounded-full ${r.bar}`}
              style={{ width: r.width, "--d": `${260 + i * 160}ms` } as React.CSSProperties}
            />
            <span className="t-data truncate text-[0.5625rem] text-ink-3">
              {r.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

const cells = [
  { n: "01", value: 4, suffix: "", fig: <BaysFig /> },
  { n: "02", value: 3, suffix: "", fig: <CallsFig /> },
  { n: "03", value: 2, suffix: "", fig: <ApprovalsFig /> },
  { n: "04", value: 8, suffix: "s", fig: <ReplyFig /> },
];

export function Stats() {
  return (
    <section className="border-y border-line bg-paper-2">
      <div className="shell band-tight">
        <Reveal>
          {/* gap-px over a line-coloured ground draws the hairline rules. */}
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s, i) => {
              const cell = cells[i];
              return (
                <div key={s.label} className="bg-paper p-5 sm:p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-data text-[0.6875rem] text-ink-3">
                      {cell.n}
                    </span>
                    <dt className="t-eyebrow text-[0.625rem]">{s.label}</dt>
                  </div>
                  <dd className="t-num mt-4 text-[2.75rem] text-ink sm:text-[3.25rem]">
                    <CountUp value={cell.value} suffix={cell.suffix} />
                  </dd>
                  <dd className="mt-1 text-[0.8125rem] text-ink-3">{s.note}</dd>
                  <dd className="mt-5">{cell.fig}</dd>
                </div>
              );
            })}
          </dl>
          <Fig n="02">
            The morning in numbers — same board, illustrative data
          </Fig>
        </Reveal>
      </div>
    </section>
  );
}
