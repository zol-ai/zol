import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { getTeamMemberById } from "@/lib/firestore/teamMembers";
import type {
  MarketingIdeaInput,
  MarketingIdeaUpdateInput,
} from "@/lib/validation/schemas";
import type { MarketingIdea, MarketingIdeaDocument, MarketingIdeaStatus } from "@/types";
import { compact, timestampToIso } from "./serialize";

const collectionName = "marketingIdeas";
const statusOrder: Record<MarketingIdeaStatus, number> = {
  idea: 0,
  planned: 1,
  creating: 2,
  ready: 3,
  posted: 4,
};

function fromDocument(snapshot: DocumentSnapshot): MarketingIdea {
  const data = snapshot.data() as MarketingIdeaDocument;
  return {
    id: snapshot.id,
    title: data.title,
    brief: data.brief,
    hook: data.hook,
    callToAction: data.callToAction,
    contentType: data.contentType,
    channel: data.channel,
    ownerId: data.ownerId,
    ownerName: data.ownerName,
    targetDate: data.targetDate,
    links: data.links ?? [],
    status: data.status,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    postedAt: data.postedAt ? timestampToIso(data.postedAt) : null,
  };
}

async function resolveOwner(ownerId: string) {
  const owner = await getTeamMemberById(ownerId);
  if (!owner.active) throw new Error("Marketing idea owner must be an active team member");
  return { ownerId: owner.id, ownerName: owner.name };
}

export async function createMarketingIdea(input: MarketingIdeaInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  const owner = input.ownerId ? await resolveOwner(input.ownerId) : {};
  await reference.set(
    compact({
      ...input,
      ...owner,
      postedAt: input.status === "posted" ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getMarketingIdeaById(reference.id);
}

export async function getMarketingIdeas() {
  const snapshot = await getAdminDb().collection(collectionName).get();
  return snapshot.docs
    .map(fromDocument)
    .sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31") ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

export async function getMarketingIdeaById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Marketing idea not found");
  return fromDocument(snapshot);
}

export async function updateMarketingIdea(id: string, input: MarketingIdeaUpdateInput) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Marketing idea not found");
  const current = snapshot.data() as MarketingIdeaDocument;

  let ownerFields: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(input, "ownerId")) {
    ownerFields = input.ownerId
      ? input.ownerId === current.ownerId
        ? { ownerId: current.ownerId, ownerName: current.ownerName }
        : await resolveOwner(input.ownerId)
      : {
          ownerId: FieldValue.delete(),
          ownerName: FieldValue.delete(),
        };
  }

  const clearedFields = Object.fromEntries(
    (["brief", "hook", "callToAction", "channel", "targetDate"] as const)
      .filter(
        (field) =>
          Object.prototype.hasOwnProperty.call(input, field) && input[field] === undefined,
      )
      .map((field) => [field, FieldValue.delete()]),
  );

  const statusFields =
    input.status === "posted" && current.status !== "posted"
      ? { postedAt: FieldValue.serverTimestamp() }
      : input.status && input.status !== "posted" && current.status === "posted"
        ? { postedAt: null }
        : {};

  await reference.update(
    compact({
      ...input,
      ...clearedFields,
      ...ownerFields,
      ...statusFields,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getMarketingIdeaById(id);
}

export async function deleteMarketingIdea(id: string) {
  await getAdminDb().collection(collectionName).doc(id).delete();
}
