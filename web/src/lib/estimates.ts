import "server-only";

import { query, type Queryable } from "./db";
import { logRoEvent } from "./events";
import { journeyMessage, queueFollowUp } from "./follow-ups";
import { formatCents } from "./money";
import { notifyShop } from "./notifications";
import { setRepairOrderStatus } from "./repair-orders-db";
import { recalculateOne } from "./ro-totals";
import type { Approval, EstimateStatus } from "./statuses";

/**
 * The estimate, and the customer's answer to it.
 *
 * An estimate is the ticket's lines frozen at the moment they were sent, and
 * the answer comes back one line at a time — from the customer's phone via
 * the portal, or from an advisor recording "she said yes to the brakes but
 * not the wipers" at the counter. Both doors land in `applyEstimateDecisions`
 * below, because everything that has to happen as a consequence (the ticket's
 * own lines updated, the total recomputed, declined work on the recall list,
 * the ticket moved, the shop told) has to happen identically whichever door
 * the answer came through.
 */

export type Decision = Extract<Approval, "approved" | "declined">;

/** How long a sent estimate stays open before the portal stops taking answers. */
export const ESTIMATE_TTL_DAYS = 14;

/** How long declined work waits on the recall list before it comes up again. */
const DECLINED_RECALL_MONTHS = 6;

// -----------------------------------------------------------------------------
// Pure helpers — no database, unit-tested in estimates.test.ts
// -----------------------------------------------------------------------------

/**
 * What the estimate's status should read once its lines have been answered.
 *
 * Every line answered and all yes → approved; all no → declined; a mix →
 * partial. Lines still pending after a partial answer (an advisor recorded
 * one line at the counter) also read as partial: the estimate is no longer
 * "sent", but it isn't finished either. Nothing answered yet → null, meaning
 * leave the status where it was.
 */
export function estimateStatusFromLines(
  lines: readonly { approval: Approval | string }[],
): Extract<EstimateStatus, "approved" | "partial" | "declined"> | null {
  if (lines.length === 0) return null;
  const approved = lines.filter((line) => line.approval === "approved").length;
  const declined = lines.filter((line) => line.approval === "declined").length;
  if (approved + declined === 0) return null;
  if (approved === lines.length) return "approved";
  if (declined === lines.length) return "declined";
  return "partial";
}

/**
 * Read per-line answers out of a submitted form. Each line is a radio group
 * named `line:<id>`; anything that isn't exactly "approved" or "declined" is
 * ignored, and only ids the caller knows about are kept — the form is public
 * on the portal, so a stray id must never reach an UPDATE.
 */
export function decisionsFromForm(
  form: FormData,
  lineIds: readonly string[],
): Record<string, Decision> {
  const decisions: Record<string, Decision> = {};
  for (const id of lineIds) {
    const value = form.get(`line:${id}`);
    if (value === "approved" || value === "declined") decisions[id] = value;
  }
  return decisions;
}

/**
 * One sentence for the timeline: "Estimate #2041 — approved: MAP sensor,
 * labour; declined: shop supplies." Written from the line descriptions so a
 * year later the history says what was agreed without opening the estimate.
 */
export function describeDecisions(
  number: number,
  lines: readonly { description: string; approval: Approval | string }[],
): string {
  const approved = lines.filter((line) => line.approval === "approved").map((line) => line.description);
  const declined = lines.filter((line) => line.approval === "declined").map((line) => line.description);
  const parts: string[] = [];
  if (approved.length > 0) parts.push(`approved: ${approved.join(", ")}`);
  if (declined.length > 0) parts.push(`declined: ${declined.join(", ")}`);
  if (parts.length === 0) return `Estimate #${number} — no answer recorded.`;
  return `Estimate #${number} — ${parts.join("; ")}.`;
}

/** True once a sent estimate's window has closed. Drafts and answered ones never expire. */
export function isEstimateExpired(
  estimate: { status: EstimateStatus | string; expires_at: string | Date | null },
  now = new Date(),
): boolean {
  if (estimate.status !== "sent" && estimate.status !== "viewed") return false;
  if (!estimate.expires_at) return false;
  return new Date(estimate.expires_at).getTime() < now.getTime();
}

// -----------------------------------------------------------------------------
// Rows
// -----------------------------------------------------------------------------

export interface EstimateRow {
  id: string;
  repair_order_id: string;
  customer_id: string;
  vehicle_id: string | null;
  number: number;
  status: EstimateStatus;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  note: string | null;
  /** Who wrote the note: the model, the template, or the advisor. */
  note_source: "openai" | "fallback" | "person" | null;
  sent_at: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  expires_at: string | null;
  created_at: string;
  created_by_name: string | null;
}

