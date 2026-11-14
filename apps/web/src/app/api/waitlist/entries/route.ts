import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { bearerToken, verifyGoogleIdToken } from "@/lib/google-oidc";
import { waitlistEvent, type WaitlistEntry } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

/**
 * A read-only window onto the waitlist queue, for Company OS to reconcile
 * against.
 *
 * Postgres stays the source of truth for waitlist entries and Firestore stays
 * the source of truth for client records. This endpoint copies nothing the
 * push path was not already copying — it exists so the two sides can be
 * compared and a gap closed, without a second store of the same rows.
 *
 * Every entry is the output of `waitlistEvent()`, the same function the
 * sweeper sends. Not "the same shape" — the same function. The reconciliation
 * job forwards these objects to `/api/events` verbatim, so there is exactly
 * one place an envelope is built and no second definition to drift from.
 *
 * Read-only. No statement here writes, and in particular it does not touch
 * `delivered_at`: reconciliation is about what Firestore is missing, which is
 * not the same question as what this table thinks it sent.
 */

/** Keyset position: the exact `updated_at` text and the tie-breaking id. */
interface Cursor {
  updatedAt: string;
  eventId: string;
}

/**
 * A plain, visible ASCII separator.
 *
 * A control character would be tidier in principle and a liability in
 * practice: invisible in every diff and review, and quietly eaten by an
 * editor, a copy-paste or a lint autofix — at which point an empty separator
 * splits the cursor on every character and decodes as garbage rather than
 * failing outright.
 *
 * Safe because neither half can contain it. Postgres renders a timestamptz
 * with digits, dashes, a space, a colon, a dot and a sign; a uuid is hex and
 * dashes. Both halves are regex-checked on the way back in regardless, so a
 * cursor carrying an extra pipe is rejected rather than misread.
 */
const CURSOR_SEPARATOR = "|";

/**
 * Postgres's own text rendering of a timestamptz, e.g.
 * `2026-08-27 18:04:11.221334+00`.
 *
 * The cursor carries this rather than an ISO string from JavaScript, because a
 * JS Date truncates to milliseconds and Postgres keeps microseconds. A
 * truncated cursor re-selects the rows it was supposed to advance past — and a
 * page whose rows all share one millisecond would then never advance at all,
 * so the walk loops forever instead of finishing.
 */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:\d{2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    `${cursor.updatedAt}${CURSOR_SEPARATOR}${cursor.eventId}`,
    "utf8",
  ).toString("base64url");
}

/**
 * Opaque to the caller, but still validated on the way back in. We minted it,
 * which is a reason to expect it to be well formed and not a reason to skip
 * checking — a malformed cursor should be a 400 that names the problem, not a
 * Postgres cast error surfacing as a 500.
 */
function decodeCursor(raw: string): Cursor | undefined {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return undefined;
  }

  const parts = decoded.split(CURSOR_SEPARATOR);
  if (parts.length !== 2) return undefined;
  const [updatedAt, eventId] = parts;
  if (!PG_TIMESTAMP.test(updatedAt) || !UUID.test(eventId)) return undefined;
  return { updatedAt, eventId };
}

function deny(reason: string) {
  console.warn("[entries] rejected caller:", reason);
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  const {
    audience,
    allowedServiceAccounts,
    defaultPageSize,
    maxPageSize,
    minUpdatedAt,
  } = env.waitlistRead;

  /*
    Fail closed on missing configuration, checked before anything is parsed.
    This endpoint returns names, emails and phone numbers; a deploy that
    forgot a variable must serve nothing rather than serve everyone.

    The floor is part of that: without it a reconciliation run would walk the
    pre-integration back catalogue that migration 0005 deliberately marked out
    of scope, and there is no marker in the rows themselves this endpoint
    could use to tell those apart. Refusing to serve is the only honest
    behaviour when the boundary is unconfigured.
  */
  if (!audience) return deny("WAITLIST_READ_AUDIENCE is not set");
  if (!allowedServiceAccounts) {
    return deny("WAITLIST_READ_ALLOWED_SERVICE_ACCOUNTS is not set");
  }
  if (!minUpdatedAt || Number.isNaN(Date.parse(minUpdatedAt))) {
    return deny("WAITLIST_READ_MIN_UPDATED_AT is not set to a timestamp");
  }

  const token = bearerToken(request);
  if (!token) return deny("no bearer token");

  const check = await verifyGoogleIdToken(
    token,
    audience,
    allowedServiceAccounts.split(","),
  );
  if (!check.ok) return deny(check.reason);

  const url = new URL(request.url);

  const rawLimit = url.searchParams.get("limit");
  let limit = defaultPageSize;
  if (rawLimit !== null) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > maxPageSize) {
      return badRequest(`limit must be an integer between 1 and ${maxPageSize}`);
    }
  }

  const since = url.searchParams.get("since");
  if (since !== null && Number.isNaN(Date.parse(since))) {
    return badRequest("since must be a parseable timestamp");
  }

  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? undefined : decodeCursor(rawCursor);
  if (rawCursor !== null && !cursor) return badRequest("cursor is not valid");

  /*
    Built up rather than written as one statement with null guards. A
    `($1 IS NULL OR updated_at >= $1)` clause is opaque to the planner and can
    cost the index; naming only the conditions that apply keeps the walk on
    `waitlist_entries_updated_event`.
  */
  const conditions: string[] = [];
  const params: unknown[] = [];

  /*
    Unconditional, ahead of everything the caller controls. `since` and the
    cursor can narrow the window; nothing a caller sends can reach below the
    integration boundary.
  */
  params.push(minUpdatedAt);
  conditions.push(`updated_at >= $${params.length}::timestamptz`);

  if (since !== null) {
    params.push(since);
    conditions.push(`updated_at >= $${params.length}::timestamptz`);
  }

  if (cursor) {
    params.push(cursor.updatedAt, cursor.eventId);
    conditions.push(
      `(updated_at, event_id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }

  params.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  let rows: (WaitlistEntry & { cursor_updated_at: string })[];
  try {
    /*
      `updated_at::text` alongside the row: `pg` hands back a Date for the
      column itself, which is millisecond-precision and cannot round-trip as a
      cursor. The text form is Postgres's own and casts back exactly.
    */
    rows = await query<WaitlistEntry & { cursor_updated_at: string }>(
      `SELECT *, updated_at::text AS cursor_updated_at
         FROM waitlist_entries
         ${where}
        ORDER BY updated_at, event_id
        LIMIT $${params.length}`,
      params,
    );
  } catch (error) {
    console.error("[entries] query failed", error);
    return Response.json({ error: "Queue unavailable" }, { status: 503 });
  }

  const last = rows.at(-1);
  /*
    A full page means there may be more. A short page is the end of the walk,
    and a null cursor is how the caller knows to stop. A full final page costs
    one extra empty request, which is the cheap side of the trade — the
    alternative is asking for one row more than requested on every page.
  */
  const nextCursor =
    rows.length === limit && last
      ? encodeCursor({ updatedAt: last.cursor_updated_at, eventId: last.event_id })
      : null;

  return Response.json(
    {
      entries: rows.map(waitlistEvent),
      next_cursor: nextCursor,
      count: rows.length,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
