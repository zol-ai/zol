"use client";

import { CalendarDays, ExternalLink, Link2, Pencil, Trash2, UserRound } from "lucide-react";
import type { MarketingIdea } from "@/types";
import { channels, contentTypes, labelFor } from "./config";

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
}: {
  idea: MarketingIdea;
  onEdit: (idea: MarketingIdea) => void;
  onDelete: (idea: MarketingIdea) => void;
}) {
  return (
    <article className="group rounded-xl border bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold leading-6 text-slate-900">{idea.title}</h3>
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
        </div>
        <div className="flex shrink-0 opacity-70 group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Edit ${idea.title}`}
            onClick={() => onEdit(idea)}
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <Pencil size={15} />
          </button>
          <button
            type="button"
            aria-label={`Delete ${idea.title}`}
            onClick={() => onDelete(idea)}
            className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {idea.brief ? (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
          {idea.brief}
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-400">No explanation yet.</p>
      )}
      {idea.hook ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
          <span className="font-semibold">Hook:</span> {idea.hook}
        </div>
      ) : null}
      {idea.callToAction ? (
        <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-700">
          <span className="font-semibold">Call to action:</span> {idea.callToAction}
        </div>
      ) : null}

      {idea.ownerName || idea.targetDate || idea.links.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
          {idea.ownerName ? (
            <span className="flex items-center gap-1.5">
              <UserRound size={13} /> {idea.ownerName}
            </span>
          ) : null}
          {idea.targetDate ? (
            <span className="flex items-center gap-1.5">
              <CalendarDays size={13} /> Target {formatDate(idea.targetDate)}
            </span>
          ) : null}
          {idea.links.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 font-medium text-blue-600 hover:underline"
            >
              <Link2 size={13} /> {link.label} <ExternalLink size={11} />
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}
