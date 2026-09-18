import type { Metadata } from "next";
import Link from "next/link";

import { DemoButton } from "@/components/site/demo-button";
import { Footer } from "@/components/site/footer";
import { FounderCard } from "@/components/site/founders";
import { Nav } from "@/components/site/nav";
import { Reveal } from "@/components/site/reveal";
import { productSections } from "@/lib/product";
import { site } from "@/lib/site";
import { founders } from "@/lib/team";

export const metadata: Metadata = {
  title: "About",
  description: `${site.name} is a ${site.company.city} software company, founded in ${site.company.founded}, building AI shop management software for independent auto repair shops. Who we are, what the product does, and how to reach us.`,
  alternates: { canonical: site.aboutPath },
};

/**
 * The company, plainly. The landing page sells; this page states. Anyone
 * who needs to know what ZOL is, who is behind it, what the product
 * actually contains and how to get hold of us should find every one of
 * those answers here without scrolling through a pitch.
 */

const facts = [
  { label: "Company", value: site.name },
  { label: "Founded", value: site.company.founded },
  { label: "Based in", value: `${site.company.city}, ${site.company.region}` },
  { label: "Customers", value: "Independent auto repair shops" },
] as const;

export default function AboutPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />

      <main id="main" className="flex-1">
        {/* What ZOL is */}
        <section className="band">
          <div className="shell">
            <Reveal className="max-w-3xl">
              <p className="t-eyebrow">About {site.name}</p>
              <h1 className="t-h2 mt-4 text-[2rem] sm:text-[2.625rem] lg:text-[3rem]">
                Shop management software that does the work instead of just
                recording it.
              </h1>
              <p className="t-lede mt-6">
                {site.name} answers an auto repair shop&rsquo;s phone night and
                weekend, books the job, checks the car in, helps the technician
                diagnose and inspect it, texts the estimate, takes the approval
                from the customer&rsquo;s phone, tracks the parts, invoices,
                takes payment and follows up afterwards — one record from the
                first call to the next visit.
              </p>
              <p className="mt-5 max-w-2xl text-[1rem] leading-relaxed text-ink-2">
                It is built for the independent shop: the owner-operator with
                two to ten bays, whose front desk is also the service advisor,
                the parts buyer and the person who was supposed to call about
                that estimate. Every shop system on the market records the
                work. {site.name} records it and does the parts nobody at the
                counter gets to.
              </p>
            </Reveal>

            <Reveal delay={80} className="mt-12">
              <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
                {facts.map((f) => (
                  <div key={f.label} className="bg-paper p-5">
                    <dt className="t-eyebrow text-[0.625rem]">{f.label}</dt>
                    <dd className="mt-2 text-[1.0625rem] font-semibold text-ink">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </section>

        {/* What is in the product */}
        <section className="band border-t border-line bg-paper-2">
          <div className="shell">
            <Reveal className="max-w-2xl">
              <p className="t-eyebrow">The product</p>
              <h2 className="t-h2 mt-4 text-[1.875rem] sm:text-[2.375rem]">
                What&rsquo;s in {site.name}
              </h2>
              <p className="t-lede mt-5">
                The app is live. A shop signs up, invites its advisors and
                technicians, and runs the day from these sections. Its
                customers never sign in — every estimate and invoice text
                carries a link to their own portal page, and each shop has a
                public receptionist page where a customer can describe the
                problem and leave with a booking.
              </p>
            </Reveal>

            <Reveal delay={80} className="mt-10">
              <dl className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
                {productSections.map((s) => (
                  <div key={s.name} className="bg-paper p-5 sm:p-6">
                    <dt className="text-[1rem] font-semibold text-ink">
                      {s.name}
                    </dt>
                    <dd className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">
                      {s.what}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            <Reveal delay={120} className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={`/#product`} className="btn btn-primary">
                See the screens
              </Link>
              <Link href={site.signupPath} className="btn btn-ghost">
                Set up your shop
              </Link>
              <Link href={site.signinPath} className="btn btn-ghost">
                Sign in
              </Link>
            </Reveal>
          </div>
        </section>

        {/* Who is behind it */}
        <section className="band border-t border-line">
          <div className="shell">
            <Reveal className="max-w-2xl">
              <p className="t-eyebrow">Founders</p>
              <h2 className="t-h2 mt-4 text-[1.875rem] sm:text-[2.375rem]">
                Who&rsquo;s behind {site.name}
              </h2>
              <p className="t-lede mt-5">
                Two technical founders, building in {site.company.city}, who
                spent two months embedded in independent mechanic shops before
                writing a line of it. The names and photographs are real; every
                link goes to a public profile on a site we don&rsquo;t control.
              </p>
            </Reveal>

            <div className="mt-12 grid max-w-[58rem] gap-6 md:grid-cols-2 md:gap-8">
              {founders.map((person, i) => (
                <Reveal key={person.name} delay={i * 90}>
                  <FounderCard person={person} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How to reach us */}
        <section className="band-tight border-t border-line bg-paper-2">
          <div className="shell">
            <Reveal className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="t-eyebrow">Reach us</p>
                <h2 className="t-h3 mt-3 text-[1.5rem] sm:text-[1.75rem]">
                  A person answers this one
                </h2>
                <p className="mt-3 max-w-xl text-[0.9375rem] leading-relaxed text-ink-2">
                  Email{" "}
                  <a
                    href={`mailto:${site.contactEmail}`}
                    className="font-semibold text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                  >
                    {site.contactEmail}
                  </a>{" "}
                  and a founder replies. Or book twenty minutes and we&rsquo;ll
                  put a call through {site.name} while you listen, on your own
                  shop&rsquo;s numbers.
                </p>
              </div>
              <DemoButton />
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
