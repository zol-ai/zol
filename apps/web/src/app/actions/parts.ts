"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { logRoEvent } from "@/lib/events";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import { formatCents, parseCents } from "@/lib/money";
import { setRepairOrderStatus, transitionRepairOrder } from "@/lib/repair-orders-db";
import { requestOrigin } from "@/lib/request-origin";
import { zonedToUtc } from "@/lib/schedule";
import {
  PART_STATUS_LABEL,
  PART_STATUSES,
  type PartStatus,
  type RoStatus,
} from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * Parts — the things with a supplier and an ETA that can hold a bay hostage.
 *
 * A part is not a line. The line is the money; the part is the physical
 * thing, and it moves needed → requested → ordered → received → installed
 * (or back out as returned). The ticket follows it: ordering the parts for a
 * job on the lift parks the ticket as waiting-on-parts and tells the
 * customer; the last part arriving puts it back on the lift and tells them
 * again. Both of those are here, once, so the panel and the parts index
 * cannot disagree about what "received" means.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function ticketPath(id: string): string {
  return `/app/repair-orders/${id}#parts`;
}

function isPartStatus(value: string): value is PartStatus {
  return (PART_STATUSES as readonly string[]).includes(value);
}

export async function addPart(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const repairOrderId = text(form, "repair_order_id");
  const name = text(form, "name");
  const partNumber = text(form, "part_number");
  const supplier = text(form, "supplier");
  const rawQuantity = text(form, "quantity") || "1";
  const rawCost = text(form, "unit_cost");
  const rawPrice = text(form, "unit_price");
  const lineId = text(form, "line_id");
  const expected = text(form, "expected_at");
  const notes = text(form, "notes");

  const values = {
    name,
    part_number: partNumber,
    supplier,
    quantity: rawQuantity,
    unit_cost: rawCost,
    unit_price: rawPrice,
    line_id: lineId,
    expected_at: expected,
    notes,
  };
  const fields: Record<string, string> = {};

  if (name.length < 2) fields.name = "What is the part?";
  if (name.length > 200) fields.name = "Keep it under 200 characters.";
  if (partNumber.length > 80) fields.part_number = "Too long for a part number.";
  if (supplier.length > 120) fields.supplier = "Too long.";
  if (notes.length > 1000) fields.notes = "Keep it under 1,000 characters.";

  const quantity = Number(rawQuantity);
  if (!/^\d{1,4}$/.test(rawQuantity) || quantity < 1) fields.quantity = "A whole number, at least 1.";

  const cost = rawCost ? parseCents(rawCost) : 0;
  if (cost === undefined || cost < 0) fields.unit_cost = "A dollar amount.";

  let price = rawPrice ? parseCents(rawPrice) : undefined;
  if (rawPrice && (price === undefined || price < 0)) fields.unit_price = "A dollar amount.";

  // "2026-09-11T09:00" from the picker, read as wall clock in the shop's zone.
  let expectedAt: Date | null = null;
  if (expected) {
    const [date, time] = expected.split("T");
    const parsed =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? zonedToUtc(date, time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "09:00", user.timezone)
        : undefined;
    if (!parsed) fields.expected_at = "Use the date picker.";
    else expectedAt = parsed;
  }
  if (Object.keys(fields).length > 0) return { fields, values };

  const rows = await query<{ parts_margin_pct: string }>(
    `SELECT s.parts_margin_pct
       FROM repair_orders ro JOIN shops s ON s.id = ro.shop_id
      WHERE ro.id = $1 AND ro.shop_id = $2`,
    [repairOrderId, user.shopId],
  );
  if (rows.length === 0) redirect("/app/repair-orders");

  // No price typed means the shop's margin over cost — the number in
  // settings, applied the same way every time, never a guess.
  if (price === undefined) {
    price = Math.round((cost ?? 0) * (1 + Number(rows[0].parts_margin_pct) / 100));
  }

  // The line it fulfils has to be a part line on this same ticket.
  if (lineId) {
    const line = await query<{ id: string }>(
      `SELECT id FROM repair_order_lines
        WHERE id = $1 AND repair_order_id = $2 AND kind = 'part'`,
      [lineId, repairOrderId],
    );
    if (line.length === 0) return { fields: { line_id: "Not a part line on this ticket." }, values };
  }

  await tx(async (client) => {
    await client.query(
      `INSERT INTO parts
         (shop_id, repair_order_id, repair_order_line_id, name, part_number, supplier,
          quantity, unit_cost_cents, unit_price_cents, expected_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        user.shopId,
        repairOrderId,
        lineId || null,
        name,
        partNumber || null,
        supplier || null,
        quantity,
        cost,
        price,
        expectedAt,
        notes || null,
      ],
    );

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "part_added",
      detail:
        `Part needed: ${quantity > 1 ? `${quantity} × ` : ""}${name}` +
        (supplier ? ` from ${supplier}` : "") +
        ` — ${formatCents(price! * quantity)}.`,
      actor: "person",
      staffId: user.staffId,
    });
  });

  revalidatePath("/app/parts");
  revalidatePath("/app/repair-orders");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}

/**
 * Move a part along, and move the ticket with it.
 *
 *   ordered  — a ticket on the lift, or one waiting for approval that already
 *              has approved work, becomes waiting-on-parts. That transition
 *              is what tells the customer their parts are on order.
 *   received — when nothing else is outstanding, the customer hears the parts
 *              are in, and a waiting-on-parts ticket goes back on the lift.
 *              That second move uses the low-level status call on purpose:
 *              the arrival message *is* the customer's update, and the
 *              journey's "on the lift" text on top of it would be two texts
 *              five minutes apart saying the same thing.
 *   returned — when it was the last thing outstanding on a waiting-on-parts
 *              ticket, the ticket goes back on the lift too, but through the
 *              full transition: nothing arrived, so there is no arrival
 *              message, and the journey's "on the lift" text is the
 *              customer's word. Whether to re-order is now the shop's call,
 *              and the history row says so.
 */
export async function setPartStatus(form: FormData): Promise<void> {
  const user = await requireUser();
  const partId = text(form, "part_id");
  const repairOrderId = text(form, "repair_order_id");
  const status = text(form, "status");

  if (!isPartStatus(status)) redirect(ticketPath(repairOrderId));

  const origin = await requestOrigin();

  await tx(async (client) => {
    const { rows } = await client.query<{
      name: string;
      from_status: PartStatus;
    }>(
      `WITH before AS (
         SELECT status FROM parts WHERE id = $1 AND shop_id = $2 AND repair_order_id = $3 FOR UPDATE
       )
       UPDATE parts p
          SET status = $4,
              ordered_at   = CASE WHEN $4 = 'ordered'   THEN coalesce(p.ordered_at, now())   ELSE p.ordered_at END,
              received_at  = CASE WHEN $4 = 'received'  THEN coalesce(p.received_at, now())  ELSE p.received_at END,
              installed_at = CASE WHEN $4 = 'installed' THEN coalesce(p.installed_at, now()) ELSE p.installed_at END
         FROM before
        WHERE p.id = $1 AND p.shop_id = $2 AND p.repair_order_id = $3
        RETURNING p.name, before.status AS from_status`,
      [partId, user.shopId, repairOrderId, status],
    );
    const part = rows[0];
    if (!part || part.from_status === status) return;

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "part_updated",
      detail: `${part.name}: ${PART_STATUS_LABEL[part.from_status]} → ${PART_STATUS_LABEL[status as PartStatus]}.`,
      actor: "person",
      staffId: user.staffId,
    });

    const { rows: ros } = await client.query<{
      status: RoStatus;
      number: number;
      customer_id: string;
      vehicle_id: string | null;
      approved_lines: number;
      outstanding: number;
      sms_opted_out: boolean;
      full_name: string | null;
      vehicle: string | null;
      shop_name: string;
      public_phone: string | null;
    }>(
      `SELECT ro.status, ro.number, ro.customer_id, ro.vehicle_id,
              (SELECT count(*) FROM repair_order_lines l
                WHERE l.repair_order_id = ro.id AND l.approval = 'approved')::int AS approved_lines,
              (SELECT count(*) FROM parts p
                WHERE p.repair_order_id = ro.id
                  AND p.status IN ('needed', 'requested', 'ordered'))::int AS outstanding,
              c.sms_opted_out, c.full_name,
              nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
              s.name AS shop_name, s.public_phone
         FROM repair_orders ro
         JOIN customers c ON c.id = ro.customer_id
         JOIN shops s ON s.id = ro.shop_id
         LEFT JOIN vehicles v ON v.id = ro.vehicle_id
        WHERE ro.id = $1 AND ro.shop_id = $2`,
      [repairOrderId, user.shopId],
    );
    const ro = ros[0];
    if (!ro) return;

    if (status === "ordered") {
      const parkable =
        ro.status === "in_progress" ||
        (ro.status === "awaiting_approval" && ro.approved_lines > 0);
      if (parkable) {
        await transitionRepairOrder(client, {
          shopId: user.shopId,
          repairOrderId,
          status: "awaiting_parts",
          staffId: user.staffId,
          actor: "person",
          detail: `Parts ordered — ${part.name}. Waiting on parts.`,
          origin,
        });
      }
      return;
    }

    if (ro.outstanding !== 0) return;

    if (status === "received") {
      if (!ro.sms_opted_out) {
        const message = journeyMessage("parts_received", {
          shopName: ro.shop_name,
          shopPhone: ro.public_phone,
          firstName: ro.full_name?.split(" ")[0] ?? null,
          vehicle: ro.vehicle,
          roNumber: ro.number,
        });
        await queueFollowUp(client, {
          shopId: user.shopId,
          customerId: ro.customer_id,
          repairOrderId,
          vehicleId: ro.vehicle_id,
          kind: "parts_received",
          title: message.title,
          body: message.body,
          source: "person",
        });
      }

      if (ro.status === "awaiting_parts") {
        await setRepairOrderStatus(client, {
          shopId: user.shopId,
          repairOrderId,
          status: "in_progress",
          staffId: user.staffId,
          actor: "person",
          detail: "All parts in — back on the lift.",
        });
      }
      return;
    }

    // The last outstanding part came back instead of in. Nothing is on order
    // any more, but nothing arrived either — and left alone the ticket sits in
    // waiting-on-parts for good: exempt from the stale flag, counted on the
    // dashboard, and the customer who was told "we'll let you know the moment
    // they arrive" hears nothing. Unpark it; re-ordering parks it again.
    if (status === "returned" && ro.status === "awaiting_parts") {
      await transitionRepairOrder(client, {
        shopId: user.shopId,
        repairOrderId,
        status: "in_progress",
        staffId: user.staffId,
        actor: "person",
        detail: `${part.name} returned — nothing else on order. Back on the lift; decide whether to re-order.`,
        origin,
      });
    }
  });

  revalidatePath("/app/parts");
  revalidatePath("/app/repair-orders");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}
