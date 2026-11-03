import type { ReactNode } from "react";

import { Footer } from "./footer";
import { Nav } from "./nav";

/**
 * The frame for the privacy policy and the SMS terms: nav, a title block
 * with the effective date, numbered sections in a readable column, footer.
 * Plain on purpose — these are read by carrier reviewers and lawyers, not
 * sold to anyone.
 */
export function LegalPage({
  title,
  effective,
  intro,
  children,
}: {
  title: string;
  effective: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Nav />

      <main id="main" className="flex-1">
        <section className="band">
          <div className="shell">
            <div className="max-w-3xl">
              <p className="t-eyebrow">Legal</p>
              <h1 className="t-h2 mt-4 text-[2rem] sm:text-[2.625rem]">{title}</h1>
              <p className="t-data mt-4 text-[0.8125rem] text-ink-3">
                Effective {effective}
              </p>
              <div className="mt-6 text-[1rem] leading-relaxed text-ink-2">{intro}</div>

              <div className="mt-10 space-y-10">{children}</div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="t-h3 text-[1.25rem] sm:text-[1.375rem]">{title}</h2>
      <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed text-ink-2 [&_a]:font-semibold [&_a]:text-ink [&_a]:underline [&_a]:decoration-line-2 [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
