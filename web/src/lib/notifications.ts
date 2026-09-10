import "server-only";

import { query, type Queryable } from "./db";

/**
 * The bell in the corner. Staff-facing only — a customer never sees one of
 * these; they get a follow-up (lib/follow-ups.ts).
 *
 * `staffId` null means the whole shop: "ZOL booked a car for 8am". Set it to
 * address one person: "your ticket #1042 was approved". The count in the
 * header is unread rows that are either everyone's or mine.
 */

export type NotificationKind =
  | "appointment"
  | "check_in"
  | "diagnosis"
  | "estimate"
  | "part"
  | "repair"
  | "invoice"
  | "payment"
  | "message"
  | "call"
  | "follow_up"
  | "system";

export interface Notification {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** A path inside the app, e.g. /app/repair-orders/<id>. */
  href?: string | null;
  staffId?: string | null;
}

export async function notifyShop(
  client: Queryable,
  shopId: string,
  notification: Notification,
): Promise<void> {
  await client.query(
    `INSERT INTO notifications (shop_id, staff_id, kind, title, body, href)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      shopId,
      notification.staffId ?? null,
      notification.kind,
      notification.title,
      notification.body ?? null,
      notification.href ?? null,
    ],
  );
}

/** What the header badge shows. One indexed count. */
export async function unreadNotifications(
  shopId: string,
  staffId: string,
): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM notifications
      WHERE shop_id = $1 AND read_at IS NULL
        AND (staff_id IS NULL OR staff_id = $2)`,
    [shopId, staffId],
  );
  return Number(rows[0]?.n ?? 0);
}
