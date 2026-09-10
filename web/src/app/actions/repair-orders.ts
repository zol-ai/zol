"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { applyEstimateDecisions } from "@/lib/estimates";
import { logRoEvent } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { formatCents, parseCents, parseQuantity } from "@/lib/money";
import {
  assignTechnician,
  openRepairOrder,
  transitionRepairOrder,
} from "@/lib/repair-orders-db";
import { requestOrigin } from "@/lib/request-origin";
import { recalculateOne } from "@/lib/ro-totals";
import { zonedToUtc } from "@/lib/schedule";
import {
  isRoStatus,
  LINE_KIND_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  RO_STATUS_LABEL,
  type LineKind,
  type Priority,
  type RoStatus,
} from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * Repair orders — the ticket.
 *
 * Money is integer cents throughout and the stored total is derived, never
 * typed: every write that can change a line recomputes `total_cents` from the
 * lines in the same transaction. A total that drifts from the lines under it
 * is the one bug in this file a shop would never forgive, because it's the
 * number they read out loud.
 *
 * Every state change goes through lib/repair-orders-db.ts and lands on the
 * ticket's history. Status moves use `transitionRepairOrder` so the customer
 * hears about the ones they should — the same call the board and the
 * technician screen make, so no two buttons can disagree about what a status
 * means.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function ticketPath(id: string, anchor?: string): string {
  return `/app/repair-orders/${id}${anchor ? `#${anchor}` : ""}`;
}

function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

// -----------------------------------------------------------------------------
// Open a ticket
// -----------------------------------------------------------------------------

export async function createRepairOrder(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerId = text(form, "customer_id");
  const vehicleId = text(form, "vehicle_id");
  const complaint = text(form, "complaint");
  const mileage = text(form, "mileage").replace(/[,\s]/g, "");
  const technicianId = text(form, "technician_id");
  const priority = text(form, "priority") || "normal";

  const values = {
    customer_id: customerId,
    vehicle_id: vehicleId,
    complaint,
    mileage,
    technician_id: technicianId,
    priority,
  };
  const fields: Record<string, string> = {};

  if (!customerId) fields.customer_id = "Which customer?";
  if (complaint.length < 3) {
    fields.complaint = "What did they say was wrong? Their words are fine.";
  }
  if (mileage && !/^\d{1,7}$/.test(mileage)) fields.mileage = "Numbers only.";
  if (!isPriority(priority)) fields.priority = "Pick a priority.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const belongs = await query<{ id: string }>(
    "SELECT id FROM customers WHERE id = $1 AND shop_id = $2",
    [customerId, user.shopId],
  );
  if (belongs.length === 0) redirect("/app/customers");

  // The vehicle and the technician come from selects, but a select is still
  // a form: confirm both are this shop's before writing them onto a ticket.
  if (vehicleId) {
    const vehicle = await query<{ id: string }>(
      "SELECT id FROM vehicles WHERE id = $1 AND shop_id = $2 AND customer_id = $3",
      [vehicleId, user.shopId, customerId],
    );
    if (vehicle.length === 0) return { fields: { vehicle_id: "Not one of their vehicles." }, values };
  }
  if (technicianId) {
    const tech = await query<{ id: string }>(
      "SELECT id FROM staff WHERE id = $1 AND shop_id = $2 AND disabled_at IS NULL",
      [technicianId, user.shopId],
    );
    if (tech.length === 0) return { fields: { technician_id: "Not on the team." }, values };
  }

  const opened = await tx((client) =>
    openRepairOrder(client, {
      shopId: user.shopId,
      customerId,
      vehicleId: vehicleId || null,
      complaint,
      mileageIn: mileage ? Number(mileage) : null,
      technicianId: technicianId || null,
      priority: priority as Priority,
      source: "counter",
      staffId: user.staffId,
      actor: "person",
    }),
  );

  revalidatePath("/app/repair-orders");
  redirect(ticketPath(opened.id));
}

// -----------------------------------------------------------------------------
// The three C's and mileage
// -----------------------------------------------------------------------------

/**
 * Complaint, cause, correction, mileage. Status is deliberately not here any
 * more — it moves through `setRepairOrderStatus` below, which is the only
 * path that tells the customer and writes the history row.
 */
