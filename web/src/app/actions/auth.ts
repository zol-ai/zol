"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { query, tx } from "@/lib/db";
import { decoyHash, hashPassword, verifyPassword } from "@/lib/password";
import {
  endAllSessions,
  endSession,
  hashToken,
  newToken,
  requireRole,
  requireUser,
  startSession,
} from "@/lib/auth";

/**
 * Everything that creates or destroys a session.
 *
 * All of it is Server Actions rather than route handlers: Next verifies the
 * Origin header against the Host on every action call, so the CSRF token a
 * hand-rolled POST endpoint would need is already handled, and the form still
 * submits with JavaScript switched off.
 */

export interface FormState {
  error?: string;
  /** Field-specific message, keyed by input name, for inline display. */
  fields?: Record<string, string>;
  /** Filled back into the form so a failed submit doesn't clear typing. */
  values?: Record<string, string>;
}

/** Failed sign-ins allowed for one email before it's locked, and for how long. */
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MINUTES = 15;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function passwordProblem(password: string): string | undefined {
  if (password.length < 10) return "At least 10 characters.";
  if (password.length > 200) return "That's too long.";
  // Length is the control that matters, and extra rules mostly produce
  // Password1! — but a single repeated character is a real hole, so reject
  // the degenerate case only.
  if (/^(.)\1*$/.test(password)) return "Too repetitive to be a password.";
  return undefined;
}

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    // Vercel sets this. Behind Cloud Run it's the load balancer's list, whose
    // first entry is the client.
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}

// -----------------------------------------------------------------------------
// Sign up — a new shop and its owner
// -----------------------------------------------------------------------------

export async function signUp(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const shopName = text(form, "shop_name");
  const fullName = text(form, "full_name");
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const code = text(form, "code");

  const values = { shop_name: shopName, full_name: fullName, email };
  const fields: Record<string, string> = {};

  if (shopName.length < 2) fields.shop_name = "What's the shop called?";
  if (fullName.length < 2) fields.full_name = "Your name, as customers hear it.";
  if (!EMAIL.test(email)) fields.email = "That doesn't look like an email.";
  const bad = passwordProblem(password);
  if (bad) fields.password = bad;

  /*
    Open sign-up until there's a reason not to have it, but leave a switch:
    setting ZOL_SIGNUP_CODE closes the door without a deploy. Shops that call
    in get the code; nobody else gets a tenant.
  */
  const expected = process.env.ZOL_SIGNUP_CODE;
  if (expected && code !== expected) fields.code = "That code isn't right.";

  if (Object.keys(fields).length > 0) return { fields, values };

  const taken = await query<{ one: number }>(
    "SELECT 1 AS one FROM staff WHERE lower(email) = $1",
    [email],
  );
  if (taken.length > 0) {
    return {
      values,
      fields: { email: "There's already an account on this address." },
    };
  }

  const passwordHash = await hashPassword(password);

  const created = await tx(async (client) => {
    const shop = await client.query<{ id: string }>(
      "INSERT INTO shops (name) VALUES ($1) RETURNING id",
      [shopName],
    );
    const shopId = shop.rows[0].id;

    const staff = await client.query<{ id: string }>(
      `INSERT INTO staff (shop_id, email, full_name, role, password_hash,
                          last_login_at)
       VALUES ($1, $2, $3, 'owner', $4, now())
       RETURNING id`,
      [shopId, email, fullName, passwordHash],
    );

    // A plausible week, so scheduling has something to answer with on day
    // one. Monday to Friday, 8 to 5, weekends closed — the owner corrects it
    // in settings, and correcting is a much smaller job than starting empty.
    await client.query(
      `INSERT INTO shop_hours (shop_id, day_of_week, opens_at, closes_at, is_closed)
       SELECT $1, d,
              CASE WHEN d BETWEEN 1 AND 5 THEN TIME '08:00' END,
              CASE WHEN d BETWEEN 1 AND 5 THEN TIME '17:00' END,
              d NOT BETWEEN 1 AND 5
         FROM generate_series(0, 6) AS d`,
      [shopId],
    );

    return { shopId, staffId: staff.rows[0].id };
  });

  await startSession(created.staffId, created.shopId, await requestMeta());
  redirect("/app");
}

// -----------------------------------------------------------------------------
// Sign in
// -----------------------------------------------------------------------------

