"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireRole, requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { assignTechnician, transitionRepairOrder } from "@/lib/repair-orders-db";
import { requestOrigin } from "@/lib/request-origin";
import { isRoStatus, type RoStatus } from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * The technician board's buttons, and the profile behind each column.
 *
 * A status move from the board is the same move as from the ticket page:
 * `transitionRepairOrder` moves it, logs it, and tells the customer when
 * the stop is one they'd want to hear about. Nothing here writes status
 * directly — a board that could drift from the ticket page on what "ready"
 * means is a board nobody trusts.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function returnTo(form: FormData, fallback: string): string {
  const raw = text(form, "return_to");
  return /^\/app(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9=&_\-]*)?$/.test(raw) ? raw : fallback;
}

// -----------------------------------------------------------------------------
// Profile — specialties and a phone, owner-only
// -----------------------------------------------------------------------------

export async function saveTechnicianProfile(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireRole("owner");

  const staffId = text(form, "staff_id");
  // Field names carry the staff id: several of these forms sit on one page
  // (one per column on the board) and the Field primitive uses the name as
  // the input's id, which has to be unique for the labels to work.
  const rawSpecialties = text(form, `specialties-${staffId}`);
  const rawPhone = text(form, `phone-${staffId}`);
  const back = returnTo(form, "/app/team");

  const values = { specialties: rawSpecialties, phone: rawPhone };
  const fields: Record<string, string> = {};

  // Free text, comma separated, deduplicated case-insensitively. The
  // receptionist matches these against a complaint when it picks a tech, so
  // "brakes" and "Brakes" must be one specialty, not two.
  const seen = new Set<string>();
  const specialties: string[] = [];
  for (const raw of rawSpecialties.split(/[,\n;]/)) {
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item) continue;
    if (item.length > 40) {
      fields.specialties = "Keep each one short — 'Diagnostics', 'Brakes', 'Electrical'.";
      break;
    }
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    specialties.push(item);
  }
  if (specialties.length > 12) fields.specialties = "Twelve is plenty.";

  const phone = rawPhone ? toE164(rawPhone) : null;
  if (rawPhone && !phone) fields.phone = "Ten digits, or + and a country code.";

  if (Object.keys(fields).length > 0) return { fields, values };

  const updated = await query<{ id: string }>(
    `UPDATE staff SET specialties = $3, phone = $4
      WHERE id = $1 AND shop_id = $2 AND disabled_at IS NULL
      RETURNING id`,
    [staffId, user.shopId, specialties, phone],
  );
  if (updated.length === 0) {
    return { error: "That person isn't on this shop's team.", values };
  }

  revalidatePath("/app/team");
  revalidatePath("/app/technicians");
  redirect(back);
}

// -----------------------------------------------------------------------------
// Quick moves
// -----------------------------------------------------------------------------

/**
 * The moves the board offers, by where the ticket is now. The full stepper
 * lives on the ticket page; the board has the handful a tech reaches for
 * with greasy hands, plus the step back for "not quite yet".
 */
const BOARD_MOVES: Partial<Record<RoStatus, readonly RoStatus[]>> = {
  open: ["diagnosing", "in_progress"],
  diagnosing: ["in_progress"],
  awaiting_parts: ["in_progress"],
  in_progress: ["quality_check"],
  quality_check: ["ready", "in_progress"],
};

export async function moveTicket(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");
  const to = text(form, "to");
  const back = returnTo(form, "/app/technicians");

  if (!isRoStatus(to)) redirect(back);

  const origin = await requestOrigin();

  await tx(async (client) => {
    // Read the current stop under the shop's scope, and only move along an
    // edge the board actually drew — a stale tab that posts "ready" for a
    // ticket somebody already closed does nothing.
    const { rows } = await client.query<{ status: RoStatus }>(
      "SELECT status FROM repair_orders WHERE id = $1 AND shop_id = $2 FOR UPDATE",
      [repairOrderId, user.shopId],
    );
    const current = rows[0]?.status;
    if (!current || !BOARD_MOVES[current]?.includes(to)) return;

    await transitionRepairOrder(client, {
      shopId: user.shopId,
      repairOrderId,
      status: to,
      staffId: user.staffId,
      actor: "person",
      origin,
    });
  });

  revalidatePath("/app/technicians");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(back);
}

export async function assignTicket(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");
  const technicianId = text(form, "technician_id");
  const back = returnTo(form, "/app/technicians");

  await tx(async (client) => {
    await assignTechnician(client, {
      shopId: user.shopId,
      repairOrderId,
      technicianId: technicianId || null,
      staffId: user.staffId,
      actor: "person",
    });
  });

  revalidatePath("/app/technicians");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(back);
}
