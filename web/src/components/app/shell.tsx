import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { Wordmark } from "@/components/site/mark";
import type { Session } from "@/lib/auth";
import { AppNav } from "./app-nav";

/**
 * The chrome around every signed-in screen.
 *
 * A single top bar rather than a sidebar: the shop's counter machine is often
 * a laptop or a tablet held sideways, and horizontal space is the scarce one
 * once a repair order with parts lines is on screen.
 */
export function AppShell({
  user,
  children,
}: {
  user: Session;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper-2">
      <header className="sticky top-0 z-40 border-b border-line bg-paper">
        <div className="shell flex h-[60px] items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/app" aria-label="ZOL">
              <Wordmark size={26} />
            </Link>
            <span className="hidden h-5 w-px bg-line-2 sm:block" />
            <span className="hidden truncate text-[0.875rem] font-semibold text-ink-2 sm:block">
              {user.shopName}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-right text-[0.8125rem] leading-tight text-ink-3 md:block">
              <span className="block font-semibold text-ink-2">
                {user.fullName}
              </span>
              <span className="t-data text-[0.6875rem] uppercase tracking-wider">
                {user.role}
              </span>
            </span>
            {/*
              A form, not a link: signing out is a state change, and a GET that
              mutates gets fired by every link prefetcher and antivirus proxy
              that walks the page.
            */}
            <form action={signOut}>
              <button type="submit" className="btn btn-ghost btn-sm">
                Sign out
              </button>
            </form>
          </div>
        </div>

        <AppNav role={user.role} />
      </header>

      <main className="shell w-full flex-1 py-6 sm:py-8">{children}</main>
    </div>
  );
}

/** Page title block, so every screen sets its heading the same way. */
export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="t-eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="t-h2 text-[1.75rem] sm:text-[2rem]">{title}</h1>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
