import "server-only";

import type { Queryable } from "./db";
import { logRoEvent } from "./events";
import { journeyMessage, queueFollowUp } from "./follow-ups";
import { notifyShop } from "./notifications";
import { nextNumber } from "./numbering";
import { mintPortalToken, portalPath } from "./portal";
import { totalsFor } from "./ro-totals";
import {
  RO_STATUS_LABEL,
  type FollowUpKind,
  type Priority,
  type RoStatus,
  type Source,
} from "./statuses";

/**
 * Writing to a repair order, for everyone who does it.
 *
 * Three doors open a ticket — the advisor at the counter, the check-in on the
 * schedule, and ZOL from a call — and two of them are not a Server Action.
 * The number, the mileage update, the appointment link and the first history
 * row have to happen the same way from all three, so they happen here, on
 * whatever client the caller is already inside a transaction with.
 */

export interface OpenRepairOrderInput {
  shopId: string;
  customerId: string;
  vehicleId?: string | null;
  /** The customer's words, not a diagnosis. */
  complaint: string;
  mileageIn?: number | null;
  technicianId?: string | null;
  /** Links the booking, marks it arrived and stamps the check-in. */
  appointmentId?: string | null;
  openedByCallId?: string | null;
  source?: Source;
  priority?: Priority;
  fuelLevel?: number | null;
  visibleDamage?: string | null;
  checkInNotes?: string | null;
  promisedAt?: Date | null;
  /** Who did it, when a person did. */
  staffId?: string | null;
  actor?: "zol" | "person";
}

