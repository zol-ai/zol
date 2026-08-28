/**
 * The waitlist's shape, shared by the form and the action.
 *
 * No `server-only` guard here on purpose: the option lists have to render in a
 * client component and be validated again on the server, and the whole point
 * is that there is one definition of what a valid answer is. The database
 * repeats the same two lists as CHECK constraints — three copies would be two
 * too many, but the third one is Postgres refusing to store a value the code
 * has never heard of, which is worth having.
 */

export const BAY_BANDS = ["1-3", "4-6", "7-10", "10+"] as const;
export type BayBand = (typeof BAY_BANDS)[number];

export function isBayBand(value: string): value is BayBand {
  return (BAY_BANDS as readonly string[]).includes(value);
}

/** US ZIP. Five digits — ZIP+4 is more than we need and more to get wrong. */
export const ZIP = /^\d{5}$/;

/**
 * The name of the honeypot input.
 *
 * Named like something a form-filling bot wants to complete and a person never
 * sees. Kept here so the field and the check that reads it cannot drift apart.
 */
export const HONEYPOT = "company_website";

/** UTM keys captured off the landing URL, in the order they're stored. */
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];

/** One waitlist row, as the database holds it. */
export interface WaitlistEntry {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  shop_name: string;
  zip: string;
  bays: BayBand;
  consent: boolean;
  consent_at: string;
  source_page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;

  /** Names the row, and so the person. Fixed at insert, never reissued. */
  event_id: string;
  /** Names the version of the row. Bumped only on a material change. */
  revision: number;
  /** Null until Company OS has accepted this revision. */
  delivered_at: string | null;
  /** Every number this row has had before the current one, oldest first. */
  phone_history: string[];
}

/* ---------------------------------------------------------------------------
   What crosses the wire

   These two lists are the single definition of the event payload and of what
   counts as a change worth redelivering. The upsert builds its SQL from them,
   the payload builder reads from them, and nothing else hardcodes a field
   name — adding a column to the payload later should not require remembering
   to add it to a second list somewhere.
   ------------------------------------------------------------------------ */

/**
 * The columns Company OS receives.
 *
 * Deliberately not the whole row. `ip` and `user_agent` are abuse-handling
 * details with no business meaning downstream, and the UTM columns are
 * attribution that would only ever land in the receiver's conflict pile
 * without telling anyone anything. Both can be added later; neither is worth
 * the noise today.
 */
export const WAITLIST_PAYLOAD_COLUMNS = [
  "full_name",
  "email",
  "phone",
  "phone_history",
  "shop_name",
  "zip",
  "bays",
  "consent",
  "consent_at",
] as const;

/**
 * Payload columns that move on their own, and so cannot mean "something
 * changed".
 *
 * `consent_at` is restamped by every submission — it records the most recent
 * moment permission was given, which is the thing we would have to produce if
 * anybody ever asks. Comparing it would make every duplicate form fill look
 * like an edit, bump the revision, and redeliver an identical event forever.
 *
 * `phone_history` is derived from a phone change rather than being one, so
 * comparing it would double-count the edit that produced it.
 *
 * `email` is the conflict key. It cannot differ between the stored row and the
 * incoming one, because a different address is a different row.
 */
const WAITLIST_VOLATILE_COLUMNS = ["consent_at", "phone_history", "email"] as const;

/**
 * The columns whose change bumps `revision` and triggers redelivery — the
 * payload minus what moves on its own. Derived rather than written out, so a
 * field added to the payload is compared by default and has to be excluded
 * on purpose.
 */
export const WAITLIST_REVISION_COLUMNS = WAITLIST_PAYLOAD_COLUMNS.filter(
  (column): column is Exclude<
    (typeof WAITLIST_PAYLOAD_COLUMNS)[number],
    (typeof WAITLIST_VOLATILE_COLUMNS)[number]
  > => !(WAITLIST_VOLATILE_COLUMNS as readonly string[]).includes(column),
);

/** The `payload` half of the event envelope, built from one row. */
export type WaitlistEventPayload = Pick<
  WaitlistEntry,
  (typeof WAITLIST_PAYLOAD_COLUMNS)[number]
>;

export function waitlistEventPayload(entry: WaitlistEntry): WaitlistEventPayload {
  return Object.fromEntries(
    WAITLIST_PAYLOAD_COLUMNS.map((column) => [column, entry[column]]),
  ) as WaitlistEventPayload;
}

export const WAITLIST_EVENT_TYPE = "waitlist.submitted";
export const WAITLIST_EVENT_SOURCE = "tryzol.com";

/** One `POST /api/events` envelope, payload included. */
export interface WaitlistEvent {
  event_id: string;
  revision: number;
  type: typeof WAITLIST_EVENT_TYPE;
  occurred_at: string;
  source: typeof WAITLIST_EVENT_SOURCE;
  payload: WaitlistEventPayload;
}

/**
 * One row → one envelope. **The only place an envelope is constructed.**
 *
 * Two callers: the sweeper, which POSTs it to Company OS, and
 * `GET /api/waitlist/entries`, which hands the same object to a reconciliation
 * job that POSTs it to the same endpoint. They have to agree exactly — a
 * reconciliation that produced a subtly different envelope from the push would
 * write different data through the same ingest transaction, and the two would
 * only be caught disagreeing by somebody noticing a record was wrong.
 *
 * Sharing the *shape* by convention is what fails here: both sides look right
 * in isolation, and the drift arrives whenever somebody adds a field to one
 * path. So they share the function instead, and there is no second definition
 * to forget about.
 */
export function waitlistEvent(entry: WaitlistEntry): WaitlistEvent {
  return {
    event_id: entry.event_id,
    revision: entry.revision,
    type: WAITLIST_EVENT_TYPE,
    /*
      When the shop owner submitted, not when we got round to sending it.
      `updated_at` is the moment of the submission that produced this revision,
      so a delivery three days late — or a reconciliation three months late —
      still reports when it actually happened.

      Built from a Date rather than trusted as a string: `pg` hands back a Date
      for timestamptz whatever the declared type here says, and both callers
      have to serialise it identically.
    */
    occurred_at: new Date(entry.updated_at).toISOString(),
    source: WAITLIST_EVENT_SOURCE,
    payload: waitlistEventPayload(entry),
  };
}
