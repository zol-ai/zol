/**
 * Money is integer cents everywhere — in the schema, in every query, in every
 * total. It becomes a string only at the edge, here, and it becomes a number
 * only when a human typed one.
 *
 * Floating point is not a rounding annoyance in this product; it is a customer
 * being quoted $1,247.99 on the phone and invoiced $1,248.01 at the counter.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}

/** Dollars as typed by a human → integer cents, or undefined if it isn't money. */
export function parseCents(raw: string): number | undefined {
  const cleaned = raw.replace(/[$,\s]/g, "");
  // Leading minus allowed: a discount line is negative money.
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Book hours or part counts. Two decimals, matching numeric(8,2) in the
 * schema — 0.3 hours is a real labour line and 1/3 of a part is not.
 */
export function parseQuantity(raw: string): number | undefined {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return value > 0 && value <= 9999 ? value : undefined;
}
