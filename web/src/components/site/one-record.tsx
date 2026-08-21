import { ticket } from "@/lib/shop-demo";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { AttributionLegend, Tag } from "./tag";

export function OneRecord() {
  return (
    <section id="one-record" className="band border-t border-line bg-paper-2">
      <div className="shell">
        <SectionHead
          n="02"
          label="One record"
          title={
            <>
              Everything on
              <br />
              one ticket
            </>
          }
          lede="RO-4471 exactly as it happened — after-hours call through invoice. Nothing retyped into a second system."
        />

        <AttributionLegend className="mt-6" />

        <div className="mt-10 grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-8">
          {/* The vehicle */}
          <Reveal>
            <div className="screen h-full">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-5 py-3">
                <span className="t-data text-[0.8125rem] font-semibold text-ink">
                  {ticket.ro}
                </span>
                <span className="t-eyebrow text-[0.5625rem]">Vehicle</span>
              </div>

              <div className="p-5">
                <h3 className="t-h3 text-[1.25rem]">{ticket.vehicle}</h3>

                <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3.5">
                  {ticket.fields.map(([k, v]) => (
                    <div key={k}>
                      <dt className="t-eyebrow text-[0.5625rem]">{k}</dt>
                      <dd className="t-data mt-1 text-[0.8125rem] font-medium text-ink">
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="mt-5 border-t border-line pt-4 text-[0.875rem] leading-relaxed text-ink-2">
                  {ticket.finding}
                </p>

                <div className="mt-5 flex items-baseline justify-between gap-3 rounded-md bg-paper-3 px-4 py-3">
                  <span className="t-eyebrow text-[0.5625rem]">Approved total</span>
                  <span
                    className="t-data text-[1.375rem] font-semibold text-ink"
                    style={{ letterSpacing: "-0.03em" }}
                  >
                    {ticket.total}
                  </span>
                </div>
              </div>
            </div>
          </Reveal>

          {/* What happened, and who did it */}
          <Reveal delay={90}>
            <div className="screen h-full">
              <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-5 py-3">
                <span className="t-eyebrow text-[0.5625rem]">Timeline</span>
                <span className="t-data text-[0.625rem] text-ink-3">
                  6 events · 4 unattended
                </span>
              </div>

              <ol className="p-5">
                {ticket.timeline.map((e, i) => {
                  const last = i === ticket.timeline.length - 1;
                  return (
                    <li key={e.title} className="relative grid grid-cols-[1.25rem_1fr] gap-x-4">
                      {/* rail */}
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ring-4 ${
                            e.by === "zol"
                              ? "bg-emerald ring-emerald-wash"
                              : "bg-amber ring-amber-wash"
                          }`}
                          aria-hidden="true"
                        />
                        {!last && (
                          <span
                            className="w-px flex-1 bg-line"
                            aria-hidden="true"
                          />
                        )}
                      </div>

                      <div className={last ? "pb-0" : "pb-6"}>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h4 className="text-[0.9375rem] font-semibold text-ink">
                            {e.title}
                          </h4>
                          <span className="t-data text-[0.6875rem] text-ink-3">
                            {e.at}
                          </span>
                          <Tag by={e.by} className="ml-auto" />
                        </div>
                        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-2">
                          {e.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Reveal>
        </div>

        <p className="t-data mt-6 text-[0.5625rem] uppercase tracking-[0.14em] text-ink-3">
          Sample repair order — illustrative data
        </p>
      </div>
    </section>
  );
}
