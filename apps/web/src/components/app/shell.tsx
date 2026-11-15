import type { ReactNode } from "react";

import type { Session } from "@/lib/auth";
import { AppChrome } from "./app-chrome";

/**
 * The chrome around every signed-in screen. The interactive part — the
 * drawer, the ⌘K handler, the user menu — lives in `app-chrome.tsx` as a
 * client component; this is the server-side seam that decides what it's
 * told about the person and the shop.
 */
export function AppShell({
  user,
  unread = 0,
  children,
}: {
  user: Session;
  /** Unread notifications for the bell. */
  unread?: number;
  children: ReactNode;
}) {
  return (
    <AppChrome
      user={{ fullName: user.fullName, role: user.role, shopName: user.shopName }}
      unread={unread}
    >
      {children}
    </AppChrome>
  );
}

/** Page title block, so every screen sets its heading the same way. */
export function PageHead({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="t-eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="t-h2 text-[1.625rem] sm:text-[1.875rem]">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-ink-2">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
