import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { WaitlistSubmittedPayload } from "@/lib/validation/events";
import type { ClientInput } from "@/lib/validation/schemas";
import type {
  Client,
  ClientContact,
  ClientDocument,
  PendingReviewEntry,
} from "@/types";
import { markerRef, type IngestMarker } from "./ingestEvents";
import { compact, timestampToIso } from "./serialize";

const collectionName = "clients";

function fromDocument(snapshot: DocumentSnapshot): Client {
  const data = snapshot.data() as ClientDocument;
  return {
    id: snapshot.id,
    name: data.name,
    contactName: data.contactName,
    contactEmail: data.contactEmail,
    status: data.status,
    color: data.color ?? "blue",
    notes: data.notes,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    phone: data.phone,
    zip: data.zip,
    bays: data.bays,
    /*
      Everything that predates the waitlist integration was created by a person
      typing it in, so absent means manual. Not backfilled — the default is the
      truth about those records rather than a placeholder.
    */
    source: data.source ?? "manual",
    contacts: data.contacts,
    consentAt: data.consentAt,
    lastInboundAt: data.lastInboundAt,
    pendingReview: data.pendingReview,
  };
}

export async function createClient(input: ClientInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  await reference.set(
    compact({
      ...input,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getClientById(reference.id);
}

export async function getClients() {
  const snapshot = await getAdminDb().collection(collectionName).get();
  return snapshot.docs.map(fromDocument).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClientById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Client not found");
  return fromDocument(snapshot);
}

export async function updateClient(id: string, input: Partial<ClientInput>) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Client not found");
  const clearedFields = Object.fromEntries(
    (["contactName", "contactEmail", "notes"] as const)
      .filter(
        (field) =>
          Object.prototype.hasOwnProperty.call(input, field) && input[field] === undefined,
      )
      .map((field) => [field, FieldValue.delete()]),
  );
  await reference.update(
    compact({ ...input, ...clearedFields, updatedAt: FieldValue.serverTimestamp() }),
  );
  return getClientById(id);
}

export async function deleteClient(id: string) {
  const relatedTasks = await getAdminDb()
    .collection("tasks")
    .where("clientId", "==", id)
    .limit(1)
    .get();
  if (!relatedTasks.empty) {
    throw new Error("This client has related tasks. Archive it by setting status to closed instead.");
  }
  await getAdminDb().collection(collectionName).doc(id).delete();
}

/* ===========================================================================
   Inbound waitlist events

   The rest of this file is the human-facing CRM. What follows is the machine
   path, and it plays by stricter rules: it may fill in a blank, it may add a
   person, and it may flag a disagreement, but it may never overwrite something
   somebody typed. Form input losing to curation is the point — a shop owner
   filling the form in again from a different phone must not quietly rewrite a
   record the team has been working.
   ======================================================================== */

/**
 * Payload field → client field.
 *
 * Also the definition of what an inbound event is allowed to touch. A field
 * absent from this map cannot be written or flagged by an event, however the
 * payload grows.
 */
const INBOUND_FIELDS = {
  shop_name: "name",
  full_name: "contactName",
  email: "contactEmail",
  zip: "zip",
  bays: "bays",
  consent_at: "consentAt",
} as const satisfies Partial<Record<keyof WaitlistSubmittedPayload, keyof Client>>;

export type IngestOutcome =
  /** Already applied. The marker existed; nothing was read or written. */
  | { outcome: "duplicate"; clientId: string }
  | { outcome: "created"; clientId: string }
  | { outcome: "merged"; clientId: string; conflicts: string[] };

function contactFrom(
  payload: WaitlistSubmittedPayload,
  eventId: string,
): ClientContact {
  return { name: payload.full_name, email: payload.email, sourceEventId: eventId };
}

/**
 * Applies one `waitlist.submitted` event.
 *
 * Everything happens in a single Firestore transaction: the duplicate check,
 * the match, the merge and the marker commit together or not at all. A crash
 * between the write and the marker cannot leave an event recorded as applied
 * but not applied — and if the transaction does fail, the sender simply sends
 * it again in five minutes.
 *
 * Firestore requires every read in a transaction to precede every write, which
 * is why the matching below resolves fully before anything is staged.
 */
export async function ingestWaitlistSubmission(input: {
  eventId: string;
  revision: number;
  type: string;
  source: string;
  occurredAt: string;
  payload: WaitlistSubmittedPayload;
}): Promise<IngestOutcome> {
  const { eventId, revision, payload } = input;
  const db = getAdminDb();
  const marker = markerRef(eventId, revision);
  const clients = db.collection(collectionName);
  const now = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    // ---- reads ----------------------------------------------------------

    const existingMarker = await tx.get(marker);
    if (existingMarker.exists) {
      /*
        This exact revision has already been applied. Returning without
        touching anything is what makes the sender's every-five-minutes retry
        free, and it is the reason the marker is keyed on the pair: a bare
        event_id would land here for a correction too, and drop it.
      */
      const previous = existingMarker.data() as IngestMarker;
      return { outcome: "duplicate", clientId: previous.clientId };
    }

    let match = (await tx.get(clients.where("phone", "==", payload.phone).limit(1)))
      .docs[0];

    /*
      No match on the current number: try the ones this person used to have.

      Phone is the match key, so a correction is the single edit that cannot be
      merged on its own — the new number matches nothing, and the event would
      create a second client while the original kept the stale value. The
      sender ships the history for exactly this.

      Chunked at ten because that is the floor on Firestore's `in` operator
      across SDK versions, and the payload allows twenty. Newest first: the
      most recently replaced number is the likeliest match.
    */
    let displaced: string | undefined;
    if (!match && payload.phone_history.length > 0) {
      const history = [...payload.phone_history].reverse();
      for (let i = 0; i < history.length && !match; i += 10) {
        const chunk = history.slice(i, i + 10);
        match = (await tx.get(clients.where("phone", "in", chunk).limit(1))).docs[0];
      }
      if (match) displaced = (match.data() as ClientDocument).phone;
    }

    // ---- writes ---------------------------------------------------------

    if (!match) {
      const reference = clients.doc();
      tx.set(
        reference,
        compact({
          name: payload.shop_name,
          contactName: payload.full_name,
          contactEmail: payload.email,
          phone: payload.phone,
          zip: payload.zip,
          bays: payload.bays,
          consentAt: payload.consent_at,
          status: "lead" as const,
          source: "waitlist" as const,
          color: "blue" as const,
          /*
            The first contact is seeded here rather than only on a later merge.
            Otherwise the array only ever exists for clients that happened to
            receive a second submission, and the UI has to treat "no contacts"
            and "one contact, implied by the top-level fields" as the same
            thing.
          */
          contacts: [contactFrom(payload, eventId)],
          lastInboundAt: now,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      );

      tx.set(marker, {
        eventId,
        revision,
        type: input.type,
        source: input.source,
        occurredAt: input.occurredAt,
        clientId: reference.id,
        ingestedAt: now,
      } satisfies IngestMarker);

      return { outcome: "created", clientId: reference.id };
    }

    const stored = match.data() as ClientDocument;
    const update: Record<string, unknown> = {
      // Unconditional, even when the event changes nothing else. It is the
      // answer to "has this shop been back", which is worth knowing on its own.
      lastInboundAt: now,
      updatedAt: FieldValue.serverTimestamp(),
    };
    const pending: Record<string, PendingReviewEntry> = {};
    const conflicts: string[] = [];

    for (const [payloadField, clientField] of Object.entries(INBOUND_FIELDS) as [
      keyof typeof INBOUND_FIELDS,
      (typeof INBOUND_FIELDS)[keyof typeof INBOUND_FIELDS],
    ][]) {
      const incoming = String(payload[payloadField]);
      const current = stored[clientField];

      if (current === undefined || current === null || current === "") {
        // Filling a blank is not overwriting anybody's work.
        update[clientField] = incoming;
        continue;
      }

      if (current === incoming) continue;

      /*
        Disagreement. The stored value stays and the incoming one waits for a
        person — "the form said 4-6 bays, you have 7-10". Silently taking
        either side is the failure mode this whole path exists to avoid: one
        direction loses curation to a form, the other loses the correction.
      */
      pending[clientField] = {
        incoming,
        reason: "conflict",
        sourceEventId: eventId,
        at: now,
      };
      conflicts.push(clientField);
    }

    /*
      A phone correction is the exception, and deliberately so.

      We only get here by matching through the history, which means this record
      *is* this person and the number on it is known to be out of date. Leaving
      the stale value in place and merely flagging it would leave the record
      unreachable by the number they actually answer — so the new number goes
      in, and the one it displaced is what waits for review.
    */
    if (displaced && displaced !== payload.phone) {
      update.phone = payload.phone;
      pending.phone = {
        incoming: displaced,
        reason: "replaced",
        sourceEventId: eventId,
        at: now,
      };
      conflicts.push("phone");
    }

    /*
      Two people at one shop is ordinary, not a collision — an owner and a
      service advisor, two different addresses, the same main line. The second
      submission attaches instead of fighting the first for the top-level
      fields.

      Deduplicated on email so that redeliveries and revisions of the same
      person cannot grow the array.
    */
    const contacts = stored.contacts ?? [];
    const known = new Set(
      contacts.map((contact) => contact.email?.toLowerCase()).filter(Boolean),
    );
    if (!known.has(payload.email.toLowerCase())) {
      update.contacts = FieldValue.arrayUnion(contactFrom(payload, eventId));
    }

    for (const [field, entry] of Object.entries(pending)) {
      // Dotted path, so one flagged field cannot clear another that is already
      // waiting. The keys come from INBOUND_FIELDS, never from the payload.
      update[`pendingReview.${field}`] = entry;
    }

    tx.update(match.ref, update);

    tx.set(marker, {
      eventId,
      revision,
      type: input.type,
      source: input.source,
      occurredAt: input.occurredAt,
      clientId: match.id,
      ingestedAt: now,
    } satisfies IngestMarker);

    return { outcome: "merged", clientId: match.id, conflicts };
  });
}

/**
 * Settles one flagged field.
 *
 * `accept` adopts the value that was waiting; `dismiss` keeps what is stored.
 * Both clear the entry. The asymmetry is only in what "waiting" means — see
 * `PendingReviewEntry.reason`.
 */
export async function resolvePendingReview(
  id: string,
  field: string,
  action: "accept" | "dismiss",
) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Client not found");

  const stored = snapshot.data() as ClientDocument;
  const entry = stored.pendingReview?.[field];
  if (!entry) throw new Error("Nothing is awaiting review on that field");

  // Only fields an event could have flagged can be settled here, so a crafted
  // field name cannot reach an unrelated part of the document.
  const writable = new Set<string>([...Object.values(INBOUND_FIELDS), "phone"]);
  if (!writable.has(field)) throw new Error("That field cannot be reviewed");

  await reference.update({
    ...(action === "accept" ? { [field]: entry.incoming } : {}),
    [`pendingReview.${field}`]: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return getClientById(id);
}
