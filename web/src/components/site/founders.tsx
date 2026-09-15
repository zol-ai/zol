import Image from "next/image";
import { founders, type FounderLink } from "@/lib/team";
import { Fig } from "./fig";
import { Reveal } from "./reveal";
import { SectionHead } from "./section-head";

/**
 * The founders. This is the one section of the page where nothing is
 * illustrative: the people are real, the photographs are of them, and every
 * link leaves the site for a public profile someone else hosts. That is the
 * point of it — a shop owner deciding whether to hand their phone line to a
 * piece of software should be able to see exactly who built it.
 */

function External() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M2.5 1.5h6v6M8.5 1.5 1.5 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function ProfileLink({ link, person }: { link: FounderLink; person: string }) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="me noopener noreferrer"
      aria-label={`${person} on ${link.label}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[0.8125rem] font-medium text-ink transition-colors hover:border-line-2 hover:bg-paper-3"
    >
      {link.label}
      <span className="text-ink-3">
        <External />
      </span>
    </a>
  );
}

export function Founders() {
  return (
    <section id="founders" className="band border-t border-line bg-paper-2">
      <div className="shell">
        <SectionHead
          n="06"
          label="Founders"
          title={
            <>
              Who&rsquo;s behind
              <br />
              ZOL
            </>
          }
          lede="Two technical founders, building in San Francisco, who spent two months embedded in independent mechanic shops. We didn't come to this market — we came from it."
        />

        <div className="mt-12 grid max-w-[58rem] gap-6 md:grid-cols-2 md:gap-8">
          {founders.map((person, i) => (
            <Reveal key={person.name} delay={i * 90}>
              <article className="card flex h-full flex-col overflow-hidden">
                <div className="story-img relative aspect-[4/5] border-b border-line bg-paper-3">
                  <Image
                    src={person.image}
                    alt={person.imageAlt}
                    fill
                    sizes="(min-width: 768px) 28rem, 100vw"
                    unoptimized
                    className="object-cover object-top"
                  />
                </div>

                <div className="flex flex-1 flex-col p-6 sm:p-7">
                  <p className="t-eyebrow text-[0.625rem]">{person.role}</p>
                  <h3 className="t-h3 mt-2 text-[1.5rem] text-ink sm:text-[1.75rem]">
                    {person.name}
                  </h3>

                  <ul className="mt-5 grid gap-2 border-t border-line pt-5">
                    {person.facts.map((fact) => (
                      <li
                        key={fact}
                        className="flex items-start gap-2.5 text-[0.875rem] text-ink-2"
                      >
                        <span
                          className="dot mt-[0.45rem] bg-ink-3"
                          aria-hidden="true"
                        />
                        {fact}
                      </li>
                    ))}
                  </ul>

                  {/*
                    Pushed to the foot of the card so both cards' link rows sit
                    on the same line even if one fact list runs longer.
                  */}
                  <div className="mt-auto flex flex-wrap gap-2 pt-6">
                    {person.links.map((link) => (
                      <ProfileLink
                        key={link.href}
                        link={link}
                        person={person.name}
                      />
                    ))}
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <Fig n="05">
          The founders — real names and photographs. The links go to public
          profiles off this site.
        </Fig>
      </div>
    </section>
  );
}