export async function saveRepairOrder(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const id = text(form, "id");
  const complaint = text(form, "complaint");
  const cause = text(form, "cause");
  const correction = text(form, "correction");
  const mileage = text(form, "mileage").replace(/[,\s]/g, "");

  const fields: Record<string, string> = {};
  if (mileage && !/^\d{1,7}$/.test(mileage)) fields.mileage = "Numbers only.";
  if (Object.keys(fields).length > 0) return { fields };

  await tx(async (client) => {
    const { rows } = await client.query<{ vehicle_id: string | null }>(
      `UPDATE repair_orders
          SET complaint = $3, cause = $4, correction = $5, mileage_in = $6
        WHERE id = $1 AND shop_id = $2
        RETURNING vehicle_id`,
      [id, user.shopId, complaint || null, cause || null, correction || null, mileage || null],
    );

    // Mileage on the ticket is also the newest reading we have for the car.
    const vehicleId = rows[0]?.vehicle_id;
    if (vehicleId && mileage) {
      await client.query(
        `UPDATE vehicles SET mileage = $3
          WHERE id = $1 AND shop_id = $2
            AND (mileage IS NULL OR mileage < $3)`,
        [vehicleId, user.shopId, Number(mileage)],
      );
    }
  });

  revalidatePath(ticketPath(id));
  redirect(`${ticketPath(id)}?saved=1`);
}

// -----------------------------------------------------------------------------
// Status, technician, priority, promised time
// -----------------------------------------------------------------------------

/**
 * Move the ticket. One button, one call: `transitionRepairOrder` moves it,
 * writes the history row, queues the customer's message for the stops they
 * hear about, and tells the counter when a car is ready.
 */
export async function setRepairOrderStatus(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const status = text(form, "status");

  if (!isRoStatus(status)) redirect(ticketPath(id));

  const origin = await requestOrigin();
  await tx((client) =>
    transitionRepairOrder(client, {
      shopId: user.shopId,
      repairOrderId: id,
      status: status as RoStatus,
      staffId: user.staffId,
      actor: "person",
      origin,
    }),
  );

  revalidatePath("/app/repair-orders");
  revalidatePath(ticketPath(id));
  redirect(ticketPath(id));
}

/**
 * Who has it, how urgent it is, when it was promised. One form, saved as a
 * whole, so the phone in the bay can change the technician with a single tap
 * — but only what actually changed is written and logged, so re-saving the
 * same three values leaves the history alone. The promised time is the one
 * field written only when the Save button itself was pressed: the selects
 * save themselves, and must not carry the date box along with them.
 */
export async function saveAssignment(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const id = text(form, "id");
  const technicianId = text(form, "technician_id");
  const priority = text(form, "priority");
  const promised = text(form, "promised_at");
  // The selects submit this same form the moment they change, and the date
  // box comes with them — cleared, half-typed, or finished but not yet
  // meant. Only the Save button carries the intent flag, so only a press of
  // it can write or clear the promised time; a technician change never can.
  const savePromised = text(form, "intent") === "promised";

  const values = { technician_id: technicianId, priority, promised_at: promised };
  const fields: Record<string, string> = {};

  if (!isPriority(priority)) fields.priority = "Pick a priority.";

  // <input type="datetime-local"> yields "2026-09-10T15:30", read as wall
  // clock in the shop's zone — the one the person promising it is standing in.
  let promisedAt: Date | null = null;
  if (savePromised && promised) {
    const [date, time] = promised.split("T");
    const parsed =
      date && time && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}/.test(time)
        ? zonedToUtc(date, time.slice(0, 5), user.timezone)
        : undefined;
    if (!parsed) fields.promised_at = "Use the date and time picker.";
    else promisedAt = parsed;
  }
  if (Object.keys(fields).length > 0) return { fields, values };

  const current = await query<{
    technician_id: string | null;
    priority: Priority;
    promised_at: string | null;
  }>(
    `SELECT technician_id, priority, promised_at::text
       FROM repair_orders WHERE id = $1 AND shop_id = $2`,
    [id, user.shopId],
  );
  const before = current[0];
  if (!before) redirect("/app/repair-orders");

  const technicianChanged = (before.technician_id ?? "") !== technicianId;
  const priorityChanged = before.priority !== priority;
  const beforePromised = before.promised_at ? new Date(before.promised_at).getTime() : null;
  const promisedChanged = savePromised && (promisedAt?.getTime() ?? null) !== beforePromised;

  const result = await tx(async (client) => {
    if (technicianChanged) {
      const assigned = await assignTechnician(client, {
        shopId: user.shopId,
        repairOrderId: id,
        technicianId: technicianId || null,
        staffId: user.staffId,
        actor: "person",
      });
      if (!assigned) return { technicianRejected: true };
    }

    if (priorityChanged) {
      await client.query(
        "UPDATE repair_orders SET priority = $3 WHERE id = $1 AND shop_id = $2",
        [id, user.shopId, priority],
      );
      await logRoEvent(client, {
        shopId: user.shopId,
        repairOrderId: id,
        kind: "priority_changed",
        detail: `Priority ${PRIORITY_LABEL[before.priority]} → ${PRIORITY_LABEL[priority as Priority]}.`,
        actor: "person",
        staffId: user.staffId,
      });
    }

    if (promisedChanged) {
      await client.query(
        "UPDATE repair_orders SET promised_at = $3 WHERE id = $1 AND shop_id = $2",
        [id, user.shopId, promisedAt],
      );
      await logRoEvent(client, {
        shopId: user.shopId,
        repairOrderId: id,
        kind: "note",
        detail: promisedAt
          ? `Promised for ${formatDateTime(promisedAt, user.timezone)}.`
          : "Promised time cleared.",
        actor: "person",
        staffId: user.staffId,
      });
    }

    return { technicianRejected: false };
  });

  if (result.technicianRejected) {
    return { fields: { technician_id: "Not on the team." }, values };
  }

  revalidatePath("/app/repair-orders");
  revalidatePath(ticketPath(id));
  redirect(ticketPath(id));
}

