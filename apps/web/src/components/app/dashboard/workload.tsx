import Link from "next/link";

import { Avatar, EmptyState, Section } from "@/components/app/ui";
import type { TechnicianLoad } from "@/lib/dashboard";

/**
 * A day is eight book hours. The bar is each technician's open labour
 * against that, so a bar past the end reads as what it is — more than a
 * day's work on one person — without anyone having to do arithmetic. When
 * somebody is carrying more than eight, the scale stretches to the heaviest
 * load so the bars still compare.
 */
const DAY_HOURS = 8;

export function TechnicianWorkload({ technicians }: { technicians: TechnicianLoad[] }) {
  const scale = Math.max(DAY_HOURS, ...technicians.map((tech) => tech.hours));

  return (
    <Section
      title="Technicians"
      detail="Open tickets and the book hours on them"
      action={
        <Link href="/app/technicians" className="btn btn-ghost btn-sm">
          Board
        </Link>
      }
    >
      {technicians.length === 0 ? (
        <EmptyState
          title="No technicians yet"
          detail="Invite them from Team and ZOL will start routing bookings to whoever has the right specialty."
          className="py-6"
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {technicians.map((tech) => {
            const width = Math.min(100, (tech.hours / scale) * 100);
            const over = tech.hours > DAY_HOURS;
            return (
              <li key={tech.id} className="flex items-center gap-3">
                <Avatar name={tech.full_name} size="sm" tone={over ? "person" : "neutral"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[0.9375rem] font-semibold text-ink">
                      {tech.full_name}
                      {tech.specialties.length > 0 && (
                        <span className="ml-2 hidden text-[0.75rem] font-normal text-ink-3 sm:inline">
                          {tech.specialties.join(" · ")}
                        </span>
                      )}
                    </p>
                    <p className="t-data flex-none text-[0.8125rem] text-ink-2">
                      {tech.tickets} ticket{tech.tickets === 1 ? "" : "s"} ·{" "}
                      <span className={over ? "text-amber-deep" : ""}>
                        {tech.hours.toFixed(1)} h
                      </span>
                    </p>
                  </div>
                  <div
                    role="meter"
                    aria-label={`${tech.full_name}: ${tech.hours.toFixed(1)} book hours open`}
                    aria-valuemin={0}
                    aria-valuemax={scale}
                    aria-valuenow={tech.hours}
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-3"
                  >
                    <div
                      className={`h-full rounded-full ${over ? "bg-amber" : "bg-emerald"}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
