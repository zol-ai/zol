import { z } from "zod";

import { e164Schema } from "./schemas";

/**
 * Inbound events from tryzol.com.
 *
 * Everything on this boundary is untrusted. The caller is authenticated by ID
 * token, which says who is sending — not that what they sent is well formed,
 * and not that a future version of the sender still agrees with this version
 * of the receiver about the shape.
 */

/**
 * The envelope every event shares.
 *
 * `event_id` and `revision` arrive separately rather than pre-joined, and both
 * are needed. The deduplication marker is keyed on `${event_id}:${revision}`,
 * so a redelivery of the same version collapses and a correction does not —
 * but the bare `event_id` is what gets recorded against a contact, because it
 * names the person's row rather than one delivery of it.
 */
export const eventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  type: z.string().trim().min(1).max(80),
  occurred_at: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1).max(120),
  payload: z.unknown(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/**
 * `waitlist.submitted`.
 *
 * Mirrors `WAITLIST_PAYLOAD_COLUMNS` in the zol repo. The two lists are
 * maintained by hand across a repository boundary, which is exactly why this
 * schema is strict rather than permissive: a field the sender adds and this
 * does not know about should fail loudly at the boundary, where the log says
 * which field, rather than being dropped on the floor and noticed months later
 * when somebody asks why the CRM has no ZIP codes.
 */
export const waitlistSubmittedPayloadSchema = z
  .object({
    full_name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(200),
    phone: e164Schema,
    /*
      Every number this person has had before the current one.

      Phone is the match key, which makes a corrected number the one edit that
      cannot be merged: the new value matches nothing here, so the event would
      create a second client while the first kept the stale number. Matching
      against the history is what lets a correction find the record it belongs
      to.
    */
    phone_history: z.array(e164Schema).max(20).default([]),
    shop_name: z.string().trim().min(1).max(200),
    zip: z.string().trim().regex(/^\d{5}$/, "ZIP must be five digits"),
    bays: z.enum(["1-3", "4-6", "7-10", "10+"]),
    /*
      Consent is not decoration. We intend to call and text these people, and
      the record has to be able to answer "what did they agree to, and when"
      long after the page copy changed. An event without it is refused rather
      than defaulted — a default here would be inventing permission.
    */
    consent: z.literal(true),
    consent_at: z.string().datetime({ offset: true }),
  })
  .strict();

export type WaitlistSubmittedPayload = z.infer<typeof waitlistSubmittedPayloadSchema>;

/**
 * The event types this service accepts.
 *
 * Unknown types are rejected rather than stored generically. A grab-bag
 * collection of events nobody reads is how an integration ends up with a year
 * of data in a shape nothing can use.
 */
export const KNOWN_EVENT_TYPES = ["waitlist.submitted"] as const;

export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

export function isKnownEventType(type: string): type is KnownEventType {
  return (KNOWN_EVENT_TYPES as readonly string[]).includes(type);
}
