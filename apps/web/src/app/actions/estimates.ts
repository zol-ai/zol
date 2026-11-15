"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { composeNote, draftEstimateNote } from "@/lib/ai/estimate";
import { requireUser } from "@/lib/auth";
import { query, tx } from "@/lib/db";
import {
  applyEstimateDecisions,
  ESTIMATE_TTL_DAYS,
  type Decision,
} from "@/lib/estimates";
import { logRoEvent } from "@/lib/events";
import { journeyMessage, queueFollowUp } from "@/lib/follow-ups";
import { formatCents } from "@/lib/money";
import { notifyShop } from "@/lib/notifications";
import { nextNumber } from "@/lib/numbering";
import { mintPortalToken, portalPath } from "@/lib/portal";
import { setRepairOrderStatus } from "@/lib/repair-orders-db";
import { requestOrigin } from "@/lib/request-origin";
import { totalsFor } from "@/lib/ro-totals";

/**
 * Estimates, from the advisor's side of the counter.
 *
 * Three moments: freezing the ticket's lines into a draft with a note the
 * customer can follow, sending it (which is when the ticket starts waiting
 * on them), and recording an answer given in person. The customer's own
 * answer arrives through actions/portal.ts; both roads end in
 * `applyEstimateDecisions` so they cannot disagree about what an answer does.
 *
 * Every action here is a one-click form: the panel already knows when a
 * button can't work (no lines, already sent) and says so instead of showing
 * it, so a failed guard below simply lands back on the ticket.
 */

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function ticketPath(repairOrderId: string): string {
  return `/app/repair-orders/${repairOrderId}#estimates`;
}

const NOTE_MAX = 2000;

// -----------------------------------------------------------------------------
// Draft
// -----------------------------------------------------------------------------

