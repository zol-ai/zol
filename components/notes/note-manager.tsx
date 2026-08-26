"use client";

import { Pencil, Plus, StickyNote, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import {
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  Textarea,
} from "@/components/ui/core";
import { apiFetch } from "@/lib/api";
import type { NoteColor, WorkspaceNote } from "@/types";

type NoteDraft = {
  title: string;
  body: string;
  color: NoteColor;
};

const emptyDraft: NoteDraft = {
  title: "",
  body: "",
  color: "amber",
};

const noteColors: Array<{ value: NoteColor; label: string; dot: string; card: string; strip: string }> = [
  { value: "amber", label: "Amber", dot: "bg-amber-500", card: "border-amber-200 bg-amber-50/70", strip: "bg-amber-500" },
  { value: "blue", label: "Blue", dot: "bg-blue-500", card: "border-blue-200 bg-blue-50/60", strip: "bg-blue-500" },
  { value: "green", label: "Green", dot: "bg-emerald-500", card: "border-emerald-200 bg-emerald-50/60", strip: "bg-emerald-500" },
  { value: "rose", label: "Rose", dot: "bg-rose-500", card: "border-rose-200 bg-rose-50/60", strip: "bg-rose-500" },
  { value: "violet", label: "Violet", dot: "bg-violet-500", card: "border-violet-200 bg-violet-50/60", strip: "bg-violet-500" },
  { value: "slate", label: "Slate", dot: "bg-slate-500", card: "border-slate-200 bg-white", strip: "bg-slate-500" },
];

function getNoteColor(color: NoteColor) {
  return noteColors.find((item) => item.value === color) ?? noteColors[0];
}

export function NoteManager() {
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceNote | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceNote | null>(null);
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      setNotes(await apiFetch<WorkspaceNote[]>("/api/notes"));
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

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setModalOpen(true);
  }

  function openEdit(note: WorkspaceNote) {
    setEditing(note);
    setDraft({ title: note.title, body: note.body, color: note.color });
    setModalOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<WorkspaceNote>(
        editing ? `/api/notes/${editing.id}` : "/api/notes",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setNotes((current) =>
        editing
          ? current.map((note) => (note.id === saved.id ? saved : note))
          : [saved, ...current],
      );
      setModalOpen(false);
      toast.success(editing ? "Note updated" : "Note added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save note");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote() {
    if (!deleting) return;
    try {
      await apiFetch<{ ok: boolean }>(`/api/notes/${deleting.id}`, { method: "DELETE" });
      setNotes((current) => current.filter((note) => note.id !== deleting.id));
      toast.success("Note deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete note");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <LoadingState label="Loading notes" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <>
      <PageHeader
        title="Notes"
        description="Keep quick internal notes next to the rest of the workspace."
        actions={
          <Button onClick={openCreate}>
            <Plus size={17} /> Add note
          </Button>
        }
      />

      {!notes.length ? (
        <EmptyState
          title="No notes yet"
          description="Add notes for quick follow-ups, reminders, or client context."
          action={<Button onClick={openCreate}>Add note</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {notes.map((note) => {
            const color = getNoteColor(note.color);
            return (
              <Card key={note.id} className={`overflow-hidden p-0 ${color.card}`}>
                <div className={`h-2 ${color.strip}`} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StickyNote size={17} className="shrink-0 text-slate-400" />
                        <h2 className="break-words font-semibold text-slate-950">{note.title}</h2>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Updated {new Date(note.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span aria-label={`${color.label} note color`} className={`mt-1 size-4 rounded-full border border-white shadow-sm ring-2 ring-slate-200 ${color.dot}`} />
                  </div>
                  {note.body ? (
                    <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-700">{note.body}</p>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">No note text yet.</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => openEdit(note)}>
                      <Pencil size={15} /> Edit
                    </Button>
                    <Button variant="ghost" className="text-red-600" onClick={() => setDeleting(note)}>
                      <Trash2 size={15} /> Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? "Edit note" : "Add note"}>
        <form onSubmit={save} className="space-y-4">
          <div>
            <Label htmlFor="note-title">Title</Label>
            <Input id="note-title" required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </div>
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {noteColors.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  aria-label={`${color.label} note color`}
                  onClick={() => setDraft({ ...draft, color: color.value })}
                  className={`grid size-10 place-items-center rounded-lg border ${draft.color === color.value ? "border-slate-900" : "border-slate-200"}`}
                >
                  <span className={`size-5 rounded-full ${color.dot}`} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="note-body">Note</Label>
            <Textarea id="note-body" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button disabled={saving}>{saving ? "Saving..." : "Save note"}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete note?"
        description={`This will permanently delete "${deleting?.title ?? ""}".`}
        onConfirm={() => void removeNote()}
      />
    </>
  );
}
