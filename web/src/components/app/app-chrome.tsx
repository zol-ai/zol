"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  CalendarDays,
  Car,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  FileText,
  Gauge,
  HeartHandshake,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Package,
  PhoneCall,
  Receipt,
  Search,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { Wordmark } from "@/components/site/mark";
import type { Role } from "@/lib/auth";
import { initials } from "@/lib/format";

/**
 * The chrome around every signed-in screen: a sidebar on a laptop, a drawer
 * on a phone, and a thin bar on top with search, the bell and the way out.
 *
 * A sidebar now, where there used to be a row of tabs. Seven tabs fit across
 * a phone with a fade; seventeen sections do not, and a shop that opens the
 * app looking for "Parts" should find the word, not a scroll. The sidebar
 * takes the dark panel tokens so the working area stays paper.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

/**
 * The honest list: a section appears here when the screen behind it does
 * something. Ordered the way a day runs — what's coming in, what's in the
 * shop, what's going out, then the tools.
 */
const NAV: { heading?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/app", label: "Today", icon: LayoutDashboard },
      { href: "/app/calls", label: "Calls", icon: PhoneCall },
      { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
    ],
  },
  {
    heading: "In the shop",
    items: [
      { href: "/app/repair-orders", label: "Repair orders", icon: Wrench },
      { href: "/app/inspections", label: "Inspections", icon: ClipboardCheck },
      { href: "/app/estimates", label: "Estimates", icon: FileText },
      { href: "/app/parts", label: "Parts", icon: Package },
      { href: "/app/technicians", label: "Technicians", icon: Gauge },
    ],
  },
  {
    heading: "People",
    items: [
      { href: "/app/customers", label: "Customers", icon: Users },
      { href: "/app/vehicles", label: "Vehicles", icon: Car },
      { href: "/app/messages", label: "Messages", icon: MessageSquare },
      { href: "/app/crm", label: "Follow-ups", icon: HeartHandshake },
    ],
  },
  {
    heading: "Money",
    items: [
      { href: "/app/invoices", label: "Invoices", icon: Receipt },
      { href: "/app/payments", label: "Payments", icon: CreditCard },
    ],
  },
  {
    heading: "Shop",
    items: [
      { href: "/app/assistant", label: "Ask ZOL", icon: Sparkles },
      { href: "/app/team", label: "Team", icon: UserPlus, ownerOnly: true },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export interface ChromeUser {
  fullName: string;
  role: Role;
  shopName: string;
}

function isActive(pathname: string, href: string): boolean {
  // "/app" would otherwise light up on every child route.
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

function Sidebar({
  role,
  pathname,
  shopName,
  onNavigate,
}: {
  role: Role;
  pathname: string;
  shopName: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-panel text-panel-fg">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/app" aria-label="ZOL — Today" onClick={onNavigate}>
          <Wordmark size={24} tone="panel" />
        </Link>
        {onNavigate && (
          <button
            type="button"
            onClick={onNavigate}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-[var(--radius)] text-panel-fg-2 hover:bg-white/10 hover:text-panel-fg lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Sections" className="flex-1 overflow-y-auto px-2.5 pb-4">
        {NAV.map((group, index) => {
          const items = group.items.filter((item) => !item.ownerOnly || role === "owner");
          if (items.length === 0) return null;
          return (
            <div key={group.heading ?? index} className={index === 0 ? "" : "mt-4"}>
              {group.heading && (
                <p className="t-eyebrow px-2.5 pb-1.5 text-[0.625rem] text-panel-fg-2/80">
                  {group.heading}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-[var(--radius)] px-2.5 py-2 text-[0.875rem] font-medium transition-colors ${
                          active
                            ? "bg-white/10 text-panel-fg shadow-[inset_3px_0_0_var(--emerald)]"
                            : "text-panel-fg-2 hover:bg-white/5 hover:text-panel-fg"
                        }`}
                      >
                        <Icon
                          className={`h-[18px] w-[18px] flex-none ${active ? "text-emerald" : ""}`}
                          aria-hidden="true"
                        />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-panel-line px-4 py-3">
        <p className="truncate text-[0.8125rem] font-semibold text-panel-fg">{shopName}</p>
        <p className="t-data text-[0.6875rem] uppercase tracking-wider text-panel-fg-2">
          Shop OS
        </p>
      </div>
    </div>
  );
}

export function AppChrome({
  user,
  unread,
  children,
}: {
  user: ChromeUser;
  unread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // The drawer closes itself when a link is followed; this covers the back
  // button and anything else that moves the route underneath it. State
  // adjusted during render rather than in an effect, which is the pattern
  // React documents for "reset this when that prop changes".
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  // ⌘K / Ctrl+K from anywhere lands on search, the way every tool the
  // advisor already uses does it.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        router.push("/app/search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="min-h-dvh bg-paper-2 lg:pl-[15.5rem]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[15.5rem] lg:block">
        <Sidebar role={user.role} pathname={pathname} shopName={user.shopName} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/50"
          />
          <aside className="relative h-full w-[min(18rem,86vw)] shadow-2xl">
            <Sidebar
              role={user.role}
              pathname={pathname}
              shopName={user.shopName}
              onNavigate={() => setOpen(false)}
            />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 flex-none place-items-center rounded-[var(--radius)] border border-line-2 bg-paper text-ink lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <Link
            href="/app/search"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius)] border border-line-2 bg-paper px-3 text-[0.875rem] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-2 sm:max-w-md"
          >
            <Search className="h-4 w-4 flex-none" aria-hidden="true" />
            <span className="truncate">Search customers, plates, VINs, tickets…</span>
            <kbd className="t-data ml-auto hidden rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[0.625rem] text-ink-3 md:block">
              ⌘K
            </kbd>
          </Link>

          <Link
            href="/app/notifications"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative grid h-9 w-9 flex-none place-items-center rounded-[var(--radius)] border border-line-2 bg-paper text-ink transition-colors hover:bg-paper-2"
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
            {unread > 0 && (
              <span className="t-data absolute -right-1 -top-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-emerald-deep px-1 text-[0.625rem] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>

          {/*
            Keyed on the route: an open <details> is DOM state React never
            touches, and this header outlives every navigation, so without
            the key the menu would still be hanging open over /app/settings
            after "Settings" was clicked.
          */}
          <details key={pathname} className="relative flex-none">
            <summary className="flex list-none items-center gap-2 rounded-[var(--radius)] border border-line-2 bg-paper p-1 pr-2 text-left [&::-webkit-details-marker]:hidden">
              <span
                aria-hidden="true"
                className="grid h-7 w-7 place-items-center rounded-full bg-emerald-wash text-[0.6875rem] font-semibold text-emerald-deep"
              >
                {initials(user.fullName)}
              </span>
              <span className="hidden sm:block">
                <span className="block text-[0.8125rem] font-semibold leading-tight text-ink">
                  {user.fullName}
                </span>
                <span className="t-data block text-[0.625rem] uppercase tracking-wider text-ink-3">
                  {user.role}
                </span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-48 rounded-[var(--radius)] border border-line bg-paper p-1 shadow-lg">
              <Link
                href="/app/settings"
                className="block rounded-[4px] px-3 py-2 text-[0.875rem] text-ink hover:bg-paper-2"
              >
                Settings
              </Link>
              {/*
                A form, not a link: signing out is a state change, and a GET
                that mutates gets fired by every link prefetcher and antivirus
                proxy that walks the page.
              */}
              <form action={signOut}>
                <button
                  type="submit"
                  className="block w-full rounded-[4px] px-3 py-2 text-left text-[0.875rem] text-ink hover:bg-paper-2"
                >
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[88rem] px-3 py-5 sm:px-5 sm:py-6 lg:px-6">
        {children}
      </main>
    </div>
  );
}
