"use client";

import { Archive, BriefcaseBusiness, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
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
import { apiFetch } from "@/lib/api";
import type { Client, ClientColor, ClientStatus, Task } from "@/types";

type ClientDraft = {
  name: string;
  contactName: string;
  contactEmail: string;
  status: ClientStatus;
  color: ClientColor;
  notes: string;
};

const emptyDraft: ClientDraft = {
  name: "",
  contactName: "",
  contactEmail: "",
  status: "lead",
  color: "blue",
  notes: "",
};

const clientColors: Array<{
  value: ClientColor;
  label: string;
  dot: string;
  soft: string;
  border: string;
}> = [
  { value: "blue", label: "Blue", dot: "bg-blue-500", soft: "bg-blue-50", border: "border-blue-200" },
  { value: "green", label: "Green", dot: "bg-emerald-500", soft: "bg-emerald-50", border: "border-emerald-200" },
  { value: "amber", label: "Amber", dot: "bg-amber-500", soft: "bg-amber-50", border: "border-amber-200" },
  { value: "rose", label: "Rose", dot: "bg-rose-500", soft: "bg-rose-50", border: "border-rose-200" },
  { value: "violet", label: "Violet", dot: "bg-violet-500", soft: "bg-violet-50", border: "border-violet-200" },
  { value: "slate", label: "Slate", dot: "bg-slate-500", soft: "bg-slate-50", border: "border-slate-200" },
];

const statusLabels: Record<ClientStatus, string> = {
  lead: "Leads",
  active: "Active",
  paused: "Paused",
  closed: "Closed",
};

const statusTone: Record<ClientStatus, "slate" | "blue" | "green"> = {
  lead: "blue",
  active: "green",
  paused: "slate",
  closed: "slate",
};

function getClientColor(color: ClientColor) {
  return clientColors.find((item) => item.value === color) ?? clientColors[0];
}

export function ClientManager() {
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [confirming, setConfirming] = useState<{ client: Client; action: "archive" | "delete" } | null>(null);
  const [draft, setDraft] = useState<ClientDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const [clientData, taskData] = await Promise.all([
        apiFetch<Client[]>("/api/clients"),
        apiFetch<Task[]>("/api/tasks"),
      ]);
      setClients(clientData);
      setTasks(taskData);
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

  const crmStats = useMemo(() => {
    const openTasks = tasks.filter((task) => task.status !== "completed");
    return {
      totalClients: clients.length,
      totalTasks: tasks.length,
      openTasks: openTasks.length,
      byStatus: {
        lead: clients.filter((client) => client.status === "lead").length,
        active: clients.filter((client) => client.status === "active").length,
        paused: clients.filter((client) => client.status === "paused").length,
        closed: clients.filter((client) => client.status === "closed").length,
      },
    };
  }, [clients, tasks]);

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setModalOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setDraft({
      name: client.name,
      contactName: client.contactName ?? "",
      contactEmail: client.contactEmail ?? "",
      status: client.status,
      color: client.color ?? "blue",
      notes: client.notes ?? "",
    });
    setModalOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<Client>(
        editing ? `/api/clients/${editing.id}` : "/api/clients",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setClients((current) =>
        editing
          ? current.map((client) => (client.id === saved.id ? saved : client))
          : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setModalOpen(false);
      toast.success(editing ? "Client updated" : "Client added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save client");
    } finally {
      setSaving(false);
    }
  }

  async function confirmAction() {
    if (!confirming) return;
    try {
      if (confirming.action === "archive") {
        const saved = await apiFetch<Client>(`/api/clients/${confirming.client.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "closed" }),
        });
        setClients((current) =>
          current.map((client) => (client.id === saved.id ? saved : client)),
        );
        toast.success("Client archived");
      } else {
        await apiFetch<{ ok: boolean }>(`/api/clients/${confirming.client.id}`, {
          method: "DELETE",
        });
        setClients((current) =>
          current.filter((client) => client.id !== confirming.client.id),
        );
        toast.success("Client deleted");
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update client");
    } finally {
      setConfirming(null);
    }
  }

  if (loading) return <LoadingState label="Loading CRM" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <>
      <PageHeader
        title="CRM"
        description="Track clients, pipeline status, ownership context, and related work."
        actions={
          <Button onClick={openCreate}>
            <Plus size={17} /> Add client
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total clients</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{crmStats.totalClients}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active clients</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{crmStats.byStatus.active}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Related tasks</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{crmStats.totalTasks}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open work</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{crmStats.openTasks}</p>
        </Card>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(statusLabels) as ClientStatus[]).map((status) => (
          <div key={status} className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <BriefcaseBusiness size={17} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{statusLabels[status]}</span>
            </div>
            <span className="text-sm font-semibold text-slate-950">{crmStats.byStatus[status]}</span>
          </div>
        ))}
      </div>

      {!clients.length ? (
        <EmptyState
          title="No clients yet"
          description="Add a client to start building your CRM pipeline."
          action={<Button onClick={openCreate}>Add client</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {clients.map((client) => {
            const related = tasks.filter((task) => task.clientId === client.id);
            const openRelated = related.filter((task) => task.status !== "completed");
            const color = getClientColor(client.color ?? "blue");
            return (
              <Card key={client.id} className={`p-0 ${color.border}`}>
                <div className="flex items-start justify-between gap-3 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words font-semibold text-slate-950">{client.name}</h2>
                      <Badge tone={statusTone[client.status]}>{client.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {client.contactName || "No contact"}
                      {client.contactEmail ? ` | ${client.contactEmail}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">
                      {related.length} tasks
                    </span>
                    <span
                      aria-label={`${color.label} client color`}
                      className={`size-4 rounded-full border border-white shadow-sm ring-2 ring-slate-200 ${color.dot}`}
                    />
                  </div>
                </div>

                <div className={`border-y px-5 py-3 ${color.soft}`}>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span><strong>{openRelated.length}</strong> open tasks</span>
                    <span><strong>{related.length - openRelated.length}</strong> completed</span>
                    <span><strong>{client.status}</strong> stage</span>
                  </div>
                </div>

                <div className="p-5">
                  {client.notes ? <p className="mb-4 text-sm text-slate-600">{client.notes}</p> : null}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Related tasks</p>
                    {related.length ? (
                      <div className="space-y-2">
                        {related.slice(0, 4).map((task) => (
                          <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                            <span className="min-w-0 truncate">{task.title}</span>
                            <Badge tone={task.status === "completed" ? "green" : "blue"}>{task.status.replace("_", " ")}</Badge>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No related tasks.</p>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => openEdit(client)}>
                      <Pencil size={15} /> Edit
                    </Button>
                    {client.status !== "closed" ? (
                      <Button variant="ghost" onClick={() => setConfirming({ client, action: "archive" })}>
                        <Archive size={15} /> Archive
                      </Button>
                    ) : null}
                    <Button variant="ghost" className="text-red-600" onClick={() => setConfirming({ client, action: "delete" })}>
                      <Trash2 size={15} /> Delete
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? "Edit client" : "Add client"}>
        <form onSubmit={save} className="space-y-4">
          <div>
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-name">Contact name</Label>
              <Input id="contact-name" value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} />
            </div>
            <div>
              <Label htmlFor="contact-email">Contact email</Label>
              <Input id="contact-email" type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="client-status">Status</Label>
              <Select id="client-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ClientStatus })}>
                <option value="lead">Lead</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="closed">Closed</option>
              </Select>
            </div>
            <div>
              <Label>Client color</Label>
              <div className="flex flex-wrap gap-2">
                {clientColors.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={`${color.label} client color`}
                    onClick={() => setDraft({ ...draft, color: color.value })}
                    className={`grid size-10 place-items-center rounded-lg border ${
                      draft.color === color.value ? "border-slate-900" : "border-slate-200"
                    }`}
                  >
                    <span className={`size-5 rounded-full ${color.dot}`} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="client-notes">Notes</Label>
            <Textarea id="client-notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </div>
          <div className="flex justify-end">
            <Button disabled={saving}>{saving ? "Saving..." : "Save client"}</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.action === "delete" ? "Delete client?" : "Archive client?"}
        description={confirming?.action === "delete"
          ? `"${confirming.client.name}" can only be deleted if it has no related tasks.`
          : `"${confirming?.client.name ?? ""}" will be marked closed but its tasks will be preserved.`}
        confirmLabel={confirming?.action === "delete" ? "Delete" : "Archive"}
        onConfirm={() => void confirmAction()}
      />
    </>
  );
}