// -----------------------------------------------------------------------------
// Lines
// -----------------------------------------------------------------------------

export async function addLine(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const repairOrderId = text(form, "repair_order_id");
  const kind = text(form, "kind");
  const description = text(form, "description");
  const rawQuantity = text(form, "quantity") || "1";
  const rawUnit = text(form, "unit");

  const values = { kind, description, quantity: rawQuantity, unit: rawUnit };
  const fields: Record<string, string> = {};

  if (!["labor", "part", "fee", "discount"].includes(kind)) {
    fields.kind = "Labour, part, fee or discount.";
  }
  if (description.length < 2) fields.description = "What is it?";

  const quantity = parseQuantity(rawQuantity);
  if (quantity === undefined) fields.quantity = "A number, up to two decimals.";

  // A labour line with no rate typed is billed at the shop's rate — the
  // number in settings, not one an advisor has to remember at the counter.
  let unit = rawUnit ? parseCents(rawUnit) : undefined;
  if (!rawUnit && kind === "labor") {
    const shop = await query<{ labor_rate_cents: number }>(
      "SELECT labor_rate_cents FROM shops WHERE id = $1",
      [user.shopId],
    );
    unit = shop[0]?.labor_rate_cents;
  }
  if (unit === undefined) fields.unit = "A dollar amount.";

  if (Object.keys(fields).length > 0) return { fields, values };

  // A discount is stored negative but typed positive: an advisor taking $50
  // off types 50, and nobody has to remember a minus sign mid-conversation.
  const signedUnit = kind === "discount" ? -Math.abs(unit!) : unit!;
  const total = Math.round(quantity! * signedUnit);

  await tx(async (client) => {
    // Confirm the ticket is this shop's before writing a line onto it.
    const owned = await client.query<{ id: string }>(
      "SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2",
      [repairOrderId, user.shopId],
    );
    if (owned.rows.length === 0) return;

    // New lines start pending: the customer approves them from the estimate,
    // or an advisor records that they said yes at the counter.
    await client.query(
      `INSERT INTO repair_order_lines
         (repair_order_id, kind, description, quantity, unit_cents,
          total_cents, quoted_by_agent, approval, position)
       VALUES ($1, $2, $3, $4, $5, $6, false, 'pending',
               coalesce((SELECT max(position) + 1 FROM repair_order_lines
                          WHERE repair_order_id = $1), 0))`,
      [repairOrderId, kind, description, quantity, signedUnit, total],
    );

    await recalculateOne(client, repairOrderId, user.shopId);
    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "line_added",
      detail: `${LINE_KIND_LABEL[kind as LineKind]} line added: ${description} — ${formatCents(total)}.`,
      actor: "person",
      staffId: user.staffId,
    });
  });

  revalidatePath(ticketPath(repairOrderId));
  redirect(ticketPath(repairOrderId, "lines"));
}

export async function removeLine(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");
  const lineId = text(form, "line_id");

  await tx(async (client) => {
    // The join to repair_orders is the tenancy check: a line id alone says
    // nothing about which shop it belongs to.
    const { rows } = await client.query<{ description: string }>(
      `DELETE FROM repair_order_lines l
        USING repair_orders ro
        WHERE l.id = $1
          AND l.repair_order_id = ro.id
          AND ro.id = $2 AND ro.shop_id = $3
        RETURNING l.description`,
      [lineId, repairOrderId, user.shopId],
    );
    if (rows.length === 0) return;

    await recalculateOne(client, repairOrderId, user.shopId);
    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "line_removed",
      detail: `Line removed: ${rows[0].description}.`,
      actor: "person",
      staffId: user.staffId,
    });
  });

  revalidatePath(ticketPath(repairOrderId));
  redirect(ticketPath(repairOrderId, "lines"));
}

