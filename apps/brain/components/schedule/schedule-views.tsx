"use client";

import { format, isSameMonth } from "date-fns";
import { Plus } from "lucide-react";
import {
  compareEvents,
  countByDay,
  daysInRange,
  eventLastDay,
  eventsOn,
  formatClock,
  formatEventTime,
  fromDateKey,
  isMultiDay,
  monthGridRange,
  monthsInRange,
  overlapsRange,
  rangeFor,
  rangeLabel,
  scheduleColorStyles,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import type { ScheduleEvent } from "@/types";
import { Badge, Button, Card } from "@/components/ui/core";
import { EmptyState } from "@/components/shared";

export type ViewProps = {
  /** The date the view is centred on, as a date key. */
  anchor: string;
  today: string;
  /** Already narrowed to the visible range and the chosen assignee. */
  events: ScheduleEvent[];
  onSelectEvent: (event: ScheduleEvent) => void;
  onSelectDay: (dateKey: string) => void;
  onSelectMonth: (dateKey: string) => void;
  onCreate: (dateKey: string) => void;
};

const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayInitials = [
  ["mon", "M"],
  ["tue", "T"],
  ["wed", "W"],
  ["thu", "T"],
  ["fri", "F"],
  ["sat", "S"],
  ["sun", "S"],
] as const;

function eventTooltip(event: ScheduleEvent) {
  return [event.title, formatEventTime(event), event.assignedToName].filter(Boolean).join(" · ");
}

function EventChip({
  event,
  detail = false,
  onClick,
}: {
  event: ScheduleEvent;
  detail?: boolean;
  onClick: () => void;
}) {
  const styles = scheduleColorStyles[event.color];
  return (
    <button
      type="button"
      onClick={onClick}
      title={eventTooltip(event)}
      className={cn(
        "block w-full rounded-md border px-2 py-1 text-left text-xs transition",
        styles.chip,
      )}
    >
      <span className="block truncate">
        {!detail && !event.allDay && event.startTime ? (
          <span className="mr-1 opacity-70">{formatClock(event.startTime)}</span>
        ) : null}
        <span className="font-medium">{event.title}</span>
      </span>
      {detail ? (
        <span className="block truncate text-[11px] opacity-75">
          {formatEventTime(event)}
          {event.assignedToName ? ` · ${event.assignedToName}` : ""}
        </span>
      ) : null}
    </button>
  );
}

function AddOnDayButton({
  dateKey,
  onCreate,
  className,
}: {
  dateKey: string;
  onCreate: (dateKey: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Add event on ${format(fromDateKey(dateKey), "MMMM d")}`}
      onClick={() => onCreate(dateKey)}
      className={cn(
        "rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700",
        className,
      )}
    >
      <Plus size={16} />
    </button>
  );
}

export function DayView({ anchor, events, onSelectEvent, onCreate }: ViewProps) {
  const items = eventsOn(events, anchor);
  if (!items.length) {
    return (
      <EmptyState
        title="Nothing scheduled"
        description={`No events on ${format(fromDateKey(anchor), "EEEE, MMMM d")}.`}
        action={
          <Button onClick={() => onCreate(anchor)}>
            <Plus size={17} /> Add event
          </Button>
        }
      />
    );
  }
  return (
    <Card className="divide-y p-0">
      {items.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => onSelectEvent(event)}
          className="flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
        >
          <p className="w-36 shrink-0 pt-0.5 text-sm text-slate-500">{formatEventTime(event)}</p>
          <span
            aria-hidden="true"
            className={cn("mt-0.5 h-10 w-1 shrink-0 rounded-full", scheduleColorStyles[event.color].swatch)}
          />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{event.title}</p>
            {event.description ? (
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{event.description}</p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">
              {event.assignedToName ?? "Unassigned"}
              {isMultiDay(event)
                ? ` · ${format(fromDateKey(event.date), "MMM d")} to ${format(fromDateKey(eventLastDay(event)), "MMM d")}`
                : ""}
            </p>
          </div>
        </button>
      ))}
    </Card>
  );
}

export function WeekView({ anchor, today, events, onSelectEvent, onSelectDay, onCreate }: ViewProps) {
  const days = daysInRange(rangeFor("week", anchor));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((day) => {
        const date = fromDateKey(day);
        const items = eventsOn(events, day);
        const isToday = day === today;
        return (
          <Card
            key={day}
            className={cn("flex min-h-48 flex-col p-3", isToday && "border-blue-300 ring-1 ring-blue-200")}
          >
            <div className="mb-2 flex items-start justify-between">
              <button type="button" onClick={() => onSelectDay(day)} className="text-left">
                <p className="text-xs uppercase tracking-wide text-slate-500">{format(date, "EEE")}</p>
                <p className={cn("text-lg font-semibold leading-tight", isToday && "text-blue-700")}>
                  {format(date, "d")}
                </p>
              </button>
              <AddOnDayButton dateKey={day} onCreate={onCreate} />
            </div>
            <div className="space-y-1.5">
              {items.length ? (
                items.map((event) => (
                  <EventChip key={event.id} event={event} detail onClick={() => onSelectEvent(event)} />
                ))
              ) : (
                <p className="text-xs text-slate-400">No events</p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function MonthView({ anchor, today, events, onSelectEvent, onSelectDay, onCreate }: ViewProps) {
  const month = fromDateKey(anchor);
  const days = daysInRange(monthGridRange(anchor));
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b bg-slate-50 text-center text-xs font-medium uppercase tracking-wide text-slate-500">
        {weekdayLabels.map((label) => (
          <div key={label} className="py-2">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const date = fromDateKey(day);
          const inMonth = isSameMonth(date, month);
          const items = eventsOn(events, day);
          const visible = items.slice(0, 3);
          const hidden = items.length - visible.length;
          const isToday = day === today;
          const lastColumn = index % 7 === 6;
          const lastRow = index >= days.length - 7;
          return (
            <div
              key={day}
              className={cn(
                "group min-h-28 border-b border-r p-1.5",
                lastColumn && "border-r-0",
                lastRow && "border-b-0",
                !inMonth && "bg-slate-50/70",
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-label={format(date, "EEEE, MMMM d")}
                  className={cn(
                    "grid size-7 place-items-center rounded-full text-sm transition",
                    isToday
                      ? "bg-blue-600 font-semibold text-white"
                      : inMonth
                        ? "text-slate-800 hover:bg-slate-100"
                        : "text-slate-400 hover:bg-slate-100",
                  )}
                >
                  {format(date, "d")}
                </button>
                <AddOnDayButton
                  dateKey={day}
                  onCreate={onCreate}
                  className="p-0.5 opacity-0 focus:opacity-100 group-hover:opacity-100"
                />
              </div>
              <div className="mt-1 space-y-1">
                {visible.map((event) => (
                  <EventChip key={event.id} event={event} onClick={() => onSelectEvent(event)} />
                ))}
                {hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSelectDay(day)}
                    className="px-1 text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    +{hidden} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function intensityClass(count: number) {
  if (!count) return "text-slate-600 hover:bg-slate-100";
  if (count === 1) return "bg-blue-100 font-medium text-blue-900 hover:bg-blue-200";
  if (count <= 3) return "bg-blue-300 font-medium text-blue-950 hover:bg-blue-400";
  return "bg-blue-600 font-medium text-white hover:bg-blue-700";
}

function MiniMonth({
  monthKey,
  today,
  events,
  onSelectDay,
  onSelectMonth,
}: {
  monthKey: string;
  today: string;
  events: ScheduleEvent[];
  onSelectDay: (dateKey: string) => void;
  onSelectMonth: (dateKey: string) => void;
}) {
  const month = fromDateKey(monthKey);
  const range = rangeFor("month", monthKey);
  const counts = countByDay(events, range);
  const total = events.filter((event) => overlapsRange(event, range)).length;
  const days = daysInRange(monthGridRange(monthKey));
  return (
    <Card className="p-3">
      <button
        type="button"
        onClick={() => onSelectMonth(monthKey)}
        className="flex w-full items-baseline justify-between rounded-md px-1 py-0.5 text-left transition hover:bg-slate-50"
      >
        <span className="font-semibold">{format(month, "MMMM")}</span>
        <span className="text-xs text-slate-500">
          {total === 1 ? "1 event" : `${total} events`}
        </span>
      </button>
      <div className="mt-2 grid grid-cols-7 text-center text-[10px] font-medium uppercase text-slate-400">
        {weekdayInitials.map(([key, label]) => (
          <div key={key}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const date = fromDateKey(day);
          if (!isSameMonth(date, month)) return <div key={day} />;
          const count = counts.get(day) ?? 0;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              aria-label={`${format(date, "MMMM d")}, ${count === 1 ? "1 event" : `${count} events`}`}
              title={count ? (count === 1 ? "1 event" : `${count} events`) : undefined}
              className={cn(
                "mx-auto grid size-7 place-items-center rounded-full text-xs transition",
                intensityClass(count),
                day === today && "ring-2 ring-blue-500 ring-offset-1",
              )}
            >
              {format(date, "d")}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function EventList({
  title,
  events,
  onSelectEvent,
}: {
  title: string;
  events: ScheduleEvent[];
  onSelectEvent: (event: ScheduleEvent) => void;
}) {
  return (
    <Card className="p-0">
      <h3 className="border-b px-5 py-3 font-semibold">{title}</h3>
      {events.length ? (
        <div className="divide-y">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onSelectEvent(event)}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition hover:bg-slate-50"
            >
              <span className="w-24 shrink-0 text-slate-500">
                {format(fromDateKey(event.date), "EEE, MMM d")}
              </span>
              <span className="hidden w-36 shrink-0 text-slate-500 sm:block">
                {formatEventTime(event)}
              </span>
              <span
                aria-hidden="true"
                className={cn("size-2.5 shrink-0 rounded-full", scheduleColorStyles[event.color].swatch)}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
              <Badge>{event.assignedToName ?? "Unassigned"}</Badge>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-5 py-6 text-center text-sm text-slate-500">Nothing scheduled.</p>
      )}
    </Card>
  );
}

export function QuarterView({
  anchor,
  today,
  events,
  onSelectEvent,
  onSelectDay,
  onSelectMonth,
}: ViewProps) {
  const range = rangeFor("quarter", anchor);
  const listed = events
    .filter((event) => overlapsRange(event, range))
    .sort((a, b) => a.date.localeCompare(b.date) || compareEvents(a, b));
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {monthsInRange(range).map((monthKey) => (
          <MiniMonth
            key={monthKey}
            monthKey={monthKey}
            today={today}
            events={events}
            onSelectDay={onSelectDay}
            onSelectMonth={onSelectMonth}
          />
        ))}
      </div>
      <EventList
        title={`Events in ${rangeLabel("quarter", anchor)}`}
        events={listed}
        onSelectEvent={onSelectEvent}
      />
    </div>
  );
}

export function YearView({ anchor, today, events, onSelectDay, onSelectMonth }: ViewProps) {
  const range = rangeFor("year", anchor);
  const total = events.filter((event) => overlapsRange(event, range)).length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {total === 1 ? "1 event" : `${total} events`} in {rangeLabel("year", anchor)}. Click a month to open it, or a day to see that day.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {monthsInRange(range).map((monthKey) => (
          <MiniMonth
            key={monthKey}
            monthKey={monthKey}
            today={today}
            events={events}
            onSelectDay={onSelectDay}
            onSelectMonth={onSelectMonth}
          />
        ))}
      </div>
    </div>
  );
}
