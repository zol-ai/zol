import Link from "next/link";
import { nav, site } from "@/lib/site";
import { DemoButton } from "./demo-button";
import { Wordmark } from "./mark";

/*
  The page's section links live in `nav`; the About page is a route, not a
  section, so it goes in the company column instead of "On this page".
*/
const sections = nav.filter((item) => item.href.startsWith("/#"));

const company = [
  { label: "About ZOL", href: site.aboutPath },
  { label: "Set up your shop", href: site.signupPath },
  { label: "Sign in", href: site.signinPath },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-line bg-paper-2">
      <div className="shell py-12">
        <div className="flex flex-col gap-9 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-3">
              AI shop management for independent auto repair shops. One system
              that answers, books, quotes, chases and follows up — and keeps
              the record while it does.
            </p>
            <p className="t-data mt-4 text-[0.75rem] text-ink-3">
              {site.name} · {site.company.city}, {site.company.region}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:flex sm:gap-16">
            <nav aria-label="Footer">
              <p className="t-eyebrow text-[0.5625rem]">On this page</p>
              {/* Padded rather than spaced, so each row is a comfortable tap target. */}
              <ul className="mt-2 space-y-0.5">
                {sections.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="block py-2 text-[0.875rem] text-ink-2 transition-colors hover:text-ink"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label="Company">
              <p className="t-eyebrow text-[0.5625rem]">Company</p>
              <ul className="mt-2 space-y-0.5">
                {company.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="block py-2 text-[0.875rem] text-ink-2 transition-colors hover:text-ink"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="col-span-2 sm:col-span-1">
              <p className="t-eyebrow text-[0.5625rem]">Talk to us</p>
              {/*
                The email and the demo. "Join waitlist" used to lead this list
                and came off on 2026-09-15 — see `waitlistPath` in lib/site.ts.
              */}
              <ul className="mt-2 space-y-0.5">
                <li>
                  <a
                    href={`mailto:${site.contactEmail}`}
                    className="block py-2 text-[0.875rem] text-ink-2 transition-colors hover:text-ink"
                  >
                    {site.contactEmail}
                  </a>
                </li>
              </ul>
              <DemoButton variant="ghost" size="sm" className="mt-4" />
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="t-data text-[0.75rem] text-ink-3">
            © {new Date().getFullYear()} {site.name}. All rights reserved.
          </p>
          <p className="t-data text-[0.75rem] text-ink-3">
            The board, ticket and call examples above use sample data. The
            product screens are from the app.
          </p>
        </div>
      </div>
    </footer>
  );
}
