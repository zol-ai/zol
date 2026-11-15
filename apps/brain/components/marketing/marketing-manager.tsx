"use client";

import { Plus, Search } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared";
import { Button, Card, ConfirmDialog, Input, Modal, Select } from "@/components/ui/core";
import { apiFetch } from "@/lib/api";
import type { MarketingIdea, TeamMember } from "@/types";
import { channels, contentTypes } from "./config";
import { MarketingIdeaCard } from "./marketing-idea-card";
import {
  emptyMarketingIdeaDraft,
  MarketingIdeaForm,
  type MarketingIdeaDraft,
} from "./marketing-idea-form";

/*
  One list. Ideas used to move through five stage columns; the team decided
  the stages were more ceremony than the work needed, so every idea now sits
  in a single column, newest first. The `status` field is still stored (older
  documents keep whatever stage they had) but nothing in the UI reads it.
*/

function draftFromIdea(idea: MarketingIdea): MarketingIdeaDraft {
  return {
    title: idea.title,
    brief: idea.brief ?? "",
    hook: idea.hook ?? "",
    callToAction: idea.callToAction ?? "",
    contentType: idea.contentType,
    channel: idea.channel ?? "",
    ownerId: idea.ownerId ?? "",
    targetDate: idea.targetDate ?? "",
    links: idea.links,
    status: idea.status,
  };
}

function payloadFromDraft(draft: MarketingIdeaDraft) {
  return {
    ...draft,
    title: draft.title.trim(),
    links: draft.links
      .map((link) => ({ ...link, label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label && link.url),
  };
}

export function MarketingManager() {
  const [ideas, setIdeas] = useState<MarketingIdea[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MarketingIdea | null>(null);
  const [deleting, setDeleting] = useState<MarketingIdea | null>(null);
  const [draft, setDraft] = useState<MarketingIdeaDraft>(emptyMarketingIdeaDraft);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [contentType, setContentType] = useState("");
  const [channel, setChannel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ideaData, teamData] = await Promise.all([
        apiFetch<MarketingIdea[]>("/api/marketing"),
        apiFetch<TeamMember[]>("/api/team"),
      ]);
      setIdeas(ideaData);
      setMembers(teamData.filter((member) => member.active));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load marketing ideas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleIdeas = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ideas
      .filter((idea) => {
        if (owner && idea.ownerId !== owner) return false;
        if (contentType && idea.contentType !== contentType) return false;
        if (channel && idea.channel !== channel) return false;
        if (
          query &&
          ![idea.title, idea.brief, idea.hook, idea.callToAction, idea.ownerName].some(
            (value) => value?.toLocaleLowerCase().includes(query),
          )
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ideas, owner, contentType, channel, search]);

  function openCreate() {
    setEditing(null);
    setDraft(emptyMarketingIdeaDraft);
    setModalOpen(true);
  }

  function openEdit(idea: MarketingIdea) {
    setEditing(idea);
    setDraft(draftFromIdea(idea));
    setModalOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<MarketingIdea>(
        editing ? `/api/marketing/${editing.id}` : "/api/marketing",
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payloadFromDraft(draft)),
        },
      );
      setIdeas((current) =>
        editing
          ? current.map((idea) => (idea.id === saved.id ? saved : idea))
          : [saved, ...current],
      );
      setModalOpen(false);
      toast.success(editing ? "Idea updated" : "Idea added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the idea");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await apiFetch(`/api/marketing/${target.id}`, { method: "DELETE" });
      setIdeas((current) => current.filter((idea) => idea.id !== target.id));
      toast.success("Idea deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete the idea");
    }
  }

  if (loading) return <LoadingState label="Loading marketing ideas" />;
  if (error) return <ErrorState message={error} retry={load} />;

  const filtering = Boolean(search.trim() || owner || contentType || channel);

  return (
    <>
      <PageHeader
        title="Marketing"
        description="Every idea for getting the word out, in one list. Add one, explain it, and keep its links together."
        actions={
          <Button onClick={openCreate}>
            <Plus size={17} /> Add idea
          </Button>
        }
      />

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search
              aria-hidden="true"
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              aria-label="Search marketing ideas"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ideas…"
            />
          </div>
          <Select
            aria-label="Filter by owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="">All owners</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by content type"
            value={contentType}
            onChange={(event) => setContentType(event.target.value)}
          >
            <option value="">All content types</option>
            {contentTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
          >
            <option value="">All channels</option>
            {channels.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <section className="mt-5 rounded-xl border bg-slate-50/80 p-3 sm:p-4">
        <div className="mb-3 flex items-start justify-between gap-3 px-1">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden="true" className="size-2 rounded-full bg-violet-500" />
              Ideas
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">Everything the team wants to try</p>
          </div>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow-sm">
            {visibleIdeas.length}
          </span>
        </div>

        {visibleIdeas.length ? (
          <div className="space-y-3">
            {visibleIdeas.map((idea) => (
              <MarketingIdeaCard key={idea.id} idea={idea} onEdit={openEdit} onDelete={setDeleting} />
            ))}
          </div>
        ) : filtering ? (
          <p className="rounded-lg border border-dashed bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
            No ideas match these filters.
          </p>
        ) : (
          <EmptyState
            title="No marketing ideas yet"
            description="Add the first one. A rough idea with a sentence of explanation is enough to start."
            action={<Button onClick={openCreate}>Add idea</Button>}
          />
        )}
      </section>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? "Edit idea" : "Add idea"}
        description="Enough detail for the next person to pick this up."
      >
        <MarketingIdeaForm
          draft={draft}
          setDraft={setDraft}
          members={members}
          saving={saving}
          onSubmit={save}
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete idea?"
        description={`This permanently deletes “${deleting?.title ?? "this idea"}” and its links.`}
        onConfirm={() => void remove()}
      />
    </>
  );
}
