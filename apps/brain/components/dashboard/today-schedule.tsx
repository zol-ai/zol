"use client";

import { format } from "date-fns";
import { CalendarDays, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  eventsOn,
  formatEventTime,
  fromDateKey,
  scheduleColorStyles,
  todayKey,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { ScheduleEvent } from "@/types";
import { Badge, Card } from "@/components/ui/core";

/**
 * The day's events, straight from the browser's calendar day. The dashboard
 * only renders this after its own data has loaded client-side, so "today"
 * here is always the viewer's, never the server's.
 */
export function TodaySchedule() {
  const [today] = useState(() => todayKey());
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setEvents(await apiFetch<ScheduleEvent[]>(`/api/schedule?from=${today}&to=${today}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    }
  }, [today]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const items = events ? eventsOn(events, today) : [];

  return (
    <Card className="mt-6 p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarDays size={18} className="text-blue-600" /> Today’s schedule
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {format(fromDateKey(today), "EEEE, MMMM d")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/schedule?view=day&date=${today}&new=1`}
            className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium hover:bg-slate-50"
          >
            <Plus size={16} /> Add event
          </Link>
          <Link
            href={`/schedule?view=day&date=${today}`}
            className="inline-flex h-9 items-center rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Open schedule
          </Link>
        </div>
      </div>
      <div className="mt-4">
        {error ? (
          <p className="text-sm text-red-600">
            {error}{" "}
            <button type="button" className="font-medium underline" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : events === null ? (
          <div className="h-16 animate-pulse rounded-lg bg-slate-50" aria-label="Loading today’s schedule" />
        ) : !items.length ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-slate-500">
            Nothing scheduled for today.
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((event) => (
              <li key={event.id} className="flex items-center gap-3 py-2.5">
                <span className="w-36 shrink-0 text-sm text-slate-500">{formatEventTime(event)}</span>
                <span
                  aria-hidden="true"
                  className={cn("size-2.5 shrink-0 rounded-full", scheduleColorStyles[event.color].swatch)}
                />
                <Link
                  href={`/schedule?view=day&date=${today}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {event.title}
                </Link>
                <Badge>{event.assignedToName ?? "Unassigned"}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
