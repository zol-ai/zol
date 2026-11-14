import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { NoteInput } from "@/lib/validation/schemas";
import type { WorkspaceNote, WorkspaceNoteDocument } from "@/types";
import { compact, timestampToIso } from "./serialize";

const collectionName = "notes";

function fromDocument(snapshot: DocumentSnapshot): WorkspaceNote {
  const data = snapshot.data() as WorkspaceNoteDocument;
  return {
    id: snapshot.id,
    title: data.title,
    body: data.body ?? "",
    color: data.color ?? "amber",
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export async function createNote(input: NoteInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  await reference.set(
    compact({
      ...input,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getNoteById(reference.id);
}

export async function getNotes() {
  const snapshot = await getAdminDb().collection(collectionName).get();
  return snapshot.docs
    .map(fromDocument)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getNoteById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Note not found");
  return fromDocument(snapshot);
}

export async function updateNote(id: string, input: Partial<NoteInput>) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  if (!(await reference.get()).exists) throw new Error("Note not found");
  await reference.update(
    compact({
      ...input,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getNoteById(id);
}

export async function deleteNote(id: string) {
  await getAdminDb().collection(collectionName).doc(id).delete();
}
