"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import { Badge, Button, Card, ConfirmDialog, Input, Modal } from "@/components/ui/core";
import { apiFetch } from "@/lib/api";
import {
  checklistColumns,
  checklistTotals,
  completionKey,
  countDone,
  indexCompletions,
} from "@/lib/checklist";
import { rangeLabel, shiftAnchor, todayKey } from "@/lib/schedule";
import { cn, initials } from "@/lib/utils";
import type {
  ChecklistCompletion,
  ChecklistDay,
  ChecklistItem,
  TeamMember,
} from "@/types";
import {
  ChecklistItemForm,
  emptyChecklistItemDraft,
  type ChecklistItemDraft,
} from "./checklist-item-form";

/*
  The daily non-negotiables.

  Items are the same every day and only the ticks change, so the page is built
  around a date: one column per person, one box per person per item. Moving to
  another day re-reads that day of ticks and leaves the items alone.

  Anybody signed in can tick anybody else's box. Three founders running down
  the list together is the normal case, and the document records who clicked.
*/

function draftFromItem(item: ChecklistItem): ChecklistItemDraft {
  return { title: item.title, detail: item.detail ?? "", ownerIds: item.ownerIds };
}

export function ChecklistManager() {
  const [date, setDate] = useState(() => todayKey());
  const [day, setDay] = useState<ChecklistDay | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [pending, setPending] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [deleting, setDeleting] = useState<ChecklistItem | null>(null);
  const [draft, setDraft] = useState<ChecklistItemDraft>(emptyChecklistItemDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (target: string) => {
    setRefreshing(true);
    setError("");
    try {
      const [dayData, teamData] = await Promise.all([
        apiFetch<ChecklistDay>(`/api/checklist?date=${target}`),
        apiFetch<TeamMember[]>("/api/team"),
      ]);
      setDay(dayData);
      setMembers(teamData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load the checklist");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(date), 0);
    return () => window.clearTimeout(timer);
  }, [load, date]);

  const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);

  const done = useMemo(() => indexCompletions(day?.completions ?? []), [day]);

  const columns = useMemo(
    () => checklistColumns(day?.items ?? [], members),
    [day, members],
  );

  const totals = useMemo(() => checklistTotals(columns, done), [columns, done]);

  async function toggle(item: ChecklistItem, ownerId: string, next: boolean) {
    const key = completionKey(item.id, ownerId);
    const forDate = date;
    setPending((current) => [...current, key]);
    try {
      const result = await apiFetch<{ done: boolean; completion: ChecklistCompletion | null }>(
        `/api/checklist/${item.id}/completion`,
        { method: "POST", body: JSON.stringify({ date: forDate, ownerId, done: next }) },
      );
      setDay((current) => {
        // The view can have moved to another day while this was in flight. A
        // tick belongs to the day it was made on, not to whatever is on screen.
        if (!current || current.date !== forDate) return current;
        const others = current.completions.filter(
          (completion) => completionKey(completion.itemId, completion.ownerId) !== key,
        );
        return {
          ...current,
          completions: result.completion ? [...others, result.completion] : others,
        };
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save that");
    } finally {
      setPending((current) => current.filter((entry) => entry !== key));
    }
  }

  function openCreate() {
    setEditing(null);
    setDraft(emptyChecklistItemDraft);
    setModalOpen(true);
  }

  function openEdit(item: ChecklistItem) {
    setEditing(item);
    setDraft(draftFromItem(item));
    setModalOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<ChecklistItem>(
        editing ? `/api/checklist/${editing.id}` : "/api/checklist",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({ ...draft, title: draft.title.trim() }),
        },
      );
      setDay((current) =>
        current
          ? {
              ...current,
              items: editing
                ? current.items.map((item) => (item.id === saved.id ? saved : item))
                : [...current.items, saved],
            }
          : current,
      );
      setModalOpen(false);
      toast.success(editing ? "Item updated" : "Item added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the item");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(item: ChecklistItem, active: boolean) {
    try {
      const saved = await apiFetch<ChecklistItem>(`/api/checklist/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      setDay((current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) => (entry.id === saved.id ? saved : entry)),
            }
          : current,
      );
      toast.success(active ? "Item resumed" : "Item paused");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update the item");
    }
  }

  async function remove() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await apiFetch(`/api/checklist/${target.id}`, { method: "DELETE" });
      setDay((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((item) => item.id !== target.id),
              completions: current.completions.filter(
                (completion) => completion.itemId !== target.id,
              ),
            }
          : current,
      );
      toast.success("Item deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete the item");
    }
  }

  if (!day) {
    return error ? (
      <ErrorState message={error} retry={() => void load(date)} />
    ) : (
      <LoadingState label="Loading the checklist" />
    );
  }

  const today = todayKey();
  const relative =
    date === today
      ? "Today"
      : date === shiftAnchor("day", today, -1)
        ? "Yesterday"
        : date === shiftAnchor("day", today, 1)
          ? "Tomorrow"
          : null;

  return (
    <>
      <PageHeader
        title="Checklist"
        description="The daily non-negotiables. Same list every day, a box each, ticked or not."
        actions={
          <Button onClick={openCreate}>
            <Plus size={17} /> Add item
          </Button>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState message={error} retry={() => void load(date)} />
        </div>
      ) : null}

      <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            aria-label="Previous day"
            className="size-10 px-0"
            onClick={() => setDate(shiftAnchor("day", date, -1))}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="secondary"
            aria-label="Next day"
            className="size-10 px-0"
            onClick={() => setDate(shiftAnchor("day", date, 1))}
          >
            <ChevronRight size={18} />
          </Button>
          <div className="ml-1">
            <p className="text-sm font-semibold">{rangeLabel("day", date)}</p>
            {relative ? <p className="text-xs text-slate-500">{relative}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">
            {totals.done} of {totals.total} done
          </span>
          <div className="relative">
            <CalendarDays
              aria-hidden="true"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              aria-label="Pick a day"
              type="date"
              className="w-44 pl-9"
              value={date}
              onChange={(event) => event.target.value && setDate(event.target.value)}
            />
          </div>
          <Button variant="secondary" disabled={date === today} onClick={() => setDate(today)}>
            Today
          </Button>
        </div>
      </Card>

      <div className={cn("mt-5", refreshing && "opacity-60")}>
        {columns.length ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {columns.map((column) => {
              const finished = countDone(column, done);
              const complete = finished === column.items.length;
              return (
                <Card key={column.id} className="p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <div
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
                        complete
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {initials(column.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{column.name}</p>
                      {column.known ? null : (
                        <p className="text-xs text-amber-700">No longer on the team</p>
                      )}
                    </div>
                    <Badge tone={complete ? "green" : "slate"}>
                      {finished}/{column.items.length}
                    </Badge>
                  </div>

                  <ul className="space-y-2">
                    {column.items.map((item) => {
                      const key = completionKey(item.id, column.id);
                      const completion = done.get(key);
                      const busy = pending.includes(key);
                      return (
                        <li key={item.id}>
                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-3 transition",
                              completion
                                ? "border-emerald-200 bg-emerald-50/60"
                                : "bg-white hover:bg-slate-50",
                              busy && "opacity-60",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 size-5 shrink-0 accent-blue-600"
                              checked={Boolean(completion)}
                              disabled={busy}
                              onChange={(event) =>
                                void toggle(item, column.id, event.target.checked)
                              }
                            />
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  "block text-sm font-medium",
                                  completion && "text-slate-500 line-through",
                                )}
                              >
                                {item.title}
                              </span>
                              {item.detail ? (
                                <span className="mt-0.5 block text-xs text-slate-500">
                                  {item.detail}
                                </span>
                              ) : null}
                              {completion?.doneByEmail ? (
                                <span className="mt-1 block text-[11px] text-emerald-700">
                                  Ticked by {completion.doneByEmail}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No non-negotiables yet"
            description="Add the things that have to happen every day, and pick who owns each one."
            action={<Button onClick={openCreate}>Add item</Button>}
          />
        )}
      </div>

      {day.items.length ? (
        <Card className="mt-5 p-4">
          <h2 className="text-sm font-semibold">The list</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Editing here changes the item for everyone who owns it, on every day.
          </p>
          <ul className="mt-3 divide-y">
            {day.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        item.active || "text-slate-400 line-through",
                      )}
                    >
                      {item.title}
                    </p>
                    {item.active ? null : <Badge tone="amber">Paused</Badge>}
                  </div>
                  {item.detail ? (
                    <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.ownerIds.map((ownerId) => (
                      <Badge key={ownerId} tone="blue">
                        {members.find((member) => member.id === ownerId)?.name ??
                          "Unknown member"}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    className="size-10 px-0"
                    aria-label={item.active ? `Pause ${item.title}` : `Resume ${item.title}`}
                    onClick={() => void setActive(item, !item.active)}
                  >
                    {item.active ? <Pause size={16} /> : <Play size={16} />}
                  </Button>
                  <Button
                    variant="ghost"
                    className="size-10 px-0"
                    aria-label={`Edit ${item.title}`}
                    onClick={() => openEdit(item)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="size-10 px-0 text-red-600"
                    aria-label={`Delete ${item.title}`}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? "Edit item" : "Add item"}
        description="A non-negotiable is something its owners do every single day."
      >
        <ChecklistItemForm
          draft={draft}
          setDraft={setDraft}
          members={activeMembers}
          saving={saving}
          onSubmit={save}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete item?"
        description={`This deletes “${deleting?.title ?? "this item"}” and every tick anyone has ever made against it. Pause it instead to stop it appearing without losing the history.`}
        onConfirm={() => void remove()}
      />
    </>
  );
}
