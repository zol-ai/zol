import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { CardInput } from "@/lib/validation/schemas";
import type { WorkCard, WorkCardDocument } from "@/types";
import { compact, timestampToIso } from "./serialize";

const collectionName = "cards";

function fromDocument(snapshot: DocumentSnapshot): WorkCard {
  const data = snapshot.data() as WorkCardDocument;
  return {
    id: snapshot.id,
    title: data.title,
    todos: data.todos ?? [],
    color: data.color ?? "blue",
    order: data.order ?? 0,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export async function createCard(input: CardInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  await reference.set(
    compact({
      ...input,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getCardById(reference.id);
}

export async function getCards() {
  const snapshot = await getAdminDb().collection(collectionName).get();
  return snapshot.docs
    .map(fromDocument)
    .sort((a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt));
}

export async function getCardById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Card not found");
  return fromDocument(snapshot);
}

export async function updateCard(id: string, input: Partial<CardInput>) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  if (!(await reference.get()).exists) throw new Error("Card not found");
  await reference.update(
    compact({
      ...input,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getCardById(id);
}

export async function deleteCard(id: string) {
  await getAdminDb().collection(collectionName).doc(id).delete();
}
