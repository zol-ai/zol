import { FieldValue, type DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import type { TaskInput } from "@/lib/validation/schemas";
import type { Task, TaskDocument, TaskPriority, TaskStatus } from "@/types";
import { compact, timestampToIso } from "./serialize";

const collectionName = "tasks";

function fromDocument(snapshot: DocumentSnapshot): Task {
  const data = snapshot.data() as TaskDocument;
  return {
    id: snapshot.id,
    title: data.title,
    description: data.description,
    assignedToId: data.assignedToId,
    assignedToName: data.assignedToName,
    status: data.status,
    priority: data.priority,
    dueDate: data.dueDate,
    clientId: data.clientId,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    completedAt: data.completedAt ? timestampToIso(data.completedAt) : null,
  };
}

async function resolveAssignee(input: Partial<TaskInput>) {
  if (!input.assignedToId) return {};
  const snapshot = await getAdminDb()
    .collection("teamMembers")
    .doc(input.assignedToId)
    .get();
  if (!snapshot.exists || snapshot.data()?.active !== true) {
    throw new Error("Selected assignee is not active");
  }
  return { assignedToName: snapshot.data()?.name as string };
}

export async function createTask(input: TaskInput) {
  const reference = getAdminDb().collection(collectionName).doc();
  const assignee = input.assignedToId ? await resolveAssignee(input) : {};
  await reference.set(
    compact({
      ...input,
      ...assignee,
      completedAt: input.status === "completed" ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getTaskById(reference.id);
}

export async function getTasks(filters?: {
  assignedToId?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  clientId?: string;
  dueDate?: string;
}) {
  const snapshot = await getAdminDb().collection(collectionName).get();
  const tasks = snapshot.docs.map(fromDocument).filter((task) => {
    if (filters?.assignedToId && task.assignedToId !== filters.assignedToId) return false;
    if (filters?.status && task.status !== filters.status) return false;
    if (filters?.priority && task.priority !== filters.priority) return false;
    if (filters?.clientId && task.clientId !== filters.clientId) return false;
    if (filters?.dueDate && task.dueDate !== filters.dueDate) return false;
    return true;
  });
  return tasks.sort((a, b) => {
    if (a.status === "completed" && b.status === "completed") {
      return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
    }
    if (a.status === "completed") return 1;
    if (b.status === "completed") return -1;
    if (!a.dueDate && !b.dueDate) return b.createdAt.localeCompare(a.createdAt);
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export async function getTaskById(id: string) {
  const snapshot = await getAdminDb().collection(collectionName).doc(id).get();
  if (!snapshot.exists) throw new Error("Task not found");
  return fromDocument(snapshot);
}

export async function updateTask(id: string, input: Partial<TaskInput>) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  const snapshot = await reference.get();
  if (!snapshot.exists) throw new Error("Task not found");
  const current = snapshot.data() as TaskDocument;
  const assignee =
    Object.prototype.hasOwnProperty.call(input, "assignedToId")
      ? input.assignedToId
        ? input.assignedToId === current.assignedToId
          ? { assignedToName: current.assignedToName }
          : await resolveAssignee(input)
        : {
            assignedToId: FieldValue.delete(),
            assignedToName: FieldValue.delete(),
          }
      : {};
  const clearedFields = Object.fromEntries(
    (["description", "dueDate", "clientId"] as const)
      .filter(
        (field) =>
          Object.prototype.hasOwnProperty.call(input, field) && input[field] === undefined,
      )
      .map((field) => [field, FieldValue.delete()]),
  );
  const statusFields =
    input.status === "completed"
      ? { completedAt: FieldValue.serverTimestamp() }
      : input.status
        ? { completedAt: null }
        : {};
  await reference.update(
    compact({
      ...input,
      ...clearedFields,
      ...assignee,
      ...statusFields,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  return getTaskById(id);
}

export async function completeTask(id: string) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  if (!(await reference.get()).exists) throw new Error("Task not found");
  await reference.update({
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return getTaskById(id);
}

export async function reopenTask(id: string) {
  const reference = getAdminDb().collection(collectionName).doc(id);
  if (!(await reference.get()).exists) throw new Error("Task not found");
  await reference.update({
    status: "todo",
    completedAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return getTaskById(id);
}

export async function deleteTask(id: string) {
  await getAdminDb().collection(collectionName).doc(id).delete();
}
