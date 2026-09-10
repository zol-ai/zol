import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { todayKey } from "@/lib/schedule";
import type {
  ChecklistCompletionInput,
  ChecklistItemInput,
  ChecklistItemUpdateInput,
} from "@/lib/validation/schemas";
import type {
  ChecklistCompletion,
  ChecklistCompletionDocument,
  ChecklistDay,
  ChecklistItem,
  ChecklistItemDocument,
} from "@/types";
import { compact, timestampToIso } from "./serialize";

/*
  Daily non-negotiables, in two collections.

  `checklistItems` holds the recurring definitions — the same handful of things
  every day. `checklistCompletions` holds one document per box actually ticked.
  Nothing is created when a day begins: an empty day is simply a day with no
  completion documents, so the checklist can run for a year without a job that
  rolls it over at midnight.
*/

const itemsCollection = "checklistItems";
const completionsCollection = "checklistCompletions";

/** Deleting an item can outrun one batch; 400 keeps each commit inside the 500-write limit. */
const DELETE_BATCH_SIZE = 400;

/**
 * A completion's document ID is derived from what it means rather than
 * generated.
 *
 * One person, one item, one day is a single fact, so it gets a single
 * document — and ticking the same box twice (a double click, two open tabs,
 * two people working down the same list) converges on it instead of stacking
 * up duplicates. Same reasoning as the ingest markers.
 */
function completionId(date: string, itemId: string, ownerId: string) {
  return `${date}__${itemId}__${ownerId}`;
}

function itemFromDocument(snapshot: DocumentSnapshot): ChecklistItem {
  const data = snapshot.data() as ChecklistItemDocument;
  return {
    id: snapshot.id,
    title: data.title,
    detail: data.detail,
    ownerIds: data.ownerIds ?? [],
    order: data.order ?? 0,
    active: data.active ?? true,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

function completionFromDocument(snapshot: DocumentSnapshot): ChecklistCompletion {
  const data = snapshot.data() as ChecklistCompletionDocument;
  return {
    id: snapshot.id,
    date: data.date,
    itemId: data.itemId,
    ownerId: data.ownerId,
    doneAt: timestampToIso(data.doneAt),
    doneByEmail: data.doneByEmail,
  };
}

/** Same rule as tasks and marketing ideas: work only goes on active people. */
async function assertActiveOwners(ownerIds: string[]) {
  if (!ownerIds.length) throw new Error("Pick at least one person");
  const db = getAdminDb();
  const snapshots = await db.getAll(
    ...ownerIds.map((id) => db.collection("teamMembers").doc(id)),
  );
  if (snapshots.some((snapshot) => !snapshot.exists || snapshot.data()?.active !== true)) {
    throw new Error("Every owner must be an active team member");
  }
}

export async function createChecklistItem(input: ChecklistItemInput) {
  await assertActiveOwners(input.ownerIds);
  const db = getAdminDb();
  // New items land at the bottom. A checklist gets read top to bottom in the
  // same order every morning, so an arrival that jumped the queue would
  // quietly reshuffle a routine people have memorised.
  const last = await db.collection(itemsCollection).orderBy("order", "desc").limit(1).get();
  const order = last.empty ? 0 : ((last.docs[0].data().order as number | undefined) ?? 0) + 1;
  const reference = db.collection(itemsCollection).doc();
  await reference.set(
    compact({
      ...input,
      order,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getChecklistItemById(reference.id);
}

export async function getChecklistItems() {
  const snapshot = await getAdminDb().collection(itemsCollection).get();
  return snapshot.docs
    .map(itemFromDocument)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export async function getChecklistItemById(id: string) {
  const snapshot = await getAdminDb().collection(itemsCollection).doc(id).get();
  if (!snapshot.exists) throw new Error("Checklist item not found");
  return itemFromDocument(snapshot);
}

/**
 * Everything one day needs, in one round trip.
 *
 * `date` defaults to the server's today, which on Cloud Run is UTC. The page
 * always sends the browser's own day, so the default only covers a bare call
 * from somewhere else.
 */
export async function getChecklistDay(date: string = todayKey()): Promise<ChecklistDay> {
  const [items, completions] = await Promise.all([
    getChecklistItems(),
    getAdminDb().collection(completionsCollection).where("date", "==", date).get(),
  ]);
  return { date, items, completions: completions.docs.map(completionFromDocument) };
}

export async function updateChecklistItem(id: string, input: ChecklistItemUpdateInput) {
  const reference = getAdminDb().collection(itemsCollection).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Checklist item not found");
  if (input.ownerIds) await assertActiveOwners(input.ownerIds);

  const clearingDetail =
    Object.prototype.hasOwnProperty.call(input, "detail") && input.detail === undefined;
  await reference.update(
    compact({
      ...input,
      ...(clearingDetail ? { detail: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getChecklistItemById(id);
}

/**
 * Deletes the item and every tick anybody ever made against it.
 *
 * The history goes because without the item there is nothing left to join it
 * back to — orphaned completions would be rows naming a title that no longer
 * exists. Retiring an item with `active: false` is the other option, and that
 * one keeps everything.
 */
export async function deleteChecklistItem(id: string) {
  const db = getAdminDb();
  await db.collection(itemsCollection).doc(id).delete();
  for (;;) {
    const stale = await db
      .collection(completionsCollection)
      .where("itemId", "==", id)
      .limit(DELETE_BATCH_SIZE)
      .get();
    if (stale.empty) return;
    const batch = db.batch();
    stale.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (stale.size < DELETE_BATCH_SIZE) return;
  }
}

/**
 * Ticks or unticks one box.
 *
 * Anybody signed in can tick anybody's box — the three of them sit in the same
 * workspace and reading the list out loud is a normal way to run it. Who
 * actually clicked is recorded on the document instead of being enforced away.
 */
export async function setChecklistCompletion(
  itemId: string,
  input: ChecklistCompletionInput,
  doneByEmail?: string,
): Promise<{ done: boolean; completion: ChecklistCompletion | null }> {
  const db = getAdminDb();
  const item = await db.collection(itemsCollection).doc(itemId).get();
  if (!item.exists) throw new Error("Checklist item not found");
  const ownerIds = (item.data() as ChecklistItemDocument).ownerIds ?? [];
  if (!ownerIds.includes(input.ownerId)) {
    throw new Error("That person is not an owner of this checklist item");
  }

  const reference = db
    .collection(completionsCollection)
    .doc(completionId(input.date, itemId, input.ownerId));

  if (!input.done) {
    await reference.delete();
    return { done: false, completion: null };
  }

  await reference.set(
    compact({
      date: input.date,
      itemId,
      ownerId: input.ownerId,
      doneByEmail,
      doneAt: FieldValue.serverTimestamp(),
    }),
  );
  return { done: true, completion: completionFromDocument(await reference.get()) };
}
