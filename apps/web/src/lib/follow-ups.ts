import "server-only";

import type { Queryable } from "./db";
import { formatCents } from "./money";
import { formatPhone } from "./phone";
import type { FollowUpKind } from "./statuses";

/**
 * Everything ZOL says to a customer goes through here.
 *
 * A follow-up is a row, not a send. The worker (`/api/jobs/follow-ups`,
 * called by Cloud Scheduler) drains what's due through the messaging provider
 * and writes the resulting `messages` row. That indirection is the whole
 * design: a redeploy can't drop "your car is ready", a customer who texted
 * STOP is checked at send time rather than queue time, and while telephony is
 * switched off the same rows simply land on the customer's portal page
 * instead of their phone — nothing upstream knows or cares which.
 *
 * Pages and actions never call a provider. They call `queueFollowUp`.
 */

export interface QueuedFollowUp {
  shopId: string;
  customerId: string;
  kind: FollowUpKind;
  /** What the customer receives. */
  body: string;
  /** What the CRM card says. Defaults to the kind's label on the way out. */
  title?: string | null;
  details?: string | null;
  /** Defaults to now — the worker picks it up on its next pass. */
  scheduledFor?: Date;
  repairOrderId?: string | null;
  vehicleId?: string | null;
  declinedWorkId?: string | null;
  /**
   * The visit a confirmation or reminder is about. Cancelling an appointment
   * cancels its own pending messages by this, not by customer — a person
   * with two bookings keeps the confirmation for the one still happening.
   */
  appointmentId?: string | null;
  channel?: "sms" | "email" | "portal";
  source?: "zol" | "person";
}

/**
 * Queue one message. Returns the row id, or null when an identical pending
 * follow-up already exists for the same ticket and kind — a status that flips
 * back and forth while somebody is deciding must not text the customer twice.
 * Retention kinds (no ticket) don't dedupe; a birthday text is once a year by
 * construction.
 */
