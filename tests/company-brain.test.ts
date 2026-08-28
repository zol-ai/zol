import { describe, expect, it } from "vitest";
import { summarizeWorkspace } from "../lib/ai/metrics";
import { companyBrainRequestSchema } from "../lib/validation/companyBrain";
import type { Client, Task, TeamMember } from "../types";

const timestamp = "2026-08-20T12:00:00.000Z";

const tasks: Task[] = [
  {
    id: "open-overdue",
    title: "Overdue task",
    status: "todo",
    priority: "high",
    dueDate: "2026-08-19",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "open-today",
    title: "Today task",
    status: "in_progress",
    priority: "medium",
    dueDate: "2026-08-20",
    assignedToId: "amol",
    assignedToName: "Amol",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "completed",
    title: "Finished task",
    status: "completed",
    priority: "low",
    dueDate: "2026-08-18",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  },
];

const members: TeamMember[] = [
  {
    id: "amol",
    name: "Amol",
    email: "private@example.com",
    role: "Founder",
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "archived",
    name: "Archived person",
    active: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const clients: Client[] = [
  {
    id: "client",
    name: "Client",
    contactEmail: "private@client.example",
    status: "active",
    color: "blue",
    source: "manual",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

describe("Company Brain request validation", () => {
  it("requires the last message to come from the user", () => {
    expect(() =>
      companyBrainRequestSchema.parse({
        messages: [{ role: "assistant", content: "Ready" }],
      }),
    ).toThrow("The last message must be from the user");
  });

  it("accepts a bounded conversation", () => {
    const result = companyBrainRequestSchema.parse({
      messages: [
        { role: "user", content: "How many tasks?" },
        { role: "assistant", content: "Three." },
        { role: "user", content: "How many are open?" },
      ],
    });
    expect(result.messages).toHaveLength(3);
  });
});

describe("Company Brain workspace summary", () => {
  it("calculates exact task, people, and client counts", () => {
    const summary = summarizeWorkspace(
      tasks,
      members,
      clients,
      "2026-08-20",
      "America/Los_Angeles",
    );

    expect(summary.tasks).toEqual({
      total: 3,
      open: 2,
      todo: 1,
      inProgress: 1,
      completed: 1,
      dueToday: 1,
      overdue: 1,
      unassigned: 1,
    });
    expect(summary.people).toEqual({ total: 2, active: 1, archived: 1 });
    expect(summary.clients.total).toBe(1);
  });

  it("does not expose member or client contact details", () => {
    const summary = summarizeWorkspace(
      tasks,
      members,
      clients,
      "2026-08-20",
      "America/Los_Angeles",
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("private@client.example");
  });
});
