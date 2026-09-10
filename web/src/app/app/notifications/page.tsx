import {
  Bell,
  CalendarDays,
  CreditCard,
  FileText,
  HeartHandshake,
  KeyRound,
  MessageSquare,
  Package,
  PhoneCall,
  Receipt,
  Stethoscope,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { markAllRead, openNotification } from "@/app/actions/notifications";
import { PageHead } from "@/components/app/shell";
import { EmptyState } from "@/components/app/ui";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import type { NotificationKind } from "@/lib/notifications";

export const metadata = { title: "Notifications" };

/**
 * The bell, opened. Everything addressed to the whole shop plus everything
 * addressed to this person, newest first, unread rows emphasised. Each row
 * is a form, not a link: opening one is a state change (it becomes read)
 * followed by a redirect, and a GET that mutates gets fired by every link
 * prefetcher that walks the page.
 */

interface Row {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  mine: boolean;
}

const ICON: Record<NotificationKind, LucideIcon> = {
  appointment: CalendarDays,
  check_in: KeyRound,
  diagnosis: Stethoscope,
  estimate: FileText,
  part: Package,
  repair: Wrench,
  invoice: Receipt,
  payment: CreditCard,
  message: MessageSquare,
  call: PhoneCall,
  follow_up: HeartHandshake,
  system: Bell,
};

export default async function NotificationsPage() {
  const user = await requireUser();

  const rows = await query<Row>(
    `SELECT n.id, n.kind, n.title, n.body, n.href, n.read_at::text, n.created_at::text,
            n.staff_id IS NOT NULL AS mine
       FROM notifications n
      WHERE n.shop_id = $1
        AND (n.staff_id IS NULL OR n.staff_id = $2)
      ORDER BY n.created_at DESC
      LIMIT 100`,
    [user.shopId, user.staffId],
  );

  const unread = rows.filter((row) => row.read_at === null).length;

  return (
    <>
      <PageHead
        eyebrow={user.shopName}
        title="Notifications"
        description={
          unread === 0
            ? "You're caught up."
            : `${unread} unread. Opening one marks it read and takes you to it.`
        }
      >
        {unread > 0 && (
          <form action={markAllRead}>
            <button type="submit" className="btn btn-ghost btn-sm">
              Mark all read
            </button>
          </form>
        )}
      </PageHead>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing yet"
            detail="When ZOL books a car, a customer opens an estimate, a part lands or a text comes in, it shows up here."
          />
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((row) => {
            const Icon = ICON[row.kind] ?? Bell;
            const isUnread = row.read_at === null;
            return (
              <li key={row.id}>
                <form action={openNotification}>
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper-2 sm:px-5 ${
                      isUnread ? "" : "opacity-70"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-[var(--radius)] ${
                        isUnread ? "wash-zol" : "wash-neutral"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span
                          className={`text-[0.9375rem] text-ink ${
                            isUnread ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {row.title}
                          {isUnread && (
                            <>
                              <span
                                aria-hidden="true"
                                className="ml-2 inline-block h-2 w-2 rounded-full bg-emerald align-middle"
                              />
                              <span className="sr-only"> (unread)</span>
                            </>
                          )}
                        </span>
                        <span className="t-data flex-none text-[0.75rem] text-ink-3">
                          {formatRelative(row.created_at, user.timezone)}
                        </span>
                      </span>
                      {row.body && (
                        <span className="mt-0.5 block text-[0.875rem] leading-relaxed text-ink-2">
                          {row.body}
                        </span>
                      )}
                      {row.mine && (
                        <span className="tag tag-neutral mt-1.5">Just you</span>
                      )}
                    </span>
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
