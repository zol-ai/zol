"use client";

import { format, parseISO } from "date-fns";
import { Check, Lightbulb, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import { Button, Card, ConfirmDialog, Input, Label, Textarea } from "@/components/ui/core";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { NoteColor, WorkspaceNote } from "@/types";

/*
  Marketing ideas are workspace notes wearing a different page. Same `notes`
  collection, same /api/notes routes, same Company Brain tools: an idea's name
  is the note title and its explanation is the note body. Anything that already
  existed as a note shows up here as an idea, and the agent can still list,
  add, edit, and delete them.
*/

type IdeaDraft = { title: string; body: string; color: NoteColor };

const emptyDraft: IdeaDraft = { title: "", body: "", color: "amber" };

const labels: Array<{ value: NoteColor; label: string; dot: string; bar: string }> = [
  { value: "amber", label: "Amber", dot: "bg-amber-500", bar: "bg-amber-400" },
  { value: "blue", label: "Blue", dot: "bg-blue-500", bar: "bg-blue-400" },
  { value: "green", label: "Green", dot: "bg-emerald-500", bar: "bg-emerald-400" },
  { value: "rose", label: "Rose", dot: "bg-rose-500", bar: "bg-rose-400" },
  { value: "violet", label: "Violet", dot: "bg-violet-500", bar: "bg-violet-400" },
  { value: "slate", label: "Slate", dot: "bg-slate-500", bar: "bg-slate-300" },
];

function labelFor(color: NoteColor) {
  return labels.find((item) => item.value === color) ?? labels[0];
}

function LabelPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: NoteColor;
  onChange: (color: NoteColor) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex h-10 items-center gap-1.5" role="radiogroup" aria-label="Label color">
      {labels.map((item) => (
        <button
          key={`${idPrefix}-${item.value}`}
          type="button"
          role="radio"
          aria-checked={value === item.value}
          aria-label={item.label}
          onClick={() => onChange(item.value)}
          className={cn(
            "grid size-7 place-items-center rounded-full border-2 transition",
            value === item.value ? "border-slate-900" : "border-transparent hover:border-slate-300",
          )}
        >
          <span className={cn("size-4 rounded-full", item.dot)} />
        </button>
      ))}
    </div>
  );
}

function IdeaFields({
  draft,
  setDraft,
  idPrefix,
  autoFocus = false,
}: {
  draft: IdeaDraft;
  setDraft: (draft: IdeaDraft) => void;
  idPrefix: string;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <Label htmlFor={`${idPrefix}-title`}>Idea</Label>
          <Input
            id={`${idPrefix}-title`}
            required
            maxLength={160}
            autoFocus={autoFocus}
            placeholder="e.g. Referral credit for every shop a customer brings in"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </div>
        <div>
          <Label>Label</Label>
          <LabelPicker
            idPrefix={idPrefix}
            value={draft.color}
            onChange={(color) => setDraft({ ...draft, color })}
          />
        </div>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-body`}>Explain it</Label>
        <Textarea
          id={`${idPrefix}-body`}
          maxLength={4000}
          placeholder="What it is, who it reaches, why it could work, and what it would take."
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
      </div>
    </>
  );
}

export function MarketingIdeas() {
  const [ideas, setIdeas] = useState<WorkspaceNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<IdeaDraft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<IdeaDraft>(emptyDraft);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceNote | null>(null);

  const load = useCallback(async () => {
    try {
      setError("");
      setIdeas(await apiFetch<WorkspaceNote[]>("/api/notes"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Newest idea on top. The API orders by last edit, which would shuffle the
  // list every time somebody polished an explanation.
  const ordered = useMemo(
    () => [...ideas].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [ideas],
  );

  async function addIdea(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    try {
      const saved = await apiFetch<WorkspaceNote>("/api/notes", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setIdeas((current) => [saved, ...current]);
      setDraft({ ...emptyDraft, color: draft.color });
      toast.success("Idea added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not add the idea");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(idea: WorkspaceNote) {
    setEditingId(idea.id);
    setEditDraft({ title: idea.title, body: idea.body, color: idea.color });
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    setSavingEdit(true);
    try {
      const saved = await apiFetch<WorkspaceNote>(`/api/notes/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(editDraft),
      });
      setIdeas((current) => current.map((idea) => (idea.id === saved.id ? saved : idea)));
      setEditingId(null);
      toast.success("Idea updated");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the idea");
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeIdea() {
    if (!deleting) return;
    try {
      await apiFetch<{ ok: boolean }>(`/api/notes/${deleting.id}`, { method: "DELETE" });
      setIdeas((current) => current.filter((idea) => idea.id !== deleting.id));
      if (editingId === deleting.id) setEditingId(null);
      toast.success("Idea deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete the idea");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <LoadingState label="Loading marketing ideas" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <>
      <PageHeader
        title="Marketing ideas"
        description="Every idea for getting the word out, in one list. Add one, explain it, and refine it over time."
      />

      <Card className="mb-5 p-4">
        <form onSubmit={addIdea} className="space-y-3">
          <IdeaFields draft={draft} setDraft={setDraft} idPrefix="new-idea" />
          <div className="flex justify-end">
            <Button disabled={adding}>
              <Plus size={17} /> {adding ? "Adding…" : "Add idea"}
            </Button>
          </div>
        </form>
      </Card>

      {!ordered.length ? (
        <EmptyState
          title="No marketing ideas yet"
          description="Write the first one above. A rough idea with a sentence of explanation is enough to start."
        />
      ) : (
        <Card className="divide-y p-0">
          {ordered.map((idea) => {
            const label = labelFor(idea.color);
            if (editingId === idea.id) {
              return (
                <form key={idea.id} onSubmit={saveEdit} className="space-y-3 bg-slate-50/60 px-5 py-4">
                  <IdeaFields draft={editDraft} setDraft={setEditDraft} idPrefix={`idea-${idea.id}`} autoFocus />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setEditingId(null)}
                      disabled={savingEdit}
                    >
                      <X size={16} /> Cancel
                    </Button>
                    <Button disabled={savingEdit}>
                      <Check size={16} /> {savingEdit ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </form>
              );
            }
            return (
              <article key={idea.id} className="flex gap-4 px-5 py-4">
                <span aria-hidden="true" className={cn("w-1 shrink-0 self-stretch rounded-full", label.bar)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="flex items-center gap-2 break-words font-semibold text-slate-950">
                      <Lightbulb size={16} className="shrink-0 text-amber-500" />
                      {idea.title}
                    </h2>
                    <span className="text-xs text-slate-500">
                      Added {format(parseISO(idea.createdAt), "MMM d, yyyy")}
                    </span>
                  </div>
                  {idea.body ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{idea.body}</p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">No explanation yet.</p>
                  )}
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    aria-label={`Edit ${idea.title}`}
                    variant="ghost"
                    className="px-3"
                    onClick={() => startEdit(idea)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    aria-label={`Delete ${idea.title}`}
                    variant="ghost"
                    className="px-3 text-red-600"
                    onClick={() => setDeleting(idea)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </article>
            );
          })}
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete idea?"
        description={`This will permanently delete “${deleting?.title ?? ""}”.`}
        onConfirm={() => void removeIdea()}
      />
    </>
  );
}
