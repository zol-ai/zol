import Image from "next/image";
import Link from "next/link";
import { productScreens, productSections } from "@/lib/product";
import { site } from "@/lib/site";
import { Fig } from "./fig";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

/**
 * The product, as it runs. Everything above this section on the page is a
 * demonstration — a board and a ticket built by hand to explain the idea.
 * This is the app: screens captured from a live ZOL instance, and the two
 * doors into it, sign-up and sign-in. A visitor (or anyone checking whether
 * the software behind the pitch exists) should be able to see it here
 * without booking anything.
 */
export function Product() {
  const [lead, ...rest] = productScreens;
  const wide = rest.filter((s) => s.width >= s.height);
  const tall = rest.filter((s) => s.width < s.height);

  return (
    <section id="product" className="band border-t border-line">
      <div className="shell">
        <SectionHead
          n="05"
          label="The product"
          title={
            <>
              This is ZOL,
              <br />
              as it runs today
            </>
          }
          lede="Screens from the app, not mockups. A shop sets itself up in two minutes, invites its team, and runs the day from here — and its customers approve estimates and pay from a text, with nothing to install."
        />

        {/* The lead screen: the dashboard, at full width. */}
        <Reveal className="mt-12">
          <figure>
            <div className="screen">
              <Image
                src={lead.src}
                alt={lead.alt}
                width={lead.width}
                height={lead.height}
                sizes="(min-width: 1280px) 72rem, 100vw"
                unoptimized
                className="h-auto w-full"
              />
            </div>
            <figcaption className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="t-eyebrow text-[0.625rem]">{lead.screen}</span>
              <span className="text-[0.875rem] text-ink-2">{lead.caption}</span>
            </figcaption>
          </figure>
        </Reveal>

        {/* The rest, two up. */}
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          {wide.map((s, i) => (
            <Reveal key={s.src} delay={i * 70}>
              <figure>
                <div className="screen">
                  <Image
                    src={s.src}
                    alt={s.alt}
                    width={s.width}
                    height={s.height}
                    sizes="(min-width: 768px) 36rem, 100vw"
                    unoptimized
                    className="h-auto w-full"
                  />
                </div>
                <figcaption className="mt-3">
                  <span className="t-eyebrow text-[0.625rem]">{s.screen}</span>
                  <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-2">
                    {s.caption}
                  </p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

        {/* The customer's side, on a phone, beside what's in the app and the ways in. */}
        <div className="mt-12 grid items-start gap-10 border-t border-line pt-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-14">
          {tall.map((s) => (
            <Reveal key={s.src}>
              <figure className="mx-auto max-w-[19rem]">
                <div className="screen">
                  <Image
                    src={s.src}
                    alt={s.alt}
                    width={s.width}
                    height={s.height}
                    sizes="19rem"
                    unoptimized
                    className="h-auto w-full"
                  />
                </div>
                <figcaption className="mt-3">
                  <span className="t-eyebrow text-[0.625rem]">{s.screen}</span>
                  <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-2">
                    {s.caption}
                  </p>
                </figcaption>
              </figure>
            </Reveal>
          ))}

          <Reveal delay={90}>
            <p className="t-eyebrow">What&rsquo;s in it</p>
            <h3 className="t-h3 mt-3 text-[1.375rem] sm:text-[1.625rem]">
              One system, the whole shop
            </h3>
            <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {productSections.map((s) => (
                <div key={s.name} className="flex items-start gap-2.5">
                  <span className="dot mt-[0.45rem] bg-emerald" aria-hidden="true" />
                  <div>
                    <dt className="text-[0.9375rem] font-semibold text-ink">
                      {s.name}
                    </dt>
                    <dd className="mt-0.5 text-[0.875rem] leading-relaxed text-ink-2">
                      {s.what}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={site.signupPath} className="btn btn-primary">
                Set up your shop
              </Link>
              <Link href={site.signinPath} className="btn btn-ghost">
                Sign in
              </Link>
            </div>
            <p className="t-data mt-4 text-[0.6875rem] text-ink-3">
              Two minutes, nothing to install. Nothing changes on your phone
              line until you say so.
            </p>
          </Reveal>
        </div>

        <Fig n="04">
          Screens captured from the ZOL app on the demo shop — the product,
          not a rendering of it.
        </Fig>
      </div>
    </section>
  );
}
