"use client";

import {
  BriefcaseBusiness,
  CheckSquare2,
  FileText,
  LayoutDashboard,
  LogOut,
  PanelsTopLeft,
  Menu,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn, initials } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: CheckSquare2 },
  { href: "/cards", label: "Cards", icon: PanelsTopLeft },
  { href: "/team", label: "Team", icon: Users },
  { href: "/clients", label: "CRM", icon: BriefcaseBusiness },
];

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name: string; email: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  const sidebar = (
    <>
      <div className="flex h-16 items-center gap-3 border-b px-5">
        <div className="grid size-9 place-items-center rounded-lg bg-blue-600 font-bold text-white">
          C
        </div>
        <div>
          <p className="font-semibold leading-tight">Company OS</p>
          <p className="text-xs text-slate-500">Team workspace</p>
        </div>
      </div>
      <nav aria-label="Primary navigation" className="flex-1 space-y-1 p-3">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
              pathname === href
                ? "bg-blue-50 text-blue-700"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
        <div
          aria-disabled="true"
          className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400"
        >
          <FileText size={18} />
          <span>Documents</span>
          <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">Soon</span>
        </div>
      </nav>
      <div className="border-t p-3">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <div className="grid size-9 place-items-center rounded-full bg-slate-100 text-xs font-semibold">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            aria-label="Sign out"
            onClick={logout}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-white lg:flex">
        {sidebar}
      </aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 flex-col bg-white shadow-xl">
            <button
              aria-label="Close navigation"
              className="absolute right-3 top-4 z-10 rounded p-2"
              onClick={() => setMobileOpen(false)}
            >
              <X size={20} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-white/95 px-4 backdrop-blur lg:hidden">
        <button
          aria-label="Open navigation"
          className="rounded-lg border p-2"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} />
        </button>
        <p className="ml-3 font-semibold">Company OS</p>
      </header>
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
