"use client";

import { Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { scheduleColors, scheduleColorStyles } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { ScheduleColor, ScheduleEvent, TeamMember } from "@/types";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/core";

export type EventDraft = {
  title: string;
  description: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  assignedToId: string;
  color: ScheduleColor;
};

export const emptyDraft: EventDraft = {
  title: "",
  description: "",
  date: "",
  endDate: "",
  allDay: false,
  startTime: "09:00",
  endTime: "10:00",
  assignedToId: "",
  color: "blue",
};

export function draftFromEvent(event: ScheduleEvent): EventDraft {
  return {
    title: event.title,
    description: event.description ?? "",
    date: event.date,
    endDate: event.endDate ?? "",
    allDay: event.allDay,
    startTime: event.startTime ?? "",
    endTime: event.endTime ?? "",
    assignedToId: event.assignedToId ?? "",
    color: event.color,
  };
}

export function EventForm({
  draft,
  setDraft,
  members,
  saving,
  editing,
  onSubmit,
  onDelete,
}: {
  draft: EventDraft;
  setDraft: (draft: EventDraft) => void;
  members: TeamMember[];
  saving: boolean;
  editing: boolean;
  onSubmit: (event: FormEvent) => void;
  onDelete?: () => void;
}) {
  const field = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="event-title">Title</Label>
        <Input
          id="event-title"
          required
          maxLength={200}
          value={draft.title}
          onChange={(event) => field("title", event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="event-description">Description</Label>
        <Textarea
          id="event-description"
          value={draft.description}
          onChange={(event) => field("description", event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="event-date">Date</Label>
          <Input
            id="event-date"
            type="date"
            required
            value={draft.date}
            onChange={(event) => field("date", event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="event-end-date">End date</Label>
          <Input
            id="event-end-date"
            type="date"
            min={draft.date || undefined}
            value={draft.endDate}
            onChange={(event) => field("endDate", event.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">Leave blank for a single day.</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          className="size-4 rounded border-slate-300"
          checked={draft.allDay}
          onChange={(event) => field("allDay", event.target.checked)}
        />
        All day
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="event-start">Start time</Label>
          <Input
            id="event-start"
            type="time"
            required={!draft.allDay}
            disabled={draft.allDay}
            value={draft.startTime}
            onChange={(event) => field("startTime", event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="event-end">End time</Label>
          <Input
            id="event-end"
            type="time"
            disabled={draft.allDay}
            value={draft.endTime}
            onChange={(event) => field("endTime", event.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="event-assignee">Assign to</Label>
        <Select
          id="event-assignee"
          value={draft.assignedToId}
          onChange={(event) => field("assignedToId", event.target.value)}
        >
          <option value="">Unassigned</option>
          {members
            .filter((member) => member.active || member.id === draft.assignedToId)
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.active ? "" : " (archived)"}
              </option>
            ))}
        </Select>
      </div>
      <div>
        <p className="mb-1.5 block text-sm font-medium text-slate-700">Color</p>
        <div className="flex gap-2" role="radiogroup" aria-label="Event color">
          {scheduleColors.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={draft.color === color}
              aria-label={scheduleColorStyles[color].label}
              onClick={() => field("color", color)}
              className={cn(
                "size-8 rounded-full border-2 transition",
                scheduleColorStyles[color].swatch,
                draft.color === color ? "border-slate-900 scale-110" : "border-transparent",
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {editing && onDelete ? (
          <Button type="button" variant="ghost" className="px-3 text-red-600" onClick={onDelete}>
            <Trash2 size={16} /> Delete
          </Button>
        ) : (
          <span />
        )}
        <Button disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Add event"}
        </Button>
      </div>
    </form>
  );
}
