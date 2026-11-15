import { describe, expect, it } from "vitest";
import {
  checklistColumns,
  checklistTotals,
  completionKey,
  countDone,
  indexCompletions,
} from "../lib/checklist";
import {
  checklistCompletionSchema,
  checklistDayQuerySchema,
  checklistItemCreateSchema,
  checklistItemUpdateSchema,
} from "../lib/validation/schemas";
import type { ChecklistCompletion, ChecklistItem, TeamMember } from "../types";

function item(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: "item",
    title: "Item",
    ownerIds: ["ezaz"],
    order: 0,
    active: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function member(id: string, name: string): TeamMember {
  return { id, name, active: true, createdAt: "", updatedAt: "" };
}

function completion(itemId: string, ownerId: string): ChecklistCompletion {
  return { id: `${itemId}-${ownerId}`, date: "2026-09-09", itemId, ownerId, doneAt: "" };
}

const team = [member("amol", "Amol"), member("ezaz", "Ezaz"), member("ikram", "Ikram")];

describe("checklistColumns", () => {
  it("gives each owner of a shared item their own column", () => {
    const calls = item({ id: "calls", ownerIds: ["ezaz", "amol", "ikram"] });
    const columns = checklistColumns([calls], team);
    expect(columns.map((column) => column.id)).toEqual(["amol", "ezaz", "ikram"]);
    for (const column of columns) expect(column.items).toEqual([calls]);
  });

  it("leaves paused items out of every column", () => {
    const columns = checklistColumns(
      [item({ id: "live" }), item({ id: "paused", active: false })],
      team,
    );
    expect(columns).toHaveLength(1);
    expect(columns[0].items.map((entry) => entry.id)).toEqual(["live"]);
  });

  it("has no columns at all when everything is paused", () => {
    expect(checklistColumns([item({ active: false })], team)).toEqual([]);
  });

  it("keeps an owner who has left the team, flagged and last", () => {
    const columns = checklistColumns(
      [item({ id: "a", ownerIds: ["ezaz"] }), item({ id: "b", ownerIds: ["ghost"] })],
      team,
    );
    expect(columns.map((column) => [column.id, column.known])).toEqual([
      ["ezaz", true],
      ["ghost", false],
    ]);
    expect(columns[1].name).toBe("Unknown member");
  });

  it("lists an owner once however many items they hold", () => {
    const columns = checklistColumns(
      [item({ id: "a", ownerIds: ["ezaz"] }), item({ id: "b", ownerIds: ["ezaz"] })],
      team,
    );
    expect(columns).toHaveLength(1);
    expect(columns[0].items).toHaveLength(2);
  });
});

describe("counting ticks", () => {
  it("counts a shared item once per owner, not once overall", () => {
    const calls = item({ id: "calls", ownerIds: ["ezaz", "amol", "ikram"] });
    const columns = checklistColumns([calls], team);
    const done = indexCompletions([completion("calls", "ezaz")]);

    expect(checklistTotals(columns, done)).toEqual({ done: 1, total: 3 });
    expect(countDone(columns.find((column) => column.id === "ezaz")!, done)).toBe(1);
    expect(countDone(columns.find((column) => column.id === "amol")!, done)).toBe(0);
  });

  it("ignores a tick belonging to somebody else's box", () => {
    const columns = checklistColumns([item({ id: "post", ownerIds: ["ezaz"] })], team);
    expect(checklistTotals(columns, indexCompletions([completion("post", "amol")]))).toEqual({
      done: 0,
      total: 1,
    });
  });

  it("keys a tick by item and owner together", () => {
    expect(completionKey("post", "ezaz")).toBe("post:ezaz");
  });
});

describe("checklistItemCreateSchema", () => {
  it("requires at least one owner", () => {
    expect(() => checklistItemCreateSchema.parse({ title: "Post", ownerIds: [] })).toThrow();
  });

  it("requires a title", () => {
    expect(() => checklistItemCreateSchema.parse({ title: "  ", ownerIds: ["ezaz"] })).toThrow();
  });

  it("drops a duplicated owner rather than giving them two boxes", () => {
    const parsed = checklistItemCreateSchema.parse({
      title: "X post",
      ownerIds: ["ezaz", "ezaz", "amol"],
    });
    expect(parsed.ownerIds).toEqual(["ezaz", "amol"]);
  });

  it("turns an empty detail into nothing stored", () => {
    expect(
      checklistItemCreateSchema.parse({ title: "X post", detail: "", ownerIds: ["ezaz"] }).detail,
    ).toBeUndefined();
  });

  it("rejects fields the form has no business sending", () => {
    expect(() =>
      checklistItemCreateSchema.parse({ title: "X post", ownerIds: ["ezaz"], order: 3 }),
    ).toThrow();
  });
});

describe("checklistItemUpdateSchema", () => {
  it("rejects an empty patch", () => {
    expect(() => checklistItemUpdateSchema.parse({})).toThrow();
  });

  it("accepts pausing on its own", () => {
    expect(checklistItemUpdateSchema.parse({ active: false })).toEqual({ active: false });
  });
});

describe("checklistCompletionSchema", () => {
  it("accepts a tick", () => {
    expect(
      checklistCompletionSchema.parse({ date: "2026-09-09", ownerId: "ezaz", done: true }),
    ).toEqual({ date: "2026-09-09", ownerId: "ezaz", done: true });
  });

  it("rejects a day that never happened", () => {
    expect(() =>
      checklistCompletionSchema.parse({ date: "2026-02-30", ownerId: "ezaz", done: true }),
    ).toThrow();
  });

  it("insists on saying which way the box goes", () => {
    expect(() =>
      checklistCompletionSchema.parse({ date: "2026-09-09", ownerId: "ezaz" }),
    ).toThrow();
  });
});

describe("checklistDayQuerySchema", () => {
  it("allows no date at all", () => {
    expect(checklistDayQuerySchema.parse({}).date).toBeUndefined();
  });

  it("rejects a malformed date instead of falling back to today", () => {
    expect(() => checklistDayQuerySchema.parse({ date: "yesterday" })).toThrow();
  });
});