export async function signIn(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = text(form, "next");
  const values = { email };

  if (!email || !password) {
    return { values, error: "Email and password, please." };
  }

  const meta = await requestMeta();

  // Count recent failures for this address, and drop rows older than a day in
  // the same request so the table stays small without a cron.
  await query("DELETE FROM auth_attempts WHERE at < now() - interval '1 day'");
  const recent = await query<{ n: string }>(
    `SELECT count(*) AS n FROM auth_attempts
      WHERE lower(email) = $1
        AND at > now() - interval '1 minute' * $2`,
    [email, ATTEMPT_WINDOW_MINUTES],
  );

  if (Number(recent[0]?.n ?? 0) >= MAX_ATTEMPTS) {
    return {
      values,
      error: `Too many attempts. Try again in ${ATTEMPT_WINDOW_MINUTES} minutes.`,
    };
  }

  const rows = await query<{
    id: string;
    shop_id: string;
    password_hash: string | null;
    disabled_at: string | null;
  }>(
    `SELECT id, shop_id, password_hash, disabled_at
       FROM staff WHERE lower(email) = $1`,
    [email],
  );

  const staff = rows[0];
  // Verify against a decoy when there's no such account, so a missing address
  // and a wrong password take the same couple of hundred milliseconds.
  // Otherwise this form is a fine tool for finding out which of a shop's
  // people have accounts here.
  const ok = await verifyPassword(
    password,
    staff?.disabled_at ? null : (staff?.password_hash ?? (await decoyHash())),
  );

  if (!ok || !staff) {
    await query("INSERT INTO auth_attempts (email, ip) VALUES ($1, $2)", [
      email,
      meta.ip,
    ]);
    return { values, error: "That email and password don't match." };
  }

  await query("DELETE FROM auth_attempts WHERE lower(email) = $1", [email]);
  await query("UPDATE staff SET last_login_at = now() WHERE id = $1", [
    staff.id,
  ]);
  await startSession(staff.id, staff.shop_id, meta);

  // Only ever a path on this site. An open redirect here would let a phishing
  // link borrow the real sign-in page and bounce the shop somewhere else.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/app");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/signin");
}

// -----------------------------------------------------------------------------
// Invites — how everybody who isn't the owner gets an account
// -----------------------------------------------------------------------------

const INVITE_DAYS = 14;

export async function inviteStaff(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireRole("owner");

  const email = text(form, "email").toLowerCase();
  const fullName = text(form, "full_name");
  const role = text(form, "role");
  const values = { email, full_name: fullName, role };
  const fields: Record<string, string> = {};

  if (!EMAIL.test(email)) fields.email = "That doesn't look like an email.";
  if (fullName.length < 2) fields.full_name = "Their name.";
  if (!["advisor", "tech", "owner"].includes(role)) fields.role = "Pick a role.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const taken = await query<{ one: number }>(
    "SELECT 1 AS one FROM staff WHERE lower(email) = $1",
    [email],
  );
  if (taken.length > 0) {
    return { values, fields: { email: "They already have an account." } };
  }

  const { token, hash } = newToken();
  await query(
    `INSERT INTO staff_invites
       (shop_id, email, full_name, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 day' * $7)`,
    [user.shopId, email, fullName, role, hash, user.staffId, INVITE_DAYS],
  );

  // The token is shown once, on the next page load, for the owner to hand
  // over. Nothing stores it in a form we can read back, and there is no
  // outbound email yet to send it in.
  redirect(`/app/team?invited=${encodeURIComponent(token)}`);
}

export async function revokeInvite(form: FormData): Promise<void> {
  const user = await requireRole("owner");
  await query(
    `UPDATE staff_invites SET revoked_at = now()
      WHERE id = $1 AND shop_id = $2 AND accepted_at IS NULL`,
    [text(form, "id"), user.shopId],
  );
  redirect("/app/team");
}

export async function acceptInvite(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const token = text(form, "token");
  const password = String(form.get("password") ?? "");
  const fullName = text(form, "full_name");

  const fields: Record<string, string> = {};
  if (fullName.length < 2) fields.full_name = "Your name.";
  const bad = passwordProblem(password);
  if (bad) fields.password = bad;
  if (Object.keys(fields).length > 0) {
    return { fields, values: { full_name: fullName } };
  }

  const rows = await query<{
    id: string;
    shop_id: string;
    email: string;
    role: string;
  }>(
    `SELECT id, shop_id, email, role FROM staff_invites
      WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
        AND expires_at > now()`,
    [hashToken(token)],
  );

  const invite = rows[0];
  if (!invite) {
    return { error: "That invite has expired or already been used." };
  }

  const passwordHash = await hashPassword(password);

  const staffId = await tx(async (client) => {
    const staff = await client.query<{ id: string }>(
      `INSERT INTO staff (shop_id, email, full_name, role, password_hash,
                          last_login_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [invite.shop_id, invite.email, fullName, invite.role, passwordHash],
    );
    await client.query(
      "UPDATE staff_invites SET accepted_at = now() WHERE id = $1",
      [invite.id],
    );
    return staff.rows[0].id;
  });

  await startSession(staffId, invite.shop_id, await requestMeta());
  redirect("/app");
}

// -----------------------------------------------------------------------------
// Password change
// -----------------------------------------------------------------------------

export async function changePassword(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current_password") ?? "");
  const next = String(form.get("password") ?? "");

  const bad = passwordProblem(next);
  if (bad) return { fields: { password: bad } };

  const rows = await query<{ password_hash: string | null }>(
    "SELECT password_hash FROM staff WHERE id = $1",
    [user.staffId],
  );
  if (!(await verifyPassword(current, rows[0]?.password_hash ?? null))) {
    return { fields: { current_password: "That isn't your current password." } };
  }

  await query("UPDATE staff SET password_hash = $1 WHERE id = $2", [
    await hashPassword(next),
    user.staffId,
  ]);

  // Every other session dies: a password change is usually a response to
  // somebody having had access, and leaving their tab signed in defeats it.
  await endAllSessions(user.staffId);
  await startSession(user.staffId, user.shopId, await requestMeta());

  redirect("/app/settings?saved=password");
}
