import type { DocumentReference } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";

/**
 * The deduplication markers.
 *
 * One document per accepted delivery, keyed by `${event_id}:${revision}`, and
 * written in the same transaction as the change it describes. Nothing in the
 * application reads these for business logic — their existence *is* the data.
 *
 * The sender retries every five minutes until a delivery is acknowledged, so
 * duplicates are the normal case rather than an edge one. This collection is
 * what makes that safe.
 *
 * Keyed on the pair, never on `event_id` alone: the sending row is mutable, so
 * a corrected phone number arrives under the same `event_id` as the original.
 * Deduplicating on the bare id would discard the correction as a duplicate and
 * nothing would look broken.
 */

const collectionName = "ingest_events";

export type IngestMarker = {
  eventId: string;
  revision: number;
  type: string;
  source: string;
  occurredAt: string;
  /** The client this event created or merged into. */
  clientId: string;
  /** When we accepted it, which is not when it happened. */
  ingestedAt: string;
};

/**
 * Deterministic, from the two halves of the delivery key.
 *
 * A slug rather than a nested path: Firestore document IDs may not contain a
 * forward slash, and both halves are constrained by the envelope schema — a
 * uuid and a non-negative integer — so neither can smuggle one in.
 */
export function markerRef(
  eventId: string,
  revision: number,
): DocumentReference {
  return getAdminDb().collection(collectionName).doc(`${eventId}:${revision}`);
}
