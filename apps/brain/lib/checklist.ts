import type { ChecklistCompletion, ChecklistItem, TeamMember } from "@/types";

/*
  Pure grouping for the checklist page.

  Kept out of the component for the same reason lib/schedule.ts is: this is the
  part worth testing, and it must stay free of React and of anything
  server-only.
*/

export function completionKey(itemId: string, ownerId: string) {
  return `${itemId}:${ownerId}`;
}

/** Ticks indexed by item and owner, so deciding whether a box is filled is one lookup. */
export function indexCompletions(completions: ChecklistCompletion[]) {
  return new Map(
    completions.map(
      (completion) => [completionKey(completion.itemId, completion.ownerId), completion] as const,
    ),
  );
}

export type ChecklistColumn = {
  id: string;
  name: string;
  /** False when the owner is no longer in the team list. The column still appears. */
  known: boolean;
  items: ChecklistItem[];
};

/**
 * One column per person who owns something today, alphabetical.
 *
 * Paused items are left out entirely. An owner who has left the team still
 * gets a column, listed last: the work stays on the list until somebody edits
 * it off, and dropping it silently would make a day look finished when nobody
 * did it.
 */
export function checklistColumns(
  items: ChecklistItem[],
  members: TeamMember[],
): ChecklistColumn[] {
  const active = items.filter((item) => item.active);
  const byId = new Map(members.map((member) => [member.id, member]));
  return [...new Set(active.flatMap((item) => item.ownerIds))]
    .map((id) => ({
      id,
      name: byId.get(id)?.name ?? "Unknown member",
      known: byId.has(id),
      items: active.filter((item) => item.ownerIds.includes(id)),
    }))
    .sort((a, b) => Number(b.known) - Number(a.known) || a.name.localeCompare(b.name));
}

export function countDone(column: ChecklistColumn, done: ReadonlyMap<string, unknown>) {
  return column.items.filter((item) => done.has(completionKey(item.id, column.id))).length;
}

/** Boxes ticked and boxes there are, across everybody. */
export function checklistTotals(
  columns: ChecklistColumn[],
  done: ReadonlyMap<string, unknown>,
) {
  return columns.reduce(
    (running, column) => ({
      done: running.done + countDone(column, done),
      total: running.total + column.items.length,
    }),
    { done: 0, total: 0 },
  );
}
