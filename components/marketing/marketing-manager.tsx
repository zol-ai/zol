"use client";

import { CheckCircle2, Lightbulb, Plus, Rocket, Search } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState, PageHeader } from "@/components/shared";
import {
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  Select,
} from "@/components/ui/core";
import { apiFetch } from "@/lib/api";
import type {
  MarketingIdea,
  MarketingIdeaStatus,
  TeamMember,
} from "@/types";
import { channels, contentTypes } from "./config";
import { MarketingBoard } from "./marketing-board";
import {
  emptyMarketingIdeaDraft,
  MarketingIdeaForm,
  type MarketingIdeaDraft,
} from "./marketing-idea-form";

type Visibility = "active" | "posted" | "all";

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
    brief: draft.brief,
    hook: draft.hook,
    callToAction: draft.callToAction,
    channel: draft.channel,
    ownerId: draft.ownerId,
    targetDate: draft.targetDate,
    links: draft.links
      .map((link) => ({
        ...link,
        label: link.label.trim(),
        url: link.url.trim(),
      }))
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
  const [visibility, setVisibility] = useState<Visibility>("all");

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

  const filteredIdeas = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return ideas.filter((idea) => {
      if (visibility === "active" && idea.status === "posted") return false;
      if (visibility === "posted" && idea.status !== "posted") return false;
      if (owner && idea.ownerId !== owner) return false;
      if (contentType && idea.contentType !== contentType) return false;
      if (channel && idea.channel !== channel) return false;
      if (
        query &&
        ![
          idea.title,
          idea.brief,
          idea.hook,
          idea.callToAction,
          idea.ownerName,
        ].some((value) => value?.toLocaleLowerCase().includes(query))
      ) {
        return false;
      }
      return true;
    });
  }, [ideas, visibility, owner, contentType, channel, search]);

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
          : [...current, saved],
      );
      setModalOpen(false);
      toast.success(editing ? "Marketing idea updated" : "Marketing idea added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save the idea");
    } finally {
      setSaving(false);
    }
  }

  async function move(idea: MarketingIdea, status: MarketingIdeaStatus) {
    const previous = idea;
    setIdeas((current) =>
      current.map((item) => (item.id === idea.id ? { ...item, status } : item)),
    );
    try {
      const saved = await apiFetch<MarketingIdea>(`/api/marketing/${idea.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setIdeas((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      toast.success(status === "posted" ? "Marked as posted" : "Idea stage updated");
    } catch (cause) {
      setIdeas((current) =>
        current.map((item) => (item.id === previous.id ? previous : item)),
      );
      toast.error(cause instanceof Error ? cause.message : "Could not move the idea");
    }
  }

  async function remove() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await apiFetch(`/api/marketing/${target.id}`, { method: "DELETE" });
      setIdeas((current) => current.filter((idea) => idea.id !== target.id));
      toast.success("Marketing idea deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete the idea");
    }
  }

  if (loading) return <LoadingState label="Loading marketing ideas..." />;
  if (error) return <ErrorState message={error} retry={load} />;

  const activeCount = ideas.filter((idea) => idea.status !== "posted").length;
  const readyCount = ideas.filter((idea) => idea.status === "ready").length;
  const postedCount = ideas.filter((idea) => idea.status === "posted").length;

  return (
    <>
      <PageHeader
        title="Marketing"
        description="Capture ideas, shape the creative angle, and move every concept from spark to published."
        actions={
          <Button onClick={openCreate}>
            <Plus size={17} /> Add idea
          </Button>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card className="flex items-center gap-3 p-4">
          <div className="grid size-10 place-items-center rounded-lg bg-violet-50 text-violet-600">
            <Lightbulb size={20} />
          </div>
          <div>
            <p className="text-2xl font-semibold">{activeCount}</p>
            <p className="text-xs text-slate-500">Active ideas</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <div className="grid size-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
            <Rocket size={20} />
          </div>
          <div>
            <p className="text-2xl font-semibold">{readyCount}</p>
            <p className="text-xs text-slate-500">Ready to publish</p>
          </div>
        </Card>
        <Card className="flex items-center gap-3 p-4">
          <div className="grid size-10 place-items-center rounded-lg bg-slate-100 text-slate-600">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-2xl font-semibold">{postedCount}</p>
            <p className="text-xs text-slate-500">Posted</p>
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <div className="relative sm:col-span-2 xl:col-span-1">
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
              placeholder="Search ideas..."
            />
          </div>
          <Select
            aria-label="Filter by visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as Visibility)}
          >
            <option value="active">Active pipeline</option>
            <option value="posted">Posted only</option>
            <option value="all">All ideas</option>
          </Select>
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

      <div className="mt-5">
        <MarketingBoard
          ideas={filteredIdeas}
          onEdit={openEdit}
          onDelete={setDeleting}
          onMove={(idea, status) => void move(idea, status)}
        />
      </div>

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? "Edit marketing idea" : "Add marketing idea"}
        description="Build enough clarity for the next person to move this idea forward."
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
        title="Delete marketing idea?"
        description={`This permanently deletes “${deleting?.title ?? "this idea"}” and its creative links.`}
        onConfirm={() => void remove()}
      />
    </>
  );
}
