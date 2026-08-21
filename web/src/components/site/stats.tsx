import { stats } from "@/lib/shop-demo";
import { Reveal } from "./reveal";

export function Stats() {
  return (
    <section className="border-y border-line bg-paper-2">
      <div className="shell band-tight">
        <Reveal>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="t-eyebrow text-[0.625rem]">{s.label}</dt>
                <dd className="t-num mt-2 text-[2.25rem] text-ink sm:text-[2.75rem]">
                  {s.value}
                </dd>
                <dd className="mt-1 text-[0.8125rem] text-ink-3">{s.note}</dd>
              </div>
            ))}
          </dl>
          <p className="t-data mt-8 text-[0.5625rem] uppercase tracking-[0.14em] text-ink-3">
            A day on the sample shop board — illustrative data
          </p>
        </Reveal>
      </div>
    </section>
  );
}