/**
 * The customer's answer to one line, recorded at the counter.
 *
 * The estimate path writes the same columns when the customer answers from
 * their phone; this is for the customer who is standing here saying yes or
 * no out loud. A declined line stays on the ticket as the record of what was
 * offered, drops out of the total, and goes straight onto the recall list
 * six months out — the same interval the declined-work form defaults to,
 * because a "no" said at the counter is exactly the work that gets forgotten.
 *
 * When the last pending line is answered on a ticket that was waiting for
 * approval, the ticket moves on by itself: to waiting-on-parts if anything
 * is outstanding, otherwise on to the lift. All declined leaves it where it
 * is for a person to decide what happens next.
 *
 * If the line is on an estimate the customer can still answer, the answer is
 * recorded through the estimate instead — `applyEstimateDecisions`, the same
 * call the estimate panel's counter buttons make. The estimate is the record
 * of what was shown, and the portal, the dashboard's "still unanswered" list
 * and the panel all read it: a yes written on the ticket line alone would
 * leave the estimate open, and a later tap on the portal would write no over
 * work already under way.
 */
export async function setLineApproval(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");
  const lineId = text(form, "line_id");
  const approval = text(form, "approval");

  if (approval !== "approved" && approval !== "declined") {
    redirect(ticketPath(repairOrderId, "lines"));
  }

  const origin = await requestOrigin();

  await tx(async (client) => {
    // A live estimate — sent, opened, or part-answered — with this line still
    // unanswered on it: the answer belongs to the estimate. Only the newest
    // one counts; an older estimate on the same ticket was superseded.
    const { rows: live } = await client.query<{
      estimate_id: string;
      estimate_line_id: string;
    }>(
      `SELECT e.id AS estimate_id, el.id AS estimate_line_id
         FROM estimate_lines el
         JOIN estimates e ON e.id = el.estimate_id
        WHERE el.repair_order_line_id = $1
          AND e.repair_order_id = $2 AND e.shop_id = $3
          AND e.status IN ('sent', 'viewed', 'partial')
          AND el.approval = 'pending'
        ORDER BY e.created_at DESC
        LIMIT 1`,
      [lineId, repairOrderId, user.shopId],
    );
    if (live[0]) {
      // Mirrors the ticket line, recomputes the total, puts declined work on
      // the recall list, moves the ticket and tells the shop — one function,
      // whichever door the answer came through.
      await applyEstimateDecisions(client, {
        shopId: user.shopId,
        estimateId: live[0].estimate_id,
        decisions: { [live[0].estimate_line_id]: approval },
        actor: "person",
        staffId: user.staffId,
        origin,
      });
      return;
    }

    // `approval = 'pending'` makes a second click — a stale tab, a second
    // advisor — match nothing, so a line is answered once: one history row,
    // one recall entry, one status tally.
    const { rows } = await client.query<{
      description: string;
      total_cents: number;
      customer_id: string;
      vehicle_id: string | null;
      status: RoStatus;
    }>(
      `UPDATE repair_order_lines l
          SET approval = $4,
              approved_at = CASE WHEN $4 = 'approved' THEN now() ELSE NULL END
         FROM repair_orders ro
        WHERE l.id = $1
          AND l.repair_order_id = ro.id
          AND ro.id = $2 AND ro.shop_id = $3
          AND l.approval = 'pending'
        RETURNING l.description, l.total_cents, ro.customer_id, ro.vehicle_id, ro.status`,
      [lineId, repairOrderId, user.shopId, approval],
    );
    const line = rows[0];
    if (!line) return;

    await recalculateOne(client, repairOrderId, user.shopId);
    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "line_approval",
      detail:
        approval === "approved"
          ? `Approved at the counter: ${line.description} (${formatCents(line.total_cents)}).`
          : `Declined at the counter: ${line.description} (${formatCents(line.total_cents)}).`,
      actor: "person",
      staffId: user.staffId,
    });

    if (approval === "declined") {
      // Keyed on the ticket and the wording, exactly as the estimate path
      // is, so the two writers of the recall list share one rule and the
      // same job cannot land on it twice.
      await client.query(
        `INSERT INTO declined_work
           (shop_id, customer_id, vehicle_id, repair_order_id, description,
            estimated_cents, remind_after)
         SELECT $1, $2, $3, $4, $5, $6, now() + interval '6 months'
          WHERE NOT EXISTS (
            SELECT 1 FROM declined_work
             WHERE repair_order_id = $4 AND description = $5 AND resolved_at IS NULL)`,
        [user.shopId, line.customer_id, line.vehicle_id, repairOrderId, line.description, line.total_cents],
      );
    }

    if (line.status !== "awaiting_approval") return;

    const { rows: counts } = await client.query<{
      pending: number;
      approved: number;
      outstanding_parts: number;
    }>(
      `SELECT count(*) FILTER (WHERE l.approval = 'pending')::int AS pending,
              count(*) FILTER (WHERE l.approval = 'approved')::int AS approved,
              (SELECT count(*) FROM parts p
                WHERE p.repair_order_id = $1
                  AND p.status IN ('needed', 'requested', 'ordered'))::int AS outstanding_parts
         FROM repair_order_lines l
        WHERE l.repair_order_id = $1`,
      [repairOrderId],
    );
    const tally = counts[0];
    if (!tally || tally.pending > 0 || tally.approved === 0) return;

    await transitionRepairOrder(client, {
      shopId: user.shopId,
      repairOrderId,
      status: tally.outstanding_parts > 0 ? "awaiting_parts" : "in_progress",
      staffId: user.staffId,
      actor: "person",
      detail: `Every line answered at the counter — ${
        tally.outstanding_parts > 0 ? "waiting on parts" : "on to the lift"
      }.`,
      origin,
    });
  });

  revalidatePath("/app/repair-orders");
  revalidatePath("/app/estimates");
  revalidatePath("/app/declined");
  revalidatePath(ticketPath(repairOrderId));
  redirect(ticketPath(repairOrderId, "lines"));
}

