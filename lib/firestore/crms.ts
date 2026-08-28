import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";

import { getAdminDb } from "@/lib/firebase/admin";
import type { CrmInput } from "@/lib/validation/schemas";
import { DEFAULT_CRM_ID, type Crm } from "@/types";
import { timestampToIso } from "./serialize";

/**
 * CRMs are named pipelines. "Clients" is the built-in one — fixed document ID,
 * created on first read, and the only pipeline waitlist ingest writes to. The
 * rest are whatever the team adds: Investors, Partners, Hiring.
 *
 * There is deliberately no delete. A pipeline that stops being useful just
 * stops being used; deleting one would orphan every record carrying its id,
 * and nothing here garbage-collects records.
 */

const collectionName = "crms";

function fromDocument(snapshot: DocumentSnapshot): Crm {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    name: (data.name as string) ?? snapshot.id,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

/**
 * Idempotent. Every listing goes through this, so the default pipeline exists
 * before anything can ask for it — including the ingest path's records, whose
 * crmId points here by construction.
 */
async function ensureDefault() {
  const reference = getAdminDb().collection(collectionName).doc(DEFAULT_CRM_ID);
  const snapshot = await reference.get();
  if (snapshot.exists) return;
  await reference.set({
    name: "Clients",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function getCrms() {
  await ensureDefault();
  const snapshot = await getAdminDb().collection(collectionName).get();
  return snapshot.docs
    .map(fromDocument)
    .sort((a, b) =>
      // The default pipeline first, the rest in creation order.
      a.id === DEFAULT_CRM_ID ? -1 : b.id === DEFAULT_CRM_ID ? 1 : a.createdAt.localeCompare(b.createdAt),
    );
}

export async function createCrm(input: CrmInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  await reference.set({
    name: input.name,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const snapshot = await reference.get();
  return fromDocument(snapshot);
}
