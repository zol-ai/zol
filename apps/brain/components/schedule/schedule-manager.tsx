"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import {
  DATE_KEY_PATTERN,
  isScheduleView,
  overlapsRange,
  rangeFor,
  rangeLabel,
  scheduleViews,
  shiftAnchor,
  todayKey,
  type DateRange,
  type ScheduleView,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { ScheduleEvent, TeamMember } from "@/types";
import { Button, ConfirmDialog, Modal, Select } from "@/components/ui/core";
import { ErrorState, LoadingState, PageHeader } from "@/components/shared";
import { draftFromEvent, emptyDraft, EventForm, type EventDraft } from "./event-form";
import { DayView, MonthView, QuarterView, WeekView, YearView } from "./schedule-views";

const viewLabels: Record<ScheduleView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

export function ScheduleManager() {
  const [today] = useState(() => todayKey());
  const [view, setView] = useState<ScheduleView>("week");
  const [anchor, setAnchor] = useState(today);
  const [initialized, setInitialized] = useState(false);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [myMemberId, setMyMemberId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [deleting, setDeleting] = useState<ScheduleEvent | null>(null);
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const loadEvents = useCallback(async (target: DateRange) => {
    setFetching(true);
    try {
      setError("");
      setEvents(
        await apiFetch<ScheduleEvent[]>(`/api/schedule?from=${target.start}&to=${target.end}`),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unknown error");
    } finally {
      setFetching(false);
      setLoading(false);
    }
  }, []);

  const loadPeople = useCallback(async () => {
    try {
      const [memberData, dashboard] = await Promise.all([
        apiFetch<TeamMember[]>("/api/team"),
        apiFetch<{ matchingMember: TeamMember | null }>("/api/dashboard"),
      ]);
      setMembers(memberData);
      setMyMemberId(dashboard.matchingMember?.id ?? "");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not load the team");
    }
  }, []);

  // Read the deep link (?view=&date=&new=1) once after mount; the range effect
  // below takes over from there.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const requestedView = query.get("view");
      const requestedDate = query.get("date");
      const startDate =
        requestedDate && DATE_KEY_PATTERN.test(requestedDate) ? requestedDate : null;
      if (isScheduleView(requestedView)) setView(requestedView);
      if (startDate) setAnchor(startDate);
      if (query.get("new") === "1") {
        setEditing(null);
        setDraft({ ...emptyDraft, date: startDate ?? todayKey() });
        setModalOpen(true);
      }
      setInitialized(true);
      void loadPeople();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPeople]);

  useEffect(() => {
    if (!initialized) return;
    const timer = window.setTimeout(() => void loadEvents(range), 0);
    return () => window.clearTimeout(timer);
  }, [initialized, loadEvents, range]);

  // Keep the address bar in step so a refresh or a shared link lands on the same view.
  useEffect(() => {
    if (!initialized) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    url.searchParams.set("date", anchor);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }, [initialized, view, anchor]);

  const visibleEvents = useMemo(
    () => (assignee ? events.filter((event) => event.assignedToId === assignee) : events),
    [assignee, events],
  );

  function goTo(nextView: ScheduleView, dateKey: string) {
    setView(nextView);
    setAnchor(dateKey);
  }

  function openCreate(dateKey?: string) {
    setEditing(null);
    setDraft({
      ...emptyDraft,
      date: dateKey ?? (view === "day" ? anchor : today),
      assignedToId: assignee || myMemberId,
    });
    setModalOpen(true);
  }

  function openEdit(event: ScheduleEvent) {
    setEditing(event);
    setDraft(draftFromEvent(event));
    setModalOpen(true);
  }

  async function saveEvent(formEvent: FormEvent) {
    formEvent.preventDefault();
    setSaving(true);
    try {
      const saved = await apiFetch<ScheduleEvent>(
        editing ? `/api/schedule/${editing.id}` : "/api/schedule",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(draft) },
      );
      setEvents((current) => {
        const others = current.filter((item) => item.id !== saved.id);
        return overlapsRange(saved, range) ? [...others, saved] : others;
      });
      setModalOpen(false);
      toast.success(editing ? "Event updated" : "Event added");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not save event");
    } finally {
      setSaving(false);
    }
  }

  function requestDelete() {
    if (!editing) return;
    setDeleting(editing);
    setModalOpen(false);
  }

  async function removeEvent() {
    if (!deleting) return;
    try {
      await apiFetch<{ ok: boolean }>(`/api/schedule/${deleting.id}`, { method: "DELETE" });
      setEvents((current) => current.filter((event) => event.id !== deleting.id));
      toast.success("Event deleted");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not delete event");
    } finally {
      setDeleting(null);
    }
  }

  if (loading) return <LoadingState label="Loading schedule" />;
  if (error) return <ErrorState message={error} retry={() => void loadEvents(range)} />;

  const viewProps = {
    anchor,
    today,
    events: visibleEvents,
    onSelectEvent: openEdit,
    onSelectDay: (dateKey: string) => goTo("day", dateKey),
    onSelectMonth: (dateKey: string) => goTo("month", dateKey),
    onCreate: openCreate,
  };
  const body = {
    day: <DayView {...viewProps} />,
    week: <WeekView {...viewProps} />,
    month: <MonthView {...viewProps} />,
    quarter: <QuarterView {...viewProps} />,
    year: <YearView {...viewProps} />,
  }[view];

  return (
    <>
      <PageHeader
        title="Schedule"
        description="What the team has planned, by day, week, month, quarter, or year."
        actions={
          <Button onClick={() => openCreate()}>
            <Plus size={17} /> Add event
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="px-3"
            aria-label="Previous"
            onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button variant="secondary" onClick={() => setAnchor(today)}>
            Today
          </Button>
          <Button
            variant="secondary"
            className="px-3"
            aria-label="Next"
            onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
          >
            <ChevronRight size={16} />
          </Button>
          <h2 className="ml-1 text-lg font-semibold">{rangeLabel(view, anchor)}</h2>
          {fetching ? <span className="text-xs text-slate-400">Updating…</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border bg-white p-1" aria-label="Schedule view">
            {scheduleViews.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={view === item}
                onClick={() => setView(item)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  view === item ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {viewLabels[item]}
              </button>
            ))}
          </div>
          <Select
            aria-label="Filter by assignee"
            className="w-auto min-w-44"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <option value="">Everyone</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.active ? "" : " (archived)"}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {body}

      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={editing ? "Edit event" : "Add event"}
        description="Changes are saved to Firestore immediately."
      >
        <EventForm
          draft={draft}
          setDraft={setDraft}
          members={members}
          saving={saving}
          editing={Boolean(editing)}
          onSubmit={saveEvent}
          onDelete={requestDelete}
        />
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete event?"
        description={`This will permanently delete “${deleting?.title ?? ""}”. This action cannot be undone.`}
        onConfirm={() => void removeEvent()}
      />
    </>
  );
}
