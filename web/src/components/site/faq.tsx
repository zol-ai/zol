import { Reveal } from "./reveal";

const questions = [
  {
    q: "Do I have to replace my shop management software?",
    a: "No, and that's the point. Tekmetric, Shopmonkey, Shop-Ware, Mitchell 1 and AutoLeap record the work — they're not the problem. ZOL sits on top and does the phone, the texting and the chasing that nobody has time for. Customers, vehicles and repair orders sync both ways, so your writers keep working exactly where they already work.",
  },
  {
    q: "Will my customers know they're not talking to a person?",
    a: "It introduces itself as Zol and it won't claim to be a human if someone asks. In practice callers care about two things: that somebody picked up, and that whoever picked up knew their truck. It does both.",
  },
  {
    q: "What happens when it doesn't know the answer?",
    a: "It says so. It won't invent a diagnosis or a price it isn't sure about — it takes a number, flags the call for you, and you can set it to transfer straight to your cell for anything outside what you've told it to handle. Everything it did is on the board with the full conversation attached.",
  },
  {
    q: "Does this replace my service advisor?",
    a: "No. It covers the hours nobody is standing at the counter, and the calls that come in while your advisor is already on the other line. Shops with an advisor use it for after-hours and overflow; shops without one use it as the counter.",
  },
  {
    q: "Where do the quoted prices come from?",
    a: "From you. Your labor rate, your book times, your parts margin, set during onboarding. Nothing goes to a customer at a number you haven't approved, and you can cap what it's allowed to quote without checking with you first.",
  },
  {
    q: "Does it text customers from a robot number?",
    a: "No. It works on your shop's own line, so the number your customers already have keeps working. When a person on your team picks up a thread, ZOL steps aside.",
  },
  {
    q: "Who owns the recordings and the customer data?",
    a: "Your shop does. It lives in your shop's own database, you can export all of it whenever you want, and you can have it deleted. We don't sell it and we don't hand your customer list to another shop.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="band border-t border-line">
      <div className="shell">
        <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
          <Reveal>
            <p className="t-eyebrow">Questions</p>
            <h2 className="t-h2 mt-4 text-[1.875rem] sm:text-[2.375rem]">
              The things shop
              <br />
              owners ask first
            </h2>
            <p className="t-lede mt-5">
              Straight answers. If yours isn&apos;t here, ask it on the demo.
            </p>
          </Reveal>

          <Reveal delay={80}>
            <div className="border-t border-line">
              {questions.map((item) => (
                <details key={item.q} className="group border-b border-line">
                  <summary className="flex cursor-pointer list-none items-start gap-4 py-5 text-[1rem] font-semibold leading-snug text-ink marker:hidden">
                    <span className="flex-1">{item.q}</span>
                    <span
                      className="mt-1 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-45"
                      aria-hidden="true"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14">
                        <path
                          d="M7 0v14M0 7h14"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                      </svg>
                    </span>
                  </summary>
                  <p className="max-w-2xl pb-6 pr-8 text-[0.9375rem] leading-relaxed text-ink-2">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
