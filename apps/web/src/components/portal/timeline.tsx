import { formatDateTime } from "@/lib/format";
import type { RoEventKind } from "@/lib/events";

/**
 * The ticket's history, in the customer's words.
 *
 * Only the events a customer would want to hear about, and none of the
 * detail text — that column is written for the shop ("coil 1 swapped with
 * coil 3", "WorldPac, due 9:00") and is not always fit for the person paying.
 * The status the ticket moved to is enough to say where the car is.
 */

export const PORTAL_EVENT_KINDS: readonly RoEventKind[] = [
  "opened",
  "checked_in",
  "status_changed",
  "estimate_sent",
  "estimate_responded",
  "part_updated",
  "invoice_created",
  "payment_recorded",
  "closed",
];

export interface PortalEvent {
  id: string;
  kind: string;
  to_status: string | null;
  created_at: string;
}

const STATUS_WORDS: Record<string, string> = {
  open: "Your ticket is open",
  diagnosing: "We're diagnosing the problem",
  awaiting_approval: "Waiting on your approval",
  awaiting_parts: "Waiting on parts",
  in_progress: "Work is under way",
  quality_check: "Final checks",
  ready: "Ready for pickup",
  closed: "All done — thank you",
  cancelled: "Cancelled",
};

/** "Waiting on your approval" for awaiting_approval — the headline on the page. */
export function plainStatus(status: string): string {
  return STATUS_WORDS[status] ?? "In the shop";
}

export function describeEvent(event: PortalEvent): string | null {
  switch (event.kind) {
    case "opened":
      return "Ticket opened";
    case "checked_in":
      return "Vehicle checked in";
    case "status_changed":
      return event.to_status ? (STATUS_WORDS[event.to_status] ?? null) : null;
    case "estimate_sent":
      return "Estimate sent to you";
    case "estimate_responded":
      return "Your answer to the estimate was recorded";
    case "part_updated":
      return "Parts update";
    case "invoice_created":
      return "Invoice ready";
    case "payment_recorded":
      return "Payment received";
    case "closed":
      return "All done — thank you";
    default:
      return null;
  }
}

export function PortalTimeline({ events, timezone }: { events: PortalEvent[]; timezone: string }) {
  const items = events
    .map((event) => ({ ...event, words: describeEvent(event) }))
    .filter((event): event is PortalEvent & { words: string } => Boolean(event.words));

  if (items.length === 0) {
    return <p className="text-[0.9375rem] text-ink-3">Nothing to show yet.</p>;
  }

  return (
    <ol className="relative flex flex-col gap-3 border-l border-line pl-4">
      {items.map((event, index) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden="true"
            className={`absolute -left-[1.3125rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-paper ${
              index === 0 ? "bg-emerald" : "bg-line-2"
            }`}
          />
          <p className={`text-[0.9375rem] ${index === 0 ? "font-semibold text-ink" : "text-ink-2"}`}>
            {event.words}
          </p>
          <p className="t-data text-[0.75rem] text-ink-3">{formatDateTime(event.created_at, timezone)}</p>
        </li>
      ))}
    </ol>
  );
}