export interface EstimateLineRow {
  id: string;
  estimate_id: string;
  repair_order_line_id: string | null;
  kind: string;
  description: string;
  /** numeric(8,2) comes back from pg as a string. */
  quantity: string;
  unit_cents: number;
  total_cents: number;
  approval: Approval;
  position: number;
}

const ESTIMATE_COLUMNS = `
  e.id, e.repair_order_id, e.customer_id, e.vehicle_id, e.number, e.status,
  e.subtotal_cents, e.tax_cents, e.total_cents, e.note, e.note_source,
  e.sent_at::text, e.viewed_at::text, e.responded_at::text, e.expires_at::text,
  e.created_at::text, s.full_name AS created_by_name`;

/** Every estimate on a ticket, newest first, with its lines. */
export async function listEstimatesForRepairOrder(
  shopId: string,
  repairOrderId: string,
): Promise<{ estimate: EstimateRow; lines: EstimateLineRow[] }[]> {
  const estimates = await query<EstimateRow>(
    `SELECT ${ESTIMATE_COLUMNS}
       FROM estimates e
       LEFT JOIN staff s ON s.id = e.created_by
      WHERE e.repair_order_id = $1 AND e.shop_id = $2
      ORDER BY e.created_at DESC`,
    [repairOrderId, shopId],
  );
  if (estimates.length === 0) return [];

  const lines = await query<EstimateLineRow>(
    `SELECT l.id, l.estimate_id, l.repair_order_line_id, l.kind, l.description,
            l.quantity::text, l.unit_cents, l.total_cents, l.approval, l.position
       FROM estimate_lines l
       JOIN estimates e ON e.id = l.estimate_id
      WHERE e.repair_order_id = $1 AND e.shop_id = $2
      ORDER BY l.position, l.id`,
    [repairOrderId, shopId],
  );

  return estimates.map((estimate) => ({
    estimate,
    lines: lines.filter((line) => line.estimate_id === estimate.id),
  }));
}

/** The newest estimate on a ticket, for the portal. */
export async function latestEstimateForRepairOrder(
  shopId: string,
  repairOrderId: string,
): Promise<{ estimate: EstimateRow; lines: EstimateLineRow[] } | null> {
  const all = await listEstimatesForRepairOrder(shopId, repairOrderId);
  return all[0] ?? null;
}

// -----------------------------------------------------------------------------
// The customer opened it
// -----------------------------------------------------------------------------

/**
 * First view of a sent estimate: stamp `viewed_at`, move the status on, tell
 * the shop. Guarded on `viewed_at IS NULL` so the second and hundredth opens
 * are no-ops — the notification is "they've seen it", not "they refreshed".
 */
export async function markEstimateViewed(
  client: Queryable,
  args: { shopId: string; estimateId: string },
): Promise<boolean> {
  const { rows } = await client.query<{
    number: number;
    repair_order_id: string;
    total_cents: number;
    customer_name: string | null;
  }>(
    `UPDATE estimates e
        SET viewed_at = now(),
            status = CASE WHEN e.status = 'sent' THEN 'viewed' ELSE e.status END
       FROM customers c
      WHERE e.id = $1 AND e.shop_id = $2 AND e.viewed_at IS NULL
        AND c.id = e.customer_id
      RETURNING e.number, e.repair_order_id, e.total_cents, c.full_name AS customer_name`,
    [args.estimateId, args.shopId],
  );
  const row = rows[0];
  if (!row) return false;

  await logRoEvent(client, {
    shopId: args.shopId,
    repairOrderId: row.repair_order_id,
    kind: "estimate_viewed",
    detail: `Customer opened estimate #${row.number}.`,
    actor: "zol",
  });
  await notifyShop(client, args.shopId, {
    kind: "estimate",
    title: `Estimate #${row.number} opened`,
    body: `${row.customer_name ?? "The customer"} opened the ${formatCents(row.total_cents)} estimate. No answer yet.`,
    href: `/app/repair-orders/${row.repair_order_id}`,
  });
  return true;
}

/**
 * Lazily retire an estimate whose window has closed. Called from the portal
 * on render rather than by a cron, because the only moment it matters is
 * when somebody tries to answer it.
 */
