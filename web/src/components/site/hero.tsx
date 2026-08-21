import { DemoButton } from "./demo-button";
import { HeroMedia } from "./hero-media";

const proof = [
  "Answers every call, night and weekend",
  "Texts estimates and chases approvals",
  "Orders parts and flags vendor delays",
];

/* The headline is set one line per element so each can fade in from the top in
   sequence. Every other piece of the hero picks up the same stagger. */
const headline = ["The best AI", "shop management", "tool."];

function Check() {
  return (
    <span
      className="mt-[3px] grid h-4 w-4 flex-none place-items-center rounded-full bg-emerald-wash"
      aria-hidden="true"
    >
      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
        <path
          d="M1 3.6 3.2 5.8 8 1"
          stroke="var(--emerald-deep)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg" aria-hidden="true" />

      {/*
        The picture takes the right three quarters of the window and runs the
        full height of the hero. The copy stays on the shell's left edge — the
        same edge the nav and every section below it use — and lies over the
        image, with the scrim fading the two together where they meet.
      */}
      <div className="hero-media">
        <HeroMedia />
      </div>

      <div className="shell relative pb-[19rem] pt-12 sm:pb-[22rem] lg:pb-28 lg:pt-12 xl:pt-14">
        {/* Opens up on the widest screens, where there is room for SHOP
            MANAGEMENT to sit on one line — it needs 757px at this size, so the
            column and the type step up together or not at all. */}
        <div className="lg:max-w-[30rem] xl:max-w-[35rem] 2xl:max-w-[48rem]">
          <p className="t-eyebrow hero-in" style={{ "--d": "0ms" } as React.CSSProperties}>
            AI shop management for auto repair
          </p>

          <h1 className="t-display mt-5 text-[2.75rem] sm:text-[3.75rem] lg:text-[3.5rem] xl:text-[4.25rem] 2xl:text-[4.5rem]">
            {headline.map((line, i) => (
              <span
                key={line}
                className="hero-in block"
                style={{ "--d": `${90 + i * 110}ms` } as React.CSSProperties}
              >
                {line}
              </span>
            ))}
          </h1>

          <p
            className="hero-in mt-6 text-[1.0625rem] font-semibold leading-snug text-ink md:text-[1.25rem]"
            style={{ "--d": "440ms" } as React.CSSProperties}
          >
            Don&rsquo;t let your competitors beat you with AI and automation.
          </p>

          <p
            className="hero-in t-lede mt-3 max-w-xl"
            style={{ "--d": "520ms" } as React.CSSProperties}
          >
            One system that runs the shop and works the phone. Not one more
            tab for your writer to type into.
          </p>

          <ul className="mt-7 grid gap-2.5">
            {proof.map((line, i) => (
              <li
                key={line}
                className="hero-in flex items-start gap-2.5"
                style={{ "--d": `${600 + i * 80}ms` } as React.CSSProperties}
              >
                <Check />
                <span className="text-[0.9375rem] text-ink-2">{line}</span>
              </li>
            ))}
          </ul>

          <div
            className="hero-in mt-9 flex flex-col gap-3 sm:flex-row sm:items-center"
            style={{ "--d": "860ms" } as React.CSSProperties}
          >
            <DemoButton />
            <a href="#how-it-works" className="btn btn-ghost">
              See how it works
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
