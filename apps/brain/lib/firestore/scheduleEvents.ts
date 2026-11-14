import { FieldValue, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { compareEvents, eventLastDay } from "@/lib/schedule";
import {
  scheduleEventCreateSchema,
  type ScheduleEventInput,
  type ScheduleEventUpdateInput,
  type ScheduleQuery,
} from "@/lib/validation/schemas";
import type { ScheduleEvent, ScheduleEventDocument } from "@/types";
import { compact, timestampToIso } from "./serialize";

const collectionName = "scheduleEvents";

function fromDocument(snapshot: DocumentSnapshot): ScheduleEvent {
  const data = snapshot.data() as ScheduleEventDocument;
  return {
    id: snapshot.id,
    title: data.title,
    description: data.description,
    date: data.date,
    endDate: data.endDate,
    allDay: data.allDay ?? false,
    startTime: data.startTime,
    endTime: data.endTime,
    assignedToId: data.assignedToId,
    assignedToName: data.assignedToName,
    color: data.color ?? "blue",
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

/** Same rule as tasks: an event can only be put on an active team member. */
async function resolveAssignee(assignedToId?: string) {
  if (!assignedToId) return { assignedToId: undefined, assignedToName: undefined };
  const snapshot = await getAdminDb().collection("teamMembers").doc(assignedToId).get();
  if (!snapshot.exists || snapshot.data()?.active !== true) {
    throw new Error("Selected assignee is not active");
  }
  return { assignedToId, assignedToName: snapshot.data()?.name as string };
}

export async function createScheduleEvent(input: ScheduleEventInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  const assignee = await resolveAssignee(input.assignedToId);
  await reference.set(
    compact({
      ...input,
      ...assignee,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getScheduleEventById(reference.id);
}

/**
 * Events touching the window, earliest first.
 *
 * Firestore only needs one inequality (`date <= to`); the other bound is
 * applied in memory because a multi-day event that *started* before `from`
 * can still cover it, and that is a question about `endDate`, not `date`.
 */
export async function getScheduleEvents(filters: Partial<ScheduleQuery> = {}) {
  let query: Query = getAdminDb().collection(collectionName);
  if (filters.to) query = query.where("date", "<=", filters.to);
  const snapshot = await query.get();
  return snapshot.docs
    .map(fromDocument)
    .filter((event) => {
      if (filters.from && eventLastDay(event) < filters.from) return false;
      if (filters.assignedToId && event.assignedToId !== filters.assignedToId) return false;
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b));
}

export async function getScheduleEventById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Schedule event not found");
  return fromDocument(snapshot);
}

export async function updateScheduleEvent(id: string, input: ScheduleEventUpdateInput) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Schedule event not found");
  const current = snapshot.data() as ScheduleEventDocument;

  const sent = (field: keyof ScheduleEventUpdateInput) =>
    Object.prototype.hasOwnProperty.call(input, field);
  const merged = {
    title: sent("title") ? input.title : current.title,
    description: sent("description") ? input.description : current.description,
    date: sent("date") ? input.date : current.date,
    endDate: sent("endDate") ? input.endDate : current.endDate,
    allDay: sent("allDay") ? input.allDay : current.allDay,
    startTime: sent("startTime") ? input.startTime : current.startTime,
    endTime: sent("endTime") ? input.endTime : current.endTime,
    assignedToId: sent("assignedToId") ? input.assignedToId : current.assignedToId,
    color: sent("color") ? input.color : current.color,
  };
  // Validate the record as it will be stored, so "end before start" is caught
  // whichever half of the window this request changed. A ZodError here maps
  // to a 400 like any other validation failure.
  const next = scheduleEventCreateSchema.parse(merged);
  const assignee =
    next.assignedToId === current.assignedToId
      ? { assignedToId: current.assignedToId, assignedToName: current.assignedToName }
      : await resolveAssignee(next.assignedToId);
  const orClear = <T>(value: T | undefined) => (value === undefined ? FieldValue.delete() : value);

  await reference.update({
    title: next.title,
    description: orClear(next.description),
    date: next.date,
    endDate: orClear(next.endDate),
    allDay: next.allDay,
    startTime: orClear(next.startTime),
    endTime: orClear(next.endTime),
    color: next.color,
    assignedToId: orClear(assignee.assignedToId),
    assignedToName: orClear(assignee.assignedToName),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return getScheduleEventById(id);
}

export async function deleteScheduleEvent(id: string) {
  await getAdminDb().collection(collectionName).doc(id).delete();
}
