import type { Metadata } from "next";

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
 * The waitlist, on its own — no nav, no pitch, no footer.
 *
 * Whoever lands here already decided to sign up (an ad, a link from a rep, a
 * QR code on a flyer); re-selling them the product on the way in is friction,
 * not context. The form is the whole page.
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
    <main className="flex min-h-dvh items-center justify-center bg-paper-2 px-5 py-12">
      <div className="w-full max-w-lg">
        <h1 className="t-h2 text-[1.75rem] sm:text-[2rem]">Have us call you</h1>
        <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-ink-2">
          {/* PLACEHOLDER COPY — yours to write. One line. */}
          Six boxes. We&rsquo;ll ring the shop when a slot opens up.
        </p>

        <div className="mt-7">
          <WaitlistForm sourcePage="/waitlist" utm={utm} />
        </div>
      </div>
    </main>
  );
}
