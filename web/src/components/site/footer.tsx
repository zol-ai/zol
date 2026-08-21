import { nav, site } from "@/lib/site";
import { DemoButton } from "./demo-button";
import { Wordmark } from "./mark";

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
          </div>

          <div className="flex flex-col gap-8 sm:flex-row sm:gap-16">
            <nav aria-label="Footer">
              <p className="t-eyebrow text-[0.5625rem]">The product</p>
              {/* Padded rather than spaced, so each row is a comfortable tap target. */}
              <ul className="mt-2 space-y-0.5">
                {nav.map((item) => (
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

            <div>
              <p className="t-eyebrow text-[0.5625rem]">Talk to us</p>
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
            Shop data, calls and repair orders shown here are illustrative.
          </p>
        </div>
      </div>
    </footer>
  );
}
