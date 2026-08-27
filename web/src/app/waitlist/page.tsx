import type { Metadata } from "next";

import { DemoButton } from "@/components/site/demo-button";
import { Footer } from "@/components/site/footer";
import { Nav } from "@/components/site/nav";
import { WaitlistForm } from "@/components/site/waitlist-form";
import { site } from "@/lib/site";
import { UTM_KEYS, type UtmKey } from "@/lib/waitlist";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description:
    "Put your shop on the list for ZOL — the AI shop management software that answers every call, writes the repair order and chases the approval.",
  alternates: { canonical: `${site.url}/waitlist` },
};

/**
 * The waitlist.
 *
 * Booking a demo stays the primary path — a shop owner who is ready to talk
 * should not be put in a queue — so the calendar button sits above the form
 * and the form is the quieter thing underneath it, for the ones who want to be
 * called rather than to pick a slot at nine at night.
 *
 * The demo video goes between the copy and the button when there is one.
 */
export default async function WaitlistPage(props: PageProps<"/waitlist">) {
  const params = await props.searchParams;

  /*
    UTMs off the landing URL, handed to the form as hidden fields. A Server
    Action only ever sees its own request — by the time this is submitted the
    campaign parameters are long gone from the URL, so they have to be carried.
    A repeated parameter (?utm_source=a&utm_source=b) arrives as an array;
    the first one is the one that brought them.
  */
  const utm: Partial<Record<UtmKey, string>> = {};
  for (const key of UTM_KEYS) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.length > 0) utm[key] = first;
  }

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
      >
        Skip to content
      </a>

      <Nav />

      <main id="main" className="flex-1">
        <section className="band-tight">
          <div className="shell">
            <div className="max-w-2xl">
              <p className="t-eyebrow">{/* PLACEHOLDER COPY */}Early access</p>

              <h1 className="t-display mt-4 text-[2.5rem] sm:text-[3.25rem] lg:text-[3.75rem]">
                {/* PLACEHOLDER COPY — yours to write. */}
                Get your shop
                <br />
                on the list
              </h1>

              <p className="t-lede mt-5">
                {/* PLACEHOLDER COPY — yours to write. One line. */}
                We turn ZOL on for a handful of shops at a time so every one of
                them gets set up properly. Tell us about yours and we&rsquo;ll
                call your main line when there&rsquo;s room.
              </p>
            </div>

            {/*
              The demo video goes here — above the button, ungated, no form in
              front of it. Nothing is stubbed in for it yet on purpose: there
              is no video, and an empty player is worse than no player.
            */}

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <DemoButton>Book a demo</DemoButton>
              <p className="t-data text-[0.6875rem] text-ink-3">
                Opens our calendar · no card, no commitment
              </p>
            </div>
          </div>
        </section>

        {/*
          The quieter half. A different ground and a rule above it, so the form
          reads as the alternative to the button rather than as the next step
          after it.
        */}
        <section className="band-tight border-t border-line bg-paper-2">
          <div className="shell">
            <div className="max-w-2xl">
              <h2 className="t-h2 text-[1.75rem] sm:text-[2rem]">
                {/* PLACEHOLDER COPY — yours to write. */}
                Or have us call you
              </h2>
              <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
                {/* PLACEHOLDER COPY — yours to write. One line. */}
                Six boxes. We&rsquo;ll ring the shop when a slot opens up.
              </p>

              <div className="mt-7">
                <WaitlistForm sourcePage="/waitlist" utm={utm} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
