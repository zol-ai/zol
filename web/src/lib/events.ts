import "server-only";

import type { Queryable } from "./db";
import type { RoStatus } from "./statuses";

/**
 * The ticket's history.
 *
 * Every state change on a repair order writes one of these — status moves,
 * who it was handed to, the estimate going out, the customer's answer, a part
 * arriving, the payment. It is what the timeline on the ticket renders, and
 * it is where "who approved that?" gets answered from a year later.
 *
 * `actor` is the app's one colour system: 'zol' means it happened with nobody
 * watching, 'person' means somebody pressed the button. Pass `staffId` for a
 * person whenever you have a session; the seam that can't (a webhook, the
 * follow-up worker) is by definition ZOL.
 */

export type RoEventKind =
  | "opened"
  | "checked_in"
  | "status_changed"
  | "assigned"
  | "priority_changed"
  | "note"
  | "diagnostic_added"
  | "diagnostic_verified"
  | "inspection_started"
  | "inspection_completed"
  | "line_added"
  | "line_removed"
  | "line_approval"
  | "estimate_sent"
  | "estimate_viewed"
  | "estimate_responded"
  | "part_added"
  | "part_updated"
  | "invoice_created"
  | "payment_recorded"
  | "message_sent"
  | "message_received"
  | "approved_over_cap"
  | "photo_added"
  | "closed";

export interface RoEvent {
  shopId: string;
  repairOrderId: string;
  kind: RoEventKind;
  /** One sentence, in shop language. Shown on the timeline verbatim. */
  detail?: string | null;
  fromStatus?: RoStatus | string | null;
  toStatus?: RoStatus | string | null;
  actor?: "zol" | "person";
  staffId?: string | null;
}

export async function logRoEvent(client: Queryable, event: RoEvent): Promise<void> {
  await client.query(
    `INSERT INTO repair_order_events
       (shop_id, repair_order_id, kind, detail, from_status, to_status, actor, staff_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.shopId,
      event.repairOrderId,
      event.kind,
      event.detail ?? null,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.actor ?? (event.staffId ? "person" : "zol"),
      event.staffId ?? null,
    ],
  );
}

/** One row of the timeline, as the ticket page reads it back. */
export interface RoEventRow {
  id: string;
  kind: RoEventKind;
  detail: string | null;
  from_status: string | null;
  to_status: string | null;
  actor: "zol" | "person";
  staff_name: string | null;
  created_at: string;
}

export async function listRoEvents(
  client: Queryable,
  shopId: string,
  repairOrderId: string,
  limit = 100,
): Promise<RoEventRow[]> {
  const { rows } = await client.query<RoEventRow>(
    `SELECT e.id, e.kind, e.detail, e.from_status, e.to_status, e.actor,
            s.full_name AS staff_name, e.created_at::text
       FROM repair_order_events e
       LEFT JOIN staff s ON s.id = e.staff_id
      WHERE e.repair_order_id = $1 AND e.shop_id = $2
      ORDER BY e.created_at DESC
      LIMIT $3`,
    [repairOrderId, shopId, limit],
  );
  return rows;
}
