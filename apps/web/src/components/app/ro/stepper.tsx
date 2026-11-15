import { Check } from "lucide-react";

import { RO_PIPELINE, RO_STATUS_LABEL, type RoStatus } from "@/lib/statuses";

/**
 * Where the ticket is on the line.
 *
 * Eight stops from open to closed, in the order work moves through a shop.
 * Past stops are ticked, the current one is emerald, the rest wait. A
 * cancelled ticket is off the line — it says so rather than pretending to be
 * somewhere on it.
 *
 * On a phone only the current stop is named; the rest are dots. Eight labels
 * do not fit across 360px and a stepper you scroll sideways is one you stop
 * reading.
 */
export function Stepper({ status }: { status: RoStatus }) {
  if (status === "cancelled") {
    return (
      <p className="t-eyebrow text-red-deep">Cancelled — off the line</p>
    );
  }

  const current = RO_PIPELINE.indexOf(status);

  return (
    <ol aria-label="Progress" className="flex items-start gap-1 sm:gap-2">
      {RO_PIPELINE.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? "step" : undefined}
            className={`flex min-w-0 items-start gap-1.5 ${active ? "flex-[2] sm:flex-1" : "flex-1"}`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={`h-1.5 w-full rounded-full ${
                  done ? "bg-emerald" : active ? "bg-emerald-deep" : "bg-line"
                }`}
              />
              <span
                className={`flex items-center gap-1 truncate text-[0.6875rem] font-semibold uppercase tracking-[0.06em] ${
                  active ? "text-emerald-deep" : done ? "text-ink-2" : "text-ink-3"
                } ${active ? "" : "hidden sm:flex"}`}
              >
                {done && <Check className="h-3 w-3 flex-none" aria-hidden="true" />}
                <span className="truncate">{RO_STATUS_LABEL[step]}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
