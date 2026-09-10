import "server-only";

import { query, type Queryable } from "./db";
import { hashToken, newToken } from "./tokens";

/**
 * How a customer with no account reaches their own repair.
 *
 * One opaque token per link, texted to them, and stored only as its SHA-256
 * — the same rule sessions and invites follow, so a dump of the table opens
 * nobody's repair. Because only the hash is kept, a raw token can't be looked
 * up again later: every message that needs a link mints a fresh token. Old
 * ones stay valid until they expire, so a customer tapping last week's text
 * still lands on the right page — unless the shop has cut them off, which
 * `revokePortalTokens` does when the number they were texted to turns out
 * to have been the wrong one.
 */

const TTL_DAYS = 90;

export interface PortalAccess {
  tokenId: string;
  shopId: string;
  customerId: string;
  repairOrderId: string;
}

/** A new link for this ticket. Returns the raw token; only the hash is stored. */
export async function mintPortalToken(
  client: Queryable,
  access: { shopId: string; customerId: string; repairOrderId: string },
): Promise<string> {
  const { token, hash } = newToken();
  await client.query(
    `INSERT INTO portal_tokens (shop_id, customer_id, repair_order_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '1 day' * $5)`,
    [access.shopId, access.customerId, access.repairOrderId, hash, TTL_DAYS],
  );
  return token;
}

export function portalPath(token: string): string {
  return `/portal/${token}`;
}

/**
 * Cut off every live link this customer holds at this shop, or just the
 * ones for one ticket.
 *
 * The case that needs it: an estimate text went to a mistyped number, the
 * counter noticed and corrected it, and whoever owns that number is still
 * holding a link that reads the diagnosis, answers the estimate and writes
 * to the shop as the customer — for ninety days, if nothing is done. A
 * revoked token fails `resolvePortalToken` the same way an expired one
 * does, and the next message to the right number mints a fresh one.
 */
export async function revokePortalTokens(
  client: Queryable,
  scope: { shopId: string; customerId: string; repairOrderId?: string | null },
): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE portal_tokens SET revoked_at = now()
      WHERE shop_id = $1 AND customer_id = $2 AND revoked_at IS NULL
        AND ($3::uuid IS NULL OR repair_order_id = $3)`,
    [scope.shopId, scope.customerId, scope.repairOrderId ?? null],
  );
  return rowCount ?? 0;
}

/**
 * Who a token lets in, or null. Marks the visit in passing — `last_viewed_at`
 * is how the estimate screen shows "opened Tuesday 4:12pm" without a tracking
 * pixel — and does so fire-and-forget so the page never waits on it.
 */
export async function resolvePortalToken(token: string): Promise<PortalAccess | null> {
  if (!token || token.length > 200) return null;
  const hash = hashToken(token);

  const rows = await query<{
    id: string;
    shop_id: string;
    customer_id: string;
    repair_order_id: string;
  }>(
    `SELECT id, shop_id, customer_id, repair_order_id
       FROM portal_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hash],
  );

  const row = rows[0];
  if (!row) return null;

  void query("UPDATE portal_tokens SET last_viewed_at = now() WHERE id = $1", [row.id]).catch(
    () => {},
  );

  return {
    tokenId: row.id,
    shopId: row.shop_id,
    customerId: row.customer_id,
    repairOrderId: row.repair_order_id,
  };
}
