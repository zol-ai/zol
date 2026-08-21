"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { parseCents, parseQuantity } from "@/lib/money";
import type { FormState } from "./auth";
import { STATUSES, type Status } from "@/lib/repair-orders";
import { recalculateOne } from "@/lib/ro-totals";

/**
 * Repair orders — the ticket.
 *
 * Money is integer cents throughout and the stored total is derived, never
 * typed: every write that can change a line recomputes `total_cents` from the
 * lines in the same transaction. A total that drifts from the lines under it
 * is the one bug in this file a shop would never forgive, because it's the
 * number they read out loud.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
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

  const values = { customer_id: customerId, vehicle_id: vehicleId, complaint, mileage };
  const fields: Record<string, string> = {};

  if (!customerId) fields.customer_id = "Which customer?";
  if (complaint.length < 3) {
    fields.complaint = "What did they say was wrong? Their words are fine.";
  }
  if (mileage && !/^\d{1,7}$/.test(mileage)) fields.mileage = "Numbers only.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const belongs = await query<{ id: string }>(
    "SELECT id FROM customers WHERE id = $1 AND shop_id = $2",
    [customerId, user.shopId],
  );
  if (belongs.length === 0) redirect("/app/customers");

  const id = await tx(async (client) => {
    // Row lock on the shop: the second advisor opening a ticket at the same
    // instant waits here and gets the next number, instead of both reading
    // the same max and one insert dying on the unique index.
    const seq = await client.query<{ ro_number_seq: number }>(
      `UPDATE shops SET ro_number_seq = ro_number_seq + 1
        WHERE id = $1 RETURNING ro_number_seq`,
      [user.shopId],
    );

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO repair_orders
         (shop_id, number, customer_id, vehicle_id, complaint, mileage_in)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        user.shopId,
        seq.rows[0].ro_number_seq,
        customerId,
        vehicleId || null,
        complaint,
        mileage || null,
      ],
    );

    // Mileage on the ticket is also the newest reading we have for the car.
    if (vehicleId && mileage) {
      await client.query(
        `UPDATE vehicles SET mileage = $3
          WHERE id = $1 AND shop_id = $2
            AND (mileage IS NULL OR mileage < $3)`,
        [vehicleId, user.shopId, Number(mileage)],
      );
    }

    return inserted.rows[0].id;
  });

  revalidatePath("/app/repair-orders");
  redirect(`/app/repair-orders/${id}`);
}

// -----------------------------------------------------------------------------
// The three C's, mileage, status
// -----------------------------------------------------------------------------

export async function saveRepairOrder(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const id = text(form, "id");
  const complaint = text(form, "complaint");
  const cause = text(form, "cause");
  const correction = text(form, "correction");
  const status = text(form, "status") as Status;
  const mileage = text(form, "mileage").replace(/[,\s]/g, "");

  const fields: Record<string, string> = {};
  if (!STATUSES.includes(status)) fields.status = "Not a status.";
  if (mileage && !/^\d{1,7}$/.test(mileage)) fields.mileage = "Numbers only.";
  if (Object.keys(fields).length > 0) return { fields };

  await query(
    `UPDATE repair_orders
        SET complaint = $3, cause = $4, correction = $5,
            status = $6, mileage_in = $7,
            closed_at = CASE
              WHEN $6 IN ('closed', 'cancelled') THEN coalesce(closed_at, now())
              ELSE NULL
            END
      WHERE id = $1 AND shop_id = $2`,
    [
      id,
      user.shopId,
      complaint || null,
      cause || null,
      correction || null,
      status,
      mileage || null,
    ],
  );

  revalidatePath(`/app/repair-orders/${id}`);
  redirect(`/app/repair-orders/${id}?saved=1`);
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

  const unit = parseCents(rawUnit);
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

    await client.query(
      `INSERT INTO repair_order_lines
         (repair_order_id, kind, description, quantity, unit_cents,
          total_cents, quoted_by_agent, position)
       VALUES ($1, $2, $3, $4, $5, $6, false,
               coalesce((SELECT max(position) + 1 FROM repair_order_lines
                          WHERE repair_order_id = $1), 0))`,
      [repairOrderId, kind, description, quantity, signedUnit, total],
    );

    await recalculateOne(client, repairOrderId, user.shopId);
  });

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(`/app/repair-orders/${repairOrderId}`);
}

export async function removeLine(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");
  const lineId = text(form, "line_id");

  await tx(async (client) => {
    // The join to repair_orders is the tenancy check: a line id alone says
    // nothing about which shop it belongs to.
    await client.query(
      `DELETE FROM repair_order_lines l
        USING repair_orders ro
        WHERE l.id = $1
          AND l.repair_order_id = ro.id
          AND ro.id = $2 AND ro.shop_id = $3`,
      [lineId, repairOrderId, user.shopId],
    );
    await recalculateOne(client, repairOrderId, user.shopId);
  });

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(`/app/repair-orders/${repairOrderId}`);
}

// -----------------------------------------------------------------------------
// Approval
// -----------------------------------------------------------------------------

/**
 * A human signing off on a number above the shop's cap.
 *
 * This is the control the whole product's risk sits behind: above
 * auto_quote_cap_cents, nothing goes to a customer until somebody here says
 * so. It records who and when, because "who approved that?" is the first
 * question asked when a quote turns out wrong.
 */
export async function approveRepairOrder(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = text(form, "id");

  await query(
    `UPDATE repair_orders
        SET approved_at = now(), approved_by = $3,
            status = CASE WHEN status = 'awaiting_approval'
                          THEN 'in_progress' ELSE status END
      WHERE id = $1 AND shop_id = $2 AND approved_at IS NULL`,
    [id, user.shopId, user.staffId],
  );

  revalidatePath(`/app/repair-orders/${id}`);
  redirect(`/app/repair-orders/${id}`);
}
