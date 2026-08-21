"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { nav } from "@/lib/site";
import { DemoButton } from "./demo-button";
import { Wordmark } from "./mark";

export function Nav() {
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        lifted
          ? "border-b border-line bg-paper/85 backdrop-blur-md"
          : "border-b border-transparent bg-paper"
      }`}
    >
      <div className="shell flex h-[64px] items-center justify-between gap-6">
        <Link href="/" className="shrink-0" aria-label="ZOL home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[0.875rem] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          {/*
            Shops that already use ZOL arrive here first and look for the way
            in. The signed-in check happens on /signin itself, which bounces
            an existing session straight to the board.
          */}
          <Link
            href="/signin"
            className="hidden text-[0.875rem] font-medium text-ink-2 transition-colors hover:text-ink sm:block"
          >
            Sign in
          </Link>
          <DemoButton size="sm" className="hidden sm:inline-flex" />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-10 w-10 place-items-center rounded-md border border-line text-ink md:hidden"
          >
            <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
              <path
                d={open ? "M2 1 14 11M14 1 2 11" : "M0 1h16M0 6h16M0 11h16"}
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="border-t border-line bg-paper md:hidden"
        >
          <div className="shell flex flex-col py-3">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-3 text-[0.9375rem] font-medium text-ink-2 last:border-0"
              >
                {item.label}
              </a>
            ))}
            <Link
              href="/signin"
              onClick={() => setOpen(false)}
              className="py-3 text-[0.9375rem] font-medium text-ink-2"
            >
              Sign in
            </Link>
            <DemoButton className="mt-1 w-full" />
          </div>
        </div>
      )}
    </header>
  );
}
