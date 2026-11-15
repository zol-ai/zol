"use client";

import type { FormEvent } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/types";

export type ChecklistItemDraft = {
  title: string;
  detail: string;
  ownerIds: string[];
};

export const emptyChecklistItemDraft: ChecklistItemDraft = {
  title: "",
  detail: "",
  ownerIds: [],
};

export function ChecklistItemForm({
  draft,
  setDraft,
  members,
  saving,
  onSubmit,
}: {
  draft: ChecklistItemDraft;
  setDraft: (draft: ChecklistItemDraft) => void;
  members: TeamMember[];
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  function toggleOwner(id: string) {
    setDraft({
      ...draft,
      ownerIds: draft.ownerIds.includes(id)
        ? draft.ownerIds.filter((owner) => owner !== id)
        : [...draft.ownerIds, id],
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <Label htmlFor="checklist-title">What has to happen, every day</Label>
        <Input
          id="checklist-title"
          required
          maxLength={200}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="Example: 10 customer calls"
        />
      </div>

      <div>
        <Label htmlFor="checklist-detail">Detail</Label>
        <Textarea
          id="checklist-detail"
          className="min-h-20"
          maxLength={2000}
          value={draft.detail}
          onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
          placeholder="What counts as done, and why it matters."
        />
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-slate-700">
          Who owns it
        </legend>
        <p className="mb-2 text-xs text-slate-500">
          Everyone picked here gets their own box to tick, every day.
        </p>
        <div className="flex flex-wrap gap-2">
          {members.map((member) => {
            const selected = draft.ownerIds.includes(member.id);
            return (
              <label
                key={member.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  selected
                    ? "border-blue-300 bg-blue-50 text-blue-800"
                    : "bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-blue-600"
                  checked={selected}
                  onChange={() => toggleOwner(member.id)}
                />
                {member.name}
              </label>
            );
          })}
        </div>
        {members.length ? null : (
          <p className="mt-2 text-sm text-slate-500">
            Add someone on the Team page first.
          </p>
        )}
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        {draft.ownerIds.length ? null : (
          <p className="text-sm text-slate-500">Pick at least one person.</p>
        )}
        <Button disabled={saving || !draft.ownerIds.length}>
          {saving ? "Saving..." : "Save item"}
        </Button>
      </div>
    </form>
  );
}
