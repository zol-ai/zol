import { describe, expect, it } from "vitest";

import {
  eventEnvelopeSchema,
  isKnownEventType,
  waitlistSubmittedPayloadSchema,
} from "../lib/validation/events";

/**
 * The event boundary.
 *
 * These schemas are the only thing standing between an authenticated sender
 * and the client records, and the sender lives in a different repository — so
 * the pairing is maintained by hand and the failure mode is drift. What is
 * being pinned here is mostly what gets *refused*.
 */

const payload = {
  full_name: "Dana Reyes",
  email: "dana@example.com",
  phone: "+16615550148",
  phone_history: [],
  shop_name: "Reyes Auto",
  zip: "93301",
  bays: "4-6",
  consent: true,
  consent_at: "2026-08-27T18:04:11.221Z",
};

const envelope = {
  event_id: "8f1a4a3e-1d2b-4c5f-9e7a-2b3c4d5e6f70",
  revision: 0,
  type: "waitlist.submitted",
  occurred_at: "2026-08-27T18:04:11.221Z",
  source: "tryzol.com",
  payload,
};

describe("event envelope", () => {
  it("accepts a well-formed envelope", () => {
    expect(() => eventEnvelopeSchema.parse(envelope)).not.toThrow();
  });

  it("requires event_id and revision separately", () => {
    // The deduplication key is the pair. A sender that joined them into one
    // string would lose the bare event_id, which is what a contact records.
    expect(() =>
      eventEnvelopeSchema.parse({ ...envelope, revision: undefined }),
    ).toThrow();
    expect(() =>
      eventEnvelopeSchema.parse({ ...envelope, event_id: "not-a-uuid" }),
    ).toThrow();
  });

  it("rejects a negative or fractional revision", () => {
    expect(() => eventEnvelopeSchema.parse({ ...envelope, revision: -1 })).toThrow();
    expect(() => eventEnvelopeSchema.parse({ ...envelope, revision: 1.5 })).toThrow();
  });

  it("knows only the types it has a handler for", () => {
    expect(isKnownEventType("waitlist.submitted")).toBe(true);
    expect(isKnownEventType("waitlist.deleted")).toBe(false);
  });
});

describe("waitlist.submitted payload", () => {
  it("accepts a well-formed payload", () => {
    expect(() => waitlistSubmittedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("requires E.164 phone numbers", () => {
    // Phone is the match key. A number in any other shape matches nothing and
    // silently creates a second client for somebody we already have.
    for (const phone of ["6615550148", "(661) 555-0148", "+0615550148", ""]) {
      expect(() => waitlistSubmittedPayloadSchema.parse({ ...payload, phone })).toThrow();
    }
  });

  it("requires the phone history to be E.164 too", () => {
    expect(() =>
      waitlistSubmittedPayloadSchema.parse({
        ...payload,
        phone_history: ["6615550148"],
      }),
    ).toThrow();
  });

  it("defaults an absent phone history to empty", () => {
    const { phone_history: _omitted, ...rest } = payload;
    expect(waitlistSubmittedPayloadSchema.parse(rest).phone_history).toEqual([]);
  });

  it("refuses an event that does not carry consent", () => {
    // We intend to call and text these people. A default here would be
    // inventing permission we cannot later prove was given.
    expect(() =>
      waitlistSubmittedPayloadSchema.parse({ ...payload, consent: false }),
    ).toThrow();
    const { consent: _dropped, ...withoutConsent } = payload;
    expect(() => waitlistSubmittedPayloadSchema.parse(withoutConsent)).toThrow();
  });

  it("rejects unknown fields rather than dropping them", () => {
    // The sender is a different repo. A field it starts sending that this does
    // not know about should fail loudly at the boundary, not vanish.
    expect(() =>
      waitlistSubmittedPayloadSchema.parse({ ...payload, utm_source: "google" }),
    ).toThrow();
  });

  it("constrains bays to the bands the form offers", () => {
    expect(() => waitlistSubmittedPayloadSchema.parse({ ...payload, bays: "12" })).toThrow();
  });
});
