import { comparison, replaces } from "@/lib/shop-demo";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

export function WhySwitch() {
  return (
    <section id="why-switch" className="band border-t border-line bg-paper-2">
      <div className="shell">
        <SectionHead
          n="04"
          label="Why shops switch"
          title={
            <>
              Your shop software
              <br />
              only writes it down
            </>
          }
          lede="Every shop system records the work. Someone still has to answer the phone, chase the approval, call about the part. ZOL does both."
        />

        <Reveal className="mt-10">
          <p className="t-eyebrow text-[0.625rem]">Built to replace</p>
          <ul className="mt-3 flex flex-wrap gap-2.5">
            {replaces.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-2"
              >
                <span className="dot bg-emerald" aria-hidden="true" />
                <span className="text-[0.875rem] font-medium text-ink">{name}</span>
              </li>
            ))}
          </ul>
          <p className="t-data mt-3 text-[0.6875rem] text-ink-3">
            History comes across during onboarding. Your data stays exportable.
          </p>
        </Reveal>

        {/* What changes */}
        <Reveal delay={90} className="mt-12">
          <div className="screen overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr]">
              {/* Header row (wide only) */}
              <div className="hidden border-b border-line px-5 py-3 sm:block" />
              <div className="hidden border-b border-line px-5 py-3 sm:block">
                <span className="t-eyebrow text-[0.5625rem]">
                  Shop software alone
                </span>
              </div>
              <div className="hidden border-b border-line bg-emerald-wash px-5 py-3 sm:block">
                <span className="t-eyebrow text-[0.5625rem] text-emerald-deep">
                  On ZOL
                </span>
              </div>

              {comparison.map((row) => (
                <div key={row.row} className="contents">
                  <div className="border-b border-line px-5 pb-2 pt-4 sm:py-4">
                    <span className="text-[0.875rem] font-semibold text-ink">
                      {row.row}
                    </span>
                  </div>
                  <div className="border-b border-line px-5 pb-3 sm:py-4">
                    <span className="t-eyebrow mb-1 block text-[0.5rem] sm:hidden">
                      Shop software alone
                    </span>
                    <span className="text-[0.875rem] leading-relaxed text-ink-3">
                      {row.without}
                    </span>
                  </div>
                  <div className="border-b border-line bg-emerald-wash px-5 pb-4 pt-3 sm:py-4">
                    <span className="t-eyebrow mb-1 block text-[0.5rem] text-emerald-deep sm:hidden">
                      On ZOL
                    </span>
                    <span className="text-[0.875rem] font-medium leading-relaxed text-ink">
                      {row.with}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
