"use client";

import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { Task, TeamMember } from "@/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
  Modal,
} from "@/components/ui/core";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import { initials } from "@/lib/utils";

type MemberDraft = {
  name: string;
  email: string;
  role: string;
  active: boolean;
};

const emptyDraft: MemberDraft = { name: "", email: "", role: "", active: true };

export function TeamManager() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [archiving, setArchiving] = useState<TeamMember | null>(null);
  const [draft, setDraft] = useState<MemberDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const [memberData, taskData] = await Promise.all([
        apiFetch<TeamMember[]>("/api/team"),
        apiFetch<Task[]>("/api/tasks"),
      ]);
      setMembers(memberData);
      setTasks(taskData);
      if (new URLSearchParams(window.location.search).get("new") === "1") {
        setModalOpen(true);
      }
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

  function openEdit(member: TeamMember) {
    setEditing(member);
    setDraft({
      name: member.name,
      email: member.email ?? "",
      role: member.role ?? "",
      active: member.active,
    });
    setModalOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<TeamMember>(
        editing ? `/api/team/${editing.id}` : "/api/team",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(draft),
        },
      );
      setMembers((current) =>
        editing
          ? current.map((member) => (member.id === saved.id ? saved : member))
          : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setModalOpen(false);
      toast.success(editing ? "Team member updated" : "Team member added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save team member");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!archiving) return;
    try {
      const saved = await apiFetch<TeamMember>(`/api/team/${archiving.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "deactivate" }),
      });
      setMembers((current) =>
        current.map((member) => (member.id === saved.id ? saved : member)),
      );
      toast.success("Team member archived");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not archive team member");
    } finally {
      setArchiving(null);
    }
  }

  async function reactivate(member: TeamMember) {
    try {
      const saved = await apiFetch<TeamMember>(`/api/team/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: true }),
      });
      setMembers((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      toast.success("Team member reactivated");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not reactivate member");
    }
  }

  if (loading) return <LoadingState label="Loading team" />;
  if (error) return <ErrorState message={error} retry={load} />;

  return (
    <>
      <PageHeader
        title="Team"
        description="Manage assignable people without changing application access."
        actions={<Button onClick={openCreate}><Plus size={17} /> Add team member</Button>}
      />
      {!members.length ? (
        <EmptyState title="No team members" description="Add your first person to start assigning tasks." action={<Button onClick={openCreate}>Add member</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {members.map((member) => {
            const assigned = tasks.filter((task) => task.assignedToId === member.id);
            const open = assigned.filter((task) => task.status !== "completed").length;
            const completed = assigned.filter((task) => task.status === "completed").length;
            return (
              <Card key={member.id}>
                <div className="flex items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                    {initials(member.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{member.name}</h2>
                      <Badge tone={member.active ? "green" : "slate"}>{member.active ? "Active" : "Archived"}</Badge>
                    </div>
                    <p className="text-sm text-slate-500">{member.role || "Team member"}</p>
                    {member.email ? <p className="mt-1 truncate text-xs text-slate-500">{member.email}</p> : null}
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xl font-semibold">{open}</p><p className="text-xs text-slate-500">Open tasks</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xl font-semibold">{completed}</p><p className="text-xs text-slate-500">Completed</p></div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => openEdit(member)}><Pencil size={15} /> Edit</Button>
                  {member.active ? (
                    <Button variant="ghost" className="text-slate-600" onClick={() => setArchiving(member)}><Archive size={15} /> Archive</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => void reactivate(member)}><RotateCcw size={15} /> Reactivate</Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title={editing ? "Edit team member" : "Add team member"} description="Adding a person makes them assignable; it does not grant app access.">
        <form onSubmit={save} className="space-y-4">
          <div><Label htmlFor="member-name">Name</Label><Input id="member-name" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div><Label htmlFor="member-email">Email</Label><Input id="member-email" type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></div>
          <div><Label htmlFor="member-role">Role</Label><Input id="member-role" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
            Active and available for assignment
          </label>
          <div className="flex justify-end"><Button disabled={saving}>{saving ? "Saving…" : "Save member"}</Button></div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => !open && setArchiving(null)}
        title="Archive team member?"
        description={`${archiving?.name ?? "This person"} will no longer appear in assignment dropdowns. Historical tasks will remain unchanged.`}
        confirmLabel="Archive"
        onConfirm={() => void archive()}
      />
    </>
  );
}
