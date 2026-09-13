import Link from "next/link";

import { Section } from "@/components/app/ui";
import type { PipelineCount } from "@/lib/dashboard";
import {
  RO_PIPELINE,
  RO_STATUS_LABEL,
  RO_STATUS_TONE,
  type RoStatus,
} from "@/lib/statuses";

const TONE_TEXT: Record<string, string> = {
  zol: "text-emerald-deep",
  person: "text-amber-deep",
  neutral: "text-ink",
  blue: "text-blue-deep",
  violet: "text-violet-deep",
  red: "text-red-deep",
};

/**
 * The board in one line: how many tickets sit at each stop, in the order
 * work moves. Closed is left off — it is where tickets go, not where they
 * are — and every count links to the board filtered to that column.
 *
 * The shape follows the card's own width rather than the window's, which is
 * why this is a container query and not a `sm:`. On the dashboard the card
 * is the narrow column from `lg` up, so the viewport is wide exactly when
 * there is least room for seven stops across; under about 28rem each stop
 * takes its own row instead of squeezing "Waiting on parts" into 60 pixels.
 */
export function PipelineStrip({ counts }: { counts: PipelineCount[] }) {
  const byStatus = new Map(counts.map((row) => [row.status, row.n]));
  const stops = RO_PIPELINE.filter((status) => status !== "closed") as RoStatus[];
  const total = stops.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);

  return (
    <Section title="Pipeline" detail={`${total} open ticket${total === 1 ? "" : "s"}`} flush>
      <div className="@container">
        <ol className="divide-y divide-line @md:grid @md:grid-cols-7 @md:divide-x @md:divide-y-0">
          {stops.map((status) => {
            const n = byStatus.get(status) ?? 0;
            return (
              <li key={status} className="min-w-0">
                <Link
                  href={`/app/repair-orders?status=${status}`}
                  className="flex h-full items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-paper-2 @md:flex-col @md:justify-start @md:gap-1.5 @md:px-1.5 @md:py-3.5"
                >
                  <span className="min-w-0 text-[0.875rem] text-ink-2 @md:order-2 @md:text-center @md:text-[0.6875rem] @md:font-semibold @md:leading-[1.15] @md:text-balance @md:text-ink-3">
                    {RO_STATUS_LABEL[status]}
                  </span>
                  <span
                    className={`t-num flex-none text-[1.125rem] @md:text-[1.5rem] ${
                      n === 0 ? "text-ink-3" : TONE_TEXT[RO_STATUS_TONE[status]]
                    }`}
                  >
                    {n}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </Section>
  );
}
