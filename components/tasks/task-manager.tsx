"use client";

import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { Client, Task, TaskPriority, TaskStatus, TeamMember } from "@/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  Select,
  Textarea,
} from "@/components/ui/core";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";

type TaskDraft = {
  title: string;
  description: string;
  assignedToId: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  clientId: string;
};

const emptyDraft: TaskDraft = {
  title: "",
  description: "",
  assignedToId: "",
  status: "todo",
  priority: "medium",
  dueDate: "",
  clientId: "",
};

const statusLabels: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
};

function TaskForm({
  draft,
  setDraft,
  members,
  clients,
  saving,
  onSubmit,
}: {
  draft: TaskDraft;
  setDraft: (draft: TaskDraft) => void;
  members: TeamMember[];
  clients: Client[];
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  const field = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          required
          maxLength={200}
          value={draft.title}
          onChange={(event) => field("title", event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="task-description">Description</Label>
        <Textarea
          id="task-description"
          value={draft.description}
          onChange={(event) => field("description", event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="task-assignee">Assign to</Label>
          <Select
            id="task-assignee"
            value={draft.assignedToId}
            onChange={(event) => field("assignedToId", event.target.value)}
          >
            <option value="">Unassigned</option>
            {members
              .filter((member) => member.active || member.id === draft.assignedToId)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}{member.active ? "" : " (archived)"}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="task-status">Status</Label>
          <Select
            id="task-status"
            value={draft.status}
            onChange={(event) => field("status", event.target.value as TaskStatus)}
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="task-priority">Priority</Label>
          <Select
            id="task-priority"
            value={draft.priority}
            onChange={(event) => field("priority", event.target.value as TaskPriority)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="task-due">Due date</Label>
          <Input
            id="task-due"
            type="date"
            value={draft.dueDate}
            onChange={(event) => field("dueDate", event.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="task-client">Client</Label>
        <Select
          id="task-client"
          value={draft.clientId}
          onChange={(event) => field("clientId", event.target.value)}
        >
          <option value="">No client</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}{client.status === "closed" ? " (closed)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex justify-end">
        <Button disabled={saving}>{saving ? "Saving…" : "Save task"}</Button>
      </div>
    </form>
  );
}

export function TaskManager() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [myMemberId, setMyMemberId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("all");
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [client, setClient] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const [taskData, memberData, clientData, dashboard] = await Promise.all([
        apiFetch<Task[]>("/api/tasks"),
        apiFetch<TeamMember[]>("/api/team"),
        apiFetch<Client[]>("/api/clients"),
        apiFetch<{ matchingMember: TeamMember | null }>("/api/dashboard"),
      ]);
      setTasks(taskData);
      setMembers(memberData);
      setClients(clientData);
      setMyMemberId(dashboard.matchingMember?.id ?? "");
      const query = new URLSearchParams(window.location.search);
      if (query.get("new") === "1") setModalOpen(true);
      if (query.get("view") === "my") setTab("my");
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

  const filteredTasks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const tabMember = members.find((member) => member.name.toLowerCase() === tab.toLowerCase());
    return tasks.filter((task) => {
      if (tab === "my" && (!myMemberId || task.assignedToId !== myMemberId)) return false;
      if (tab === "completed" && task.status !== "completed") return false;
      if (tabMember && task.assignedToId !== tabMember.id) return false;
      if (assignee && task.assignedToId !== assignee) return false;
      if (status && task.status !== status) return false;
      if (priority && task.priority !== priority) return false;
      if (client && task.clientId !== client) return false;
      if (due === "today" && task.dueDate !== today) return false;
      if (due === "overdue" && (!task.dueDate || task.dueDate >= today || task.status === "completed")) return false;
      if (due === "upcoming" && (!task.dueDate || task.dueDate <= today)) return false;
      if (due === "none" && task.dueDate) return false;
      return true;
    });
  }, [assignee, client, due, members, myMemberId, priority, status, tab, tasks]);

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setModalOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setDraft({
      title: task.title,
      description: task.description ?? "",
      assignedToId: task.assignedToId ?? "",
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? "",
      clientId: task.clientId ?? "",
    });
    setModalOpen(true);
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<Task>(
        editing ? `/api/tasks/${editing.id}` : "/api/tasks",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setTasks((current) =>
        editing
          ? current.map((task) => (task.id === saved.id ? saved : task))
          : [saved, ...current],
      );
      setModalOpen(false);
      toast.success(editing ? "Task updated" : "Task created");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save task");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(task: Task) {
    const action = task.status === "completed" ? "reopen" : "complete";
    try {
      const saved = await apiFetch<Task>(`/api/tasks/${task.id}/status`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setTasks((current) => current.map((item) => (item.id === task.id ? saved : item)));
      toast.success(action === "complete" ? "Task completed" : "Task reopened");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update task");
    }
  }

  async function removeTask() {
    if (!deleting) return;
    try {
      await apiFetch<{ ok: boolean }>(`/api/tasks/${deleting.id}`, { method: "DELETE" });
      setTasks((current) => current.filter((task) => task.id !== deleting.id));
      toast.success("Task deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete task");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <LoadingState label="Loading tasks" />;
  if (error) return <ErrorState message={error} retry={load} />;

  const tabs = ["my", "all", "amol", "ezaz", "completed"];

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Plan, assign, and track work across your team."
        actions={<Button onClick={openCreate}><Plus size={17} /> Add task</Button>}
      />

      <div className="mb-4 overflow-x-auto">
        <div className="flex min-w-max gap-1 rounded-lg border bg-white p-1">
          {tabs.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`rounded-md px-4 py-2 text-sm font-medium capitalize ${tab === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
            >
              {item === "my" ? "My Tasks" : item === "all" ? "All Tasks" : item}
            </button>
          ))}
        </div>
      </div>

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select aria-label="Filter by assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">All assignees</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </Select>
          <Select aria-label="Filter by priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">All priorities</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
          <Select aria-label="Filter by due date" value={due} onChange={(event) => setDue(event.target.value)}>
            <option value="">Any due date</option>
            <option value="today">Due today</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
            <option value="none">No due date</option>
          </Select>
          <Select aria-label="Filter by client" value={client} onChange={(event) => setClient(event.target.value)}>
            <option value="">All clients</option>
            {clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </div>
      </Card>

      {!filteredTasks.length ? (
        <EmptyState title="No tasks found" description="Adjust the filters or create a new task." action={<Button onClick={openCreate}>Add task</Button>} />
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task) => {
            const clientName = clients.find((item) => item.id === task.clientId)?.name;
            return (
              <Card key={task.id} className="p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className={`font-semibold ${task.status === "completed" ? "text-slate-500 line-through" : ""}`}>{task.title}</h2>
                      <Badge tone={task.status === "completed" ? "green" : "blue"}>{statusLabels[task.status]}</Badge>
                      <Badge tone={task.priority === "high" ? "red" : task.priority === "medium" ? "amber" : "slate"}>{task.priority}</Badge>
                    </div>
                    {task.description ? <p className="mt-2 line-clamp-2 text-sm text-slate-600">{task.description}</p> : null}
                    <p className="mt-2 text-xs text-slate-500">
                      {task.assignedToName || "Unassigned"} 뿯½ {task.dueDate ? `Due ${task.dueDate}` : "No due date"}{clientName ? ` 뿯½ ${clientName}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" className="px-3" onClick={() => void changeStatus(task)}>
                      {task.status === "completed" ? <RotateCcw size={16} /> : <Check size={16} />}
                      {task.status === "completed" ? "Reopen" : "Complete"}
                    </Button>
                    <Button aria-label={`Edit ${task.title}`} variant="ghost" className="px-3" onClick={() => openEdit(task)}><Pencil size={16} /></Button>
                    <Button aria-label={`Delete ${task.title}`} variant="ghost" className="px-3 text-red-600" onClick={() => setDeleting(task)}><Trash2 size={16} /></Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? "Edit task" : "Create task"} description="Changes are saved to Firestore immediately.">
        <TaskForm draft={draft} setDraft={setDraft} members={members} clients={clients} saving={saving} onSubmit={saveTask} />
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete task?"
        description={`This will permanently delete “${deleting?.title ?? ""}”. This action cannot be undone.`}
        onConfirm={() => void removeTask()}
      />
    </>
  );
}
