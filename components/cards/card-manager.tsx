"use client";

import { Check, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import {
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Modal,
} from "@/components/ui/core";
import { apiFetch } from "@/lib/api";
import type { WorkCard, WorkCardColor, WorkCardTodo } from "@/types";

const colors: Array<{ value: WorkCardColor; label: string; swatch: string; card: string; bar: string }> = [
  {
    value: "blue",
    label: "Blue",
    swatch: "bg-blue-500",
    card: "border-blue-200 bg-blue-50/50",
    bar: "bg-blue-500",
  },
  {
    value: "green",
    label: "Green",
    swatch: "bg-emerald-500",
    card: "border-emerald-200 bg-emerald-50/50",
    bar: "bg-emerald-500",
  },
  {
    value: "amber",
    label: "Amber",
    swatch: "bg-amber-500",
    card: "border-amber-200 bg-amber-50/60",
    bar: "bg-amber-500",
  },
  {
    value: "rose",
    label: "Rose",
    swatch: "bg-rose-500",
    card: "border-rose-200 bg-rose-50/50",
    bar: "bg-rose-500",
  },
  {
    value: "violet",
    label: "Violet",
    swatch: "bg-violet-500",
    card: "border-violet-200 bg-violet-50/50",
    bar: "bg-violet-500",
  },
  {
    value: "slate",
    label: "Slate",
    swatch: "bg-slate-500",
    card: "border-slate-200 bg-white",
    bar: "bg-slate-500",
  },
];

type CardDraft = {
  title: string;
  todos: WorkCardTodo[];
  color: WorkCardColor;
};

const emptyDraft: CardDraft = {
  title: "",
  todos: [],
  color: "blue",
};

function createTodo(text = ""): WorkCardTodo {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    text,
    done: false,
  };
}

function sanitizeDraft(draft: CardDraft, order: number) {
  return {
    title: draft.title,
    color: draft.color,
    order,
    todos: draft.todos
      .map((todo) => ({ ...todo, text: todo.text.trim() }))
      .filter((todo) => todo.text.length > 0),
  };
}

