import Image from "next/image";
import { featuredStory, stories, type Story } from "@/lib/shop-demo";
import { Fig } from "./fig";
import { ShopMarquee } from "./marquee";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

/**
 * Pilot-shop stories. Everything here — names, photos, numbers — is a
 * placeholder to be replaced with real shops, and the figure caption says so;
 * the section exists now so the page has the shape the real stories will
 * land in.
 */

function Byline({ story }: { story: Story }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="grid h-10 w-10 flex-none place-items-center rounded-full bg-ink text-[0.75rem] font-semibold text-paper"
        aria-hidden="true"
      >
        {story.initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[0.9375rem] font-semibold text-ink">
          {story.owner}
          <span className="font-normal text-ink-3"> · {story.role}</span>
        </p>
        <p className="t-data truncate text-[0.6875rem] text-ink-3">
          {story.shop} — {story.city}
        </p>
      </div>
    </div>
  );
}

export function Stories() {
  return (
    <section id="stories" className="band border-t border-line">
      <div className="shell">
        <SectionHead
          n="05"
          label="Shop stories"
          title={
            <>
              Shops that run
              <br />
              on ZOL
            </>
          }
          lede="Independent shops in the pilot, in their owners' words — what stopped slipping once the phone answered itself."
        />
      </div>

      {/* The pilot strip runs the full window width, edge to edge. */}
      <Reveal className="mt-10 border-y border-line bg-paper-2 py-4">
        <ShopMarquee />
      </Reveal>

      <div className="shell">
        {/* The featured story — the same fictional shop the whole page
            describes, closing the loop the hero opened. */}
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <Reveal>
            <div className="screen story-img relative aspect-[4/3]">
              <Image
                src={featuredStory.image}
                alt={featuredStory.imageAlt}
                fill
                sizes="(min-width: 1024px) 50vw, 100vw"
                unoptimized
                className="object-cover"
              />
            </div>
          </Reveal>

          <Reveal delay={90}>
            <blockquote>
              <p className="text-[1.1875rem] font-medium leading-relaxed text-ink sm:text-[1.375rem]">
                &ldquo;{featuredStory.quote}&rdquo;
              </p>
              <footer className="mt-6">
                <Byline story={featuredStory} />
              </footer>
            </blockquote>

            <dl className="mt-7 grid grid-cols-3 gap-4 border-t border-line pt-6">
              {featuredStory.stats.map((s) => (
                <div key={s.label}>
                  <dd className="t-num text-[1.75rem] text-ink sm:text-[2.125rem]">
                    {s.value}
                  </dd>
                  <dt className="mt-1 text-[0.75rem] leading-snug text-ink-3">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>

        {/* Two more, briefer. */}
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {stories.map((story, i) => (
            <Reveal key={story.shop} delay={i * 90}>
              <div className="card flex h-full flex-col overflow-hidden">
                <div className="story-img relative aspect-[16/9] border-b border-line">
                  <Image
                    src={story.image}
                    alt={story.imageAlt}
                    fill
                    sizes="(min-width: 768px) 50vw, 100vw"
                    unoptimized
                    className="object-cover"
                  />
                </div>
                <div className="flex flex-1 flex-col p-6 sm:p-7">
                  <blockquote className="flex-1">
                    <p className="text-[0.9375rem] leading-relaxed text-ink-2">
                      &ldquo;{story.quote}&rdquo;
                    </p>
                  </blockquote>
                  <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
                    <Byline story={story} />
                    {story.stats[0] && (
                      <div className="text-right">
                        <p className="t-num text-[1.5rem] text-ink">
                          {story.stats[0].value}
                        </p>
                        <p className="mt-0.5 text-[0.6875rem] leading-snug text-ink-3">
                          {story.stats[0].label}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Fig n="04">
          Pilot shop stories — names, photos and numbers are placeholders
        </Fig>
      </div>
    </section>
  );
}
