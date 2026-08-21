import "server-only";

import type { PoolClient } from "pg";

import { query } from "./db";

/**
 * The one place a repair order's total is computed.
 *
 * `repair_orders.total_cents` is derived from the lines beneath it and from
 * the shop's tax rate. It is stored rather than computed on read because the
 * board shows a hundred tickets at once and summing every line for each of
 * them turns one query into a hundred — but stored means it can go stale, so
 * every write that could change it comes through here.
 *
 * Tax lands on parts and fees, not on labour. That is how California works,
 * which is where the first shops are. A shop in a state that taxes labour
 * sets its rate to 0 and adds a fee line, rather than being quietly
 * overcharged by a default nobody chose. The ticket spells out which lines
 * the tax hit, so it is never a mystery number.
 */

const RECALCULATE = `
  UPDATE repair_orders ro
     SET total_cents = t.subtotal + t.tax
    FROM (
      SELECT l.repair_order_id,
             coalesce(sum(l.total_cents), 0)::int AS subtotal,
             round(
               coalesce(
                 sum(l.total_cents) FILTER (WHERE l.kind IN ('part', 'fee')),
                 0)
               * (SELECT tax_rate_pct FROM shops WHERE id = $1) / 100
             )::int AS tax
        FROM repair_order_lines l
       GROUP BY l.repair_order_id
    ) t
   WHERE ro.id = t.repair_order_id AND ro.shop_id = $1
`;

/** After a line is added or removed. Runs inside the caller's transaction. */
export async function recalculateOne(
  client: PoolClient,
  repairOrderId: string,
  shopId: string,
): Promise<void> {
  await client.query(`${RECALCULATE} AND ro.id = $2`, [shopId, repairOrderId]);

  // A ticket whose last line was just deleted has no rows in the aggregate
  // above, so the UPDATE above cannot reach it. Zero it explicitly.
  await client.query(
    `UPDATE repair_orders SET total_cents = 0
      WHERE id = $1 AND shop_id = $2
        AND NOT EXISTS (SELECT 1 FROM repair_order_lines
                         WHERE repair_order_id = $1)`,
    [repairOrderId, shopId],
  );
}

/**
 * After the shop's tax rate changes.
 *
 * Only tickets that are still open: a closed one is a record of what was
 * actually charged at the time, and restating it to match today's tax rate
 * would rewrite history the shop has already invoiced.
 */
export async function recalculateOpen(shopId: string): Promise<void> {
  await query(
    `${RECALCULATE} AND ro.status NOT IN ('closed', 'cancelled')`,
    [shopId],
  );
}