export async function createEstimate(form: FormData): Promise<void> {
  const user = await requireUser();
  const repairOrderId = text(form, "repair_order_id");

  // Everything the note needs, read outside the transaction: the model call
  // can take seconds and a row lock should never wait on OpenAI.
  const rows = await query<{
    id: string;
    customer_id: string;
    vehicle_id: string | null;
    complaint: string | null;
    tax_rate_pct: string;
    shop_name: string;
    vehicle: string | null;
    codes: string[] | null;
    verification: string | null;
    inspection_summary: string | null;
  }>(
    `SELECT ro.id, ro.customer_id, ro.vehicle_id, ro.complaint, s.tax_rate_pct,
            s.name AS shop_name,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            d.obd_codes AS codes, d.verification,
            i.summary->>'summary' AS inspection_summary
       FROM repair_orders ro
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN LATERAL (
         SELECT obd_codes, verification FROM diagnostics
          WHERE repair_order_id = ro.id AND verified_at IS NOT NULL
          ORDER BY verified_at DESC LIMIT 1) d ON true
       LEFT JOIN LATERAL (
         SELECT summary FROM inspections
          WHERE repair_order_id = ro.id AND completed_at IS NOT NULL
          ORDER BY completed_at DESC LIMIT 1) i ON true
      WHERE ro.id = $1 AND ro.shop_id = $2`,
    [repairOrderId, user.shopId],
  );
  const ro = rows[0];
  if (!ro) redirect("/app/repair-orders");

  const lines = await query<{
    id: string;
    kind: string;
    description: string;
    quantity: string;
    unit_cents: number;
    total_cents: number;
  }>(
    `SELECT id, kind, description, quantity::text, unit_cents, total_cents
       FROM repair_order_lines
      WHERE repair_order_id = $1 AND approval <> 'declined'
      ORDER BY position, created_at`,
    [ro.id],
  );
  if (lines.length === 0) redirect(ticketPath(ro.id));

  const note = await draftEstimateNote({
    shopName: ro.shop_name,
    vehicle: ro.vehicle,
    complaint: ro.complaint,
    diagnosis: ro.verification ? { codes: ro.codes ?? [], verification: ro.verification } : null,
    inspectionSummary: ro.inspection_summary,
    lines: lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      quantity: Number(line.quantity),
      unitCents: line.unit_cents,
      totalCents: line.total_cents,
    })),
  });

  const totals = totalsFor(lines, ro.tax_rate_pct);

  await tx(async (client) => {
    const number = await nextNumber(client, user.shopId, "estimate");
    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO estimates
         (shop_id, repair_order_id, customer_id, vehicle_id, number, status,
          subtotal_cents, tax_cents, total_cents, note, note_source, created_by)
       VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        user.shopId,
        ro.id,
        ro.customer_id,
        ro.vehicle_id,
        number,
        totals.subtotalCents,
        totals.taxCents,
        totals.totalCents,
        composeNote(note),
        // Stored with the note, so the panel says who wrote it rather than
        // guessing from whether a key is configured today.
        note.source,
        user.staffId,
      ],
    );
    const estimateId = inserted[0].id;

    // A copy, not a reference: the ticket keeps changing after this goes out,
    // and "you approved $457.23" has to be provable against what was shown.
    for (const [position, line] of lines.entries()) {
      await client.query(
        `INSERT INTO estimate_lines
           (estimate_id, repair_order_line_id, kind, description, quantity,
            unit_cents, total_cents, approval, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
        [estimateId, line.id, line.kind, line.description, line.quantity, line.unit_cents, line.total_cents, position],
      );
    }
  });

  revalidatePath(`/app/repair-orders/${ro.id}`);
  revalidatePath("/app/estimates");
  redirect(ticketPath(ro.id));
}

export async function saveEstimateNote(form: FormData): Promise<void> {
  const user = await requireUser();
  const estimateId = text(form, "estimate_id");
  // Browsers submit a textarea with CRLF line endings; the draft was stored
  // with LF. Normalise before comparing, or an untouched note reads as edited.
  const note = text(form, "note").replace(/\r\n/g, "\n").slice(0, NOTE_MAX);

  const rows = await query<{ repair_order_id: string }>(
    `UPDATE estimates
        SET note = $3,
            -- An edited note is the advisor's, whoever drafted it.
            note_source = CASE WHEN note IS DISTINCT FROM $3 THEN 'person' ELSE note_source END
      WHERE id = $1 AND shop_id = $2 AND status = 'draft'
      RETURNING repair_order_id`,
    [estimateId, user.shopId, note || null],
  );
  const row = rows[0];
  if (!row) redirect("/app/estimates");

  revalidatePath(`/app/repair-orders/${row.repair_order_id}`);
  redirect(ticketPath(row.repair_order_id));
}

// -----------------------------------------------------------------------------
// Send
// -----------------------------------------------------------------------------

/**
 * The estimate goes out and the ticket starts waiting.
 *
 * The note the advisor sees in the textarea is saved as part of the send, so
 * an edit made a second before pressing the button is the one the customer
 * reads. The link is a fresh portal token, minted here and carried in the
 * queued message — which is also how staff can see it afterwards: the
 * follow-up row keeps the exact text that went out.
 */
export async function sendEstimate(form: FormData): Promise<void> {
  const user = await requireUser();
  const estimateId = text(form, "estimate_id");
  // Browsers submit a textarea with CRLF line endings; the draft was stored
  // with LF. Normalise before comparing, or an untouched note reads as edited.
  const note = text(form, "note").replace(/\r\n/g, "\n").slice(0, NOTE_MAX);
  const origin = await requestOrigin();

  const repairOrderId = await tx(async (client) => {
    const { rows } = await client.query<{
      id: string;
      number: number;
      repair_order_id: string;
      customer_id: string;
      vehicle_id: string | null;
      total_cents: number;
      ro_number: number;
      full_name: string | null;
      sms_opted_out: boolean;
      vehicle: string | null;
      shop_name: string;
      public_phone: string | null;
    }>(
      `UPDATE estimates e
          SET status = 'sent', note = $3, sent_at = now(),
              note_source = CASE WHEN e.note IS DISTINCT FROM $3 THEN 'person' ELSE e.note_source END,
              expires_at = now() + interval '1 day' * $4
         FROM repair_orders ro, customers c, shops s
        WHERE e.id = $1 AND e.shop_id = $2 AND e.status = 'draft'
          AND ro.id = e.repair_order_id AND c.id = e.customer_id AND s.id = e.shop_id
        RETURNING e.id, e.number, e.repair_order_id, e.customer_id, e.vehicle_id,
                  e.total_cents, ro.number AS ro_number, c.full_name, c.sms_opted_out,
                  (SELECT nullif(concat_ws(' ', v.year::text, v.make, v.model), '')
                     FROM vehicles v WHERE v.id = e.vehicle_id) AS vehicle,
                  s.name AS shop_name, s.public_phone`,
      [estimateId, user.shopId, note || null, ESTIMATE_TTL_DAYS],
    );
    const estimate = rows[0];
    if (!estimate) return null;

    const token = await mintPortalToken(client, {
      shopId: user.shopId,
      customerId: estimate.customer_id,
      repairOrderId: estimate.repair_order_id,
    });
    const message = journeyMessage("estimate_ready", {
      shopName: estimate.shop_name,
      shopPhone: estimate.public_phone,
      firstName: estimate.full_name?.split(" ")[0] ?? null,
      vehicle: estimate.vehicle,
      roNumber: estimate.ro_number,
      portalUrl: origin + portalPath(token),
      totalCents: estimate.total_cents,
    });

    // Queued regardless of opt-out: the worker checks sms_opted_out at send
    // time and closes the row as cancelled ('opted out') without writing a
    // message — texted or portal. For those customers the link in the panel
    // (and the "share the link another way" notice below) is the only path.
    await queueFollowUp(client, {
      shopId: user.shopId,
      customerId: estimate.customer_id,
      repairOrderId: estimate.repair_order_id,
      vehicleId: estimate.vehicle_id,
      kind: "estimate_ready",
      title: message.title,
      details: `Estimate #${estimate.number} — ${formatCents(estimate.total_cents)}`,
      body: message.body,
      source: "person",
    });

    // This flow sends its own message, so the low-level move — the
    // transition's generic text would be a second, worse version of it.
    await setRepairOrderStatus(client, {
      shopId: user.shopId,
      repairOrderId: estimate.repair_order_id,
      status: "awaiting_approval",
      staffId: user.staffId,
      actor: "person",
      detail: `Estimate #${estimate.number} sent — waiting on the customer.`,
    });

    await logRoEvent(client, {
      shopId: user.shopId,
      repairOrderId: estimate.repair_order_id,
      kind: "estimate_sent",
      detail: `Estimate #${estimate.number} for ${formatCents(estimate.total_cents)} sent to the customer.`,
      actor: "person",
      staffId: user.staffId,
    });

    await notifyShop(client, user.shopId, {
      kind: "estimate",
      title: `Estimate #${estimate.number} sent`,
      body: `${estimate.full_name ?? "Customer"} · ${estimate.vehicle ?? "vehicle"} · ${formatCents(estimate.total_cents)}${estimate.sms_opted_out ? " — texts stopped; share the link another way" : ""}`,
      href: `/app/repair-orders/${estimate.repair_order_id}`,
    });

    return estimate.repair_order_id;
  });

  if (!repairOrderId) redirect("/app/estimates");

  revalidatePath(`/app/repair-orders/${repairOrderId}`);
  revalidatePath("/app/estimates");
  redirect(ticketPath(repairOrderId));
}

