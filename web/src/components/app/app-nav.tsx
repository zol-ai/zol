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
  { href: "/app/repair-orders", label: "Repair orders" },
  { href: "/app/customers", label: "Customers" },
  { href: "/app/team", label: "Team", ownerOnly: true },
  { href: "/app/settings", label: "Settings" },
];

export function AppNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="shell flex h-[42px] items-stretch gap-5 overflow-x-auto border-t border-line"
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
  );
}
