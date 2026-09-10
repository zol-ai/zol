"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { summarize } from "@/lib/ai/inspection";
import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { logRoEvent } from "@/lib/events";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import {
  countRatings,
  describeItem,
  INSPECTION_ITEMS,
  isRating,
  joinForSentence,
  overallRating,
  phraseItem,
} from "@/lib/inspections";
import { RATING_LABEL, type Rating } from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * The digital inspection.
 *
 * Start it and the thirteen items exist, all "not checked". Rate them one at
 * a time from the phone in the bay. Complete it and the summary is written —
 * from the items that were rated and nothing else — and the yellow items are
 * queued as one gentle reminder six weeks out, which is when "your pads are
 * at 4mm" becomes "shall we book them in".
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function ticketPath(id: string): string {
  return `/app/repair-orders/${id}#inspection`;
}

/** Days between finishing the inspection and raising the yellow items. */
const RECOMMENDATION_DELAY_DAYS = 45;

export async function startInspection(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");

  await tx(async (client) => {
    const { rows } = await client.query<{
      vehicle_id: string | null;
      technician_id: string | null;
      open_inspection: string | null;
    }>(
      `SELECT ro.vehicle_id, ro.technician_id,
              (SELECT i.id FROM inspections i
                WHERE i.repair_order_id = ro.id AND i.completed_at IS NULL
                LIMIT 1) AS open_inspection
         FROM repair_orders ro
        WHERE ro.id = $1 AND ro.shop_id = $2`,
      [repairOrderId, user.shopId],
    );
    const ro = rows[0];
    // One inspection at a time: a double-tap must not produce two sheets.
    if (!ro || ro.open_inspection) return;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO inspections (shop_id, repair_order_id, vehicle_id, technician_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.shopId, repairOrderId, ro.vehicle_id, ro.technician_id ?? user.staffId],
    );
    const inspectionId = inserted.rows[0].id;

    // Item names are copied in, so a later edit to the checklist never
    // rewrites a sheet that has already been signed.
    for (const [position, item] of INSPECTION_ITEMS.entries()) {
      await client.query(
        `INSERT INTO inspection_items (inspection_id, category, name, position)
         VALUES ($1, $2, $3, $4)`,
        [inspectionId, item.category, item.name, position],
      );
    }

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "inspection_started",
      detail: `Digital inspection started — ${INSPECTION_ITEMS.length} systems.`,
      actor: "person",
      staffId: user.staffId,
    });
  });

  revalidatePath("/app/inspections");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}

export async function saveInspectionItem(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const itemId = text(form, "item_id");
  const repairOrderId = text(form, "repair_order_id");
  const rating = text(form, "rating");
  const measurement = text(form, "measurement");
  const notes = text(form, "notes");

  const values = { rating, measurement, notes };
  const fields: Record<string, string> = {};

  if (!isRating(rating)) fields.rating = "Good, watch, urgent or not checked.";
  if (measurement.length > 40) fields.measurement = "Keep it short — a number and its unit.";
  if (notes.length > 500) fields.notes = "Keep it under 500 characters.";
  // A red or yellow with no words is a finding nobody can act on. Green and
  // not-checked are fine bare.
  if ((rating === "red" || rating === "yellow") && !notes && !measurement) {
    fields.notes = `What did you find? A ${RATING_LABEL[rating as Rating].toLowerCase()} needs a note or a measurement.`;
  }
  if (Object.keys(fields).length > 0) return { fields, values };

  await tx(async (client) => {
    // The join through inspections is the tenancy check; an item id alone
    // says nothing about whose car it is. A completed sheet is read-only.
    const { rows } = await client.query<{ inspection_id: string }>(
      `UPDATE inspection_items it
          SET rating = $4, measurement = $5, notes = $6
         FROM inspections i
        WHERE it.id = $1
          AND i.id = it.inspection_id
          AND i.shop_id = $2 AND i.repair_order_id = $3
          AND i.completed_at IS NULL
        RETURNING it.inspection_id`,
      [itemId, user.shopId, repairOrderId, rating, measurement || null, notes || null],
    );
    const inspectionId = rows[0]?.inspection_id;
    if (!inspectionId) return;

    // Keep the running worst on the sheet so the index shows where it stands
    // before it is finished; completion recomputes it from the final items.
    await client.query(
      `UPDATE inspections i
          SET overall = coalesce(
                (SELECT it.rating FROM inspection_items it
                  WHERE it.inspection_id = i.id AND it.rating <> 'not_inspected'
                  ORDER BY CASE it.rating WHEN 'red' THEN 3 WHEN 'yellow' THEN 2 ELSE 1 END DESC
                  LIMIT 1),
                'not_inspected')
        WHERE i.id = $1 AND i.shop_id = $2`,
      [inspectionId, user.shopId],
    );
  });

  revalidatePath("/app/inspections");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}