export async function openRepairOrder(
  client: Queryable,
  input: OpenRepairOrderInput,
): Promise<{ id: string; number: number }> {
  const number = await nextNumber(client, input.shopId, "ro");
  const actor = input.actor ?? (input.staffId ? "person" : "zol");

  // A ticket opened from an arrival is checked in by definition; one opened
  // from a phone call is not — the car isn't here yet.
  const checkedIn =
    Boolean(input.appointmentId) ||
    input.fuelLevel != null ||
    Boolean(input.visibleDamage) ||
    Boolean(input.checkInNotes);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO repair_orders
       (shop_id, number, customer_id, vehicle_id, technician_id, opened_by_call_id,
        complaint, mileage_in, source, priority, fuel_level, visible_damage,
        check_in_notes, checked_in_at, promised_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             CASE WHEN $14::boolean THEN now() END, $15)
     RETURNING id`,
    [
      input.shopId,
      number,
      input.customerId,
      input.vehicleId ?? null,
      input.technicianId ?? null,
      input.openedByCallId ?? null,
      input.complaint,
      input.mileageIn ?? null,
      input.source ?? "counter",
      input.priority ?? "normal",
      input.fuelLevel ?? null,
      input.visibleDamage ?? null,
      input.checkInNotes ?? null,
      checkedIn,
      input.promisedAt ?? null,
    ],
  );
  const id = rows[0].id;

  // Mileage on the ticket is also the newest reading we have for the car.
  if (input.vehicleId && input.mileageIn) {
    await client.query(
      `UPDATE vehicles SET mileage = $3
        WHERE id = $1 AND shop_id = $2
          AND (mileage IS NULL OR mileage < $3)`,
      [input.vehicleId, input.shopId, input.mileageIn],
    );
  }

  if (input.appointmentId) {
    await client.query(
      `UPDATE appointments
          SET repair_order_id = $1,
              status = 'arrived',
              checked_in_at = coalesce(checked_in_at, now()),
              technician_id = coalesce(technician_id, $4)
        WHERE id = $2 AND shop_id = $3`,
      [id, input.appointmentId, input.shopId, input.technicianId ?? null],
    );
  }

  await logRoEvent(client, {
    shopId: input.shopId,
    repairOrderId: id,
    kind: "opened",
    detail: `Ticket #${number} opened${input.source && input.source !== "counter" ? ` from ${input.source === "agent" ? "a call ZOL took" : input.source}` : ""}.`,
    toStatus: "open",
    actor,
    staffId: input.staffId ?? null,
  });

  if (checkedIn) {
    await logRoEvent(client, {
      shopId: input.shopId,
      repairOrderId: id,
      kind: "checked_in",
      detail: [
        input.mileageIn ? `${input.mileageIn.toLocaleString("en-US")} mi` : null,
        input.fuelLevel != null ? `fuel ${input.fuelLevel}%` : null,
        input.visibleDamage ? `damage noted` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Vehicle checked in.",
      actor,
      staffId: input.staffId ?? null,
    });
  }

  return { id, number };
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

export interface StatusChange {
  from: RoStatus;
  to: RoStatus;
  changed: boolean;
}

/**
 * Move a ticket. Records where it came from, keeps `closed_at` and
 * `completed_at` honest, and writes the history row — or does nothing at all
 * if the ticket is already there, so a double-click doesn't produce two
 * identical timeline entries.
 */
export async function setRepairOrderStatus(
  client: Queryable,
  change: {
    shopId: string;
    repairOrderId: string;
    status: RoStatus;
    staffId?: string | null;
    actor?: "zol" | "person";
    detail?: string | null;
  },
): Promise<StatusChange | null> {
  const { rows } = await client.query<{ from_status: RoStatus }>(
    `WITH before AS (
       SELECT status FROM repair_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE
     )
     UPDATE repair_orders ro
        SET status = $3,
            closed_at = CASE
              WHEN $3 IN ('closed', 'cancelled') THEN coalesce(ro.closed_at, now())
              ELSE NULL
            END,
            completed_at = CASE
              WHEN $3 IN ('ready', 'closed') THEN coalesce(ro.completed_at, now())
              WHEN $3 = 'cancelled' THEN ro.completed_at
              ELSE NULL
            END
       FROM before
      WHERE ro.id = $1 AND ro.shop_id = $2
      RETURNING before.status AS from_status`,
    [change.repairOrderId, change.shopId, change.status],
  );

  const row = rows[0];
  if (!row) return null;

  const changed = row.from_status !== change.status;
  if (changed) {
    await logRoEvent(client, {
      shopId: change.shopId,
      repairOrderId: change.repairOrderId,
      kind: change.status === "closed" ? "closed" : "status_changed",
      detail:
        change.detail ??
        `${RO_STATUS_LABEL[row.from_status] ?? row.from_status} → ${RO_STATUS_LABEL[change.status]}`,
      fromStatus: row.from_status,
      toStatus: change.status,
      actor: change.actor ?? (change.staffId ? "person" : "zol"),
      staffId: change.staffId ?? null,
    });
  }

  return { from: row.from_status, to: change.status, changed };
}

/**
 * Which stop on the customer's journey a status move announces. Only the
 * moves the customer would want to hear about; the estimate path sends its
 * own message when the estimate goes out, and payment sends the receipt.
 */
const JOURNEY_FOR_STATUS: Partial<Record<RoStatus, FollowUpKind>> = {
  in_progress: "in_progress",
  awaiting_parts: "part_ordered",
  ready: "ready_for_pickup",
};

/**
 * The status change every button should call.
 *
 * `setRepairOrderStatus` moves the ticket and writes the history row;
 * this wraps it with what the shop expects to happen *because* the ticket
 * moved — the customer told their car is on the lift, or ready, and the
 * counter told a car is ready to be called about. One place, so the board,
 * the ticket page and the technician board can't drift apart on what a
 * status means.
 *
 * `origin` is the public origin for the portal link in a "ready" message
 * (see lib/request-origin.ts). A customer who texted STOP gets no message,
 * and nothing here fails the status change if a message can't be queued.
 */
export async function transitionRepairOrder(
  client: Queryable,
  change: {
    shopId: string;
    repairOrderId: string;
    status: RoStatus;
    staffId?: string | null;
    actor?: "zol" | "person";
    detail?: string | null;
    origin: string;
  },
): Promise<StatusChange | null> {
  const result = await setRepairOrderStatus(client, change);
  if (!result?.changed) return result;

  const { rows } = await client.query<{
    number: number;
    total_cents: number;
    customer_id: string;
    vehicle_id: string | null;
    full_name: string | null;
    phone: string;
    sms_opted_out: boolean;
    vehicle: string | null;
    shop_name: string;
    public_phone: string | null;
    tax_rate_pct: string;
  }>(
    `SELECT ro.number, ro.total_cents, ro.customer_id, ro.vehicle_id,
            c.full_name, c.phone, c.sms_opted_out,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            s.name AS shop_name, s.public_phone, s.tax_rate_pct
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.id = $1 AND ro.shop_id = $2`,
    [change.repairOrderId, change.shopId],
  );
  const ro = rows[0];
  if (!ro) return result;

  /*
    "On the lift" is news the first time. Coming back to it from quality
    check, or from ready, is the shop's business and not the customer's, so
    that message only goes when the ticket arrives from earlier in the line.
  */
  const announces =
    change.status !== "in_progress" ||
    ["open", "diagnosing", "awaiting_approval", "awaiting_parts"].includes(result.from);
  const kind = announces ? JOURNEY_FOR_STATUS[change.status] : undefined;
  if (kind && !ro.sms_opted_out) {
    const portalUrl =
      kind === "ready_for_pickup"
        ? change.origin +
          portalPath(
            await mintPortalToken(client, {
              shopId: change.shopId,
              customerId: ro.customer_id,
              repairOrderId: change.repairOrderId,
            }),
          )
        : null;

    /*
      The figure in the "ready" text has to be the figure on the invoice.
      The ticket's total_cents still counts pending lines — until the
      customer answers, the total is the quote — but an invoice bills the
      approved ones only, so quoting the ticket here texts one number and
      then asks them to pay another. The invoice when there is one; the
      approved lines it would be built from when there isn't; no number at
      all when nothing has been approved.
    */
    const totalCents =
      kind === "ready_for_pickup"
        ? await amountOwed(client, change.shopId, change.repairOrderId, ro.tax_rate_pct)
        : null;

    const message = journeyMessage(kind, {
      shopName: ro.shop_name,
      shopPhone: ro.public_phone,
      firstName: ro.full_name?.split(" ")[0] ?? null,
      vehicle: ro.vehicle,
      roNumber: ro.number,
      portalUrl,
      totalCents,
    });

    await queueFollowUp(client, {
      shopId: change.shopId,
      customerId: ro.customer_id,
      repairOrderId: change.repairOrderId,
      vehicleId: ro.vehicle_id,
      kind,
      title: message.title,
      body: message.body,
      source: change.actor ?? (change.staffId ? "person" : "zol"),
    });
  }

  if (change.status === "ready") {
    await notifyShop(client, change.shopId, {
      kind: "repair",
      title: `#${ro.number} is ready for pickup`,
      body: `${ro.full_name ?? "Customer"} · ${ro.vehicle ?? "vehicle"}${ro.sms_opted_out ? " — texts stopped, call them" : " — customer notified"}`,
      href: `/app/repair-orders/${change.repairOrderId}`,
    });
  }

  return result;
}

/**
 * What the customer will actually be asked to pay on a ticket: the invoice's
 * total when one stands, otherwise the approved lines an invoice would be
 * frozen from, otherwise nothing — null, not zero, so a message can leave the
 * figure out rather than quote $0.00.
 */
async function amountOwed(
  client: Queryable,
  shopId: string,
  repairOrderId: string,
  taxRatePct: string,
): Promise<number | null> {
  const { rows: invoices } = await client.query<{ total_cents: number }>(
    `SELECT total_cents FROM invoices
      WHERE repair_order_id = $1 AND shop_id = $2 AND status <> 'void'`,
    [repairOrderId, shopId],
  );
  if (invoices[0]) return invoices[0].total_cents;

  const { rows: lines } = await client.query<{ kind: string; total_cents: number }>(
    `SELECT kind, total_cents FROM repair_order_lines
      WHERE repair_order_id = $1 AND approval = 'approved'`,
    [repairOrderId],
  );
  return lines.length > 0 ? totalsFor(lines, taxRatePct).totalCents : null;
}

// -----------------------------------------------------------------------------
// Assignment
// -----------------------------------------------------------------------------

/**
 * Hand a ticket to a technician, or take it off them (`technicianId` null).
 * The tech has to be this shop's — a uuid from a form could be anyone's.
 */
export async function assignTechnician(
  client: Queryable,
  input: {
    shopId: string;
    repairOrderId: string;
    technicianId: string | null;
    staffId?: string | null;
    actor?: "zol" | "person";
  },
): Promise<{ technicianName: string | null } | null> {
  let technicianName: string | null = null;

  if (input.technicianId) {
    const { rows } = await client.query<{ full_name: string }>(
      `SELECT full_name FROM staff
        WHERE id = $1 AND shop_id = $2 AND disabled_at IS NULL`,
      [input.technicianId, input.shopId],
    );
    if (!rows[0]) return null;
    technicianName = rows[0].full_name;
  }

  const { rowCount } = await client.query(
    `UPDATE repair_orders SET technician_id = $3
      WHERE id = $1 AND shop_id = $2`,
    [input.repairOrderId, input.shopId, input.technicianId],
  );
  if (!rowCount) return null;

  await logRoEvent(client, {
    shopId: input.shopId,
    repairOrderId: input.repairOrderId,
    kind: "assigned",
    detail: technicianName ? `Assigned to ${technicianName}.` : "Unassigned.",
    actor: input.actor ?? (input.staffId ? "person" : "zol"),
    staffId: input.staffId ?? null,
  });

  return { technicianName };
}
