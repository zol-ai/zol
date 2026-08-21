import { DemoButton } from "./demo-button";
import { HeroMedia } from "./hero-media";

const proof = [
  "Answers every call, night and weekend",
  "Texts estimates and chases approvals",
  "Orders parts and flags vendor delays",
];

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

      {/* Runs the full height and bleeds to the right edge; the type sits on it. */}
      <div className="hero-media">
        <HeroMedia />
      </div>

      <div className="shell relative pb-[19rem] pt-12 sm:pb-[22rem] lg:pb-28 lg:pt-24 xl:pb-32 xl:pt-28">
        <div className="lg:max-w-[28rem] xl:max-w-[34rem]">
          <p className="t-eyebrow">AI front desk for auto repair shops</p>

          <h1 className="t-display mt-5 text-[2.5rem] sm:text-[3.5rem] lg:text-[3.75rem] xl:text-[4.5rem]">
            The front desk
            <br />
            that never
            <br />
            goes home.
          </h1>

          <p className="t-lede mt-6 max-w-xl">
            ZOL picks up the calls nobody gets to, books the job, texts the
            estimate and chases the approval — then leaves the shop software you
            already run exactly where it is.
          </p>

          <ul className="mt-7 grid gap-2.5">
            {proof.map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <Check />
                <span className="text-[0.9375rem] text-ink-2">{line}</span>
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
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