/**
 * Sign the sheet. Writes the overall rating, the completion time and the
 * customer-facing summary; logs it; and queues the yellow items as one
 * inspection recommendation for six weeks out. Nothing goes out for a
 * customer who has stopped texts, and nothing goes out when there is
 * nothing yellow to say.
 */
export async function completeInspection(form: FormData): Promise<void> {
  const user = await requireUser();
  const inspectionId = text(form, "inspection_id");
  const repairOrderId = text(form, "repair_order_id");

  const items = await query<{
    category: string;
    name: string;
    rating: Rating;
    notes: string | null;
    measurement: string | null;
  }>(
    `SELECT it.category, it.name, it.rating, it.notes, it.measurement
       FROM inspection_items it
       JOIN inspections i ON i.id = it.inspection_id
      WHERE it.inspection_id = $1
        AND i.shop_id = $2 AND i.repair_order_id = $3
        AND i.completed_at IS NULL
      ORDER BY it.position`,
    [inspectionId, user.shopId, repairOrderId],
  );
  if (items.length === 0) redirect(ticketPath(repairOrderId));

  // Outside the transaction: the model may take a while and must not hold a
  // connection while it thinks.
  const outcome = await summarize(items);
  const overall = overallRating(items.map((item) => item.rating));
  const counts = countRatings(items.map((item) => item.rating));

  await tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE inspections
          SET overall = $3, completed_at = now(), summary = $4, summary_source = $5
        WHERE id = $1 AND shop_id = $2 AND completed_at IS NULL
        RETURNING id`,
      [inspectionId, user.shopId, overall, JSON.stringify(outcome.summary), outcome.source],
    );
    if (rows.length === 0) return;

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "inspection_completed",
      detail:
        `Inspection completed — ${RATING_LABEL[overall].toLowerCase()} overall: ` +
        `${counts.green} good, ${counts.yellow} watch, ${counts.red} urgent` +
        (counts.not_inspected > 0 ? `, ${counts.not_inspected} not checked` : "") +
        `.${outcome.source === "fallback" ? " Summary from fallback guidance." : ""}`,
      actor: "person",
      staffId: user.staffId,
    });

    const yellow = items.filter((item) => item.rating === "yellow");
    if (yellow.length === 0) return;

    const { rows: ros } = await client.query<{
      customer_id: string;
      vehicle_id: string | null;
      number: number;
      sms_opted_out: boolean;
      full_name: string | null;
      vehicle: string | null;
      shop_name: string;
      public_phone: string | null;
    }>(
      `SELECT ro.customer_id, ro.vehicle_id, ro.number, c.sms_opted_out, c.full_name,
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
    if (!ro || ro.sms_opted_out) return;

    // "brakes (front pads at 4mm) and suspension (end links loose)" — the
    // yellow items as one phrase the customer can read on a phone.
    const phrase = joinForSentence(yellow.map(phraseItem));

    const message = journeyMessage("inspection_recommendation", {
      shopName: ro.shop_name,
      shopPhone: ro.public_phone,
      firstName: ro.full_name?.split(" ")[0] ?? null,
      vehicle: ro.vehicle,
      roNumber: ro.number,
      work: phrase,
    });

    await queueFollowUp(client, {
      shopId: user.shopId,
      customerId: ro.customer_id,
      repairOrderId,
      vehicleId: ro.vehicle_id,
      kind: "inspection_recommendation",
      title: message.title,
      body: message.body,
      details: yellow.map(describeItem).join("\n"),
      scheduledFor: new Date(Date.now() + RECOMMENDATION_DELAY_DAYS * 86_400_000),
      source: "zol",
    });
  });

  revalidatePath("/app/inspections");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}
