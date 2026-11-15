import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { verifyServiceCaller } from "@/lib/auth/serviceIdentity";
import { ingestWaitlistSubmission } from "@/lib/firestore/clients";
import {
  eventEnvelopeSchema,
  isKnownEventType,
  waitlistSubmittedPayloadSchema,
} from "@/lib/validation/events";

export const dynamic = "force-dynamic";

/**
 * Inbound events from tryzol.com.
 *
 * The one route in this application that is not behind a Firebase session.
 * Every other handler wraps itself in `authorized()`, which requires a signed
 * session cookie and an ALLOWED_EMAILS match; this one deliberately does not,
 * because its caller is a Cloud Run service rather than a person in a browser.
 *
 * That makes the token check below the entire boundary, so it happens before
 * the body is read — an unauthenticated caller should not be able to make this
 * service parse anything it sent.
 *
 * Idempotent by construction. The sender retries every five minutes until it
 * gets a 2xx, and an event already applied returns 200 without touching
 * Firestore. Duplicates are the normal case here, not an error to report.
 */

function deny(reason: string) {
  console.warn("[events] rejected caller:", reason);
  // The reason goes to our logs, never to the caller. Somebody probing this
  // endpoint learns that it did not work and nothing else.
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: Request) {
  const caller = await verifyServiceCaller(request);
  if (!caller.ok) return deny(caller.reason);

  let envelope;
  try {
    envelope = eventEnvelopeSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid event envelope", issues: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Body was not JSON" }, { status: 400 });
  }

  /*
    Unknown types are refused rather than stored generically. A collection of
    events nobody has written a handler for is how an integration accumulates a
    year of data in a shape nothing can read — and a 400 here tells the sender
    immediately, while somebody still remembers deploying it.

    422 rather than 400: the envelope was valid, we just do not handle this.
    Either way the sender treats it as "rejected, do not retry" and leaves the
    row queued for a person.
  */
  if (!isKnownEventType(envelope.type)) {
    console.warn(`[events] unknown type ${envelope.type} from ${caller.email}`);
    return NextResponse.json(
      { error: `Unknown event type: ${envelope.type}` },
      { status: 422 },
    );
  }

  const event = `${envelope.event_id}:${envelope.revision}`;

  try {
    const payload = waitlistSubmittedPayloadSchema.parse(envelope.payload);
    const result = await ingestWaitlistSubmission({
      eventId: envelope.event_id,
      revision: envelope.revision,
      type: envelope.type,
      source: envelope.source,
      occurredAt: envelope.occurred_at,
      payload,
    });

    if (result.outcome === "merged" && result.conflicts.length > 0) {
      console.info(
        `[events] ${event} merged into ${result.clientId}, ` +
          `awaiting review: ${result.conflicts.join(", ")}`,
      );
    } else {
      console.info(`[events] ${event} ${result.outcome} ${result.clientId}`);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      /*
        A malformed payload will still be malformed in five minutes, so this is
        the sender's cue to stop retrying and leave the row for a person. Full
        detail goes back because the caller is an allowlisted service, not the
        public — it is the only way whoever is reading the sweeper's log finds
        out which field was wrong.
      */
      console.error(`[events] ${event} rejected:`, error.flatten());
      return NextResponse.json(
        { error: "Invalid payload", issues: error.flatten() },
        { status: 400 },
      );
    }

    // Anything else is ours: Firestore unavailable, a contention retry that ran
    // out. 500 tells the sweeper to leave delivered_at null and come back.
    console.error(`[events] ${event} failed`, error);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
