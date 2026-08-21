import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { query } from "./db";

/**
 * Sessions.
 *
 * The cookie carries 32 random bytes; the database stores only their SHA-256.
 * So the cookie is the credential, the table is not, and a leaked backup can't
 * be replayed as a login. No signature and no JWT: revocation has to be
 * immediate. When an owner disables an advisor, or that advisor signs out on
 * the shop's shared tablet, the next request must already be denied — a
 * stateless token can only expire, and "expires in 30 days" is not an answer
 * for a screen that sits logged in on a counter.
 *
 * Every read is one primary-key lookup on an already-warm pool. That is
 * cheaper than verifying a signature was going to be, and it is `cache`d for
 * the render pass so a page and its layout share one query.
 */

const COOKIE = "zol_session";
const TTL_DAYS = 30;
/** Rolling window: only touch the row when it's this stale, to avoid a write per request. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export type Role = "owner" | "advisor" | "tech";

export interface Session {
  staffId: string;
  shopId: string;
  email: string;
  fullName: string;
  role: Role;
  shopName: string;
  timezone: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a session and set the cookie. Only callable from a Server Action or
 * Route Handler — a Server Component cannot set a cookie, and Next throws
 * rather than silently dropping it.
 */
export async function startSession(
  staffId: string,
  shopId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (id, staff_id, shop_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hashToken(token),
      staffId,
      shopId,
      expires,
      meta?.userAgent?.slice(0, 400) ?? null,
      meta?.ip ?? null,
    ],
  );

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    // Lax, not Strict: a link from the shop's own email or a text has to land
    // the owner on the board already signed in. Lax still blocks the cross-site
    // POST that CSRF needs, and Server Actions check Origin on top of that.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await query("DELETE FROM sessions WHERE id = $1", [hashToken(token)]).catch(
      () => {
        // The cookie goes either way. A database blip must not strand somebody
        // signed in on a machine they're walking away from.
      },
    );
  }
  jar.delete(COOKIE);
}

/** Sign out every session for one person — used when a password changes. */
export async function endAllSessions(staffId: string): Promise<void> {
  await query("DELETE FROM sessions WHERE staff_id = $1", [staffId]);
}

/**
 * Who is asking, or null. `cache` dedupes this across the layout, the page and
 * every component that asks during a single render.
 */
export const currentUser = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const rows = await query<{
    staff_id: string;
    shop_id: string;
    email: string;
    full_name: string;
    role: Role;
    shop_name: string;
    timezone: string;
    stale: boolean;
  }>(
    `SELECT s.staff_id, s.shop_id, st.email, st.full_name, st.role,
            sh.name AS shop_name, sh.timezone,
            s.last_seen_at < now() - interval '1 millisecond' * $2 AS stale
       FROM sessions s
       JOIN staff st ON st.id = s.staff_id
       JOIN shops sh ON sh.id = s.shop_id
      WHERE s.id = $1
        AND s.expires_at > now()
        AND st.disabled_at IS NULL`,
    [hashToken(token), TOUCH_AFTER_MS],
  );

  const row = rows[0];
  if (!row) return null;

  if (row.stale) {
    // Rolling expiry: someone using the board every day never gets logged out,
    // and a session nobody has touched in 30 days dies. Fire-and-forget — the
    // page must not wait on a bookkeeping write.
    void query(
      `UPDATE sessions
          SET last_seen_at = now(),
              expires_at = now() + interval '1 day' * $2
        WHERE id = $1`,
      [hashToken(token), TTL_DAYS],
    ).catch(() => {});
  }

  return {
    staffId: row.staff_id,
    shopId: row.shop_id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    shopName: row.shop_name,
    timezone: row.timezone,
  };
});

/**
 * The gate every authenticated page and action goes through.
 *
 * Deliberately not a proxy/middleware check. Middleware runs before the route
 * and would have to re-implement the session read at the edge, away from the
 * pool; worse, it makes the protection a property of a URL pattern, so a route
 * added later that nobody remembers to match is simply public. Calling this
 * inside the thing that touches data means the check cannot be routed around.
 */
export async function requireUser(): Promise<Session> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

/** Same, plus a role floor. Owners can do anything an advisor can. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const user = await requireUser();
  if (user.role !== "owner" && !roles.includes(user.role)) {
    redirect("/app?denied=1");
  }
  return user;
}

/** Token for an invite or reset link: opaque, and stored only as a hash. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export { hashToken };
