import type { Metadata } from "next";

import { AppShell } from "@/components/app/shell";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = {
  // Nothing behind sign-in belongs in an index, and the shop's customer names
  // are in here.
  robots: { index: false, follow: false },
};

/**
 * Everything under /app is signed-in.
 *
 * The check here is for the chrome — the layout needs to know whose name to
 * put in the corner. It is *not* the security boundary: a layout can be
 * skipped when a child route is fetched on its own, so every page and every
 * action calls `requireUser` for itself as well.
 */
export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
