"use client";

import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { Client, ClientStatus, Task } from "@/types";
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

type ClientDraft = {
  name: string;
  contactName: string;
  contactEmail: string;
  status: ClientStatus;
  notes: string;
};

const emptyDraft: ClientDraft = {
  name: "",
  contactName: "",
  contactEmail: "",
  status: "lead",
  notes: "",
};

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

  if (loading) return <LoadingState label="Loading clients" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <>
      <PageHeader
        title="Clients"
        description="Keep lightweight client context alongside related work."
        actions={<Button onClick={openCreate}><Plus size={17} /> Add client</Button>}
      />
      {!clients.length ? (
        <EmptyState title="No clients yet" description="Add a client to associate it with tasks." action={<Button onClick={openCreate}>Add client</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {clients.map((client) => {
            const related = tasks.filter((task) => task.clientId === client.id);
            return (
              <Card key={client.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{client.name}</h2>
                      <Badge tone={client.status === "active" ? "green" : client.status === "lead" ? "blue" : "slate"}>{client.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {client.contactName || "No contact"}{client.contactEmail ? ` 뿯½ ${client.contactEmail}` : ""}
                    </p>
                  </div>
                  <span className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">{related.length} tasks</span>
                </div>
                {client.notes ? <p className="mt-4 text-sm text-slate-600">{client.notes}</p> : null}
                <div className="mt-4 border-t pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Related tasks</p>
                  {related.length ? (
                    <div className="space-y-2">
                      {related.slice(0, 4).map((task) => (
                        <div key={task.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="truncate">{task.title}</span>
                          <Badge tone={task.status === "completed" ? "green" : "blue"}>{task.status.replace("_", " ")}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-slate-500">No related tasks.</p>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => openEdit(client)}><Pencil size={15} /> Edit</Button>
                  {client.status !== "closed" ? (
                    <Button variant="ghost" onClick={() => setConfirming({ client, action: "archive" })}><Archive size={15} /> Archive</Button>
                  ) : null}
                  <Button variant="ghost" className="text-red-600" onClick={() => setConfirming({ client, action: "delete" })}><Trash2 size={15} /> Delete</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? "Edit client" : "Add client"}>
        <form onSubmit={save} className="space-y-4">
          <div><Label htmlFor="client-name">Name</Label><Input id="client-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="contact-name">Contact name</Label><Input id="contact-name" value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} /></div>
            <div><Label htmlFor="contact-email">Contact email</Label><Input id="contact-email" type="email" value={draft.contactEmail} onChange={(event) => setDraft({ ...draft, contactEmail: event.target.value })} /></div>
          </div>
          <div><Label htmlFor="client-status">Status</Label><Select id="client-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ClientStatus })}><option value="lead">Lead</option><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option></Select></div>
          <div><Label htmlFor="client-notes">Notes</Label><Textarea id="client-notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></div>
          <div className="flex justify-end"><Button disabled={saving}>{saving ? "Saving…" : "Save client"}</Button></div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.action === "delete" ? "Delete client?" : "Archive client?"}
        description={confirming?.action === "delete"
          ? `“${confirming.client.name}” can only be deleted if it has no related tasks.`
          : `“${confirming?.client.name ?? ""}” will be marked closed but its tasks will be preserved.`}
        confirmLabel={confirming?.action === "delete" ? "Delete" : "Archive"}
        onConfirm={() => void confirmAction()}
      />
    </>
  );
}
