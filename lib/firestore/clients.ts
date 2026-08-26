import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ClientInput } from "@/lib/validation/schemas";
import type { Client, ClientDocument } from "@/types";
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
