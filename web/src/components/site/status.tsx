import { DemoButton } from "./demo-button";
import { Reveal } from "./reveal";

const stack = [
  ["Twilio", "Voice and SMS on a number that stays yours"],
  ["OpenAI", "Understands the call, writes the ticket"],
  ["Google Cloud", "Runs in one place, doesn't fall over"],
  ["PostgreSQL", "Your shop's history, exportable, yours"],
];

/**
 * Says out loud where the product actually is. Shop owners have been sold
 * vapour before; the honest version converts better than the confident one.
 */
export function Status() {
  return (
    <section className="band-tight border-t border-line">
      <div className="shell">
        <Reveal>
          <div className="card overflow-hidden">
            <div className="grid gap-8 p-6 sm:p-9 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
              <div>
                <p className="t-eyebrow text-emerald-deep">Where we actually are</p>
                <h2 className="t-h3 mt-4 text-[1.375rem] sm:text-[1.75rem]">
                  We&apos;re signing up the first shops now
                </h2>
                <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
                  Carrier registration — the compliance step every business
                  calling and texting line has to clear before it can go live —
                  is in progress. Until it lands we&apos;re running demos, setting
                  up shops and tuning the diagnosis on real calls.
                </p>
                <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink">
                  Book a demo and you&apos;ll see the whole thing end to end, and
                  get first slot when the line opens.
                </p>
                <DemoButton className="mt-6" />
              </div>

              <div>
                <p className="t-eyebrow text-[0.625rem]">Built on</p>
                <ul className="mt-4">
                  {stack.map(([name, what]) => (
                    <li
                      key={name}
                      className="grid grid-cols-[7rem_1fr] gap-3 border-b border-line py-3 last:border-0"
                    >
                      <span className="t-data text-[0.8125rem] font-semibold text-ink">
                        {name}
                      </span>
                      <span className="text-[0.8125rem] leading-relaxed text-ink-3">
                        {what}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
