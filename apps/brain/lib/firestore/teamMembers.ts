import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { TeamMemberInput } from "@/lib/validation/schemas";
import type { TeamMember, TeamMemberDocument } from "@/types";
import { compact, timestampToIso } from "./serialize";

const collectionName = "teamMembers";

function fromDocument(snapshot: DocumentSnapshot): TeamMember {
  const data = snapshot.data() as TeamMemberDocument;
  return {
    id: snapshot.id,
    name: data.name,
    email: data.email,
    role: data.role,
    active: data.active,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export async function createTeamMember(input: TeamMemberInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  await reference.set(
    compact({
      ...input,
      active: input.active ?? true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getTeamMemberById(reference.id);
}

export async function getTeamMembers(options?: { activeOnly?: boolean }) {
  const snapshot = await getAdminDb().collection(collectionName).get();
  return snapshot.docs
    .map(fromDocument)
    .filter((member) => !options?.activeOnly || member.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTeamMemberById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Team member not found");
  return fromDocument(snapshot);
}

export async function updateTeamMember(id: string, input: Partial<TeamMemberInput>) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Team member not found");
  const clearedFields = Object.fromEntries(
    (["email", "role"] as const)
      .filter(
        (field) =>
          Object.prototype.hasOwnProperty.call(input, field) && input[field] === undefined,
      )
      .map((field) => [field, FieldValue.delete()]),
  );
  await reference.update(
    compact({ ...input, ...clearedFields, updatedAt: FieldValue.serverTimestamp() }),
  );
  return getTeamMemberById(id);
}

export async function deactivateTeamMember(id: string) {
  return updateTeamMember(id, { active: false });
}
