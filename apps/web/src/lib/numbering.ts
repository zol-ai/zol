import "server-only";

import type { Queryable } from "./db";

/**
 * Human-facing numbers: the one on the paper ticket, the one on the estimate,
 * the one on the invoice. Per shop, sequential, never reused.
 *
 * A counter on the shop row rather than a sequence, for the reason
 * 0002_repair_orders.sql gives: `UPDATE ... RETURNING` takes a row lock, so
 * two advisors sending estimates at the same instant queue behind each other
 * and get consecutive numbers instead of both reading the same max. It has to
 * run inside the caller's transaction so a failed insert rolls the number
 * back too — a shop that skips from 2041 to 2043 will ask why.
 */

const COLUMN = {
  ro: "ro_number_seq",
  estimate: "estimate_number_seq",
  invoice: "invoice_number_seq",
} as const;

export type NumberKind = keyof typeof COLUMN;

export async function nextNumber(
  client: Queryable,
  shopId: string,
  kind: NumberKind,
): Promise<number> {
  // The identifier is one of three compile-time constants, never caller input.
  const column = COLUMN[kind];
  const { rows } = await client.query<{ n: number }>(
    `UPDATE shops SET ${column} = ${column} + 1 WHERE id = $1 RETURNING ${column} AS n`,
    [shopId],
  );
  const next = rows[0]?.n;
  if (next === undefined) throw new Error(`No shop ${shopId} to number a ${kind} for.`);
  return next;
}