export async function queueFollowUp(
  client: Queryable,
  followUp: QueuedFollowUp,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO follow_ups
       (shop_id, customer_id, repair_order_id, vehicle_id, declined_work_id,
        kind, scheduled_for, body, title, details, channel, source, appointment_id)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      WHERE $3::uuid IS NULL
         OR NOT EXISTS (
              SELECT 1 FROM follow_ups f
               WHERE f.repair_order_id = $3 AND f.kind = $6 AND f.status = 'pending')
     RETURNING id`,
    [
      followUp.shopId,
      followUp.customerId,
      followUp.repairOrderId ?? null,
      followUp.vehicleId ?? null,
      followUp.declinedWorkId ?? null,
      followUp.kind,
      followUp.scheduledFor ?? new Date(),
      followUp.body,
      followUp.title ?? null,
      followUp.details ?? null,
      followUp.channel ?? "sms",
      followUp.source ?? "zol",
      followUp.appointmentId ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

// -----------------------------------------------------------------------------
// The journey — what each stop says
// -----------------------------------------------------------------------------

export interface JourneyContext {
  shopName: string;
  /** The shop's public number, E.164. Rendered for humans here. */
  shopPhone?: string | null;
  firstName?: string | null;
  /** "2015 Chevrolet Sonic". Falls back to "your vehicle". */
  vehicle?: string | null;
  roNumber?: number | null;
  /** Absolute link to the customer's portal page for this ticket. */
  portalUrl?: string | null;
  /** "Tuesday, Sep 15 at 8:00 AM", already in the shop's zone. */
  when?: string | null;
  technician?: string | null;
  serviceType?: string | null;
  totalCents?: number | null;
  /** For declined-work and inspection recalls: what the work was. */
  work?: string | null;
}

export interface JourneyMessage {
  title: string;
  body: string;
}

/**
 * Plain, short, and honest — these go to a phone. No marketing voice, no
 * exclamation marks, the shop's name first so the customer knows who it is
 * before they've read a word. Every fact in them was supplied by the caller;
 * the templates add none.
 */
export function journeyMessage(kind: FollowUpKind, ctx: JourneyContext): JourneyMessage {
  const shop = ctx.shopName;
  // "your 2015 Chevrolet Sonic" — the way a person says it to the owner.
  // Callers pass the bare label; the possessive is added here, once.
  const car = ctx.vehicle ? `your ${ctx.vehicle}` : "your vehicle";
  const phone = ctx.shopPhone ? ` or call ${formatPhone(ctx.shopPhone)}` : "";
  const link = ctx.portalUrl ? ` ${ctx.portalUrl}` : "";
  const ro = ctx.roNumber ? ` (#${ctx.roNumber})` : "";
  const total = ctx.totalCents != null ? formatCents(ctx.totalCents) : null;

  switch (kind) {
    case "appointment_confirmed":
      return {
        title: "Booking confirmed",
        body:
          `${shop}: you're booked for ${ctx.when ?? "your appointment"}` +
          (ctx.technician ? ` with ${ctx.technician}` : "") +
          (ctx.serviceType ? ` — ${ctx.serviceType}` : "") +
          `. Reply to this text${phone} if you need to change it.`,
      };
    case "appointment_reminder":
      return {
        title: "Appointment reminder",
        body: `${shop}: a reminder that ${car} is booked for ${ctx.when ?? "tomorrow"}. Reply${phone} if that no longer works.`,
      };
    case "checked_in":
      return {
        title: "Checked in",
        body: `${shop}: we have ${car}${ro}. We'll text you as soon as we know more. Follow along here:${link}`,
      };
    case "diagnosis_ready":
      return {
        title: "Diagnosis ready",
        body: `${shop}: we've finished looking at ${car}${ro}. What we found is here:${link}`,
      };
    case "estimate_ready":
      return {
        title: "Estimate ready",
        body:
          `${shop}: the estimate for ${car} is ready` +
          (total ? ` — ${total}` : "") +
          `. Review and approve it here:${link}`,
      };
    case "approved":
      return {
        title: "Work approved",
        body: `${shop}: thanks — we've got the go-ahead on ${car} and the work is underway. We'll text you when it's done.`,
      };
    case "part_ordered":
      return {
        title: "Parts ordered",
        body: `${shop}: the parts for ${car} are on order. We'll let you know the moment they arrive.`,
      };
    case "parts_received":
      return {
        title: "Parts arrived",
        body: `${shop}: the parts for ${car} have arrived and the job is moving again.`,
      };
    case "in_progress":
      return {
        title: "Work started",
        body: `${shop}: ${car} is on the lift.`,
      };
    case "ready_for_pickup":
      return {
        title: "Ready for pickup",
        body:
          `${shop}: ${car} is ready to pick up` +
          (total ? `. Total ${total}. Pay ahead or see the invoice here:${link}` : `. The details are here:${link}`),
      };
    case "payment_receipt":
      return {
        title: "Payment received",
        body:
          `${shop}: thanks — payment` +
          (total ? ` of ${total}` : "") +
          ` received${ro}. Your receipt:${link}`,
      };
    case "post_repair":
      return {
        title: "Post-repair check-in",
        body: `${shop}: how is ${car} running since the visit? If anything isn't right, reply here${phone} and we'll sort it.`,
      };
    case "declined_work_recall":
      return {
        title: "Declined work",
        body:
          `${shop}: when ${car} was in we noted ${ctx.work ?? "some work"} it will need. ` +
          `Want us to take care of it on your next visit? Reply here${phone}.`,
      };
    case "inspection_recommendation":
      return {
        title: "From your inspection",
        body: `${shop}: from ${car}'s last inspection, ${ctx.work ?? "an item we flagged"} will want attention soon. Reply${phone} to book it in.`,
      };
    case "service_due":
      return {
        title: "Service due",
        body: `${shop}: ${car} is coming up on ${ctx.work ?? "its next service"}. Reply${phone} and we'll find you a slot.`,
      };
    case "birthday":
      return {
        title: "Birthday",
        body: `${shop}: happy birthday${ctx.firstName ? `, ${ctx.firstName}` : ""}, from all of us at the shop.`,
      };
    case "holiday":
      return {
        title: "Holiday",
        body: `${shop}: ${ctx.work ?? "season's greetings"} from everyone at the shop.`,
      };
    case "win_back":
      return {
        title: "We miss you",
        body: `${shop}: it's been a while since we saw ${car}. If it's due for anything, reply${phone} and we'll look after it.`,
      };
    case "custom":
    default:
      return {
        title: "Message",
        body: ctx.work ?? `${shop}: a note from the shop.`,
      };
  }
}
