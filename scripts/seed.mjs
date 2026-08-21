import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (process.env.NODE_ENV === "production") {
  throw new Error("The seed script is disabled when NODE_ENV=production.");
}

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required.");

const app =
  getApps()[0] ??
  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
const db = getFirestore(app);
const now = Timestamp.now();
const date = (offset) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

const members = [
  { id: "amol", name: "Amol", email: "amol@tryzol.com", role: "Founder", active: true },
  { id: "ezaz", name: "Ezaz", email: "zaz@tryzol.com", role: "Founder", active: true },
];

const clients = [
  { id: "northstar-labs", name: "Northstar Labs", contactName: "Maya Chen", contactEmail: "maya@example.com", status: "active", notes: "Product strategy engagement" },
  { id: "harbor-health", name: "Harbor Health", contactName: "Daniel Ruiz", contactEmail: "daniel@example.com", status: "lead", notes: "Discovery in progress" },
  { id: "brightpath", name: "BrightPath", contactName: "Nora Patel", status: "paused", notes: "Resume next quarter" },
];

const tasks = [
  { id: "task-product-brief", title: "Finalize product brief", description: "Consolidate feedback and publish the MVP scope.", assignedToId: "amol", assignedToName: "Amol", status: "in_progress", priority: "high", dueDate: date(0), clientId: "northstar-labs" },
  { id: "task-client-followup", title: "Follow up with Harbor Health", assignedToId: "ezaz", assignedToName: "Ezaz", status: "todo", priority: "high", dueDate: date(-2), clientId: "harbor-health" },
  { id: "task-weekly-metrics", title: "Prepare weekly metrics", assignedToId: "amol", assignedToName: "Amol", status: "todo", priority: "medium", dueDate: date(0) },
  { id: "task-customer-notes", title: "Organize customer interview notes", assignedToId: "ezaz", assignedToName: "Ezaz", status: "in_progress", priority: "medium", dueDate: date(2), clientId: "northstar-labs" },
  { id: "task-pricing-review", title: "Review pricing assumptions", assignedToId: "amol", assignedToName: "Amol", status: "todo", priority: "low", dueDate: date(5) },
  { id: "task-demo-script", title: "Write customer demo script", assignedToId: "ezaz", assignedToName: "Ezaz", status: "todo", priority: "medium", dueDate: date(7), clientId: "harbor-health" },
  { id: "task-brand-assets", title: "Collect brand assets", assignedToId: "amol", assignedToName: "Amol", status: "completed", priority: "low", dueDate: date(-3), completedAt: Timestamp.fromDate(new Date(Date.now() - 86400000)), clientId: "brightpath" },
  { id: "task-kickoff-agenda", title: "Share kickoff agenda", assignedToId: "ezaz", assignedToName: "Ezaz", status: "completed", priority: "high", dueDate: date(-1), completedAt: now, clientId: "northstar-labs" },
];

const batch = db.batch();
for (const { id, ...member } of members) {
  batch.set(db.collection("teamMembers").doc(id), {
    ...member,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
}
for (const { id, ...client } of clients) {
  batch.set(db.collection("clients").doc(id), {
    ...client,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
}
for (const { id, ...task } of tasks) {
  batch.set(db.collection("tasks").doc(id), {
    ...task,
    completedAt: task.completedAt ?? null,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
}

await batch.commit();
console.log(`Seeded ${members.length} team members, ${clients.length} clients, and ${tasks.length} tasks.`);
