import { Section, StatusBadge, Timeline } from "@/components/app/ui";
import { db } from "@/lib/db";
import { listRoEvents, type RoEventKind } from "@/lib/events";
import type { RoContext } from "./contracts";

/**
 * The ticket's history, from repair_order_events.
 *
 * Every row carries `detail` written in shop language at the moment it
 * happened; that is the title. The kind becomes a small caption so a scan
 * down the rail still reads — and a status move shows its two badges, since
 * "Open → Diagnosing" is the one line people actually look for.
 */

const KIND_LABEL: Record<RoEventKind, string> = {
  opened: "Opened",
  checked_in: "Checked in",
  status_changed: "Status",
  assigned: "Assigned",
  priority_changed: "Priority",
  note: "Note",
  diagnostic_added: "Diagnostic",
  diagnostic_verified: "Diagnostic verified",
  inspection_started: "Inspection",
  inspection_completed: "Inspection completed",
  line_added: "Line added",
  line_removed: "Line removed",
  line_approval: "Line answered",
  estimate_sent: "Estimate sent",
  estimate_viewed: "Estimate viewed",
  estimate_responded: "Estimate answered",
  part_added: "Part added",
  part_updated: "Part",
  invoice_created: "Invoice",
  payment_recorded: "Payment",
  message_sent: "Message sent",
  message_received: "Message received",
  approved_over_cap: "Approved over cap",
  photo_added: "Photo",
  closed: "Closed",
};

export async function RoTimeline({ ro }: { ro: RoContext }) {
  const events = await listRoEvents(await db(), ro.shopId, ro.id);

  return (
    <Section title="History" detail="Everything that has happened on this ticket">
      <Timeline
        timezone={ro.timezone}
        items={events.map((event) => ({
          id: event.id,
          title: event.detail ?? KIND_LABEL[event.kind] ?? event.kind.replace(/_/g, " "),
          detail:
            event.from_status || event.to_status ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[0.75rem] text-ink-3">{KIND_LABEL[event.kind] ?? event.kind}</span>
                {event.from_status && <StatusBadge kind="ro" value={event.from_status} />}
                {event.from_status && event.to_status && (
                  <span aria-hidden="true" className="text-ink-3">
                    →
                  </span>
                )}
                {event.to_status && <StatusBadge kind="ro" value={event.to_status} />}
              </span>
            ) : event.detail ? (
              <span className="text-[0.75rem] text-ink-3">{KIND_LABEL[event.kind] ?? event.kind}</span>
            ) : undefined,
          at: event.created_at,
          actor: event.actor,
          by: event.staff_name,
        }))}
      />
    </Section>
  );
}