// -----------------------------------------------------------------------------
// Answered in person
// -----------------------------------------------------------------------------

/**
 * "She said yes on the phone." One line, or the whole estimate at once; the
 * person's name lands on the history row so the ticket says who heard it.
 */
export async function recordCounterDecision(form: FormData): Promise<void> {
  const user = await requireUser();
  const estimateId = text(form, "estimate_id");
  const lineId = text(form, "line_id");
  const decision = text(form, "decision");
  if (decision !== "approved" && decision !== "declined") redirect("/app/estimates");

  const origin = await requestOrigin();

  const result = await tx(async (client) => {
    const { rows: lines } = await client.query<{ id: string; approval: string }>(
      `SELECT l.id, l.approval FROM estimate_lines l
         JOIN estimates e ON e.id = l.estimate_id
        WHERE e.id = $1 AND e.shop_id = $2 AND e.status NOT IN ('draft', 'expired')`,
      [estimateId, user.shopId],
    );

    const decisions: Record<string, Decision> = {};
    for (const line of lines) {
      if (lineId ? line.id === lineId : line.approval === "pending") {
        decisions[line.id] = decision;
      }
    }
    if (Object.keys(decisions).length === 0) return null;

    return applyEstimateDecisions(client, {
      shopId: user.shopId,
      estimateId,
      decisions,
      actor: "person",
      staffId: user.staffId,
      origin,
    });
  });

  if (!result) redirect("/app/estimates");

  revalidatePath(`/app/repair-orders/${result.repairOrderId}`);
  revalidatePath("/app/estimates");
  revalidatePath("/app/declined");
  redirect(ticketPath(result.repairOrderId));
}
