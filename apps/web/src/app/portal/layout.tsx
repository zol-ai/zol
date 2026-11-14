import type { Metadata } from "next";

/**
 * The frame around a customer's repair page.
 *
 * Deliberately not the app shell: the person reading this is a customer on a
 * phone in a car park, not staff. No sidebar, no sign-in, no ZOL chrome — the
 * shop's name goes at the top (the page puts it there) and ZOL's at the very
 * bottom, small. Nothing here is indexable; every URL carries a token.
 */
export const metadata: Metadata = {
  title: "Your repair",
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <main className="flex min-h-dvh flex-col bg-paper-2 text-ink">
      <div className="mx-auto w-full max-w-[40rem] flex-1 px-4 pb-10 pt-5 sm:px-6 sm:pt-8">
        {children}
      </div>
      <footer className="border-t border-line bg-paper px-4 py-4 text-center text-[0.75rem] text-ink-3">
        This page is private to you — the link is the key, so don&apos;t forward it.
        <span className="mx-2">·</span>
        Powered by ZOL
      </footer>
    </main>
  );
}
