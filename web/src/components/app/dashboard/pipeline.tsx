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
 */
export function PipelineStrip({ counts }: { counts: PipelineCount[] }) {
  const byStatus = new Map(counts.map((row) => [row.status, row.n]));
  const stops = RO_PIPELINE.filter((status) => status !== "closed") as RoStatus[];
  const total = stops.reduce((sum, status) => sum + (byStatus.get(status) ?? 0), 0);

  return (
    <Section title="Pipeline" detail={`${total} open ticket${total === 1 ? "" : "s"}`} flush>
      <ol className="grid grid-cols-4 divide-x divide-line sm:grid-cols-7">
        {stops.map((status) => {
          const n = byStatus.get(status) ?? 0;
          return (
            <li key={status} className="min-w-0">
              <Link
                href={`/app/repair-orders?status=${status}`}
                className="flex h-full flex-col items-center justify-start gap-1 px-1 py-3 text-center transition-colors hover:bg-paper-2"
              >
                <span
                  className={`t-num text-[1.5rem] ${
                    n === 0 ? "text-ink-3" : TONE_TEXT[RO_STATUS_TONE[status]]
                  }`}
                >
                  {n}
                </span>
                <span className="t-eyebrow text-[0.5625rem] leading-tight">
                  {RO_STATUS_LABEL[status]}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
