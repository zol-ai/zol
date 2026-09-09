"use client";

import type { DragEvent } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MarketingIdea, MarketingIdeaStatus } from "@/types";
import { marketingStatuses } from "./config";
import { MarketingIdeaCard } from "./marketing-idea-card";

export function MarketingBoard({
  ideas,
  onEdit,
  onDelete,
  onMove,
}: {
  ideas: MarketingIdea[];
  onEdit: (idea: MarketingIdea) => void;
  onDelete: (idea: MarketingIdea) => void;
  onMove: (idea: MarketingIdea, status: MarketingIdeaStatus) => void;
}) {
  const [dragOver, setDragOver] = useState<MarketingIdeaStatus | null>(null);

  function startDrag(event: DragEvent<HTMLElement>, idea: MarketingIdea) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", idea.id);
  }

  function drop(event: DragEvent<HTMLElement>, status: MarketingIdeaStatus) {
    event.preventDefault();
    setDragOver(null);
    const idea = ideas.find((item) => item.id === event.dataTransfer.getData("text/plain"));
    if (idea && idea.status !== status) onMove(idea, status);
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="grid min-w-max grid-flow-col auto-cols-[minmax(280px,1fr)] gap-4">
        {marketingStatuses.map((status) => {
          const columnIdeas = ideas.filter((idea) => idea.status === status.value);
          return (
            <section
              key={status.value}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOver(status.value);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  setDragOver(null);
                }
              }}
              onDrop={(event) => drop(event, status.value)}
              className={cn(
                "w-[280px] rounded-xl border bg-slate-50/80 p-3 transition sm:w-[300px]",
                dragOver === status.value && "border-blue-400 bg-blue-50",
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-3 px-1">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <span className={cn("size-2 rounded-full", status.dot)} />
                    {status.label}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">{status.description}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow-sm">
                  {columnIdeas.length}
                </span>
              </div>

              <div className="min-h-32 space-y-3">
                {columnIdeas.length ? (
                  columnIdeas.map((idea) => (
                    <MarketingIdeaCard
                      key={idea.id}
                      idea={idea}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onMove={onMove}
                      onDragStart={startDrag}
                      onDragEnd={() => setDragOver(null)}
                    />
                  ))
                ) : (
                  <div className="grid min-h-28 place-items-center rounded-lg border border-dashed bg-white/60 px-4 text-center text-xs text-slate-400">
                    Drop an idea here
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
