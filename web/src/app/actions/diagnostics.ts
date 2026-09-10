"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { analyze, isObdCode, parseCodes } from "@/lib/ai/diagnostics";
import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import { logRoEvent } from "@/lib/events";
import { vehicleLabel } from "@/lib/format";
import { transitionRepairOrder } from "@/lib/repair-orders-db";
import { requestOrigin } from "@/lib/request-origin";
import type { RoStatus } from "@/lib/statuses";
import type { FormState } from "./auth";

/**
 * Diagnostics — why is it doing that.
 *
 * Two writes, one by the model and one by a person, and they are kept apart
 * on the row. `runDiagnostic` stores what the technician entered and what the
 * model (or the fallback table) ranked from it. `verifyDiagnostic` stores the
 * technician's conclusion, and only that conclusion ever becomes the ticket's
 * `cause` — the ranking is a suggestion, and a suggestion does not go on an
 * estimate.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function ticketPath(id: string): string {
  return `/app/repair-orders/${id}#diagnostics`;
}

export async function runDiagnostic(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const repairOrderId = text(form, "repair_order_id");
  const rawCodes = text(form, "codes");
  const symptoms = text(form, "symptoms");
  const observations = text(form, "observations");

  const values = { codes: rawCodes, symptoms, observations };
  const fields: Record<string, string> = {};

  // Anything typed into the codes box that isn't a code is a typo worth
  // catching now: "PO301" with a letter O is the classic, and it would
  // otherwise be dropped silently and the coil never mentioned.
  const tokens = rawCodes.split(/[\s,;/]+/).filter(Boolean);
  const bad = tokens.filter((token) => !isObdCode(token));
  if (bad.length > 0) {
    fields.codes = `${bad.slice(0, 3).join(", ")} ${bad.length === 1 ? "isn't" : "aren't"} OBD codes — P, B, C or U followed by four characters (zero, not the letter O).`;
  }
  const codes = parseCodes(rawCodes);
  if (codes.length === 0 && symptoms.length < 3) {
    fields.symptoms = "Give it something to work with: a code, or what the car is doing.";
  }
  if (symptoms.length > 2000) fields.symptoms = "Keep it under 2,000 characters.";
  if (observations.length > 2000) fields.observations = "Keep it under 2,000 characters.";
  if (Object.keys(fields).length > 0) return { fields, values };

  const rows = await query<{
    status: RoStatus;
    complaint: string | null;
    mileage_in: number | null;
    vehicle_id: string | null;
    technician_id: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
  }>(
    `SELECT ro.status, ro.complaint, ro.mileage_in, ro.vehicle_id, ro.technician_id,
            v.year, v.make, v.model, v.trim
       FROM repair_orders ro
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.id = $1 AND ro.shop_id = $2`,
    [repairOrderId, user.shopId],
  );
  const ro = rows[0];
  if (!ro) redirect("/app/repair-orders");

  // Outside the transaction: a model call can take twenty seconds and must
  // not hold a connection and a row lock while it does.
  const outcome = await analyze({
    codes,
    symptoms: symptoms || null,
    observations: observations || null,
    vehicle: vehicleLabel(ro),
    mileage: ro.mileage_in,
    complaint: ro.complaint,
  });

  const origin = await requestOrigin();

  await tx(async (client) => {
    await client.query(
      `INSERT INTO diagnostics
         (shop_id, repair_order_id, vehicle_id, technician_id, obd_codes,
          symptoms, observations, ai_result, ai_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        user.shopId,
        repairOrderId,
        ro.vehicle_id,
        // The tech on the ticket, or whoever is at the scanner.
        ro.technician_id ?? user.staffId,
        codes,
        symptoms || null,
        observations || null,
        JSON.stringify(outcome.result),
        outcome.source,
      ],
    );

    const top = outcome.result.causes[0];
    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "diagnostic_added",
      detail:
        `Diagnostic run${codes.length > 0 ? ` on ${codes.join(", ")}` : ""}` +
        ` — top cause: ${top.title} (${top.confidence}%).` +
        (outcome.source === "fallback" ? " Fallback guidance, no model." : ""),
      actor: "person",
      staffId: user.staffId,
    });

    // Running codes on an open ticket is what "diagnosing" means.
    if (ro.status === "open") {
      await transitionRepairOrder(client, {
        shopId: user.shopId,
        repairOrderId,
        status: "diagnosing",
        staffId: user.staffId,
        actor: "person",
        origin,
      });
    }
  });

  revalidatePath("/app/repair-orders");
  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}

/**
 * The technician's verdict. Copied into the ticket's `cause` when there isn't
 * one yet — never over one an advisor already wrote — so the estimate can be
 * built from a person's words rather than the model's.
 */
export async function verifyDiagnostic(
  _state: FormState | undefined,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const diagnosticId = text(form, "diagnostic_id");
  const repairOrderId = text(form, "repair_order_id");
  const verification = text(form, "verification");

  const values = { verification };
  if (verification.length < 3) {
    return { fields: { verification: "What did you confirm?" }, values };
  }
  if (verification.length > 2000) {
    return { fields: { verification: "Keep it under 2,000 characters." }, values };
  }

  await tx(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE diagnostics
          SET verification = $4, verified_by = $3, verified_at = now()
        WHERE id = $1 AND shop_id = $2 AND repair_order_id = $5
        RETURNING id`,
      [diagnosticId, user.shopId, user.staffId, verification, repairOrderId],
    );
    if (rows.length === 0) return;

    await client.query(
      `UPDATE repair_orders
          SET cause = coalesce(nullif(cause, ''), $3)
        WHERE id = $1 AND shop_id = $2`,
      [repairOrderId, user.shopId, verification],
    );

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId,
      kind: "diagnostic_verified",
      detail: `Verified: ${verification.length > 140 ? `${verification.slice(0, 137)}…` : verification}`,
      actor: "person",
      staffId: user.staffId,
    });
  });

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  redirect(ticketPath(repairOrderId));
}
