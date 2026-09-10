import "server-only";

import { query } from "@/lib/db";
import type { FollowUpCardData } from "./follow-up-card";

/**
 * The one query behind every follow-up card.
 *
 * The CRM shows the shop's whole worklist, a customer's page shows theirs, a
 * vehicle's page shows the ones about that car — same card, same columns,
 * same joins, so the three screens cannot drift on what a card knows.
 */

export interface FollowUpFilter {
  customerId?: string;
  vehicleId?: string;
  /** Defaults to pending. */
  statuses?: readonly string[];
  /** Only rows whose time has come (pending), or only rows still ahead. */
  when?: "due" | "scheduled";
  /** `scheduled` = soonest first; `recent` = most recently sent or closed first. */
  order?: "scheduled" | "recent";
  limit?: number;
}

export async function listFollowUps(
  shopId: string,
  filter: FollowUpFilter = {},
): Promise<FollowUpCardData[]> {
  const orderBy =
    filter.order === "recent"
      ? "coalesce(f.completed_at, f.sent_at, f.updated_at) DESC"
      : "f.scheduled_for ASC";

  return query<FollowUpCardData>(
    `SELECT f.id, f.kind, f.status, f.title, f.details, f.body, f.ai_draft, f.ai_source,
            f.channel, f.source,
            f.scheduled_for::text, f.sent_at::text, f.completed_at::text,
            (f.status = 'pending' AND f.scheduled_for <= now()) AS due,
            f.last_error, f.attempts,
            f.customer_id, c.full_name AS customer_name, c.phone AS customer_phone,
            c.sms_opted_out, c.preferred_contact,
            f.vehicle_id,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            f.repair_order_id, ro.number AS ro_number,
            f.declined_work_id,
            m.channel AS sent_via,
            cb.full_name AS completed_by_name
       FROM follow_ups f
       JOIN customers c ON c.id = f.customer_id
       LEFT JOIN vehicles v ON v.id = f.vehicle_id
       LEFT JOIN repair_orders ro ON ro.id = f.repair_order_id
       LEFT JOIN staff cb ON cb.id = f.completed_by
       LEFT JOIN LATERAL (
         SELECT channel FROM messages m
          WHERE m.follow_up_id = f.id
          ORDER BY m.created_at DESC
          LIMIT 1
       ) m ON true
      WHERE f.shop_id = $1
        AND ($2::uuid IS NULL OR f.customer_id = $2)
        AND ($3::uuid IS NULL OR f.vehicle_id = $3)
        AND f.status = ANY($4::text[])
        AND ($5::text IS NULL
             OR ($5 = 'due' AND f.scheduled_for <= now())
             OR ($5 = 'scheduled' AND f.scheduled_for > now()))
      ORDER BY ${orderBy}
      LIMIT $6`,
    [
      shopId,
      filter.customerId ?? null,
      filter.vehicleId ?? null,
      filter.statuses ?? ["pending"],
      filter.when ?? null,
      filter.limit ?? 100,
    ],
  );
}
