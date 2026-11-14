"use client";

import {
  Archive,
  BriefcaseBusiness,
  Check,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
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
import {
  DEFAULT_CRM_ID,
  type Client,
  type ClientColor,
  type ClientStatus,
  type Crm,
  type Task,
} from "@/types";

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

/** Field names as they appear on a review entry, in the words the team uses. */
const reviewFieldLabels: Record<string, string> = {
  name: "Shop name",
  contactName: "Contact name",
  contactEmail: "Contact email",
  phone: "Phone",
  zip: "ZIP",
  bays: "Bays",
  consentAt: "Consent timestamp",
};

function reviewCount(client: Client) {
  return Object.keys(client.pendingReview ?? {}).length;
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
  /*
    Multiple pipelines, one page. "Clients" (the fixed default, fed by the
    waitlist) is always first; the rest are whatever the team created —
    Investors, Partners. One pipeline shows at a time.
  */
  const [crms, setCrms] = useState<Crm[]>([]);
  const [activeCrmId, setActiveCrmId] = useState<string>(DEFAULT_CRM_ID);
  const [crmModalOpen, setCrmModalOpen] = useState(false);
  const [newCrmName, setNewCrmName] = useState("");
  const [creatingCrm, setCreatingCrm] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const [clientData, taskData, crmData] = await Promise.all([
        apiFetch<Client[]>("/api/clients"),
        apiFetch<Task[]>("/api/tasks"),
        apiFetch<Crm[]>("/api/crms"),
      ]);
      setClients(clientData);
      setTasks(taskData);
      setCrms(crmData);
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

  /** The active pipeline's records. Everything below renders from this. */
  const pipelineClients = useMemo(
    () => clients.filter((client) => (client.crmId ?? DEFAULT_CRM_ID) === activeCrmId),
    [clients, activeCrmId],
  );

  const crmStats = useMemo(() => {
    const ids = new Set(pipelineClients.map((client) => client.id));
    const related = tasks.filter((task) => task.clientId && ids.has(task.clientId));
    const openTasks = related.filter((task) => task.status !== "completed");
    return {
      totalClients: pipelineClients.length,
      totalTasks: related.length,
      openTasks: openTasks.length,
      byStatus: {
        lead: pipelineClients.filter((client) => client.status === "lead").length,
        active: pipelineClients.filter((client) => client.status === "active").length,
        paused: pipelineClients.filter((client) => client.status === "paused").length,
        closed: pipelineClients.filter((client) => client.status === "closed").length,
      },
    };
  }, [pipelineClients, tasks]);

  /*
    Every record where an inbound event disagreed with something stored.

    Waitlist leads land in the table directly — there is no unreviewed filter.
    The banner is scoped to the active pipeline, which in practice means the
    default one: ingest only ever writes there.
  */
  const needsReview = useMemo(
    () => pipelineClients.filter((client) => reviewCount(client) > 0),
    [pipelineClients],
  );

  async function createCrmPipeline(event: FormEvent) {
    event.preventDefault();
    setCreatingCrm(true);
    try {
      const created = await apiFetch<Crm>("/api/crms", {
        method: "POST",
        body: JSON.stringify({ name: newCrmName }),
      });
      setCrms((current) => [...current, created]);
      setActiveCrmId(created.id);
      setCrmModalOpen(false);
      setNewCrmName("");
      toast.success(`${created.name} pipeline created`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not create pipeline");
    } finally {
      setCreatingCrm(false);
    }
  }

  async function resolve(
    client: Client,
    field: string,
    action: "accept" | "dismiss",
  ) {
    try {
      const saved = await apiFetch<Client>(
        `/api/clients/${client.id}/pending-review`,
        { method: "POST", body: JSON.stringify({ field, action }) },
      );
      setClients((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      toast.success(action === "accept" ? "Value updated" : "Kept what was there");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not resolve");
    }
  }

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
          // New records join the pipeline being looked at; edits never move one.
          body: JSON.stringify(editing ? draft : { ...draft, crmId: activeCrmId }),
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
            <Plus size={17} /> Add record
          </Button>
        }
      />

      {/*
        The pipelines. "Clients" is fed by the tryzol.com waitlist; the rest
        hold whatever the team tracks the same way — investors, partners.
      */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {crms.map((crm) => (
          <button
            key={crm.id}
            type="button"
            onClick={() => setActiveCrmId(crm.id)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              activeCrmId === crm.id
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {crm.name}
          </button>
        ))}
        <Button variant="ghost" onClick={() => setCrmModalOpen(true)}>
          <Plus size={15} /> New CRM
        </Button>
      </div>

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

      {needsReview.length ? (
        <Card className="mb-6 border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2">
            <TriangleAlert size={17} className="text-amber-600" />
            <h2 className="text-sm font-semibold text-slate-950">
              {needsReview.length === 1
                ? "One record needs a decision"
                : `${needsReview.length} records need a decision`}
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            A waitlist submission disagreed with what is stored. Nothing was
            overwritten — pick which value is right.
          </p>
          <div className="mt-4 space-y-3">
            {needsReview.map((client) =>
              Object.entries(client.pendingReview ?? {}).map(([field, entry]) => {
                const label = reviewFieldLabels[field] ?? field;
                const stored = (client as unknown as Record<string, unknown>)[field];
                /*
                  Both reasons use the same two buttons, because the mechanics
                  are the same: accept takes the value that is waiting, dismiss
                  keeps the one on the record. Only the sentence differs — for a
                  phone correction the new number is already in place and the
                  waiting value is the one it replaced.
                */
                const replaced = entry.reason === "replaced";
                return (
                  <div
                    key={`${client.id}:${field}`}
                    className="rounded-lg border border-amber-200 bg-white px-4 py-3"
                  >
                    <div className="text-sm font-semibold text-slate-950">
                      {client.name}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">
                      {replaced ? (
                        <>
                          {label} was corrected to{" "}
                          <span className="font-medium">{String(stored ?? "—")}</span>,
                          replacing{" "}
                          <span className="font-medium">{entry.incoming}</span>.
                        </>
                      ) : (
                        <>
                          The form said {label.toLowerCase()} is{" "}
                          <span className="font-medium">{entry.incoming}</span>, you
                          have <span className="font-medium">{String(stored ?? "—")}</span>.
                        </>
                      )}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => void resolve(client, field, "accept")}
                      >
                        <Check size={15} />
                        {replaced ? `Put ${entry.incoming} back` : "Use the form's value"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void resolve(client, field, "dismiss")}
                      >
                        <X size={15} /> Keep what is there
                      </Button>
                    </div>
                  </div>
                );
              }),
            )}
          </div>
        </Card>
      ) : null}

      {!pipelineClients.length ? (
        <EmptyState
          title="Nothing here yet"
          description={
            activeCrmId === DEFAULT_CRM_ID
              ? "Add a record, or wait — tryzol.com waitlist submissions land here on their own within five minutes."
              : "Add the first record to this pipeline."
          }
          action={<Button onClick={openCreate}>Add record</Button>}
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Tasks</th>
                  <th className="px-4 py-3">Related work</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Actions</th>
                  <th className="px-5 py-3 text-right">Color</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pipelineClients.map((client) => {
                  const related = tasks.filter((task) => task.clientId === client.id);
                  const openRelated = related.filter((task) => task.status !== "completed");
                  const color = getClientColor(client.color ?? "blue");
                  return (
                    <tr key={client.id} className="bg-white align-top hover:bg-slate-50">
                      <td className="max-w-[220px] px-5 py-4">
                        <div className="font-semibold text-slate-950">{client.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{related.length} total tasks</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={statusTone[client.status]}>{client.status}</Badge>
                          {/*
                            Where the record came from, shown because it changes
                            how much the values can be trusted — a waitlist row
                            is what somebody typed into a form, not what the
                            team confirmed.
                          */}
                          {client.source === "waitlist" ? (
                            <Badge tone="slate">waitlist</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[220px] px-4 py-4 text-slate-600">
                        <div>{client.contactName || "No contact"}</div>
                        {client.contactEmail ? (
                          <div className="mt-1 truncate text-xs text-slate-500">{client.contactEmail}</div>
                        ) : null}
                        {client.phone ? (
                          <div className="mt-1 text-xs text-slate-500">{client.phone}</div>
                        ) : null}
                        {(client.contacts?.length ?? 0) > 1 ? (
                          <div className="mt-1 text-xs text-slate-500">
                            +{(client.contacts?.length ?? 1) - 1} more at this shop
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">{openRelated.length} open</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {related.length - openRelated.length} completed
                        </div>
                      </td>
                      <td className="max-w-[260px] px-4 py-4">
                        {related.length ? (
                          <div className="space-y-1">
                            {related.slice(0, 3).map((task) => (
                              <div key={task.id} className="flex items-center gap-2">
                                <span className="min-w-0 truncate text-slate-700">{task.title}</span>
                                <Badge tone={task.status === "completed" ? "green" : "blue"}>
                                  {task.status.replace("_", " ")}
                                </Badge>
                              </div>
                            ))}
                            {related.length > 3 ? (
                              <div className="text-xs text-slate-500">+{related.length - 3} more</div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-slate-500">No related tasks</span>
                        )}
                      </td>
                      <td className="max-w-[240px] px-4 py-4 text-slate-600">
                        {client.notes ? <p className="line-clamp-2">{client.notes}</p> : <span className="text-slate-500">No notes</span>}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
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
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end">
                          <span
                            aria-label={`${color.label} client color`}
                            className={`size-4 rounded-full border border-white shadow-sm ring-2 ring-slate-200 ${color.dot}`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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
      <Modal open={crmModalOpen} onOpenChange={setCrmModalOpen} title="New CRM">
        <form onSubmit={createCrmPipeline} className="space-y-4">
          <div>
            <Label htmlFor="crm-name">Name</Label>
            <Input
              id="crm-name"
              required
              placeholder="Investors"
              value={newCrmName}
              onChange={(event) => setNewCrmName(event.target.value)}
            />
            <p className="mt-2 text-xs text-slate-500">
              A separate pipeline with its own records and stages. Waitlist
              submissions always land in Clients.
            </p>
          </div>
          <div className="flex justify-end">
            <Button disabled={creatingCrm}>
              {creatingCrm ? "Creating..." : "Create pipeline"}
            </Button>
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
