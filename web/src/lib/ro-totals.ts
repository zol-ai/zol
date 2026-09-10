import "server-only";

import { query, type Queryable } from "./db";

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
 *
 * A declined line stays on the ticket — it is the record of what was offered,
 * and the recall list is built from it — but it is not money the shop is
 * owed, so it is left out of both sums. Pending lines count: until the
 * customer answers, the total is the quote.
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
       WHERE l.approval <> 'declined'
       GROUP BY l.repair_order_id
    ) t
   WHERE ro.id = t.repair_order_id AND ro.shop_id = $1
`;

/** After a line is added, removed or answered. Runs inside the caller's transaction. */
export async function recalculateOne(
  client: Queryable,
  repairOrderId: string,
  shopId: string,
): Promise<void> {
  await client.query(`${RECALCULATE} AND ro.id = $2`, [shopId, repairOrderId]);

  // A ticket with no countable lines has no row in the aggregate above, so
  // the UPDATE cannot reach it. Zero it explicitly — that covers both the
  // last line being deleted and every line being declined.
  await client.query(
    `UPDATE repair_orders SET total_cents = 0
      WHERE id = $1 AND shop_id = $2
        AND NOT EXISTS (SELECT 1 FROM repair_order_lines
                         WHERE repair_order_id = $1 AND approval <> 'declined')`,
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

/** The breakdown a ticket, an estimate or an invoice prints under its lines. */
export interface Totals {
  subtotalCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
}

/** Same arithmetic as RECALCULATE, in TypeScript, for a set of lines already in hand. */
export function totalsFor(
  lines: { kind: string; total_cents: number; approval?: string }[],
  taxRatePct: number | string,
): Totals {
  const counted = lines.filter((line) => line.approval !== "declined");
  const subtotalCents = counted.reduce((sum, line) => sum + line.total_cents, 0);
  const taxableCents = counted
    .filter((line) => line.kind === "part" || line.kind === "fee")
    .reduce((sum, line) => sum + line.total_cents, 0);
  const taxCents = taxCentsFor(taxableCents, taxRatePct);
  return { subtotalCents, taxableCents, taxCents, totalCents: subtotalCents + taxCents };
}

/**
 * The tax on a taxable sum, to the cent, exactly as Postgres computes it.
 *
 * RECALCULATE multiplies in numeric(5,2) and rounds half away from zero, so
 * $410.00 at 6.35% is exactly 2603.5 and lands on 2604. The same product in
 * a double is 2603.4999999999995, and `Math.round` lands on 2603 — one cent
 * short, on the estimate and invoice but not on the ticket, for any rate and
 * amount that meet on a half cent. The rate is capped at two decimals, so
 * scaling it to whole hundredths of a percent makes the product an exact
 * integer and takes the doubles out of it.
 */
export function taxCentsFor(taxableCents: number, taxRatePct: number | string): number {
  const rateHundredths = Math.round(Number(taxRatePct) * 100);
  const raw = taxableCents * rateHundredths;
  return Math.sign(raw) * Math.floor((Math.abs(raw) + 5000) / 10000);
}
