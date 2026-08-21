import { DemoButton } from "./demo-button";
import { Reveal } from "./reveal";

/**
 * The page's one inverted panel. Held back until the close so it lands as
 * emphasis rather than decoration.
 */
export function Cta() {
  return (
    <section className="relative overflow-hidden border-t border-line bg-panel">
      {/*
        The only photographic moment on the page. It belongs here because this
        is the one dark panel — the same scene on a light section would fight
        the product screens rather than support them.
      */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.30]"
        style={{ backgroundImage: "url(/images/bay-lift.svg)" }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 90% at 50% 50%, rgb(28 26 23 / 0.86) 0%, rgb(28 26 23 / 0.96) 70%)",
        }}
        aria-hidden="true"
      />

      <div className="shell relative py-20 text-center md:py-28">
        <Reveal>
          <p className="t-eyebrow inline-flex items-center gap-2.5 text-panel-fg-2">
            <span className="dot dot-live" aria-hidden="true" />
            It rings again tonight
          </p>

          <h2 className="t-display mx-auto mt-6 max-w-3xl text-[2.25rem] text-panel-fg sm:text-[3.25rem] lg:text-[3.75rem]">
            See it answer
            <br />
            your phone
          </h2>

          <p className="mx-auto mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-panel-fg-2">
            Twenty minutes. We&apos;ll put a call through ZOL while you listen,
            price a job at your rates, and show you the repair order it writes —
            on your own shop&apos;s numbers.
          </p>

          <div className="mt-9 flex justify-center">
            <DemoButton variant="onpanel">Book a demo</DemoButton>
          </div>

          <p className="t-data mt-6 text-[0.6875rem] text-panel-fg-2">
            Opens our calendar · no card, no commitment
          </p>
        </Reveal>
      </div>
    </section>
  );
}
