"use client";

import { Link2, Plus, X } from "lucide-react";
import type { FormEvent } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/core";
import type {
  MarketingContentType,
  MarketingIdeaLink,
  MarketingIdeaStatus,
  TeamMember,
} from "@/types";
import { channels, contentTypes } from "./config";

export type MarketingIdeaDraft = {
  title: string;
  brief: string;
  hook: string;
  callToAction: string;
  contentType: MarketingContentType;
  channel: string;
  ownerId: string;
  targetDate: string;
  links: MarketingIdeaLink[];
  status: MarketingIdeaStatus;
};

export const emptyMarketingIdeaDraft: MarketingIdeaDraft = {
  title: "",
  brief: "",
  hook: "",
  callToAction: "",
  contentType: "social_post",
  channel: "",
  ownerId: "",
  targetDate: "",
  links: [],
  status: "idea",
};

function createLink(): MarketingIdeaLink {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    label: "",
    url: "",
  };
}

export function MarketingIdeaForm({
  draft,
  setDraft,
  members,
  saving,
  onSubmit,
}: {
  draft: MarketingIdeaDraft;
  setDraft: (draft: MarketingIdeaDraft) => void;
  members: TeamMember[];
  saving: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  function updateLink(id: string, patch: Partial<MarketingIdeaLink>) {
    setDraft({
      ...draft,
      links: draft.links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <Label htmlFor="marketing-title">Idea title</Label>
        <Input
          id="marketing-title"
          required
          maxLength={200}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="Example: Founder story video series"
        />
      </div>

      <div>
        <Label htmlFor="marketing-brief">Explain it</Label>
        <Textarea
          id="marketing-brief"
          maxLength={2000}
          value={draft.brief}
          onChange={(event) => setDraft({ ...draft, brief: event.target.value })}
          placeholder="What is the idea, who is it for, and why will it resonate?"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="marketing-hook">Hook or angle</Label>
          <Textarea
            id="marketing-hook"
            className="min-h-20"
            maxLength={1000}
            value={draft.hook}
            onChange={(event) => setDraft({ ...draft, hook: event.target.value })}
            placeholder="The opening line or creative angle"
          />
        </div>
        <div>
          <Label htmlFor="marketing-cta">Call to action</Label>
          <Textarea
            id="marketing-cta"
            className="min-h-20"
            maxLength={500}
            value={draft.callToAction}
            onChange={(event) => setDraft({ ...draft, callToAction: event.target.value })}
            placeholder="What should the audience do next?"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="marketing-type">Content type</Label>
          <Select
            id="marketing-type"
            value={draft.contentType}
            onChange={(event) =>
              setDraft({
                ...draft,
                contentType: event.target.value as MarketingContentType,
              })
            }
          >
            {contentTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="marketing-channel">Channel</Label>
          <Select
            id="marketing-channel"
            value={draft.channel}
            onChange={(event) => setDraft({ ...draft, channel: event.target.value })}
          >
            <option value="">Not decided</option>
            {channels.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="marketing-owner">Owner</Label>
          <Select
            id="marketing-owner"
            value={draft.ownerId}
            onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="marketing-date">Target date</Label>
          <Input
            id="marketing-date"
            type="date"
            value={draft.targetDate}
            onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Label className="mb-0">Creative links</Label>
          <Button
            type="button"
            variant="secondary"
            className="h-9 px-3"
            onClick={() => setDraft({ ...draft, links: [...draft.links, createLink()] })}
          >
            <Plus size={16} /> Add link
          </Button>
        </div>
        <div className="space-y-2">
          {draft.links.length ? (
            draft.links.map((link) => (
              <div
                key={link.id}
                className="grid gap-2 rounded-lg border bg-slate-50 p-3 sm:grid-cols-[0.8fr_1.4fr_auto]"
              >
                <Input
                  aria-label="Link label"
                  required
                  maxLength={120}
                  value={link.label}
                  onChange={(event) => updateLink(link.id, { label: event.target.value })}
                  placeholder="Canva draft"
                />
                <div className="relative">
                  <Link2
                    aria-hidden="true"
                    size={15}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <Input
                    aria-label="Link URL"
                    type="url"
                    required
                    maxLength={2000}
                    className="pl-9"
                    value={link.url}
                    onChange={(event) => updateLink(link.id, { url: event.target.value })}
                    placeholder="https://"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="size-10 px-0 text-red-600"
                  aria-label="Remove link"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      links: draft.links.filter((item) => item.id !== link.id),
                    })
                  }
                >
                  <X size={16} />
                </Button>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-slate-500">
              Add links to Canva, Drive, YouTube, or another creative draft.
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <Button disabled={saving}>{saving ? "Saving..." : "Save idea"}</Button>
      </div>
    </form>
  );
}
