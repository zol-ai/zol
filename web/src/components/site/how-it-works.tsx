import { beats } from "@/lib/shop-demo";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";
import { Tag } from "./tag";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="band">
      <div className="shell">
        <SectionHead
          n="01"
          label="How it works"
          title={
            <>
              From the missed call
              <br />
              to the follow-up
            </>
          }
          lede="One job, start to finish, on an ordinary Tuesday. ZOL runs the emerald steps with nobody watching and hands you the rest."
        />

        <ol className="mt-12 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
          {beats.map((beat, i) => (
            <Reveal as="li" key={beat.n} delay={i * 70} className="bg-paper">
              <div className="flex h-full flex-col p-6">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-data text-[0.8125rem] font-semibold text-ink-3">
                    {beat.n}
                  </span>
                  <span className="t-data text-[0.75rem] font-medium text-ink-2">
                    {beat.clock}
                  </span>
                </div>

                <h3 className="t-h3 mt-5 text-[1.125rem]">{beat.title}</h3>

                <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-ink-2">
                  {beat.body}
                </p>

                <div
                  className={`mt-5 rounded-md border p-3 ${
                    beat.by === "zol"
                      ? "border-emerald-line bg-emerald-wash"
                      : "border-amber-line bg-amber-wash"
                  }`}
                >
                  <Tag by={beat.by} />
                  <p className="t-data mt-2 text-[0.75rem] leading-relaxed text-ink-2">
                    {beat.event}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
