"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/auth";

/**
 * The section tabs.
 *
 * This list is the honest one: a tab appears here when the screen behind it
 * does something. Features land one at a time, and a nav full of dead links is
 * how a shop decides the product isn't finished.
 */
const TABS: { href: string; label: string; ownerOnly?: boolean }[] = [
  { href: "/app", label: "Today" },
  { href: "/app/schedule", label: "Schedule" },
  { href: "/app/repair-orders", label: "Repair orders" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/declined", label: "Declined" },
  { href: "/app/team", label: "Team", ownerOnly: true },
  { href: "/app/settings", label: "Settings" },
];

export function AppNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    /*
      Seven tabs don't fit a phone, and stacking them into a menu costs a tap
      on every screen change. They scroll sideways instead — the scrollbar
      hidden, and a fade on the right edge doing the job of saying there is
      more. Above md the row fits and the fade is gone.
    */
    <div className="relative border-t border-line">
      <nav
        aria-label="Sections"
        className="shell swipe-x flex h-[46px] items-stretch gap-5 sm:h-[42px]"
      >
        {TABS.filter((tab) => !tab.ownerOnly || role === "owner").map((tab) => {
          // "/app" would otherwise light up on every child route.
          const active =
            tab.href === "/app"
              ? pathname === "/app"
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center whitespace-nowrap border-b-2 text-[0.875rem] font-semibold transition-colors ${
                active
                  ? "border-emerald-deep text-ink"
                  : "border-transparent text-ink-3 hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper to-transparent md:hidden"
      />
    </div>
  );
}
