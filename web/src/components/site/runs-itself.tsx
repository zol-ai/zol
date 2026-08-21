import { jobs } from "@/lib/shop-demo";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

export function RunsItself() {
  return (
    <section id="runs-itself" className="band border-t border-line">
      <div className="shell">
        <SectionHead
          n="03"
          label="Runs itself"
          title={
            <>
              The work your front
              <br />
              desk never gets to
            </>
          }
          lede="Not a chatbot bolted onto a calendar. Four jobs ZOL does end to end — and hands back the moment judgment is required."
        />

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {jobs.map((job, i) => (
            <Reveal key={job.title} delay={i * 70}>
              <div className="card h-full p-6 transition-shadow duration-200 hover:shadow-[0_2px_8px_rgb(25_23_20/0.06)] sm:p-7">
                <h3 className="t-h3 text-[1.1875rem]">{job.title}</h3>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
                  {job.body}
                </p>
                <p className="t-data mt-5 flex items-start gap-2.5 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-emerald-deep">
                  <span
                    className="dot mt-1.5 bg-emerald"
                    aria-hidden="true"
                  />
                  {job.event}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