export async function expireEstimateIfDue(
  client: Queryable,
  args: { shopId: string; estimateId: string },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE estimates SET status = 'expired'
      WHERE id = $1 AND shop_id = $2
        AND status IN ('sent', 'viewed')
        AND expires_at IS NOT NULL AND expires_at < now()`,
    [args.estimateId, args.shopId],
  );
  return Boolean(rowCount);
}

// -----------------------------------------------------------------------------
// The answer
// -----------------------------------------------------------------------------

export interface ApplyDecisionsInput {
  shopId: string;
  estimateId: string;
  /** estimate_lines.id → answer. Lines not mentioned keep their current value. */
  decisions: Record<string, Decision>;
  /** 'zol' when the customer answered on the portal; 'person' at the counter. */
  actor: "zol" | "person";
  staffId?: string | null;
  /** Public origin, for the link in the customer's confirmation. */
  origin: string;
}

export interface ApplyDecisionsResult {
  number: number;
  repairOrderId: string;
  status: EstimateStatus;
  approvedCount: number;
  declinedCount: number;
  /** Where the ticket ended up, if it moved. */
  movedTo: "in_progress" | "awaiting_parts" | null;
}

/**
 * Record the answer to an estimate, wherever it came from.
 *
 * Runs inside the caller's transaction. In order:
 *
 *   1. Lock the estimate; refuse if it isn't this shop's.
 *   2. Write each decision onto the estimate line and mirror it onto the
 *      ticket line it was copied from. The estimate is the record of what was
 *      shown; the ticket line is what the total and the invoice read.
 *   3. Recompute the ticket total — declined lines leave it.
 *   4. Set the estimate's status from its lines and stamp responded_at.
 *   5. Every declined line becomes a declined_work row with a six-month
 *      reminder. That table is the recall list, and this is the moment the
 *      shop is most likely to forget to fill it in.
 *   6. One history row saying exactly what was approved and declined.
 *   7. If anything was approved and the ticket was waiting on the answer, it
 *      moves: to awaiting_parts when a part is still on order, else to
 *      in_progress. Everything declined leaves it where it was — the advisor
 *      decides what happens to a job nobody wants done.
 *   8. Tell the shop, and thank the customer (unless they've opted out).
 */
export async function applyEstimateDecisions(
  client: Queryable,
  input: ApplyDecisionsInput,
): Promise<ApplyDecisionsResult | null> {
  const { rows: estimates } = await client.query<{
    id: string;
    number: number;
    repair_order_id: string;
    customer_id: string;
    vehicle_id: string | null;
    status: EstimateStatus;
  }>(
    `SELECT id, number, repair_order_id, customer_id, vehicle_id, status
       FROM estimates WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
    [input.estimateId, input.shopId],
  );
  const estimate = estimates[0];
  if (!estimate) return null;

  const { rows: lines } = await client.query<EstimateLineRow>(
    `SELECT id, estimate_id, repair_order_line_id, kind, description, quantity::text,
            unit_cents, total_cents, approval, position
       FROM estimate_lines WHERE estimate_id = $1 ORDER BY position, id`,
    [estimate.id],
  );

  let touched = 0;
  for (const line of lines) {
    const decision = input.decisions[line.id];
    if (!decision) continue;
    touched += 1;
    line.approval = decision;

    await client.query("UPDATE estimate_lines SET approval = $2 WHERE id = $1", [line.id, decision]);
    if (line.repair_order_line_id) {
      // The join back to the ticket is the tenancy check for the line.
      await client.query(
        `UPDATE repair_order_lines l
            SET approval = $3,
                approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE NULL END
           FROM repair_orders ro
          WHERE l.id = $1 AND l.repair_order_id = ro.id
            AND ro.id = $2 AND ro.shop_id = $4`,
        [line.repair_order_line_id, estimate.repair_order_id, decision, input.shopId],
      );
    }
  }

  if (touched === 0) {
    return {
      number: estimate.number,
      repairOrderId: estimate.repair_order_id,
      status: estimate.status,
      approvedCount: 0,
      declinedCount: 0,
      movedTo: null,
    };
  }

  await recalculateOne(client, estimate.repair_order_id, input.shopId);

  const status = estimateStatusFromLines(lines) ?? estimate.status;
  await client.query(
    `UPDATE estimates SET status = $3, responded_at = now()
      WHERE id = $1 AND shop_id = $2`,
    [estimate.id, input.shopId, status],
  );

  // Declined lines → the recall list. Keyed on the ticket and the wording so
  // an answer that arrives twice (a retry, a second person at the counter)
  // doesn't put the same job on the list twice.
  const declinedNow = lines.filter(
    (line) => input.decisions[line.id] === "declined",
  );
  for (const line of declinedNow) {
    await client.query(
      `INSERT INTO declined_work
         (shop_id, customer_id, vehicle_id, repair_order_id, description,
          estimated_cents, remind_after)
       SELECT $1, $2, $3, $4, $5, $6, now() + interval '1 month' * $7
        WHERE NOT EXISTS (
          SELECT 1 FROM declined_work
           WHERE repair_order_id = $4 AND description = $5 AND resolved_at IS NULL)`,
      [
        input.shopId,
        estimate.customer_id,
        estimate.vehicle_id,
        estimate.repair_order_id,
        line.description,
        line.total_cents,
        DECLINED_RECALL_MONTHS,
      ],
    );
  }

  const approvedCount = lines.filter((line) => line.approval === "approved").length;
  const declinedCount = lines.filter((line) => line.approval === "declined").length;
  const approvedNow = lines.some((line) => input.decisions[line.id] === "approved");

  await logRoEvent(client, {
    shopId: input.shopId,
    repairOrderId: estimate.repair_order_id,
    kind: "estimate_responded",
    detail: describeDecisions(
      estimate.number,
      lines.filter((line) => input.decisions[line.id]),
    ),
    actor: input.actor,
    staffId: input.staffId ?? null,
  });

  const { rows: ros } = await client.query<{
    number: number;
    status: string;
    total_cents: number;
    full_name: string | null;
    sms_opted_out: boolean;
    vehicle: string | null;
    shop_name: string;
    public_phone: string | null;
    parts_outstanding: boolean;
  }>(
    `SELECT ro.number, ro.status, ro.total_cents,
            c.full_name, c.sms_opted_out,
            nullif(concat_ws(' ', v.year::text, v.make, v.model), '') AS vehicle,
            s.name AS shop_name, s.public_phone,
            EXISTS (SELECT 1 FROM parts p
                     WHERE p.repair_order_id = ro.id
                       AND p.status IN ('needed', 'requested', 'ordered')) AS parts_outstanding
       FROM repair_orders ro
       JOIN customers c ON c.id = ro.customer_id
       JOIN shops s ON s.id = ro.shop_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
      WHERE ro.id = $1 AND ro.shop_id = $2`,
    [estimate.repair_order_id, input.shopId],
  );
  const ro = ros[0];

  let movedTo: ApplyDecisionsResult["movedTo"] = null;
  if (ro && approvedNow && ["open", "diagnosing", "awaiting_approval"].includes(ro.status)) {
    movedTo = ro.parts_outstanding ? "awaiting_parts" : "in_progress";
    // The low-level move: the "approved" message below is this flow's own
    // word to the customer, so the transition's generic one would double up.
    await setRepairOrderStatus(client, {
      shopId: input.shopId,
      repairOrderId: estimate.repair_order_id,
      status: movedTo,
      actor: input.actor,
      staffId: input.staffId ?? null,
      detail:
        movedTo === "awaiting_parts"
          ? `Approved — waiting on parts before work starts.`
          : `Approved — work can start.`,
    });
  }

  if (ro) {
    const who = ro.full_name ?? "The customer";
    const pendingCount = lines.length - approvedCount - declinedCount;
    const plural = lines.length === 1 ? "" : "s";
    // The bell has to be honest about a half-answered estimate: one line
    // recorded at the counter is not "approved everything".
    const summary =
      pendingCount === 0 && declinedCount === 0
        ? `${who} approved all ${lines.length} line${plural} — ${formatCents(ro.total_cents)}.`
        : pendingCount === 0 && approvedCount === 0
          ? `${who} declined everything on estimate #${estimate.number}.`
          : `${who} approved ${approvedCount} of ${lines.length} line${plural} — ${formatCents(ro.total_cents)}.` +
            (declinedCount > 0 ? ` ${declinedCount} declined, now on the recall list.` : "") +
            (pendingCount > 0 ? ` ${pendingCount} still to answer.` : "");

    await notifyShop(client, input.shopId, {
      kind: "estimate",
      title:
        input.actor === "person"
          ? `Estimate #${estimate.number} recorded at the counter`
          : `Estimate #${estimate.number} answered`,
      body: summary,
      href: `/app/repair-orders/${estimate.repair_order_id}`,
    });

    if (approvedNow && !ro.sms_opted_out) {
      const message = journeyMessage("approved", {
        shopName: ro.shop_name,
        shopPhone: ro.public_phone,
        firstName: ro.full_name?.split(" ")[0] ?? null,
        vehicle: ro.vehicle,
        roNumber: ro.number,
      });
      await queueFollowUp(client, {
        shopId: input.shopId,
        customerId: estimate.customer_id,
        repairOrderId: estimate.repair_order_id,
        vehicleId: estimate.vehicle_id,
        kind: "approved",
        title: message.title,
        body: message.body,
        source: input.actor,
      });
    }
  }

  return {
    number: estimate.number,
    repairOrderId: estimate.repair_order_id,
    status,
    approvedCount,
    declinedCount,
    movedTo,
  };
}
