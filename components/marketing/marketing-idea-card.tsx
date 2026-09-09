"use client";

import {
  CalendarDays,
  ExternalLink,
  GripVertical,
  Link2,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import type { DragEvent } from "react";
import type { MarketingIdea, MarketingIdeaStatus } from "@/types";
import { channels, contentTypes, labelFor, marketingStatuses } from "./config";

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function MarketingIdeaCard({
  idea,
  onEdit,
  onDelete,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  idea: MarketingIdea;
  onEdit: (idea: MarketingIdea) => void;
  onDelete: (idea: MarketingIdea) => void;
  onMove: (idea: MarketingIdea, status: MarketingIdeaStatus) => void;
  onDragStart: (event: DragEvent<HTMLElement>, idea: MarketingIdea) => void;
  onDragEnd: () => void;
}) {
  return (
    <article
      draggable
      onDragStart={(event) => onDragStart(event, idea)}
      onDragEnd={onDragEnd}
      className="group rounded-xl border bg-white p-3.5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start gap-2">
        <GripVertical
          size={17}
          aria-hidden="true"
          className="mt-0.5 shrink-0 cursor-grab text-slate-300 group-hover:text-slate-500"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold leading-5 text-slate-900">{idea.title}</h3>
            <div className="flex shrink-0 opacity-70 group-hover:opacity-100">
              <button
                type="button"
                aria-label={`Edit ${idea.title}`}
                onClick={() => onEdit(idea)}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${idea.title}`}
                onClick={() => onDelete(idea)}
                className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              {labelFor(contentTypes, idea.contentType)}
            </span>
            {idea.channel ? (
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                {labelFor(channels, idea.channel)}
              </span>
            ) : null}
          </div>

          {idea.brief ? (
            <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{idea.brief}</p>
          ) : null}
          {idea.hook ? (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs leading-4 text-amber-900">
              <span className="font-semibold">Hook:</span> {idea.hook}
            </div>
          ) : null}

          <div className="mt-3 space-y-1.5 text-xs text-slate-500">
            {idea.ownerName ? (
              <div className="flex items-center gap-1.5">
                <UserRound size={13} /> {idea.ownerName}
              </div>
            ) : null}
            {idea.targetDate ? (
              <div className="flex items-center gap-1.5">
                <CalendarDays size={13} /> Target {formatDate(idea.targetDate)}
              </div>
            ) : null}
            {idea.links.length ? (
              <div className="flex items-start gap-1.5">
                <Link2 size={13} className="mt-0.5 shrink-0" />
                <div className="min-w-0 space-y-1">
                  {idea.links.slice(0, 2).map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      draggable={false}
                      className="flex items-center gap-1 truncate font-medium text-blue-600 hover:underline"
                    >
                      {link.label} <ExternalLink size={11} />
                    </a>
                  ))}
                  {idea.links.length > 2 ? (
                    <span>+{idea.links.length - 2} more links</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <label className="mt-3 block">
            <span className="sr-only">Move {idea.title} to stage</span>
            <select
              value={idea.status}
              onChange={(event) =>
                onMove(idea, event.target.value as MarketingIdeaStatus)
              }
              className="h-8 w-full rounded-lg border bg-slate-50 px-2 text-xs font-medium text-slate-700"
            >
              {marketingStatuses.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </article>
  );
}
