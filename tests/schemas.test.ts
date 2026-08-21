import { describe, expect, it } from "vitest";
import {
  clientCreateSchema,
  taskCreateSchema,
  teamMemberCreateSchema,
} from "../lib/validation/schemas";

describe("task validation", () => {
  it("accepts a valid task and supplies defaults", () => {
    const result = taskCreateSchema.parse({ title: "Ship dashboard" });
    expect(result).toMatchObject({
      title: "Ship dashboard",
      status: "todo",
      priority: "medium",
    });
  });

  it("rejects an empty title and invalid due date", () => {
    expect(() =>
      taskCreateSchema.parse({ title: "", dueDate: "08/20/2026" }),
    ).toThrow();
  });
});

describe("team and client validation", () => {
  it("defaults a new team member to active", () => {
    expect(teamMemberCreateSchema.parse({ name: "Amol" }).active).toBe(true);
  });

  it("rejects an invalid client contact email", () => {
    expect(() =>
      clientCreateSchema.parse({ name: "Northstar", contactEmail: "invalid" }),
    ).toThrow();
  });
});