// -----------------------------------------------------------------------------
// Approval over the cap
// -----------------------------------------------------------------------------

/**
 * A human signing off on a number above the shop's cap.
 *
 * This is the control the whole product's risk sits behind: above
 * auto_quote_cap_cents, nothing goes to a customer until somebody here says
 * so. It records who and when, because "who approved that?" is the first
 * question asked when a quote turns out wrong — and it goes on the ticket's
 * history for the same reason.
 */
export async function approveRepairOrder(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");
  const origin = await requestOrigin();

  await tx(async (client) => {
    const { rows } = await client.query<{
      status: RoStatus;
      total_cents: number;
      auto_quote_cap_cents: number;
    }>(
      `UPDATE repair_orders ro
          SET approved_at = now(), approved_by = $3
         FROM shops s
        WHERE ro.id = $1 AND ro.shop_id = $2 AND s.id = ro.shop_id
          AND ro.approved_at IS NULL
        RETURNING ro.status, ro.total_cents, s.auto_quote_cap_cents`,
      [id, user.shopId, user.staffId],
    );
    const ro = rows[0];
    if (!ro) return;

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId: id,
      kind: "approved_over_cap",
      detail: `${formatCents(ro.total_cents)} approved over the ${formatCents(ro.auto_quote_cap_cents)} cap.`,
      actor: "person",
      staffId: user.staffId,
    });

    // A ticket parked for a human's sign-off is unparked by it — but not one
    // that is waiting on the customer. Sending an estimate parks a ticket
    // under the same status, and their answer (through the estimate, or a
    // line answered at the counter) is what moves it on; the shop's own
    // sign-off on the price is not their yes, and must not text them that
    // the car is on the lift.
    if (ro.status === "awaiting_approval") {
      const { rows: gate } = await client.query<{ customer_pending: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM estimates e
                         WHERE e.repair_order_id = $1 AND e.shop_id = $2
                           AND e.status IN ('sent', 'viewed'))
             OR EXISTS (SELECT 1 FROM repair_order_lines l
                         WHERE l.repair_order_id = $1 AND l.approval = 'pending')
               AS customer_pending`,
        [id, user.shopId],
      );
      if (!gate[0]?.customer_pending) {
        await transitionRepairOrder(client, {
          shopId: user.shopId,
          repairOrderId: id,
          status: "in_progress",
          staffId: user.staffId,
          actor: "person",
          detail: `${RO_STATUS_LABEL.awaiting_approval} → ${RO_STATUS_LABEL.in_progress} — price approved.`,
          origin,
        });
      }
    }
  });

  revalidatePath("/app/repair-orders");
  revalidatePath(ticketPath(id));
  redirect(ticketPath(id));
}