function CardForm({
  draft,
  setDraft,
  saving,
  onSubmit,
}: {
  draft: CardDraft;
  setDraft: (draft: CardDraft) => void;
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  function updateTodo(id: string, patch: Partial<WorkCardTodo>) {
    setDraft({
      ...draft,
      todos: draft.todos.map((todo) => (todo.id === id ? { ...todo, ...patch } : todo)),
    });
  }

  function removeTodo(id: string) {
    setDraft({ ...draft, todos: draft.todos.filter((todo) => todo.id !== id) });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <Label htmlFor="card-title">Heading</Label>
        <Input
          id="card-title"
          required
          maxLength={160}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="Card heading"
        />
      </div>

      <div>
        <Label>Color</Label>
        <div className="flex flex-wrap gap-2">
          {colors.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-label={`${color.label} card color`}
              onClick={() => setDraft({ ...draft, color: color.value })}
              className={`grid size-9 place-items-center rounded-lg border ${
                draft.color === color.value ? "border-slate-900" : "border-slate-200"
              }`}
            >
              <span className={`size-5 rounded-full ${color.swatch}`} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Label className="mb-0">To-do list</Label>
          <Button
            type="button"
            variant="secondary"
            className="h-9 px-3"
            onClick={() => setDraft({ ...draft, todos: [...draft.todos, createTodo()] })}
          >
            <Plus size={16} /> Add item
          </Button>
        </div>
        <div className="space-y-2">
          {draft.todos.length ? (
            draft.todos.map((todo) => (
              <div key={todo.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={(event) => updateTodo(todo.id, { done: event.target.checked })}
                  className="size-4 rounded border-slate-300"
                  aria-label="Mark item complete"
                />
                <Input
                  value={todo.text}
                  maxLength={240}
                  onChange={(event) => updateTodo(todo.id, { text: event.target.value })}
                  placeholder="To-do item"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="size-10 px-0 text-red-600"
                  aria-label="Remove item"
                  onClick={() => removeTodo(todo.id)}
                >
                  <X size={16} />
                </Button>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-slate-500">
              Add the first item for this card.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button disabled={saving}>{saving ? "Saving..." : "Save card"}</Button>
      </div>
    </form>
  );
}

export function CardManager() {
  const [cards, setCards] = useState<WorkCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkCard | null>(null);
  const [deleting, setDeleting] = useState<WorkCard | null>(null);
  const [draft, setDraft] = useState<CardDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sortedCards = useMemo(
    () => [...cards].sort((a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt)),
    [cards],
  );

  const load = useCallback(async () => {
    try {
      setError("");
      setCards(await apiFetch<WorkCard[]>("/api/cards"));
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
    setDraft({ ...emptyDraft, todos: [createTodo()] });
    setModalOpen(true);
  }

  function openEdit(card: WorkCard) {
    setEditing(card);
    setDraft({
      title: card.title,
      todos: card.todos.length ? card.todos : [createTodo()],
      color: card.color,
    });
    setModalOpen(true);
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<WorkCard>(
        editing ? `/api/cards/${editing.id}` : "/api/cards",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(
            sanitizeDraft(draft, editing?.order ?? (sortedCards.at(-1)?.order ?? -1) + 1),
          ),
        },
      );
      setCards((current) =>
        editing
          ? current.map((card) => (card.id === saved.id ? saved : card))
          : [...current, saved],
      );
      setModalOpen(false);
      toast.success(editing ? "Card updated" : "Card created");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save card");
    } finally {
      setSaving(false);
    }
  }

  async function removeCard() {
    if (!deleting) return;
    try {
      await apiFetch<{ ok: boolean }>(`/api/cards/${deleting.id}`, { method: "DELETE" });
      setCards((current) => current.filter((card) => card.id !== deleting.id));
      toast.success("Card deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete card");
    } finally {
      setDeleting(null);
    }
  }

  async function persistOrder(nextCards: WorkCard[]) {
    try {
      await Promise.all(
        nextCards.map((card, index) =>
          apiFetch<WorkCard>(`/api/cards/${card.id}`, {
            method: "PATCH",
            body: JSON.stringify({ order: index }),
          }),
        ),
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save card order");
      void load();
    }
  }

  function dropCard(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    const dragged = sortedCards.find((card) => card.id === draggingId);
    if (!dragged) return;
    const withoutDragged = sortedCards.filter((card) => card.id !== draggingId);
    const targetIndex = withoutDragged.findIndex((card) => card.id === targetId);
    const nextCards = [
      ...withoutDragged.slice(0, targetIndex),
      dragged,
      ...withoutDragged.slice(targetIndex),
    ].map((card, index) => ({ ...card, order: index }));
    setCards(nextCards);
    setDraggingId(null);
    void persistOrder(nextCards);
  }

  if (loading) return <LoadingState label="Loading cards" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <>
      <PageHeader
        title="Cards"
        description="Open cards for headings, checklists, colors, and priority moves."
        actions={
          <Button onClick={openCreate}>
            <Plus size={17} /> Create card
          </Button>
        }
      />

      {!sortedCards.length ? (
        <EmptyState
          title="No cards yet"
          description="Create a card, add its to-do list, then drag it into place."
          action={<Button onClick={openCreate}>Create card</Button>}
        />
      ) : (
        <div className="grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedCards.map((card) => {
            const completeCount = card.todos.filter((todo) => todo.done).length;
            const color = colors.find((item) => item.value === card.color) ?? colors[0];
            return (
              <Card
                key={card.id}
                draggable
                onDragStart={() => setDraggingId(card.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropCard(card.id)}
                onDragEnd={() => setDraggingId(null)}
                className={`flex min-h-64 flex-col overflow-hidden p-0 transition ${color.card} ${
                  draggingId === card.id ? "opacity-60" : ""
                }`}
              >
                <div className={`h-2 ${color.bar}`} />
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-4 flex items-start gap-3">
                    <button
                      type="button"
                      className="mt-0.5 cursor-grab rounded p-1 text-slate-400 active:cursor-grabbing"
                      aria-label={`Drag ${card.title}`}
                    >
                      <GripVertical size={18} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words text-base font-semibold text-slate-950">
                        {card.title}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {completeCount}/{card.todos.length} complete
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="size-10 px-0"
                      aria-label={`Open ${card.title}`}
                      onClick={() => openEdit(card)}
                    >
                      <Pencil size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      className="size-10 px-0 text-red-600"
                      aria-label={`Delete ${card.title}`}
                      onClick={() => setDeleting(card)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>

                  {card.todos.length ? (
                    <ul className="space-y-2">
                      {card.todos.slice(0, 6).map((todo) => (
                        <li key={todo.id} className="flex items-start gap-2 text-sm text-slate-700">
                          <span
                            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded border ${
                              todo.done
                                ? "border-emerald-500 bg-emerald-500 text-white"
                                : "border-slate-300 bg-white"
                            }`}
                          >
                            {todo.done ? <Check size={13} /> : null}
                          </span>
                          <span className={`break-words ${todo.done ? "text-slate-500 line-through" : ""}`}>
                            {todo.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">No to-do items yet.</p>
                  )}
                  {card.todos.length > 6 ? (
                    <p className="mt-3 text-xs font-medium text-slate-500">
                      +{card.todos.length - 6} more
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? "Open card" : "Create card"}
        description="Cards save their heading, color, and to-do list."
      >
        <CardForm draft={draft} setDraft={setDraft} saving={saving} onSubmit={saveCard} />
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete card?"
        description={`This will permanently delete "${deleting?.title ?? ""}".`}
        onConfirm={() => void removeCard()}
      />
    </>
  );
}
